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
import logging
import os

from django.conf import settings
from django.http import JsonResponse

logger = logging.getLogger('nav')


NAV_WRITE_TOKEN_ENV = 'NAV_WRITE_TOKEN'   # 令牌环境变量名(空/未设 = 不启用)

NAV_WRITE_TOKEN_HEADER = 'X-Nav-Write-Token'

NAV_WRITE_TOKEN_COOKIE = 'nav_token'

NAV_WRITE_TOKEN_QUERY = 'nav_token'

NAV_WRITE_METHODS = ('POST', 'PUT', 'PATCH', 'DELETE')

NAV_WRITE_PATH_PREFIX = '/api/nav/'

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

        if request.method in NAV_WRITE_METHODS and request.path.startswith(NAV_WRITE_PATH_PREFIX):
            supplied = (request.headers.get(NAV_WRITE_TOKEN_HEADER)
                        or request.COOKIES.get(NAV_WRITE_TOKEN_COOKIE) or '').strip()
            # 常量时间比较:避免按字节猜令牌
            if not _token_eq(supplied, token):
                return JsonResponse({'status': 'error', 'message': '未授权'}, status=403)
        return self.get_response(request)
