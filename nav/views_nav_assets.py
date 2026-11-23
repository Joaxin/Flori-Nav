# nav/views_nav_assets.py
"""favicon 本地化、Bing 背景、图标上传(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""

from .views_nav_base import _NAV_META_UA, _guard_public_url, _json_body, _safe_get, logger
from django.views.decorators.http import require_POST, require_http_methods

from .models import NavSite, NavCategory, NavTool, NavAiConfig
from django.conf import settings
from django.http import HttpResponse, JsonResponse
import json
import re
import requests
import uuid


NAV_FAVICON_MAX_BYTES = 512 * 1024   # 图标本地化单张上限,防超大文件写盘


@require_POST
def api_nav_favicon_localize(request):
    """一键图标本地化:把全站热链图标下载到本机(默认不本地化,此按钮手动触发)。
    失败/超时/超大的保持热链;已是本地路径或 data: 的跳过;上限 200 个、单张 ≤512KB、
    相同图标 URL 只下载一次;支持代理(与测活同一出口,被墙站图标才能抓到)。"""
    from pathlib import Path
    data, err = _json_body(request)
    if err:
        return err
    proxy = (data.get('proxy') or '').strip()[:200]
    if proxy and not proxy.startswith(('http://', 'https://', 'socks5://', 'socks5h://')):
        proxy = 'http://' + proxy
    done, failed, skipped = 0, 0, 0
    ext_map = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/x-icon': '.ico',
               'image/vnd.microsoft.icon': '.ico', 'image/svg+xml': '.svg', 'image/webp': '.webp'}
    rows = list(NavSite.objects.exclude(favicon='').values('id', 'favicon'))[:200]
    dest = Path(settings.MEDIA_ROOT) / 'nav_favicons'
    local_by_url = {}   # 相同图标 URL 只下载一次,结果复用
    proxies = {'http': proxy, 'https': proxy} if proxy else None
    for row in rows:
        url = row['favicon']
        if not url.startswith(('http://', 'https://')):
            skipped += 1
            continue
        try:
            _guard_public_url(url)   # 图标地址来自站点数据,同样可能指向内网(SSRF)
        except ValueError as exc:
            logger.debug('图标本地化跳过(地址被拒) %s:%s', url, exc)
            failed += 1
            continue
        if url in local_by_url:
            NavSite.objects.filter(id=row['id']).update(favicon=local_by_url[url])
            done += 1
            continue
        try:
            # _safe_get:图标地址 302 到内网时,在跳转那一层就被拦住
            with _safe_get(url, timeout=6, headers={'User-Agent': _NAV_META_UA},
                           stream=True, proxies=proxies) as r:
                if r.status_code != 200:
                    failed += 1
                    continue
                ext = ext_map.get((r.headers.get('Content-Type') or '').split(';')[0].strip().lower(), '.png')
                buf, too_big = bytearray(), False
                for chunk in r.iter_content(chunk_size=8192):
                    buf.extend(chunk)
                    if len(buf) > NAV_FAVICON_MAX_BYTES:
                        too_big = True
                        break
            if too_big or not buf:
                failed += 1
                continue
        except Exception as exc:   # 单个图标抓不到只记一笔 failed,不影响整批本地化
            logger.debug('图标本地化失败 %s:%s', url, exc)
            failed += 1
            continue
        name = 'fav_' + uuid.uuid4().hex + ext
        dest.mkdir(parents=True, exist_ok=True)
        (dest / name).write_bytes(bytes(buf))
        local_by_url[url] = '/nav-fav/' + name
        NavSite.objects.filter(id=row['id']).update(favicon=local_by_url[url])
        done += 1
    return JsonResponse({'status': 'ok', 'done': done, 'failed': failed, 'skipped': skipped})


@require_http_methods(["GET"])
def api_nav_bing_bg(request):
    """必应每日壁纸:服务端取 HPImageArchive(规避浏览器 CORS),返回可直接热链的 1080p 图址。"""
    from django.core.cache import cache
    key = 'nav_bing_bg_v1'
    payload = cache.get(key)
    if not payload:
        try:
            r = requests.get('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1',
                             timeout=8, headers={'User-Agent': _NAV_META_UA})
            base = r.json()['images'][0]
            url = 'https://cn.bing.com' + base['urlbase'].replace('_UHD', '') + '_1920x1080.jpg'
            payload = {'status': 'ok', 'url': url, 'copyright': base.get('copyright', '')}
            cache.set(key, payload, 60 * 60 * 6)
        except Exception as exc:   # 壁纸是锦上添花:接口变动/断网不该在日志里留白
            logger.debug('必应壁纸获取失败:%s', exc)
            return JsonResponse({'status': 'error',
                                 'message': f'必应壁纸获取失败(网络或接口变动):{exc}'}, status=502)
    return JsonResponse(payload)


@require_http_methods(["GET"])
def api_nav_bing_bg_raw(request):
    """必应壁纸原图代理:同源输出图片字节,前端 canvas 取色不被跨域污染。"""
    from django.core.cache import cache
    key = 'nav_bing_bg_raw_v1'
    data = cache.get(key)
    if not data:
        try:
            meta = json.loads(api_nav_bing_bg(request).content)
            if meta.get('status') != 'ok':
                return JsonResponse({'status': 'error',
                                     'message': meta.get('message', '获取失败')}, status=502)
            # 壁纸地址来自外部 JSON:逐跳校验,别让它 302 到内网
            r = _safe_get(meta['url'], timeout=12, headers={'User-Agent': _NAV_META_UA})
            r.raise_for_status()
            data = r.content
            if not data or len(data) > 8 * 1024 * 1024:
                raise ValueError('图片大小异常')
        except Exception as exc:
            logger.debug('必应壁纸原图获取失败:%s', exc)
            return JsonResponse({'status': 'error',
                                 'message': f'必应壁纸原图获取失败:{exc}'}, status=502)
        cache.set(key, data, 60 * 60)
    return HttpResponse(data, content_type='image/jpeg',
                        headers={'Cache-Control': 'public, max-age=3600'})


@require_POST
def api_nav_icon_upload(request):
    """本地图标上传:存 nav_favicons/(复用 nav_favicon_file 严格校验服务),≤300KB,内容 md5 命名去重。"""
    f = request.FILES.get('file')
    if not f:
        return JsonResponse({'status': 'error', 'message': '没有文件'}, status=400)
    if f.size > 300 * 1024:
        return JsonResponse({'status': 'error', 'message': '图片请小于 300KB'}, status=400)
    ext = {'png': 'png', 'jpeg': 'jpg', 'jpg': 'jpg', 'webp': 'webp', 'svg+xml': 'svg',
           'svg': 'svg', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico'}.get(
              (f.content_type or '').split('/')[-1].lower(), '')
    if not ext:
        return JsonResponse({'status': 'error', 'message': '仅支持 png/jpg/webp/svg/ico'}, status=400)
    import hashlib
    from pathlib import Path
    from django.conf import settings as dj_settings
    data = f.read()
    name = 'fav_' + hashlib.md5(data).hexdigest() + '.' + ext
    d = Path(dj_settings.MEDIA_ROOT) / 'nav_favicons'
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(data)
    return JsonResponse({'status': 'ok', 'url': f'/nav-fav/{name}'})


@require_http_methods(["GET"])
def nav_favicon_file(request, name):
    """提供本地化的站点图标(仅允许本工具生成的文件名,防路径穿越)。"""
    from pathlib import Path
    if not re.fullmatch(r'fav_[0-9a-f]{32}\.(?:png|jpg|ico|svg|webp)', name):
        return HttpResponse('无效文件名', status=404, content_type='text/plain')
    fp = Path(settings.MEDIA_ROOT) / 'nav_favicons' / name
    if not fp.exists():
        return HttpResponse('图标文件不存在', status=404, content_type='text/plain')
    ctype = {'png': 'image/png', 'jpg': 'image/jpeg', 'ico': 'image/x-icon',
             'svg': 'image/svg+xml', 'webp': 'image/webp'}[name.rsplit('.', 1)[1]]
    resp = HttpResponse(fp.read_bytes(), content_type=ctype)
    # SVG 可内嵌脚本:加 sandbox 隔离源,防同源执行(本地图标目录可能存外部抓来的 SVG)
    if ctype == 'image/svg+xml':
        resp['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
    resp['Cache-Control'] = 'public, max-age=604800'
    return resp

