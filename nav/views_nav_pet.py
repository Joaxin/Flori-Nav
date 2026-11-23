# nav/views_nav_pet.py
"""桌宠:地理定位、AI 对话、余额(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""

from .views_nav_base import _NAV_META_UA, _json_body, logger
from django.views.decorators.http import require_POST, require_http_methods

from . import ai as ai_pipeline
from . import pet_sources  # noqa: E402  零密钥兜底语料源(2026-11-10),只依赖 requests
from . import pet_weather  # noqa: E402  天气主源(2026-11-18):中国气象局 + Open-Meteo 兜底
from .ai import AiNotConfigured  # noqa: E402  置于模块底部导入区之后,保持依赖方向干净
from .models import NavSite, NavCategory, NavTool, NavAiConfig
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
import math
import re
import requests


_PET_GEO_TIMEOUT = 8


_PET_GEO_CACHE_TTL = 60 * 60 * 6   # 地名解析结果极少变;6h 缓存也照顾 Nominatim 的 1 req/s 使用政策


def _pet_geo_strip_suffix(name):
    """去行政后缀比较:朝阳区/朝阳市/朝阳县 都视为「朝阳」。"""
    return re.sub(r'(市|县|区|旗|林区|特区|自治州|地区|盟)$', '', (name or '').strip())


def _pet_geo_score(hit, typed):
    """open-meteo 候选打分:名字完全匹配(去后缀)> 前缀匹配;同级比人口(对数)。"""
    score = 0.0
    t = _pet_geo_strip_suffix(typed)
    n = _pet_geo_strip_suffix(hit.get('name'))
    if t and n == t:
        score += 100
    elif t and n.startswith(t):
        score += 20
    score += min(50.0, math.log10((hit.get('population') or 0) + 1) * 10)
    return score


def _pet_geo_pick(results, typed):
    """从 open-meteo 候选里挑最优(纯解析,便于离线测试)。空返回 None。"""
    best, best_score = None, -1.0
    for hit in results or []:
        if not isinstance(hit, dict) or 'latitude' not in hit or 'longitude' not in hit:
            continue
        s = _pet_geo_score(hit, typed)
        if s > best_score:
            best, best_score = hit, s
    return best


def api_nav_pet_geo(request):
    """桌宠天气的城市解析代理:GET ?name=城市名。
    两级策略:open-meteo 打分后,完全同名且人口 ≥10 万直接用;
    不自信(重名/乡级地名/人口小)回落 Nominatim,两路都失败才用 open-meteo 最高分兜底。"""
    from django.core.cache import cache
    name = (request.GET.get('name') or '').strip()[:50]
    if not name:
        return JsonResponse({'status': 'error', 'message': '缺少城市名'}, status=400)
    key = 'nav_pet_geo_v1:' + name
    cached = cache.get(key)
    if cached:
        return JsonResponse(cached)
    best = None
    try:
        r = requests.get('https://geocoding-api.open-meteo.com/v1/search',
                         params={'count': 10, 'language': 'zh', 'name': name},
                         timeout=_PET_GEO_TIMEOUT, headers={'User-Agent': _NAV_META_UA})
        best = _pet_geo_pick(r.json().get('results'), name)
    except Exception as exc:   # 第一级地理编码失败还有 Nominatim 兜底
        logger.debug('open-meteo 城市解析失败 %s:%s', name, exc)
        best = None
    confident = bool(best) and _pet_geo_strip_suffix(best.get('name')) == _pet_geo_strip_suffix(name) \
        and (best.get('population') or 0) >= 100000
    place = None
    if not confident:
        # Nominatim 回落:朝阳区→北京、天河→广州天河区、朝阳市→辽宁(实测覆盖远好于 open-meteo 中文)
        try:
            r = requests.get('https://nominatim.openstreetmap.org/search',
                             params={'q': name, 'format': 'jsonv2', 'limit': 5,
                                     'accept-language': 'zh'},
                             headers={'User-Agent': 'FloriNav/1.0 (local pet weather tool)'},
                             timeout=_PET_GEO_TIMEOUT)
            hits = r.json() or []
            prefer = ('administrative', 'city', 'town', 'county', 'state_district')
            hit = next((h for h in hits if h.get('type') in prefer), None)
            if hit is None and hits:
                hit = hits[0]
            if hit:
                parts = [p.strip() for p in (hit.get('display_name') or '').split(',')]
                place = {'name': hit.get('name') or (parts[0] if parts else name),
                         'region': parts[1] if len(parts) > 1 else '',
                         'lat': float(hit['lat']), 'lon': float(hit['lon']),
                         'source': 'nominatim'}
        except Exception as exc:   # 两级都失败才告诉用户没找到,这里仍属可忽略
            logger.debug('Nominatim 城市解析失败 %s:%s', name, exc)
            place = None
    if place is None and best:
        place = {'name': best['name'], 'region': best.get('admin1') or '',
                 'lat': best['latitude'], 'lon': best['longitude'], 'source': 'open-meteo'}
    if place is None:
        # 国内兜底(2026-11-18):open-meteo 与 Nominatim 都在境外,国内常有首包超时。
        # 中国气象局的站点表本身就带经纬度,按名字能命中就直接用,别让整条链路一起死。
        place = pet_weather.cma_place(name)
    if place is None:
        return JsonResponse({'status': 'error',
                             'message': f'没找到「{name}」,去宠物设置里改个城市名吧'}, status=404)
    payload = {'status': 'ok', 'place': place}
    cache.set(key, payload, _PET_GEO_CACHE_TTL)
    return JsonResponse(payload)


def _pet_ai_status():
    cfg = NavAiConfig.get_solo()
    return {'status': 'ok', 'configured': NavAiConfig.is_configured(),
            'base_url': cfg.base_url, 'model': cfg.model,
            'api_key_set': bool(cfg.api_key),
            'model_classify': cfg.model_classify, 'model_pet': cfg.model_pet,
            'last_check_at': cfg.last_check_at.isoformat() if cfg.last_check_at else '',
            'last_check_ok': cfg.last_check_ok, 'last_check_ms': cfg.last_check_ms,
            'last_check_model': cfg.last_check_model,
            'last_check_message': cfg.last_check_message,
            'persona': cfg.pet_persona,
            'memory_rounds': cfg.pet_memory_rounds}


@require_http_methods(['GET', 'POST'])
def api_nav_pet_ai_config(request):
    """桌宠 AI 配置:GET 脱敏状态(persona/记忆轮数原文返回,非敏感);POST 保存。"""
    if request.method == 'GET':
        return JsonResponse(_pet_ai_status())
    data, err = _json_body(request)
    if err:
        return err
    cfg = NavAiConfig.get_solo()
    # 2026-11-19:字段缺省就不覆盖。桌宠人设/记忆轮数搬到「宠物设置 → 聊天」后,
    # 那个保存按钮只提交 persona/memory_rounds —— 再按老写法无条件写 base_url/model
    # 会把接口地址和模型清空,桌宠与找网站一起失联。
    if 'base_url' in data:
        cfg.base_url = str(data.get('base_url') or '').strip().rstrip('/')
    if str(data.get('api_key') or '').strip():
        cfg.api_key = str(data.get('api_key')).strip()
    if 'model' in data:
        cfg.model = str(data.get('model') or '').strip()
    if 'model_classify' in data:
        cfg.model_classify = str(data.get('model_classify') or '').strip()[:100]
    if 'model_pet' in data:
        cfg.model_pet = str(data.get('model_pet') or '').strip()[:100]
    if 'persona' in data:
        cfg.pet_persona = str(data.get('persona') or '').strip()[:2000]
    if 'memory_rounds' in data:
        try:
            rounds = int(data.get('memory_rounds') or 5)
        except (TypeError, ValueError):
            rounds = 5
        cfg.pet_memory_rounds = max(0, min(rounds, 20))
    if 'clear_memory' in data and data.get('clear_memory'):
        cfg.pet_memory = []
    cfg.save()
    return JsonResponse(_pet_ai_status())


@require_POST
def api_nav_pet_chat(request):
    """桌宠对话:人设 + 时间上下文 + 最近 N 轮记忆 → 回复(可带 [图:名称] 配图)。"""
    data, err = _json_body(request)
    if err:
        return err
    text = str(data.get('text') or '').strip()
    if not text:
        return JsonResponse({'status': 'error', 'message': '想跟我说点什么?'}, status=400)
    cfg = NavAiConfig.get_solo()
    try:
        meta = ai_pipeline.chat_with_meta(
            ai_pipeline.build_pet_messages(text, memory=cfg.pet_memory), task='pet')
    except AiNotConfigured as exc:
        # 没配 Key 不等于不能聊:先试免密钥兜底源(2026-11-10),都挂了才回配置提示
        reply, source = pet_sources.fallback_chat(text)
        if not reply:
            return JsonResponse({'status': 'error', 'configured': False,
                                 'message': str(exc)}, status=400)
        return JsonResponse({'status': 'ok', 'reply': reply, 'meme': None,
                             'source': source, 'degraded': True})
    reply, meme = ai_pipeline.split_pet_meme(meta['content'])
    reply = reply[:2000]
    reasoning = (meta.get('reasoning') or '')[:2000]
    cfg.pet_memory = ai_pipeline.pet_memory_append(
        cfg.pet_memory, text, reply, rounds=cfg.pet_memory_rounds)
    cfg.save(update_fields=['pet_memory', 'updated_at'])
    return JsonResponse({'status': 'ok', 'reply': reply, 'meme': meme,
                         'reasoning': reasoning,
                         'model': meta.get('model') or '',
                         'elapsed_ms': meta.get('elapsed_ms')})


@require_POST
def api_nav_pet_quick(request):
    """桌宠聊天窗口的站点快捷操作(2026-11-18):随机站 / 站点统计 / 站内搜索。

    聊天窗口里的 chip 直接调这里,返回一句自然语言 + 可点击的站点链接;
    不依赖 AI 接口,没配 Key 也能用。
    """
    data, err = _json_body(request)
    if err:
        return err
    action = str(data.get('action') or '').strip()
    sites = NavSite.objects.filter(archived_at__isnull=True)
    if action == 'random':
        site = sites.order_by('?').first()
        if not site:
            return JsonResponse({'status': 'error', 'message': '导航里还没有站点'}, status=404)
        cat = site.category + ((' / ' + site.subcat) if site.subcat else '')
        reply = f'给你翻到一个：{site.name}（{cat}）'
        if site.description:
            reply += '\n' + site.description
        return JsonResponse({'status': 'ok', 'reply': reply,
                             'links': [{'name': site.name, 'url': site.url}]})
    if action == 'stats':
        total = sites.count()
        cats = sites.values('category').distinct().count()
        top = list(sites.order_by('-click_count', 'name')[:3])
        reply = f'导航里目前收了 {total} 个站点，共 {cats} 个大类。'
        if top and top[0].click_count:
            reply += '\n点得最多的是：' + '、'.join(s.name for s in top if s.click_count) + '。'
        return JsonResponse({'status': 'ok', 'reply': reply,
                             'links': [{'name': s.name, 'url': s.url} for s in top]})
    if action == 'search':
        q = str(data.get('query') or '').strip()[:50]
        if not q:
            return JsonResponse({'status': 'error', 'message': '要搜什么？给我个关键词'}, status=400)
        qs = list(sites.filter(
            Q(name__icontains=q) | Q(url__icontains=q) | Q(description__icontains=q) |
            Q(category__icontains=q) | Q(subcat__icontains=q)
        ).order_by('-click_count', 'name')[:6])
        if not qs:
            return JsonResponse({'status': 'ok', 'reply': f'没找到和「{q}」相关的站点，要不要换个词？',
                                 'links': []})
        reply = f'找到 {len(qs)} 个和「{q}」相关的站点：'
        return JsonResponse({'status': 'ok', 'reply': reply,
                             'links': [{'name': s.name, 'url': s.url} for s in qs]})
    return JsonResponse({'status': 'error', 'message': '不认识的快捷操作'}, status=400)


@require_POST
def api_nav_pet_whisper(request):
    """AI 碎碎念:一句日常碎碎念 + 可选配图。失败 400,前端静默回落本地语录。"""
    try:
        text, meme = ai_pipeline.pet_whisper_generate()
    except AiNotConfigured as exc:
        # 碎碎念同样降价兜底:土味情话当语料,失败就维持原来的「静默回落本地语录」
        quip = pet_sources.sweet_nothing()
        if not quip:
            return JsonResponse({'status': 'error', 'configured': False,
                                 'message': str(exc)}, status=400)
        return JsonResponse({'status': 'ok', 'text': quip, 'meme': None,
                             'source': 'quip', 'degraded': True})
    return JsonResponse({'status': 'ok', 'text': text, 'meme': meme})


def api_nav_pet_balance(request):
    """DeepSeek 账户余额(仅官方 https://api.deepseek.com 支持)。缓存 5 分钟。"""
    from django.core.cache import cache
    if not NavAiConfig.is_configured():
        return JsonResponse({'status': 'error', 'configured': False,
                             'message': '还没接 AI 接口,查不了余额'}, status=400)
    cached = cache.get('nav_pet_balance')
    if cached is not None:
        return JsonResponse(cached)
    try:
        info = ai_pipeline.deepseek_balance()
    except AiNotConfigured as exc:
        return JsonResponse({'status': 'error', 'message': str(exc)}, status=400)
    payload = {'status': 'ok', **info}
    cache.set('nav_pet_balance', payload, 300)
    return JsonResponse(payload)

@require_http_methods(['GET'])
def api_nav_pet_ip_geo(request):
    """桌宠「我没选过城市」时的 IP 定位兜底(2026-11-20 P0)。

    前端天气链路缺口:没配城市就直接写死广州,外地用户看到的是别人的天气。
    这里按本机出口 IP 反查所在地(中国气象局 → ip-api),只返回城市名与经纬度,
    不落库、不记录 IP;结果缓存 30 分钟,避免每次问天气都打一次上游。
    """
    from django.core.cache import cache
    cached = cache.get('nav_pet_ip_geo_v1')
    if cached:
        return JsonResponse(cached)
    place = pet_weather.ip_location()
    if not place:
        # 定位失败不等于天气不可用:前端会退到默认城市并在气泡里说明
        return JsonResponse({'status': 'error',
                             'message': '没能按网络定位,去宠物设置里选个城市吧'}, status=404)
    payload = {'status': 'ok', 'place': place}
    cache.set('nav_pet_ip_geo_v1', payload, 1800)
    return JsonResponse(payload)


@require_http_methods(['GET'])
def api_nav_pet_weather(request):
    """桌宠实况天气代理(2026-11-18):浏览器不再直连 open-meteo。

    国内实测 open-meteo 首包 8s 超时(第二次才回),而中国气象局同一时刻 0.18s;
    这里服务端统一取数:国内优先官方站点,海外/取不到再回落 open-meteo,结果缓存 10 分钟。
    """
    try:
        lat = float(request.GET.get('lat'))
        lon = float(request.GET.get('lon'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '缺少经纬度'}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return JsonResponse({'status': 'error', 'message': '经纬度不合法'}, status=400)
    name = (request.GET.get('name') or '').strip()[:50]
    wx = pet_weather.weather_cached(lat, lon, name)
    if not wx:
        return JsonResponse({'status': 'error', 'message': '天气服务暂时取不到'}, status=502)
    return JsonResponse({'status': 'ok', 'weather': wx})


@require_http_methods(['GET'])
def api_nav_pet_brief(request):
    """天气气泡第二行:空气质量 + 明日预报。30 分钟缓存;两边都取不到才报错。"""
    from django.core.cache import cache
    try:
        lat = float(request.GET.get('lat'))
        lon = float(request.GET.get('lon'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '缺少经纬度'}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return JsonResponse({'status': 'error', 'message': '经纬度不合法'}, status=400)
    key = 'nav_pet_brief_%.2f_%.2f' % (lat, lon)
    cached = cache.get(key)
    if cached is not None:
        return JsonResponse(cached)
    aqi = pet_sources.air_quality(lat, lon)
    # 明日预报优先复用实况那一次的结果(中国气象局每日预报就在 view 段里),
    # 省一次境外请求;实况缓存没命中/是海外城市时再回落到 open-meteo 的 daily。
    wx = pet_weather.weather_cached(lat, lon)
    tomorrow = (wx or {}).get('tomorrow') or pet_sources.daily_forecast(lat, lon)
    if not aqi and not tomorrow:
        return JsonResponse({'status': 'error', 'message': '空气和预报都取不到'},
                            status=502)
    payload = {'status': 'ok', 'aqi': aqi, 'tomorrow': tomorrow}
    cache.set(key, payload, 1800)
    return JsonResponse(payload)


@require_http_methods(['GET'])
def api_nav_pet_daily_en(request):
    """每日英语:一条英文 + 译文,按小时缓存(接口本身一天一换)。"""
    from django.core.cache import cache
    cached = cache.get('nav_pet_daily_en')
    if cached is not None:
        return JsonResponse(cached)
    data = pet_sources.daily_english()
    if not data:
        return JsonResponse({'status': 'error', 'message': '今天没取到句子'}, status=502)
    payload = {'status': 'ok', **data}
    cache.set('nav_pet_daily_en', payload, 3600)
    return JsonResponse(payload)
