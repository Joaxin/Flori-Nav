# nav/views_nav_export.py
"""导出 HTML / 书签、导入、重置(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""

from .views_nav_base import _nav_payload, _nav_real_description, _normalize_nav_url, _parse_category_order_items, _save_category_order, _seed_nav_sites, _site_defaults, logger
from django.views.decorators.http import require_POST, require_http_methods
from .views_nav_tools import _nav_tool_sanitize_text

from .models import NavSite, NavCategory, NavTool, NavAiConfig
from .nav_data import NAV_BUILTIN_CATEGORY
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from html import unescape as _html_unescape, escape as _html_escape
import base64
import json
import re
import uuid


@require_http_methods(["GET"])
def nav_export(request):
    response = HttpResponse(content_type='application/json; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="nav_sites.json"'
    response.write(json.dumps(_nav_payload(), ensure_ascii=False, indent=2))
    return response


def _bookmark_a_line(s):
    """站点 → Netscape 书签的一行 <DT><A>(名称缺失时退回网址)。"""
    href = _html_escape(s.get('url') or '', quote=True)
    name = _html_escape(s.get('name') or s.get('url') or '')
    desc = (s.get('description') or '').strip()
    line = f'<DT><A HREF="{href}">{name}</A>'
    if desc:
        line += f'\n<DD>{_html_escape(desc)}'
    return line


def _subcat_parts(sub):
    """`视频 / 图生视频` → ['视频', '图生视频'];与页面的 NAV_SUBCAT_SEPS 保持同义。"""
    return [p.strip() for p in re.split(r'\s+[/>]\s+', sub or '') if p.strip()]


def _render_subtree(subs, lines):
    """把小分类按分隔符拆成真正的嵌套文件夹。

    以前三级分类会被写成 `<H3>视频 / 图生视频</H3>` 这样一整个名字,浏览器里看是平的一层;
    现在按层级建树,导出后在 Chrome/Firefox 里也是「视频 → 图生视频」两级目录。
    """
    tree, direct = {}, []
    for sub, items in subs.items():
        if not sub:
            direct = items
            continue
        parts = _subcat_parts(sub)
        if not parts:
            direct = items
            continue
        node = tree
        for part in parts[:-1]:
            node = node.setdefault(part, {'kids': {}, 'sites': []})['kids']
        node.setdefault(parts[-1], {'kids': {}, 'sites': []})['sites'].extend(items)

    def emit(node):
        for name in sorted(node):
            entry = node[name]
            lines.append(f'<DT><H3>{_html_escape(name)}</H3>')
            lines.append('<DL><p>')
            for s in entry['sites']:
                lines.append(_bookmark_a_line(s))
            emit(entry['kids'])
            lines.append('</DL><p>')

    emit(tree)
    for s in direct:
        lines.append(_bookmark_a_line(s))


@require_http_methods(["GET"])
def nav_export_bookmark(request):
    """导出为浏览器书签(Netscape Bookmark 格式):大类 → 文件夹、小分类 → 子文件夹,
    Chrome/Edge/Firefox 的「导入收藏夹」可直接读回。站点范围与 JSON 导出一致
    (自定义 + 改过的内置),只读 _nav_payload,不维护第二套序列化。"""
    payload = _nav_payload()
    by_cat = {}
    for s in payload['sites']:
        by_cat.setdefault(s.get('category') or '自定义', {}).setdefault(
            s.get('subcat') or '', []).append(s)
    lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>',
             '<!-- This is an automatically generated file. It will be read by browsers. -->',
             '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
             '<TITLE>Bookmarks</TITLE>',
             '<H1>Bookmarks</H1>',
             '<DL><p>']
    for cat in sorted(by_cat):
        subs = by_cat[cat]
        lines.append(f'<DT><H3>{_html_escape(cat)}</H3>')
        lines.append('<DL><p>')
        # 二级/三级 → 嵌套文件夹;直属站点(_render_subtree 里已按 direct 追加)
        # ⚠️ 别再在外面补一遍 subs[''] —— 2026-11-17 复核发现两处都写,
        # 无小分类的站点在导出的书签里会出现两次(实测 422 个站点导出 428 条)。
        _render_subtree(subs, lines)
        lines.append('</DL><p>')
    lines.append('</DL><p>')
    response = HttpResponse('\n'.join(lines), content_type='text/html; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="nav_bookmarks.html"'
    return response


@require_POST
def nav_import(request):
    """导入 JSON:接受导出格式 {sites:[...], tools:[...], category_order:[...]} 或裸数组(sites);
    sites 按 url、tools 按 name upsert,幂等;老文件缺的新字段取默认值,
    v8 才有的图标/点击数在缺键时保持本机原值(导入旧文件不再抹掉它们)。"""
    file = request.FILES.get('nav_file')
    if not file:
        return JsonResponse({'status': 'error', 'message': '未找到上传的文件'}, status=400)
    if not file.name.lower().endswith('.json'):
        return JsonResponse({'status': 'error', 'message': '请上传 .json 文件'}, status=400)
    raw = file.read()
    text = None
    for encoding in ('utf-8-sig', 'gbk'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return JsonResponse({'status': 'error', 'message': '文件编码错误,请保存为 UTF-8'}, status=400)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        return JsonResponse({'status': 'error', 'message': f'JSON 格式错误: {exc}'}, status=400)
    if isinstance(parsed, dict):
        sites = parsed.get('sites') or []
        tools = parsed.get('tools') or []
        category_order = parsed.get('category_order') or []
    else:
        sites, tools, category_order = parsed, [], []
    if not isinstance(sites, list) or not isinstance(tools, list):
        return JsonResponse({'status': 'error', 'message': 'JSON 须含 sites / tools 数组'}, status=400)
    if not sites and not tools and not category_order:
        # 纯排序文件也合法(导出可只含 category_order,内置站点不计入导出)
        return JsonResponse({'status': 'error', 'message': 'JSON 中没有可导入的站点、工具或排序'}, status=400)
    created_count = 0
    updated_count = 0
    # 预先取现有简介:原来在循环里逐条查(每行一次 SELECT),400 条导入就是 400 次往返。
    # 只有"简介为空/是书签兜底文案"的行才用到它,但一次 IN 查询就能全给。
    _need = []
    for item in sites:
        if isinstance(item, dict):
            _u = _normalize_nav_url(item.get('url'))
            if _u:
                _need.append(_u)
    old_desc = dict(NavSite.objects.filter(url__in=_need).values_list('url', 'description')) if _need else {}
    with transaction.atomic():
        for item in sites:
            if not isinstance(item, dict):
                continue
            name = (item.get('name') or '').strip()[:100]
            url = _normalize_nav_url(item.get('url'))
            if not name or not url:
                continue
            defaults = _site_defaults(item)
            # 有了「导入时抓简介」之后,payload 一定带 description。两种东西不能盖掉真简介:
            #   1) 空串(没勾抓取 / 抓取失败);
            #   2) 「书签分类:xxx」兜底文案(浏览器书签没有 <DD> 时前端填的占位)。
            desc_in = defaults['description']
            if not desc_in or not _nav_real_description(desc_in):
                old = old_desc.get(url)
                if not desc_in and old:
                    defaults.pop('description')          # 空串不覆盖任何非空简介
                elif old and _nav_real_description(old):
                    defaults.pop('description')          # 兜底文案不覆盖真简介
            _, created = NavSite.objects.update_or_create(url=url, defaults=defaults)
            if created:
                created_count += 1
            else:
                updated_count += 1
        for item in tools:
            if not isinstance(item, dict):
                continue
            name = (item.get('name') or '').strip()[:100]
            if not name:
                continue
            try:
                raw = base64.b64decode(item.get('html_b64') or '')
            except Exception as exc:   # 工具HTML不是合法 base64=整条工具被丢掉,影响导入结果
                logger.warning('工具 HTML 不是合法 base64(name=%s):%s', name, exc)
                continue
            text = _nav_tool_sanitize_text(raw)
            if text is None:
                continue
            # 统一转码为 UTF-8 落盘:服务端(nav_tool_open)只按 UTF-8 解,
            # 存原始 GBK 字节会导致中文工具页打开必乱码
            raw = text.encode('utf-8')
            from django.core.files.base import ContentFile
            tool = NavTool.objects.filter(name=name).first()
            created = tool is None
            if created:
                tool = NavTool(name=name)
            tool.category = (item.get('category') or '').strip()[:50] or '我的工具'
            tool.description = (item.get('description') or '').strip()[:200]
            tool.favicon = (item.get('favicon') or '').strip()[:2000]
            tool.original_filename = (item.get('original_filename') or name)[:200]
            tool.size = len(raw)
            if tool.file:
                tool.file.delete(save=False)   # 重复导入同名工具:清掉旧文件,避免磁盘孤儿
            tool.file.save(f'{uuid.uuid4().hex}.html', ContentFile(raw), save=True)
            if created:
                created_count += 1
            else:
                updated_count += 1
        if isinstance(category_order, list) and category_order:
            pairs = _parse_category_order_items(category_order[:200])
            if pairs:
                _save_category_order(pairs)
    return JsonResponse({'status': 'success', 'created': created_count, 'updated': updated_count})


@require_POST
def nav_reset(request):
    count = _seed_nav_sites()
    # 「恢复内置站点」的语义是让它们重新可见:若这个分类之前被设为隐藏,
    # 只补数据会让页面继续空白,用户会以为恢复失败。
    NavCategory.objects.filter(name=NAV_BUILTIN_CATEGORY, hidden=True).update(hidden=False)
    return JsonResponse({'status': 'success', 'seeded': count, 'total': NavSite.objects.count()})

