# nav/views_nav_tools.py
"""在线工具 CRUD、PWA manifest / Service Worker(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""

from .views_nav_base import _json_body, _parse_tool_meta, logger
from django.views.decorators.http import require_POST, require_http_methods

from .models import NavSite, NavCategory, NavTool, NavAiConfig
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render, get_object_or_404
from django.urls import reverse
import json
import re
import uuid


NAV_TOOL_MAX_BYTES = 2 * 1024 * 1024  # 2MB,单文件小工具足够


_HTML_TAG_RE = re.compile(r'<[a-zA-Z]')


def _nav_tool_sanitize_text(raw_bytes):
    """校验上传内容是文本 HTML,返回解码文本;不合法返回 None。"""
    if len(raw_bytes) > NAV_TOOL_MAX_BYTES:
        return None
    for encoding in ('utf-8-sig', 'gbk'):
        try:
            text = raw_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        return None
    if not _HTML_TAG_RE.search(text):
        return None
    return text


@require_POST
def nav_tool_upload(request):
    file = request.FILES.get('tool_file')
    if not file:
        return JsonResponse({'status': 'error', 'message': '未找到上传的文件'}, status=400)
    if not file.name.lower().endswith(('.html', '.htm')):
        return JsonResponse({'status': 'error', 'message': '只支持 .html / .htm 单文件工具'}, status=400)
    if file.size > NAV_TOOL_MAX_BYTES:
        return JsonResponse({'status': 'error',
                             'message': f'文件超过 {NAV_TOOL_MAX_BYTES // 1024 // 1024}MB 上限'}, status=400)
    content = file.read()
    if _nav_tool_sanitize_text(content) is None:
        return JsonResponse({'status': 'error', 'message': '内容不是有效的文本 HTML'}, status=400)
    meta = _parse_tool_meta(content[:400 * 1024])
    name = (request.POST.get('name') or '').strip()[:100] or meta['title'] or file.name
    if NavTool.objects.filter(name=name).exists():
        # 与 nav_tool_edit 同一条规则:导入按名称 upsert,本机重名的两个工具换机时会被塌缩成一个
        return JsonResponse({'status': 'error',
                             'message': f'已有同名工具「{name}」,请改个名字再上传'}, status=400)
    category = (request.POST.get('category') or '').strip()[:50] or '我的工具'
    description = (request.POST.get('description') or '').strip()[:200] or meta['description']
    tool = NavTool(name=name, category=category, description=description,
                   favicon=meta['favicon'],
                   original_filename=file.name[:200], size=len(content))
    from django.core.files.base import ContentFile
    try:
        tool.file.save(f'{uuid.uuid4().hex}.html', ContentFile(content), save=True)
    except OSError as exc:
        # 只读文件系统(Serverless)下 FileField 落盘会抛 OSError,明确提示而不是 500。
        logger.warning('工具文件写入失败(部署目录可能只读):%s', exc)
        return JsonResponse({'status': 'error',
                             'message': '当前部署为只读文件系统,无法保存上传的工具文件'},
                            status=503)
    return JsonResponse({'status': 'success', 'id': tool.id})


@require_POST
def nav_tool_edit(request):
    """改工具的名称/大类/简介(不碰文件与 pk):托管页 URL 不变,工具自己存在
    localStorage 里的数据不会因为"重命名"而丢。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    tool = NavTool.objects.filter(pk=pk).first()
    if not tool:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    name = (data.get('name') or '').strip()[:100]
    if not name:
        return JsonResponse({'status': 'error', 'message': '名称不能为空'}, status=400)
    if NavTool.objects.filter(name=name).exclude(pk=pk).exists():
        # 导入按名称 upsert,重名会让两份工具在换机时合并
        return JsonResponse({'status': 'error', 'message': '已有同名工具'}, status=400)
    tool.name = name
    tool.category = (data.get('category') or '').strip()[:50] or '我的工具'
    tool.description = (data.get('description') or '').strip()[:200]
    tool.save(update_fields=['name', 'category', 'description'])
    return JsonResponse({'status': 'success', 'id': tool.id})


@require_http_methods(["GET"])
def nav_tool_open(request, pk):
    """读取托管的 HTML 文件直接返回。仅本机单用户使用,上传入口即本人管理。"""
    tool = get_object_or_404(NavTool, pk=pk)
    try:
        with tool.file.open('rb') as f:
            content = f.read()
    except (FileNotFoundError, OSError):
        return HttpResponse('工具文件已丢失,请删除后重新上传。', status=410, content_type='text/plain; charset=utf-8')
    if isinstance(content, str):
        content = content.encode('utf-8')
    text = content.decode('utf-8-sig', errors='replace')
    response = HttpResponse(text, content_type='text/html; charset=utf-8')
    response['Cache-Control'] = 'no-store'
    # 托管 HTML 是"来路不明代码在本站源执行"的唯一入口(工具多半从网上下载)。
    # 加 sandbox 后它是**不透明源**:脚本照跑,但读不到本站 cookie / localStorage,
    # 也发不出带凭据的同源请求。⚠️ 刻意**不带** allow-same-origin —— 带了等于没隔离。
    # 代价:工具自己存在 localStorage 的数据会失效(当前导航库里 0 个工具,无存量影响)。
    # 真要恢复旧行为(工具间共享本站存储),删掉下面这一行即可。
    # 只给 sandbox 指令、不加 default-src:工具常要引 CDN 上的图表库,限源会把它们一起打死。
    response['Content-Security-Policy'] = (
        'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads'
    )
    return response


@require_POST
def nav_tool_delete(request):
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    tool = NavTool.objects.filter(id=pk).first()
    if not tool:
        return JsonResponse({'status': 'error', 'message': '工具未找到'}, status=404)
    try:
        tool.file.delete(save=False)
    except Exception as exc:   # 文件已丢也要能删掉记录,但残留得留痕
        logger.warning('删除工具文件失败(id=%s):%s', pk, exc)
    tool.delete()
    return JsonResponse({'status': 'success'})


@require_http_methods(["GET"])
def nav_manifest(request):
    """PWA manifest:启动页指向导航页,scope 限导航目录,图标用下面的 SVG 视图。"""
    start = reverse('nav_sites')
    from .brand import BRAND_NAME, BRAND_ZHU

    manifest = {
        'name': BRAND_NAME,
        'short_name': BRAND_NAME,
        'start_url': start,
        'scope': start if start.endswith('/') else start.rsplit('/', 1)[0] + '/',
        'display': 'standalone',
        'background_color': '#f8f9fa',
        # 主题色跟品牌朱印红单源(brand.py):2026-11-14 朱印定稿时图标换了,
        # 这里漏改还是旧紫罗盘的 #635bff —— 装成 PWA 后标题栏/启动画面是紫色,和 UI 对不上
        'theme_color': BRAND_ZHU,
        'icons': [{'src': reverse('nav_pwa_icon'), 'sizes': 'any',
                   'type': 'image/svg+xml', 'purpose': 'any maskable'}],
    }
    return HttpResponse(json.dumps(manifest, ensure_ascii=False),
                        content_type='application/manifest+json')


@require_http_methods(["GET"])
def nav_pwa_icon(request):
    """站点 / PWA 图标(2026-11-14):寻花集的朱印。

    与顶栏 mark 共用 nav.brand 里的同一份 SVG —— 之前这里是一枚紫底指南针,
    改名"寻花集"之后标签页图标和字标对不上。
    """
    from .brand import BRAND_MARK_SVG

    return HttpResponse(str(BRAND_MARK_SVG), content_type='image/svg+xml')


@require_http_methods(["GET"])
def nav_sw(request):
    """极简 service worker:网络优先,断网时回退缓存(不缓存 /api/ 与 /admin/)。"""
    js = """
const CACHE = 'pinsflora-nav-v2';
const CACHE_MAX = 300;
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        // 清掉旧版本缓存,避免换 CACHE 名后旧缓存永占空间
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) return;
    // 图标是二进制且更新频繁(每次本地化都变),别让它把 300 条配额吃掉
    if (url.pathname.startsWith('/nav-fav/')) return;
    if (req.headers.get('range')) return;          // 分段请求(音视频)缓存会坏
    e.respondWith(
        fetch(req).then((resp) => {
            if (resp.ok && resp.type === 'basic') {
                const copy = resp.clone();
                caches.open(CACHE).then(async (c) => {
                    await c.put(req, copy);
                    // 缓存上限:超出删最旧的,防止无限增长
                    const keys = await c.keys();
                    for (let i = 0; i < keys.length - CACHE_MAX; i++) await c.delete(keys[i]);
                });
            }
            return resp;
        }).catch(() => caches.match(req))
    );
});
""".strip()
    return HttpResponse(js, content_type='application/javascript')

