# config/middleware.py
"""可选写接口令牌(2026-11-12)。

`nav` 的写接口本来没有登录体系(本地自用工具)。这里给一个"开关式"的最低成本防线:
配了 `NAV_WRITE_TOKEN` 就要求所有写请求带令牌,不配就完全放行 —— 本地开发、现有
342 项测试、Vercel 预览都不受影响,只有公网部署想收紧时才设环境变量。

设计取舍:
- 只管 `/api/nav/` 前缀 + 写方法;GET/HEAD/OPTIONS 永远放行,浏览页面不受影响。
- 令牌来源二选一:请求头 `X-Nav-Write-Token`(推荐)或 cookie `nav_token`。
  cookie 靠 `?nav_token=xxx` 访问任意路径时写入一次,之后浏览器自动带 —— 但查询串
  会进历史/Referer/日志,所以它只当"首次引导",日常请用请求头。
- cookie 是 HttpOnly + (HTTPS 时) Secure:前端从不读它,只有中间件自己用。
"""

import hmac
import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.http import HttpResponseRedirect, JsonResponse

logger = logging.getLogger('nav')


NAV_WRITE_TOKEN_ENV = 'NAV_WRITE_TOKEN'   # 令牌环境变量名(空/未设 = 不启用)

NAV_WRITE_TOKEN_HEADER = 'X-Nav-Write-Token'

NAV_WRITE_TOKEN_COOKIE = 'nav_token'

NAV_WRITE_TOKEN_QUERY = 'nav_token'

NAV_WRITE_METHODS = ('POST', 'PUT', 'PATCH', 'DELETE')

NAV_WRITE_PATH_PREFIX = '/api/nav/'

# 2026-11-24:只读型抓取豁免 —— 游客端给本机书签点「识别标题/图标」时也要用这个端点。
# 它不写库,且视图自带 @require_POST + _guard_public_url / _safe_get(挡内网与 302 内网),
# 不放开的话游客只能手填标题/图标。
NAV_WRITE_EXEMPT_PATHS = ('/api/nav/fetch-meta/',)

NAV_WRITE_TOKEN_MAX_AGE = 30 * 24 * 3600   # 浏览器里记 30 天,省得每次开机都要重设

WRITE_OPEN_WARNED = [False]   # 只在进程内提醒一次,避免每个请求刷一条日志


def _token_eq(a, b):
    """常量时间比较;encode 成 bytes 是为了兼容含非 ASCII 的令牌。"""
    return hmac.compare_digest(str(a).encode('utf-8'), str(b).encode('utf-8'))


def _nav_write_token():
    """当前配置的写令牌;空串表示未启用(每次请求现读,改环境变量不必重启进程)。"""
    return (os.environ.get(NAV_WRITE_TOKEN_ENV) or '').strip()


class WriteTokenMiddleware:
    """配置了 NAV_WRITE_TOKEN 时,校验 /api/nav/ 下写请求的令牌。"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _nav_write_token()
        if not token:                      # 未配置:本地/预览环境完全无感
            if not settings.DEBUG and not WRITE_OPEN_WARNED[0]:
                # 公网 + 未配置令牌 = 任何访客都能改数据。不阻断(会锁死既有部署),
                # 但必须在日志里留一条,免得"忘了配"一直没人发现。
                WRITE_OPEN_WARNED[0] = True
                logger.warning('NAV_WRITE_TOKEN 未配置:所有写接口对公网开放,'
                               '建议在环境变量里设置一个长随机串')
            return self.get_response(request)

        # ?nav_token=xxx:任意路径访问都行,值对就写 cookie 然后照常处理该请求。
        # 放在写校验之前判断,所以"带 ?nav_token= 的写请求"也能一次通过并记住令牌。
        # ⚠️ 令牌会进浏览器历史/Referer/日志,只用于首次引导;日常请走请求头。
        query_token = request.GET.get(NAV_WRITE_TOKEN_QUERY)
        if query_token is not None and _token_eq(query_token, token):
            response = self.get_response(request)
            response.set_cookie(NAV_WRITE_TOKEN_COOKIE, token,
                                max_age=NAV_WRITE_TOKEN_MAX_AGE,
                                httponly=True,          # 前端从不读它(只给中间件自己用)
                                secure=request.is_secure(),
                                samesite='Lax')
            return response

        if (request.method in NAV_WRITE_METHODS
                and request.path.startswith(NAV_WRITE_PATH_PREFIX)
                and request.path not in NAV_WRITE_EXEMPT_PATHS):
            supplied = (request.headers.get(NAV_WRITE_TOKEN_HEADER)
                        or request.COOKIES.get(NAV_WRITE_TOKEN_COOKIE) or '').strip()
            # 常量时间比较:避免按字节猜令牌
            if not _token_eq(supplied, token):
                return JsonResponse({'status': 'error', 'message': '未授权'}, status=403)
        return self.get_response(request)


# ============================================================
# 访客准入答题(2026-11-25)
# ============================================================
#
# 为什么中间件读快照而不是查库:访客页有"零数据库查询"契约
# (tests_nav_guest.test_guest_page_is_readonly_and_zero_queries),中间件每请求查库会直接破掉它。
# 题目/提示/一个不可逆的 key 由 export_nav_public 写进 nav-public.json;答案只留在库里。
#
# 换题或改答案 → key 变 → 老通行 cookie 立刻失效,不用手动清。
# 未配置(快照里 gate.enabled=false)→ 完全放行,本地开发无感。

NAV_QUIZ_COOKIE = 'nav_gate_pass'
NAV_QUIZ_MAX_AGE = 30 * 24 * 3600
NAV_QUIZ_PATH = '/nav/quiz/'
NAV_GATE_PREFIXES = ('/nav/', '/api/nav/')
NAV_QUIZ_EXEMPT_PATHS = ('/nav/quiz/', '/nav/login/', '/nav/logout/')
NAV_QUIZ_FAIL_WINDOW = 60          # 同一 IP 60 秒最多错 8 次,挡脚本穷举
NAV_QUIZ_FAIL_MAX = 8

NAV_GATE_CACHE_SECONDS = 120       # 进程内缓存:后台改完最多 2 分钟在整个实例组里生效

_GATE_CACHE = {'ts': 0.0, 'gate': {}}
_QUIZ_FAILS = {}


def reset_gate_cache():
    """配置保存后调一次:本实例立刻按新配置判定,不用等缓存过期。"""
    _GATE_CACHE['ts'] = 0.0
    _GATE_CACHE['gate'] = {}


def public_gate():
    """当前访客准入配置(题目/提示/key)。

    读数据库,不读公开快照:Vercel 部署目录只读,后台改完题写不进快照,
    读快照会出现"保存了但不生效"。代价是每个实例首个请求多一条极小的查询,
    之后走进程内缓存;库不可用/未迁移时按"未启用"处理,绝不把整站锁死。
    """
    now = time.monotonic()
    if _GATE_CACHE['ts'] and now - _GATE_CACHE['ts'] < NAV_GATE_CACHE_SECONDS:
        return dict(_GATE_CACHE['gate'])
    gate = {}
    try:
        from nav.management.commands.export_nav_public import gate_payload
        from nav.models import NavPublicConfig
        gate = gate_payload(NavPublicConfig.current())
    except Exception as exc:            # 未迁移/库没连上:当未启用,别锁站
        logger.warning('读取访客准入配置失败,按未启用处理:%s', exc)
        gate = {}
    _GATE_CACHE.update({'ts': now, 'gate': gate})
    return dict(gate)


def quiz_pass_token(key):
    """通行 cookie 的值:拿快照里的 key 再做一次 HMAC,伪造不出。"""
    return hmac.new((settings.SECRET_KEY or '').encode('utf-8'),
                    ('nav-quiz-pass:' + str(key or '')).encode('utf-8'), 'sha256').hexdigest()[:24]


def quiz_pass_valid(request, key):
    value = request.COOKIES.get(NAV_QUIZ_COOKIE, '')
    return bool(value and key) and hmac.compare_digest(value, quiz_pass_token(key))


def _client_ip(request):
    forwarded = (request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
    return forwarded or (request.META.get('REMOTE_ADDR') or '')


def quiz_rate_limited(ip):
    now = time.monotonic()
    hist = [t for t in _QUIZ_FAILS.get(ip, []) if now - t < NAV_QUIZ_FAIL_WINDOW]
    _QUIZ_FAILS[ip] = hist
    return len(hist) >= NAV_QUIZ_FAIL_MAX


def record_quiz_fail(ip):
    _QUIZ_FAILS.setdefault(ip, []).append(time.monotonic())


def reset_quiz_rate_limit():
    """测试用:清空限流计数。"""
    _QUIZ_FAILS.clear()


class QuizGateMiddleware:
    """访客准入:没答对题的人进不了 `/nav/` 与 `/api/nav/`。"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        gate = public_gate()
        if not gate.get('enabled'):            # 没开:本地/预览完全无感
            return self.get_response(request)
        token = _nav_write_token()
        if not token:                          # 没配主人令牌 = 单机自用,根本不存在"访客"
            return self.get_response(request)
        supplied = (request.headers.get(NAV_WRITE_TOKEN_HEADER)
                    or request.COOKIES.get(NAV_WRITE_TOKEN_COOKIE)
                    or request.GET.get(NAV_WRITE_TOKEN_QUERY) or '').strip()
        if _token_eq(supplied, token):         # 主人免检
            return self.get_response(request)
        path = request.path
        if not path.startswith(NAV_GATE_PREFIXES):
            return self.get_response(request)
        if any(path.startswith(p) for p in NAV_QUIZ_EXEMPT_PATHS):
            return self.get_response(request)
        if quiz_pass_valid(request, gate.get('key')):
            return self.get_response(request)
        if path.startswith('/api/nav/'):
            return JsonResponse({'status': 'error', 'message': '先答对访客题:浏览器打开 /nav/ 答一次即可'},
                                status=403)
        return HttpResponseRedirect(NAV_QUIZ_PATH + '?next=' + quote(request.get_full_path()))
