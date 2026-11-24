# nav/views_nav_ai.py
"""AI 找站:配置、生成、解析、导入、元数据抓取(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""

from .views_nav_base import NAV_AI_IMPORT_MAX, owner_only, _NAV_META_UA, _clean_nav_tags, _json_body, _normalize_nav_url, _parse_site_meta, _safe_get, logger
from django.views.decorators.http import require_POST, require_http_methods
from .views_nav_check import NAV_LINK_TOTAL_TIMEOUT, _nav_check_links, _nav_is_same_site, _nav_site_key

from . import ai as ai_pipeline
from .ai import AiNotConfigured  # noqa: E402  置于模块底部导入区之后,保持依赖方向干净
from .models import NavSite, NavCategory, NavTool, NavAiConfig, NavAiCallLog
from concurrent.futures import ThreadPoolExecutor, as_completed
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from urllib.parse import urlparse, urljoin
import requests
import time


def _nav_ai_last_check(cfg):
    """最近一次模型探活的诊断摘要(时间用本地时区字符串,前端直接显示)。"""
    return {'last_check_at': cfg.last_check_at.isoformat() if cfg.last_check_at else '',
            'last_check_ok': cfg.last_check_ok,
            'last_check_ms': cfg.last_check_ms,
            'last_check_model': cfg.last_check_model,
            'last_check_message': cfg.last_check_message}


def api_nav_ai_config(request):
    """导航 AI 配置:GET 返回脱敏状态,POST 保存(留空 api_key = 保持原值)。"""
    if request.method == 'GET':
        cfg = NavAiConfig.get_solo()
        return JsonResponse({'status': 'ok',
                             'configured': NavAiConfig.is_configured(),
                             'base_url': cfg.base_url, 'model': cfg.model,
                             'api_key_set': bool(cfg.api_key),
                             'model_classify': cfg.model_classify,
                             'model_pet': cfg.model_pet,
                             **_nav_ai_last_check(cfg)})
    data, err = _json_body(request)
    if err:
        return err
    cfg = NavAiConfig.get_solo()
    cfg.base_url = str(data.get('base_url') or '').strip().rstrip('/')
    if str(data.get('api_key') or '').strip():
        cfg.api_key = str(data.get('api_key')).strip()
    cfg.model = str(data.get('model') or '').strip()
    # 只有前端真的带了这两个字段才覆盖:老调用的 POST 不该把已存的覆盖模型清空
    if 'model_classify' in data:
        cfg.model_classify = str(data.get('model_classify') or '').strip()[:100]
    if 'model_pet' in data:
        cfg.model_pet = str(data.get('model_pet') or '').strip()[:100]
    cfg.save()
    return JsonResponse({'status': 'ok', 'configured': NavAiConfig.is_configured(),
                         'base_url': cfg.base_url, 'model': cfg.model,
                         'model_classify': cfg.model_classify, 'model_pet': cfg.model_pet,
                         **_nav_ai_last_check(cfg)})


@require_http_methods(['GET'])
@owner_only
def api_nav_ai_logs(request):
    """最近 AI 调用记录(只读):排查「刚才那一下为什么失败」用。

    只存摘要不存正文:站点清单体积大,而且没必要长期留在库里。"""
    rows = list(NavAiCallLog.objects.values(
        'id', 'task', 'model', 'ok', 'elapsed_ms', 'http_status', 'message', 'created_at')[:20])
    return JsonResponse({'status': 'ok', 'logs': [
        {'task': r['task'], 'model': r['model'], 'ok': r['ok'],
         'elapsed_ms': r['elapsed_ms'], 'http_status': r['http_status'],
         'message': r['message'],
         'at': r['created_at'].isoformat() if r['created_at'] else ''} for r in rows]})


@require_POST
def api_nav_ai_models(request):
    """探测 OpenAI 兼容接口的模型列表(GET {base_url}/models)。

    前端「检测模型」按钮 / 接口地址失焦时调用。浏览器直连本机网关(Magpie
    127.0.0.1:3425)会被 CORS 和混合内容拦住,所以统一由服务端代取。
    """
    data, err = _json_body(request)
    if err:
        return err
    base = str(data.get('base_url') or '').strip().rstrip('/')
    if not base:
        return JsonResponse({'status': 'error', 'message': '先填接口地址'}, status=400)
    parsed = urlparse(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        return JsonResponse({'status': 'error',
                             'message': '接口地址要以 http:// 或 https:// 开头'}, status=400)
    key = str(data.get('api_key') or '').strip() or NavAiConfig.get_solo().api_key
    headers = {'User-Agent': _NAV_META_UA}
    if key:
        headers['Authorization'] = f'Bearer {key}'
    urls = [base + '/models']
    if '/v1' not in base:
        urls.append(base + '/v1/models')      # DeepSeek 官方常用不带 /v1 的写法,补一次再试
    resp = None
    for url in urls:
        try:
            resp = requests.get(url, headers=headers, timeout=6)
        except requests.RequestException as exc:
            return JsonResponse({'status': 'error', 'message': f'连不上接口:{exc}'}, status=502)
        if resp.status_code == 200:
            break
        if resp.status_code in (401, 403):
            return JsonResponse({'status': 'error', 'message': '鉴权失败,检查 API Key'}, status=502)
        resp = None
    if resp is None:
        return JsonResponse({'status': 'error',
                             'message': '这个接口没有 /models,不支持自动检测(手动填模型名即可)'},
                            status=502)
    if len(resp.content or b'') > 2_000_000:
        return JsonResponse({'status': 'error', 'message': '模型列表过大,拒绝解析'}, status=502)
    try:
        body = resp.json()
    except ValueError:
        return JsonResponse({'status': 'error', 'message': '接口返回的不是 JSON'}, status=502)
    items = body.get('data') if isinstance(body, dict) else None
    if not isinstance(items, list):
        return JsonResponse({'status': 'error', 'message': '返回里没有 data 模型列表'}, status=502)
    models, seen = [], set()
    for it in items:
        if isinstance(it, dict):
            mid = str(it.get('id') or '').strip()
            if not mid or mid in seen:
                continue
            seen.add(mid)
            models.append({'id': mid,
                           'name': str(it.get('display_name') or it.get('name') or mid),
                           'owned_by': str(it.get('owned_by') or '')})
        elif isinstance(it, str) and it.strip() and it not in seen:
            seen.add(it)
            models.append({'id': it, 'name': it, 'owned_by': ''})
    return JsonResponse({'status': 'ok', 'count': len(models), 'models': models})


def _nav_ai_save_check(model, ok, latency_ms, message='', http_status=None):
    """把最近一次探活结果写进单例配置(2026-11-19)。

    之前「当前填的模型不可用,请改选」只在当次提示里出现,关掉弹窗就没了;
    保存到库里之后,下次打开还能看到上次测的是哪个模型、为什么不可用。"""
    cfg = NavAiConfig.get_solo()
    cfg.last_check_at = timezone.now()
    cfg.last_check_ok = bool(ok)
    cfg.last_check_ms = max(0, int(latency_ms or 0))
    cfg.last_check_model = str(model or '')[:100]
    cfg.last_check_message = str(message or '')[:200]
    cfg.save(update_fields=['last_check_at', 'last_check_ok', 'last_check_ms',
                            'last_check_model', 'last_check_message', 'updated_at'])


@require_POST
def api_nav_ai_model_test(request):
    """单模型探活:真发一次极小 chat 请求,判断这个模型到底能不能用。

    「检测模型」只能证明接口列出了它;限流/欠费/模型下线只有真调一次才知道
    (Magpie 的 our-free-model 就是列表里有、一用就 429)。前端对下拉里的模型
    逐个调用本接口,把 ✅/❌ 标在列表上。
    """
    data, err = _json_body(request)
    if err:
        return err
    base = str(data.get('base_url') or '').strip().rstrip('/')
    model = str(data.get('model') or '').strip()
    if not base or not model:
        return JsonResponse({'status': 'error', 'message': '缺少接口地址或模型名'}, status=400)
    if urlparse(base).scheme not in ('http', 'https'):
        return JsonResponse({'status': 'error', 'message': '接口地址要以 http:// 或 https:// 开头'},
                            status=400)
    key = str(data.get('api_key') or '').strip() or NavAiConfig.get_solo().api_key
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = f'Bearer {key}'
    started = time.time()

    def probe_fail(message, http_status=None):
        latency = round((time.time() - started) * 1000)
        _nav_ai_save_check(model, False, latency, message, http_status)
        return JsonResponse({'status': 'ok', 'ok': False, 'http': http_status,
                             'message': message[:160], 'latency_ms': latency})

    payload = {'model': model,
               'messages': [{'role': 'user', 'content': '只回复 OK'}],
               'max_tokens': 8, 'temperature': 0}
    # 探活要重试一次(2026-11-19):用户点「保存」前当场复测,而免费/本地网关在
    # 批量测完 31 个模型后常常排队 —— 单次 10s 超时会把一个明明可用的模型判死,
    # 于是「显示可用却保存失败」。第一次 10s,失败(超时/连不上/429/5xx)再给 15s。
    resp = None
    last_err = ''
    for attempt in range(2):
        timeout_s = 10 if attempt == 0 else 15
        try:
            resp = requests.post(base + '/chat/completions', headers=headers,
                                 json=payload, timeout=timeout_s)
        except requests.Timeout:
            resp = None
            last_err = '超时(10s 没响应)' if attempt == 0 else '超时(重试 15s 仍没响应)'
            continue
        except requests.RequestException as exc:
            resp = None
            last_err = f'连不上:{exc}'
            continue
        if attempt == 0 and resp.status_code in (429, 500, 502, 503, 504):
            last_err = f'HTTP {resp.status_code}'
            time.sleep(0.4)
            resp = None
            continue
        break
    if resp is None:
        return probe_fail(last_err or '测试失败')
    latency = round((time.time() - started) * 1000)
    if resp.status_code != 200:
        message = f'HTTP {resp.status_code}'
        try:
            body = resp.json()
            message = str(((body or {}).get('error') or {}).get('message') or message)
        except ValueError:
            pass
        return probe_fail(message, resp.status_code)
    try:
        body = resp.json()
    except ValueError:
        return probe_fail('返回不是 JSON')
    if not isinstance(body, dict):
        return probe_fail('返回格式异常')
    if body.get('error'):   # 有的网关 200 里塞 error,不能只看状态码
        err = body.get('error')
        msg = err.get('message') if isinstance(err, dict) else str(err)
        return probe_fail(str(msg or '接口返回 error'))
    choices = body.get('choices')
    if not isinstance(choices, list) or not choices:
        return probe_fail('返回 choices 为空')
    msg_obj = choices[0].get('message') if isinstance(choices[0], dict) else None
    if not isinstance(msg_obj, dict):
        return probe_fail('返回里没有 message')
    # 推理模型可能把 8 个 token 全用在 reasoning 上,content 为空但 reasoning 有内容也算可用
    content = str(msg_obj.get('content') or '').strip()
    reasoning = str(msg_obj.get('reasoning_content') or '').strip()
    tool_calls = msg_obj.get('tool_calls') if isinstance(msg_obj.get('tool_calls'), list) else []
    if not (content or reasoning or tool_calls):
        return probe_fail('返回内容为空')
    _nav_ai_save_check(model, True, latency, '可用', 200)
    return JsonResponse({'status': 'ok', 'ok': True, 'http': 200, 'message': '可用',
                         'latency_ms': latency})


@require_POST
def api_nav_ai_generate(request):
    """按大类/小类/场景生成网站候选(草稿,不入库)。同域名已有的候选直接剔除。"""
    data, err = _json_body(request)
    if err:
        return err
    category = str(data.get('category') or '').strip()[:50]
    subcat = str(data.get('subcat') or '').strip()[:50]
    if not category:
        return JsonResponse({'status': 'error', 'message': '请先选择大类'}, status=400)
    scene = data.get('scene')
    if scene is not None and not isinstance(scene, str):
        return JsonResponse({'status': 'error', 'message': 'scene 必须是字符串'}, status=400)
    try:
        count = int(data.get('count') or 8)
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'count 必须是整数'}, status=400)
    existing = list(NavSite.objects.filter(category=category)
                    .values('name', 'url'))[:50]
    sub_options = list(NavSite.objects.filter(category=category).exclude(subcat='')
                       .values_list('subcat', flat=True).distinct().order_by('subcat'))[:30]
    try:
        meta = {}
        drafts = ai_pipeline.generate_site_drafts(
            scene=scene, category_name=category,
            sub_name=subcat, count=count,
            existing_sites=existing, sub_options=sub_options, meta_out=meta)
    except AiNotConfigured as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)
    # 同域名过滤:库里已有该域(含子域)的候选剔除
    all_hosts = [_nav_site_key(urlparse(u).hostname)
                 for u in NavSite.objects.values_list('url', flat=True)]
    all_hosts = [h for h in all_hosts if h]
    kept, skipped = [], []
    for d in drafts:
        host = urlparse(_normalize_nav_url(d['url']) or d['url']).hostname
        if host and any(_nav_is_same_site(host, h) for h in all_hosts):
            d['skipped_reason'] = '导航中已有同域名站点'
            skipped.append(d)
        else:
            kept.append(d)
    return JsonResponse({'status': 'ok', 'drafts': kept, 'skipped': skipped,
                         # 本次调用的元信息(2026-11-19):前端在候选上方标注,
                         # 换模型后一眼能看出这次到底用的哪个、花了多久
                         'model': meta.get('model', ''),
                         'elapsed_ms': meta.get('elapsed_ms'),
                         'repaired': bool(meta.get('repaired'))})


@require_POST
def api_nav_ai_prompt(request):
    """「无 API 手动模式」第一步:构造与 API 管线完全一致的提示词,供复制到任意外部 AI。

    不调用任何接口、不要求 NavAiConfig 已配置——没有 key 也能用。"""
    data, err = _json_body(request)
    if err:
        return err
    category = str(data.get('category') or '').strip()[:50]
    subcat = str(data.get('subcat') or '').strip()[:50]
    if not category:
        return JsonResponse({'status': 'error', 'message': '请先选择大类'}, status=400)
    scene = data.get('scene')
    if scene is not None and not isinstance(scene, str):
        return JsonResponse({'status': 'error', 'message': 'scene 必须是字符串'}, status=400)
    try:
        count = int(data.get('count') or 8)
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'count 必须是整数'}, status=400)
    existing = list(NavSite.objects.filter(category=category).values('name', 'url'))[:50]
    sub_options = list(NavSite.objects.filter(category=category).exclude(subcat='')
                       .values_list('subcat', flat=True).distinct().order_by('subcat'))[:30]
    try:
        system_prompt, user_prompt = ai_pipeline.build_site_prompts(
            scene=scene, category_name=category, sub_name=subcat,
            count=count, existing_sites=existing, sub_options=sub_options)
    except AiNotConfigured as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)
    # 合成单段文本:网页版 AI 只有一个输入框,系统约束 + 场景要求一起给
    prompt = f'{system_prompt}\n\n---\n\n{user_prompt}'
    return JsonResponse({'status': 'ok', 'prompt': prompt})


@require_POST
def api_nav_ai_parse(request):
    """「无 API 手动模式」第二步:解析从外部 AI 复制回来的候选,返回草稿走既有预览测活导入。

    容忍 ```json 围栏和前后废话;解析不出 JSON 数组时给可操作的提示而非 500。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        count = int(data.get('count') or 8)
    except (TypeError, ValueError):
        count = 8
    text = data.get('text')
    if not isinstance(text, str) or not text.strip():
        return JsonResponse({'status': 'error', 'message': '请先粘贴 AI 的回复'}, status=400)
    try:
        drafts = ai_pipeline.parse_site_drafts(text, count)
    except AiNotConfigured as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)
    except ValueError as exc:
        return JsonResponse({'status': 'error',
                             'message': f'没能从粘贴内容里解析出 JSON 数组({exc})。'
                                        '请完整复制 AI 的回复(通常含 ```json 围栏)后重试'},
                            status=400)
    return JsonResponse({'status': 'ok', 'drafts': drafts})


def _nav_meta_best_effort(url, proxy=''):
    """尽力抓取站点标题/favicon/简介;失败返回空 dict(不影响导入)。

    proxy 与测活保持一致:被墙站测活走代理通过、抓 meta 直连必失败,标题图标会全空。"""
    try:
        kwargs = {'timeout': 8, 'headers': {'User-Agent': _NAV_META_UA}}
        if proxy:
            kwargs['proxies'] = {'http': proxy, 'https': proxy}
        response = _safe_get(url, **kwargs)   # 逐跳校验,防 302 → 内网
        response.raise_for_status()
        final_url = response.url if isinstance(getattr(response, 'url', None), str) else url
        if urlparse(final_url).scheme not in ('http', 'https'):
            return {}
        meta = _parse_site_meta(final_url, response.content[:400 * 1024])
        return meta if isinstance(meta, dict) else {}
    except Exception as exc:
        logger.debug('抓取站点 meta 失败 %s:%s', url, exc)
        return {}


def _nav_fetch_meta_map(urls, proxy, budget=NAV_LINK_TOTAL_TIMEOUT):
    """并发抓一批站点的 meta,返回 {url: meta};预算内没跑完的按空 dict 处理。

    抓不到标题/图标只影响入库条目的名字,不该拖慢整单 AI 导入,所以沿用同一套总时长预算。"""
    metas = {}
    if not urls or budget <= 0:
        return metas
    pool = ThreadPoolExecutor(max_workers=6)
    try:
        futures = {pool.submit(_nav_meta_best_effort, u, proxy): u for u in urls}
        try:
            for fut in as_completed(futures, timeout=budget):
                u = futures[fut]
                try:
                    metas[u] = fut.result() or {}
                except Exception as exc:   # 单条抓挂了当作没抓到标题
                    logger.debug('并发抓 meta 异常 %s:%s', u, exc)
        except TimeoutError:
            logger.warning('抓 meta 超出总时长预算 %ss,%s 条按无标题入库',
                           budget, len(urls) - len(metas))
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return metas


@require_POST
def api_nav_ai_import(request):
    """AI 候选一键导入:逐条 去重 → 测活 → 抓标题/图标 → 入库。
    测活失败/重复的条目不入库,分桶返回让用户一眼看到结果。"""
    data, err = _json_body(request)
    if err:
        return err
    category = str(data.get('category') or '').strip()[:50]
    if not category:
        return JsonResponse({'status': 'error', 'message': '请先选择大类'}, status=400)
    default_sub = str(data.get('subcat') or '').strip()[:50]
    proxy = str(data.get('proxy') or '').strip()[:200]
    if proxy and not proxy.startswith(('http://', 'https://', 'socks5://', 'socks5h://')):
        proxy = 'http://' + proxy
    raw_sites = data.get('sites')
    if not isinstance(raw_sites, list) or not raw_sites:
        return JsonResponse({'status': 'error', 'message': 'sites 须为非空数组'}, status=400)

    # 1) 归一化 + 去重(库内同域 + 批内同域)
    db_hosts = [_nav_site_key(urlparse(u).hostname)
                for u in NavSite.objects.values_list('url', flat=True)]
    db_hosts = [h for h in db_hosts if h]
    candidates, seen_hosts = [], set()
    duplicates = []
    # 超出单次上限的候选:明确报告,不静默丢弃
    overflow = [str(s.get('name') or '').strip()[:50] or str(s.get('url') or '').strip()[:50]
                for s in raw_sites[NAV_AI_IMPORT_MAX:] if isinstance(s, dict)]
    for s in raw_sites[:NAV_AI_IMPORT_MAX]:
        if not isinstance(s, dict):
            continue
        name = str(s.get('name') or '').strip()[:100]
        url = _normalize_nav_url(s.get('url'))
        if not name or not url:
            continue
        host = urlparse(url).hostname or ''
        host_key = _nav_site_key(host)
        dup_reason = ''
        if NavSite.objects.filter(url=url).exists():
            dup_reason = '网址已存在'
        elif host_key and any(_nav_is_same_site(host_key, h) for h in db_hosts):
            dup_reason = '已有同域名站点'
        elif host_key in seen_hosts:
            dup_reason = '本批内重复'
        if dup_reason:
            duplicates.append({'name': name, 'url': url, 'reason': dup_reason})
            continue
        seen_hosts.add(host_key)
        candidates.append({'name': name, 'url': url,
                           'description': str(s.get('description') or '').strip()[:200],
                           'subcat': (str(s.get('subcat') or '').strip()[:50]) or default_sub})
    if not candidates:
        return JsonResponse({'status': 'error', 'message': '没有可导入的候选(全部重复或无效)'}, status=400)

    # 2) 并发测活(复用链接测活的底层函数),同一套总时长预算覆盖这一整单
    started = time.monotonic()
    check_map = _nav_check_links([c['url'] for c in candidates], proxy,
                                 NAV_LINK_TOTAL_TIMEOUT)
    # 3) 通过测活的:并发抓 meta(尽力而为)→ 入库;预算是整单共用的,测活用掉多少就少多少
    imported, dead, alive = [], [], []
    for c in candidates:
        check = check_map.get(c['url'], {})
        if not check.get('ok'):
            # 预算耗尽没跑到(skipped)与"真打不开"分开报,免得用户以为这些候选都是死链
            reason = check.get('error') or '测活失败'
            if check.get('skipped'):
                reason = '未检测(总时长预算不足,可再点一次)'
            dead.append({'name': c['name'], 'url': c['url'], 'reason': reason})
            continue
        alive.append(c)
    meta_budget = NAV_LINK_TOTAL_TIMEOUT - (time.monotonic() - started)
    meta_map = _nav_fetch_meta_map([c['url'] for c in alive], proxy, meta_budget)
    for c in alive:
        meta = meta_map.get(c['url'], {})
        try:
            # 逐条独立事务:测活窗口长达数秒,并发插入同 URL 或中途异常都不该半提交/整单 500
            with transaction.atomic():
                obj = NavSite.objects.create(
                    name=c['name'],
                    url=c['url'],
                    category=category,
                    subcat=c['subcat'],
                    description=c['description'] or str(meta.get('description') or '')[:200],
                    # _parse_site_meta 返回的键是 title(不是 site_title),键名错了会让 AI 导入的标题永远为空
                    site_title=str(meta.get('title') or '')[:200],
                    favicon=str(meta.get('favicon') or '')[:300])
        except IntegrityError:
            duplicates.append({'name': c['name'], 'url': c['url'],
                               'reason': '导入期间已被创建(并发)'})
            continue
        imported.append({'id': obj.id, 'name': obj.name, 'url': obj.url,
                         'subcat': obj.subcat})
    return JsonResponse({'status': 'ok', 'imported': imported, 'dead': dead,
                         'duplicates': duplicates, 'truncated': len(overflow),
                         'truncated_names': overflow[:10]})


# ===== AI 分类(给库里已有站点重判大类/小分类) =====
# 与「AI 找站」相反:不造新站。前端只展示"建议移动"的条目(分类本来就对的直接藏掉),
# 每条右边一个「采纳」按钮 —— 分类结果全量展示会吵得没法看。
NAV_AI_CLASSIFY_BATCH = 40        # 一次喂模型多少条:再多容易漏条、序号串位
NAV_AI_CLASSIFY_LIMIT_MAX = 200   # 单次最多处理多少条
NAV_AI_CLASSIFY_UNSET = ('', '未分类', '自定义')   # 视作"还没分类"


def _nav_classify_catalog():
    """库里现成的大类 → 小分类。喂给模型是为了让它复用命名,而不是每批各造一套。"""
    subs = {}
    for cat, sub in NavSite.objects.filter(archived_at__isnull=True).values_list('category', 'subcat'):
        c = (cat or '').strip()
        if not c:
            continue
        subs.setdefault(c, set())
        s = (sub or '').strip()
        if s:
            subs[c].add(s)
    for name in NavCategory.objects.values_list('name', flat=True):
        n = (name or '').strip()
        if n:
            subs.setdefault(n, set())
    return {c: sorted(v) for c, v in subs.items()}


def _nav_classify_tag_vocab():
    """库里现有的标签词表(去重、按出现次数降序):让模型复用词,别每批各造一套。"""
    counts = {}
    for tags in NavSite.objects.filter(archived_at__isnull=True).values_list('tags', flat=True):
        for t in _clean_nav_tags(tags):
            counts[t] = counts.get(t, 0) + 1
    return [t for t, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


def _nav_classify_items(data, limit=NAV_AI_CLASSIFY_BATCH):
    """校验并清洗前端传来的待分类站点。返回 (items, error_response)。

    注意 limit 必须按调用方给:
      - 走模型的批量接口,一次只能喂 40 条(再多模型会漏条、序号串位);
      - 提示词/解析接口是「整段文本交给外部 AI」,可以一次到 200 条 ——
        原来两者共用 40,导致手动模式选了 60 条却只把前 40 条写进提示词,
        而且没有任何提示(2026-11-12 复核发现)。
    """
    raw = data.get('items')
    if not isinstance(raw, list) or not raw:
        return None, JsonResponse({'status': 'error', 'message': 'items 须为非空数组'}, status=400)
    items = []
    for s in raw[:limit]:
        if not isinstance(s, dict):
            continue
        name = str(s.get('name') or '').strip()[:100]
        url = str(s.get('url') or '').strip()[:300]
        if not name and not url:
            continue
        items.append({'id': s.get('id'), 'name': name, 'url': url,
                      'category': str(s.get('category') or '').strip()[:50],
                      'subcat': str(s.get('subcat') or '').strip()[:50],
                      'tags': _clean_nav_tags(s.get('tags')),
                      'description': str(s.get('description') or '').strip()[:200]})
    if not items:
        return None, JsonResponse({'status': 'error', 'message': '没有可分类的站点'}, status=400)
    return items, None


def _nav_classify_rows(parsed, items):
    """模型结果(按序号)→ 前端行(带 id、原分类),序号对回原条目。"""
    rows = []
    for r in parsed:
        it = items[r['i'] - 1]
        rows.append({'id': it.get('id'),
                     'name': it.get('name') or it.get('url') or '',
                     'url': it.get('url') or '',
                     'old_category': it.get('category') or '',
                     'old_subcat': it.get('subcat') or '',
                     'category': r['category'],
                     'subcat': r['subcat'],
                     'tags': r.get('tags') or [],
                     'old_tags': it.get('tags') or []})
    return rows


@require_POST
def api_nav_ai_classify_items(request):
    """取一批待分类站点(全部 / 未分类 / 指定大类),连同库里现有分类清单一并返回。"""
    data, err = _json_body(request)
    if err:
        return err
    scope = str(data.get('scope') or 'all').strip()
    category = str(data.get('category') or '').strip()[:50]
    try:
        limit = int(data.get('limit') or 60)
    except (TypeError, ValueError):
        limit = 60
    limit = max(1, min(limit, NAV_AI_CLASSIFY_LIMIT_MAX))
    qs = NavSite.objects.filter(archived_at__isnull=True)
    if scope == 'uncategorized':
        qs = qs.filter(category__in=list(NAV_AI_CLASSIFY_UNSET))
    elif scope == 'category' and category:
        qs = qs.filter(category=category)
    total = qs.count()
    rows = list(qs.order_by('category', 'subcat', 'name')
                .values('id', 'name', 'url', 'category', 'subcat', 'tags', 'description')[:limit])
    catalog = _nav_classify_catalog()
    return JsonResponse({'status': 'ok', 'items': rows, 'total': total, 'limit': limit,
                         'categories': list(catalog), 'subs': catalog,
                         'tags': _nav_classify_tag_vocab(),
                         'configured': NavAiConfig.is_configured()})


@require_POST
def api_nav_ai_classify_batch(request):
    """接口模式:给一批站点分类。未配置 AI 时返回 code,前端据此切到手动模式。"""
    data, err = _json_body(request)
    if err:
        return err
    items, bad = _nav_classify_items(data)
    if bad:
        return bad
    catalog = _nav_classify_catalog()
    try:
        parsed = ai_pipeline.classify_sites(items, list(catalog), catalog,
                                           _nav_classify_tag_vocab())
    except AiNotConfigured as exc:
        return JsonResponse({'status': 'error', 'code': 'ai_not_configured',
                             'message': str(exc)}, status=400)
    except ValueError as exc:
        return JsonResponse({'status': 'error', 'message': f'AI 回复无法解析:{exc}',
                             'code': 'parse_failed'}, status=502)
    return JsonResponse({'status': 'ok', 'rows': _nav_classify_rows(parsed, items),
                         'requested': len(items), 'got': len(parsed)})


@require_POST
def api_nav_ai_classify_prompt(request):
    """无 AI 配置时:只生成提示词(不调接口、不要求已配置),供复制到任意外部 AI。"""
    data, err = _json_body(request)
    if err:
        return err
    # 提示词模式是一次性整段交给外部 AI,不受「喂模型 40 条」的限制
    items, bad = _nav_classify_items(data, NAV_AI_CLASSIFY_LIMIT_MAX)
    if bad:
        return bad
    catalog = _nav_classify_catalog()
    system_prompt, user_prompt = ai_pipeline.build_classify_prompts(
        items, list(catalog), catalog, _nav_classify_tag_vocab())
    # 网页版 AI 只有一个输入框:系统约束 + 站点清单合成一段
    return JsonResponse({'status': 'ok', 'count': len(items),
                         'prompt': f'{system_prompt}\n\n---\n\n{user_prompt}'})


@require_POST
def api_nav_ai_classify_parse(request):
    """把外部 AI 的回复解析成同样的建议行(容错围栏和前后废话)。"""
    data, err = _json_body(request)
    if err:
        return err
    # 解析要跟提示词用同一份清单,序号才对得上 —— 上限也必须是同一个
    items, bad = _nav_classify_items(data, NAV_AI_CLASSIFY_LIMIT_MAX)
    if bad:
        return bad
    text = data.get('text')
    if not isinstance(text, str) or not text.strip():
        return JsonResponse({'status': 'error', 'message': '请先粘贴 AI 的回复'}, status=400)
    try:
        parsed = ai_pipeline.parse_classify_result(text, len(items))
    except ValueError as exc:
        return JsonResponse({'status': 'error',
                             'message': f'没能解析出分类结果:{exc}'}, status=400)
    return JsonResponse({'status': 'ok', 'rows': _nav_classify_rows(parsed, items)})


@require_POST
def api_nav_ai_classify_apply(request):
    """应用被采纳的分类变更:逐条校验,分类与小分类都没变的跳过(不写库)。"""
    data, err = _json_body(request)
    if err:
        return err
    raw = data.get('rows')
    if not isinstance(raw, list) or not raw:
        return JsonResponse({'status': 'error', 'message': 'rows 须为非空数组'}, status=400)
    plan = {}
    for r in raw[:NAV_AI_CLASSIFY_LIMIT_MAX]:
        if not isinstance(r, dict):
            continue
        try:
            sid = int(r.get('id'))
        except (TypeError, ValueError):
            continue
        cat = str(r.get('category') or '').strip()[:50]
        if not cat:
            continue                        # 空大类等于把站点丢进「未分类」,不接受
        plan[sid] = {'category': cat,
                     'subcat': str(r.get('subcat') or '').strip()[:50],
                     # 前端没给 tags 字段 = 这次不动标签;给了(哪怕是空数组)= 按给的覆盖
                     'tags': _clean_nav_tags(r.get('tags')) if 'tags' in r else None}
    if not plan:
        return JsonResponse({'status': 'error', 'message': '没有可应用的变更'}, status=400)
    updated = 0
    with transaction.atomic():
        for site in NavSite.objects.filter(id__in=list(plan)):
            target = plan[site.id]
            fields = []
            if site.category != target['category']:
                site.category = target['category']
                fields.append('category')
            if site.subcat != target['subcat']:
                site.subcat = target['subcat']
                fields.append('subcat')
            if target['tags'] is not None and list(site.tags or []) != target['tags']:
                site.tags = target['tags']
                fields.append('tags')
            if not fields:
                continue
            site.save(update_fields=fields)
            updated += 1
    return JsonResponse({'status': 'ok', 'updated': updated, 'requested': len(plan)})

