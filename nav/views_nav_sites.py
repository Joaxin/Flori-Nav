# nav/views_nav_sites.py
"""站点增删改、排序、归档、批量、卫生检查、备用地址(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""

from .views_nav_base import NAV_SITE_ORDER_MAX, _NAV_META_UA, _clean_icon_color, _clean_nav_children, _clean_nav_tags, _compose_nav_subcat, _decode_nav_html, _guard_public_url, _json_body, _nav_real_description, _normalize_nav_url, _parse_category_order_items, _parse_site_meta, _safe_get, _save_category_order, _seed_nav_sites, _site_defaults, _site_row, logger
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST, require_http_methods
from .views_nav_base import NAV_SEARCH_ENGINES
from .views_nav_check import NAV_MOVED_READ_MAX, NAV_SUBCAT_SEPS, _nav_split_subcat, _parse_moved_urls

from .models import NavSite, NavCategory, NavTool, NavAiConfig, NavPublicConfig
from .nav_access import nav_is_owner, nav_render_guest, nav_token_enabled
from .nav_data import DEFAULT_SITES
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render, get_object_or_404
from django.urls import reverse
from django.utils import timezone
from urllib.parse import urlparse, urljoin
from pathlib import Path
import json
import requests
import shutil


def _collect_site_index(sites):
    """站点列表 → (分类分组, 大类网址, 大类子页网址, 小分类集合, 网址→站点)。

    休眠站(archived_at 非空)不进分类:派生数据(cat_urls/site_map/cat_subs)
    一并拿不到它们,所以测活、批量、拖拽换分类的候选里都没有它们——
    不是"藏起来了还能被操作",是真不参与主列表。
    """
    by_cat, cat_urls, cat_child_urls, cat_subs, site_map = {}, {}, {}, {}, {}
    for site in sites:
        by_cat.setdefault(site.category, {}).setdefault(site.subcat, []).append(site)
        # d=1 表示库里已有真简介(不是「书签分类:」兜底):书签导入时据此跳过重复抓取
        entry = {'id': site.pk, 'name': site.name}
        if _nav_real_description(getattr(site, 'description', '')):
            entry['d'] = 1
        site_map[site.url] = entry
        urls = [site.url] + [a['url'] for a in (site.alternates or [])
                             if isinstance(a, dict) and a.get('url')]
        lst = cat_urls.setdefault(site.category, [])
        for u in urls:
            if u not in lst:
                lst.append(u)
        chl = [c['url'] for c in (site.children or []) if isinstance(c, dict) and c.get('url')]
        if chl:
            cat_child_urls.setdefault(site.category, []).extend(chl)
        if site.subcat:
            cat_subs.setdefault(site.category, set()).add(site.subcat)
    return by_cat, cat_urls, cat_child_urls, cat_subs, site_map


def _build_subcat_tree(subs, group_index):
    """三级模式(展示层):该大类下任一小分类名含层级分隔符时,构建 tree 供模板走三级渲染。

    不含分隔符返回 None → 模板走原有两级分支,行为与历史完全一致。
    group_index 是大类在页面上的序号(模板 forloop.counter),用来生成 navSub{组}_{父} 锚点;
    折叠状态键用完整 subcat 串,与站点数据、既有 localStorage 键保持一致。
    """
    if not any(sep in s for s in subs if s for sep in NAV_SUBCAT_SEPS):
        return None
    parents = {}
    for s in sorted(k for k in subs if k):
        parent, leaf = _nav_split_subcat(s)
        node = parents.setdefault(parent, {'count': 0, 'leaves': {}})
        node['count'] += len(subs[s])
        node['leaves'].setdefault(leaf, []).extend(subs[s])
    tree = []
    if subs.get(''):
        tree.append({'parent': '', 'count': len(subs['']), 'anchor': '',
                     'leaves': [{'leaf': '', 'sites': subs[''], 'full': '', 'anchor': ''}]})
    for parent in sorted(parents):
        node = parents[parent]
        ti = len(tree) + 1     # tree 内位置 = 模板 forloop.counter
        leaves, li = [], 0
        for leaf in sorted(node['leaves'], key=lambda x: (x != '', x)):
            li += 1
            leaves.append({
                'leaf': leaf, 'sites': node['leaves'][leaf],
                'full': (parent + ' / ' + leaf) if leaf else parent,
                'anchor': ('navSub2%d_%d_%d' % (group_index, ti, li)) if leaf else ''})
        tree.append({'parent': parent, 'count': node['count'], 'leaves': leaves,
                     'anchor': 'navSub%d_%d' % (group_index, ti)})
    return tree


@require_http_methods(["GET"])
@ensure_csrf_cookie
def nav_sites(request):
    """网址导航页:内置 + 自定义站点,按 大类 → 直属站点/小分类 两级分组。
    分类顺序可在页面设置里调整;小分类按名称排序,空小分类的站点直接挂在大类下。
    三级(展示层,2026-10-16):小分类名含「 / 」或「 > 」时该大类额外渲染成 大类→父级→子级
    (见 NAV_SUBCAT_SEPS / _nav_split_subcat),不改模型,存量两级数据零影响。

    2026-11-21 单入口:同一个 `/nav/`,令牌命中渲染本页(主人),否则渲染访客只读页
    (`nav/nav_sites.html` 的访客态,网址不变、0 查询)。判定必须在 `NavSite.objects.exists()`
    之前,否则访客请求会先把库查一遍。"""
    if not nav_is_owner(request):
        return nav_render_guest(request)
    if not NavSite.objects.exists():
        _seed_nav_sites()
    # 拖拽排序过的(order 非空)排前,未排的按 分类+名称 垫底
    by_cat, cat_urls, cat_child_urls, cat_subs, site_map = _collect_site_index(
        NavSite.objects.filter(archived_at__isnull=True).order_by(
            F('order').asc(nulls_last=True), 'category', 'name'))
    rows = {r.name: r for r in NavCategory.objects.all()}
    saved_order = [r.name for r in NavCategory.objects.order_by('order', 'name')]
    builtin_order = list(dict.fromkeys(item['category'] for item in DEFAULT_SITES))
    base = saved_order or builtin_order
    categories = [c for c in base if c in by_cat] + \
                 sorted(c for c in by_cat if c not in base)
    cat_items = [(c, rows[c].hidden if c in rows else False) for c in categories]
    groups = []
    hidden_cats = []
    hidden_site_count = 0
    for c, hidden in cat_items:
        if hidden:
            # 分类被隐藏时整组不进主列表。若所有有站点的分类都被隐藏,页面会只剩空态,
            # 必须把「站还在、只是分类隐藏了」如实告诉用户,否则会被当成数据丢失。
            count = sum(len(v) for v in by_cat[c].values())
            hidden_cats.append({'name': c, 'count': count})
            hidden_site_count += count
            continue
        subs = by_cat[c]
        items = [('', subs.get('', []))] + \
                [(s, subs[s]) for s in sorted(k for k in subs if k)]
        group = {'category': c, 'count': sum(len(v) for v in subs.values()),
                 'items': items,
                 # 左侧目录二级条目:idx 与模板 navSub{组号}_{idx} 锚点对应(items 的 forloop.counter)
                 'sub_links': [(i, s, len(v)) for i, (s, v) in enumerate(items, 1) if s and v],
                 'tree': None}
        tree = _build_subcat_tree(subs, len(groups) + 1)   # 序号与模板 forloop.counter 对齐
        if tree is not None:
            group['tree'] = tree
            # TOC 三级模式下只列父级(锚点指向父块):2000 站时 TOC 不因多一层而条目爆炸
            group['sub_links'] = [(ti, node['parent'], node['count'])
                                  for ti, node in enumerate(tree, 1)
                                  if node['parent'] and node['count']]
            group['items'] = []    # 三级模式不再渲染平铺 items,省一份内存
        groups.append(group)
    context = {
        'nav_base_template': getattr(settings, 'NAV_BASE_TEMPLATE', 'nav/base.html'),
        'groups': groups,
        'total': NavSite.objects.count(),
        # 休眠清单(抽屉「🩺 保养」页下方渲染,服务端一次查出,页面打开零请求)
        'archived': list(NavSite.objects.filter(archived_at__isnull=False).order_by('archived_at')),
        'all_categories': categories,
        'cat_items': cat_items,
        # 整页空态的一键恢复入口:有站点但分类全被隐藏时才有值
        'hidden_cats': hidden_cats,
        'hidden_site_count': hidden_site_count,
        'hidden_cat_names': [h['name'] for h in hidden_cats],
        'tools': list(NavTool.objects.all()),
        # 链接测活弹窗"填入大类网址"用:主站与子页分开,勾"含子网页"才合并
        'nav_cat_json': json.dumps(cat_urls, ensure_ascii=False).replace('</', '<\\/'),
        'nav_cat_child_json': json.dumps(cat_child_urls, ensure_ascii=False).replace('</', '<\\/'),
        # 添加表单里"小分类"输入框按所选大类自动提示(也可自定义新名称)
        'nav_cat_subs_json': json.dumps({c: sorted(s) for c, s in cat_subs.items()},
                                        ensure_ascii=False).replace('</', '<\\/'),
        # 测活结果"加入备用"用:主站网址 → {id, name}
        'nav_site_map_json': json.dumps(site_map, ensure_ascii=False).replace('</', '<\\/'),
        # 顶部搜索框引擎列表(nav_data.NAV_SEARCH_ENGINES)
        'search_engines': NAV_SEARCH_ENGINES,
        # 配了访问令牌才显示「退出主人态」:没配时这个地址本来就是自用版
        'nav_token_enabled': nav_token_enabled(),
        # 游客页公开范围（主人可在 维护 → 游客页内容 切换）
        'nav_guest_scope': NavPublicConfig.current().scope,
    }
    # 2026-11-07 脚本外置:模板里的 {% url %} 在这里统一算好,交给 #navSiteUrls 配置块
    context['nav_site_urls'] = {
        'fetchMeta': reverse('nav_fetch_meta'),
        'iconUpload': reverse('api_nav_icon_upload'),
        'add': reverse('nav_add'),
        'edit': reverse('nav_edit'),
        'delete': reverse('nav_delete'),
        'restore': reverse('nav_restore'),
        'toolEdit': reverse('nav_tool_edit'),
        'toolUpload': reverse('nav_tool_upload'),
        'toolDelete': reverse('nav_tool_delete'),
        'unhide': reverse('api_nav_category_unhide'),
    }
    return render(request, 'nav/nav_sites.html', context)


@require_POST
def api_nav_guest_scope(request):
    """主人后台切换游客页范围：public（全部未隐藏站点）/ builtin（仅内置站点）。

    保存后立即重生成 `nav-public.json`。切换 builtin 前会把当前完整快照
    备份到 nav/.cache/nav-public-full.json；如果 public 模式下库里没有可见站点
    （例如本地库只剩隐藏分类里的内置站点），切回 public 时恢复这份完整快照，
    避免一次范围切换把访客页写成空。
    """
    if not nav_is_owner(request):
        return JsonResponse({'status': 'error', 'message': '未授权'}, status=403)
    data, err = _json_body(request)
    if err:
        return err
    scope = str(data.get('scope') or '').strip()
    valid = {NavPublicConfig.SCOPE_PUBLIC, NavPublicConfig.SCOPE_BUILTIN}
    if scope not in valid:
        return JsonResponse({'status': 'error', 'message': 'scope 须为 public 或 builtin'}, status=400)

    try:
        from .management.commands.export_nav_public import public_payload
        payload = public_payload(scope=scope)
    except Exception as exc:
        logger.warning('切换游客页范围前读取站点失败:%s', exc)
        return JsonResponse({'status': 'error', 'message': f'读取站点失败：{exc}'}, status=500)

    snapshot = Path(settings.BASE_DIR) / 'nav' / 'static' / 'guest' / 'nav-public.json'
    full_cache = Path(settings.BASE_DIR) / 'nav' / '.cache' / 'nav-public-full.json'

    # 切到内置模式前，先留一份完整快照；已有缓存不覆盖，避免第二次切换把完整版冲掉。
    if scope == NavPublicConfig.SCOPE_BUILTIN and snapshot.exists():
        if not full_cache.exists():
            full_cache.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(snapshot, full_cache)
    # public 模式下库里没有可见站点：恢复上次完整快照，而不是写空。
    elif scope == NavPublicConfig.SCOPE_PUBLIC and not payload.get('sites'):
        if full_cache.exists():
            cfg = NavPublicConfig.current()
            cfg.scope = scope
            cfg.save()
            shutil.copy2(full_cache, snapshot)
            try:
                cached = json.loads(full_cache.read_text(encoding='utf-8'))
            except Exception:
                cached = {}
            return JsonResponse({
                'status': 'success',
                'scope': scope,
                'sites': len(cached.get('sites') or []),
                'categories': len(cached.get('categories') or []),
                'restored': True,
            })
        return JsonResponse({
            'status': 'error',
            'message': '当前范围没有可公开的站点，已保留现有访客快照',
        }, status=400)
    elif not payload.get('sites'):
        return JsonResponse({
            'status': 'error',
            'message': '当前范围没有可公开的站点，已保留现有访客快照',
        }, status=400)

    cfg = NavPublicConfig.current()
    cfg.scope = scope
    cfg.save()

    try:
        from .signals import write_public_snapshot
        write_public_snapshot(force=True)
    except Exception as exc:
        logger.warning('切换游客页范围后生成快照失败:%s', exc)
        return JsonResponse({'status': 'error', 'message': f'快照生成失败：{exc}'}, status=500)

    if scope == NavPublicConfig.SCOPE_PUBLIC:
        full_cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snapshot, full_cache)

    return JsonResponse({
        'status': 'success',
        'scope': scope,
        'sites': len(payload.get('sites') or []),
        'categories': len(payload.get('categories') or []),
        'restored': False,
    })


@require_POST
def nav_category_order(request):
    """保存分类顺序与显隐:{order: [分类名 或 {name, hidden}, ...]}(整表替换)。"""
    data, err = _json_body(request)
    if err:
        return err
    items = data.get('order')
    if not isinstance(items, list) or len(items) > 200:
        return JsonResponse({'status': 'error', 'message': 'order 须为分类数组(≤200)'}, status=400)
    pairs = _parse_category_order_items(items)
    _save_category_order(pairs)
    return JsonResponse({'status': 'success', 'saved': len(pairs)})


@require_POST
def api_nav_category_unhide(request):
    """空态一键恢复:{names: [分类名, ...]} —— 只把 hidden 改回 False。

    与 nav_category_order 的「整表替换」刻意分开:那个接口会按提交列表重建
    NavCategory 表,没列出的空分类会被一并删掉;这里只翻一列,不碰顺序、
    不删行,避免从一个空态操作顺手抹掉分类表里的其它记录。
    """
    if not nav_is_owner(request):
        return JsonResponse({'status': 'error', 'message': '未授权'}, status=403)
    data, err = _json_body(request)
    if err:
        return err
    names = data.get('names')
    if not isinstance(names, list) or not names:
        return JsonResponse({'status': 'error', 'message': 'names 须为非空数组'}, status=400)
    clean = []
    for raw in names[:200]:
        name = str(raw or '').strip()[:50]
        if name and name not in clean:
            clean.append(name)
    if not clean:
        return JsonResponse({'status': 'error', 'message': '没有有效分类名'}, status=400)
    updated = NavCategory.objects.filter(name__in=clean, hidden=True).update(hidden=False)
    return JsonResponse({'status': 'success', 'updated': updated})


@require_POST
def nav_category_rename(request):
    """分类改名:{old, new}。

    分类没有独立主表:站点上存的是 category 字符串,排序/显隐在 NavCategory 里各存一行。
    所以改名必须两处一起改,否则站点会变成"新分类",排序表里只剩一条指向旧名的空记录。
    """
    data, err = _json_body(request)
    if err:
        return err
    old = str(data.get('old') or '').strip()[:50]
    new = str(data.get('new') or '').strip()[:50]
    if not old or not new:
        return JsonResponse({'status': 'error', 'message': 'old / new 都不能为空'}, status=400)
    if old == new:
        return JsonResponse({'status': 'success', 'renamed': 0, 'name': new})
    if (NavSite.objects.filter(category=new).exists()
            or NavCategory.objects.filter(name=new).exists()):
        return JsonResponse({'status': 'error', 'message': f'分类「{new}」已存在'}, status=409)
    with transaction.atomic():
        renamed = NavSite.objects.filter(category=old).update(category=new)
        NavCategory.objects.filter(name=old).update(name=new)
    return JsonResponse({'status': 'success', 'renamed': renamed, 'name': new})


@require_POST
def nav_site_order(request):
    """保存卡片拖拽顺序:{order: [站点id, ...]} 按页面 DOM 顺序整表提交,
    依序赋 order=1..N;未列入的(隐藏分类里的等)清空 order 排到最后。"""
    data, err = _json_body(request)
    if err:
        return err
    items = data.get('order')
    if not isinstance(items, list) or not items or len(items) > NAV_SITE_ORDER_MAX:
        return JsonResponse({'status': 'error',
                             'message': f'order 须为站点 id 数组(≤{NAV_SITE_ORDER_MAX})'}, status=400)
    ids, seen = [], set()
    for pk in items:
        try:
            pk = int(pk)
        except (TypeError, ValueError):
            continue
        if pk > 0 and pk not in seen:
            seen.add(pk)
            ids.append(pk)
    if not ids:
        return JsonResponse({'status': 'error', 'message': 'order 里没有有效 id'}, status=400)
    with transaction.atomic():
        pos = 1
        for pk in ids:
            if NavSite.objects.filter(pk=pk).update(order=pos):
                pos += 1
        # 未列入的清空 order 排到最后;但隐藏分类的站点不在页面 DOM 里、
        # 天然"未列入",不能因此丢掉它们已保存的顺序
        # 同理,休眠中的站也不在 DOM 里(2026-10-30 休眠功能),唤醒后应回到原位而不是排到最后
        hidden_cats = list(NavCategory.objects.filter(hidden=True).values_list('name', flat=True))
        NavSite.objects.exclude(pk__in=seen).exclude(category__in=hidden_cats) \
            .exclude(archived_at__isnull=False).update(order=None)
    return JsonResponse({'status': 'success', 'saved': pos - 1})


@require_POST
def nav_fetch_meta(request):
    """添加站点时抓取对方首页的 <title>、favicon 和 meta description(用户主动提供网址,本机自用工具)。"""
    data, err = _json_body(request)
    if err:
        return err
    url = _normalize_nav_url(data.get('url'))
    if not url:
        return JsonResponse({'status': 'error', 'message': '请先填写网址'}, status=400)
    try:
        _guard_public_url(url)   # 用户填什么就取什么,先挡内网/非法 scheme(SSRF)
    except ValueError as exc:
        return JsonResponse({'status': 'error',
                             'message': f'抓取失败:{exc}(可手动填写名称)'}, status=502)
    try:
        # _safe_get:302 到内网也要在跳到那一层时被拦住(裸 requests.get 会自动跟跳)
        response = _safe_get(url, timeout=8, headers={'User-Agent': _NAV_META_UA})
        response.raise_for_status()
    except Exception as exc:   # 外网失败是常态(墙/证书/超时),提示让用户手填即可
        logger.debug('抓取站点元信息失败 %s:%s', url, exc)
        return JsonResponse({'status': 'error', 'message': '抓取失败:无法访问该网址(可手动填写名称)'}, status=502)
    final_url = response.url or url
    if urlparse(final_url).scheme not in ('http', 'https'):
        return JsonResponse({'status': 'error', 'message': '仅支持 http/https 网址'}, status=502)
    meta = _parse_site_meta(final_url, response.content[:400 * 1024])
    # 同一次抓取顺带检测"内容新地址"(旧站放新域名公告之类),零额外请求
    moved = _parse_moved_urls(final_url, _decode_nav_html(response.content[:NAV_MOVED_READ_MAX]))
    if moved:
        meta['moved'] = moved
    meta['status'] = 'success'
    return JsonResponse(meta)


@require_POST
def nav_add(request):
    data, err = _json_body(request)
    if err:
        return err
    name = (data.get('name') or '').strip()[:100]
    url = _normalize_nav_url(data.get('url'))
    category = (data.get('category') or '').strip()[:50] or '自定义'
    subcat = _compose_nav_subcat(data.get('subcat'), data.get('subcat2'))
    description = (data.get('description') or '').strip()[:200]
    site_title = (data.get('site_title') or '').strip()[:200]
    favicon = (data.get('favicon') or '').strip()[:300]
    icon_text = (data.get('icon_text') or '').strip()[:8]
    icon_color = _clean_icon_color(data.get('icon_color'))
    try:
        icon_size = max(0, min(64, int(data.get('icon_size') or 0)))
    except (TypeError, ValueError):
        icon_size = 0
    if not name or not url:
        return JsonResponse({'status': 'error', 'message': '名称和网址不能为空'}, status=400)
    if NavSite.objects.filter(url=url).exists():
        return JsonResponse({'status': 'error', 'message': '该网址已在导航中'}, status=400)
    children = _clean_nav_children(data.get('children'))
    alternates = _clean_nav_children(data.get('alternates'))
    tags = _clean_nav_tags(data.get('tags'))
    obj = NavSite.objects.create(name=name, url=url, category=category, subcat=subcat,
                                 description=description, site_title=site_title,
                                 favicon=favicon, icon_text=icon_text, icon_color=icon_color,
                                 icon_size=icon_size, children=children, alternates=alternates,
                                 tags=tags)
    return JsonResponse({'status': 'success', 'id': obj.id})


@require_POST
def nav_delete(request):
    """删除站点:同时把这一行原样返回,前端 toast 上给"撤销"按钮(见 nav_restore)。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    obj = NavSite.objects.filter(id=pk).first()
    if not obj:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    row = dict(_site_row(obj), is_builtin=obj.is_builtin)
    obj.delete()
    return JsonResponse({'status': 'success', 'site': row})


@require_POST
def nav_restore(request):
    """撤销删除:把 nav_delete 返回的那一行重新入库(同一套清洗规则)。
    网址已被重新添加时冲突,直接报错而不是覆盖用户新加的那条。"""
    data, err = _json_body(request)
    if err:
        return err
    item = data.get('site')
    if not isinstance(item, dict):
        return JsonResponse({'status': 'error', 'message': '缺少 site 数据'}, status=400)
    name = (item.get('name') or '').strip()[:100]
    url = _normalize_nav_url(item.get('url'))
    if not name or not url:
        return JsonResponse({'status': 'error', 'message': '名称和网址不能为空'}, status=400)
    if NavSite.objects.filter(url=url).exists():
        return JsonResponse({'status': 'error', 'message': '该网址已重新添加,无需恢复'}, status=400)
    obj = NavSite.objects.create(url=url, is_builtin=bool(item.get('is_builtin')),
                                 **_site_defaults(item))
    return JsonResponse({'status': 'success', 'id': obj.id})


@require_POST
def nav_edit(request):
    """编辑站点:可改名称/网址/大类/小分类/简介/子网页(内置条目也可改,恢复内置会覆盖)。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    obj = NavSite.objects.filter(id=pk).first()
    if not obj:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    name = (data.get('name') or '').strip()[:100]
    url = _normalize_nav_url(data.get('url'))
    if not name or not url:
        return JsonResponse({'status': 'error', 'message': '名称和网址不能为空'}, status=400)
    if NavSite.objects.filter(url=url).exclude(id=pk).exists():
        return JsonResponse({'status': 'error', 'message': '该网址已在导航中'}, status=400)
    obj.name = name
    obj.url = url
    obj.category = (data.get('category') or '').strip()[:50] or '自定义'
    obj.subcat = _compose_nav_subcat(data.get('subcat'), data.get('subcat2'))
    obj.description = (data.get('description') or '').strip()[:200]
    obj.site_title = (data.get('site_title') or '').strip()[:200]
    obj.favicon = (data.get('favicon') or '').strip()[:300]
    obj.icon_text = (data.get('icon_text') or '').strip()[:8]
    obj.icon_color = _clean_icon_color(data.get('icon_color'))
    try:
        obj.icon_size = max(0, min(64, int(data.get('icon_size') or 0)))
    except (TypeError, ValueError):
        obj.icon_size = 0
    obj.children = _clean_nav_children(data.get('children'))
    obj.alternates = _clean_nav_children(data.get('alternates'))
    obj.tags = _clean_nav_tags(data.get('tags'))
    # 显式列字段,别把 click_count 整行写回去:点卡片走的是 update(click_count=F(...)+1),
    # 全行 save 会用编辑前读到的旧计数盖掉并发的那几次点击
    obj.save(update_fields=['name', 'url', 'category', 'subcat', 'description', 'site_title',
                            'favicon', 'icon_text', 'icon_color', 'icon_size',
                            'children', 'alternates', 'tags'])
    return JsonResponse({'status': 'success', 'id': obj.id})


@require_POST
def nav_move(request):
    """拖拽卡片到左侧目录换分类:只改大类/小分类两个字段(其余字段不动)。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    obj = NavSite.objects.filter(id=pk).first()
    if not obj:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    category = (data.get('category') or '').strip()[:50]
    if not category:
        return JsonResponse({'status': 'error', 'message': '缺少目标分类'}, status=400)
    obj.category = category
    obj.subcat = _compose_nav_subcat(data.get('subcat'), data.get('subcat2'))
    obj.save(update_fields=['category', 'subcat'])
    return JsonResponse({'status': 'success', 'id': obj.id,
                         'category': obj.category, 'subcat': obj.subcat})


@require_http_methods(['GET', 'POST'])
def api_nav_alt_swap(request):
    """体检篮"试备用"(2026-10-26 点单):GET ?id= 返回该站备用列表;
    POST {id, new_url} 把备用提升为主站,旧主站转入 alternates(可手动换回)。"""
    if request.method == 'GET':
        try:
            pk = int(request.GET.get('id'))
        except (TypeError, ValueError):
            return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
        obj = NavSite.objects.filter(id=pk).first()
        if not obj:
            return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
        return JsonResponse({'status': 'ok', 'alternates': obj.alternates or []})
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    obj = NavSite.objects.filter(id=pk).first()
    if not obj:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    new_url = _normalize_nav_url(data.get('new_url'))
    if not new_url:
        return JsonResponse({'status': 'error', 'message': '网址不能为空'}, status=400)
    if new_url == obj.url:
        return JsonResponse({'status': 'error', 'message': '该网址已是主站'}, status=400)
    alts = [a for a in (obj.alternates or []) if isinstance(a, dict) and a.get('url')]
    hit = next((a for a in alts if _normalize_nav_url(a['url']) == new_url), None)
    if not hit:
        return JsonResponse({'status': 'error', 'message': '该网址不在备用列表里'}, status=400)
    old_url = obj.url
    obj.url = new_url
    obj.alternates = _clean_nav_children(
        [a for a in alts if _normalize_nav_url(a['url']) != new_url]
        + [{'name': obj.name, 'url': old_url}])
    obj.save(update_fields=['url', 'alternates'])
    return JsonResponse({'status': 'ok', 'url': obj.url, 'alternates': obj.alternates})


def _archive_flag(raw):
    """休眠开关取值:on 缺省为真;字符串按 '0'/'false'/'no'/'off'/空串 判假,其余判真。"""
    if raw is None:
        return True
    if isinstance(raw, str):
        return raw.strip().lower() not in ('', '0', 'false', 'no', 'off')
    return bool(raw)


@require_POST
def api_nav_archive(request):
    """休眠 / 唤醒(2026-10-30 点单):{id, on} —— on=true 收起来(记下 archived_at),
    on=false 唤醒(清空)。**只动这一个字段**:名称/分类/子页/备用/标签/星标/点击数/体检记录全不碰。
    休眠站不再出现在分类里(nav_sites 已排除),但仍在库里、仍计入「共 N 个站点」。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    obj = NavSite.objects.filter(id=pk).first()
    if not obj:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    on = _archive_flag(data.get('on', True))
    obj.archived_at = timezone.now() if on else None
    obj.save(update_fields=['archived_at'])
    return JsonResponse({'status': 'ok', 'id': obj.id, 'archived': on})


@require_POST
def api_nav_batch(request):
    """多选批量操作(2026-10-26 点单 1):{action, ids, payload}。
    action: category(批量换分类/清小分类) | tags(并集追加标签) | delete(批量删,返回整行供撤销)
    | archive / unarchive(批量休眠·唤醒,2026-10-30)。"""
    data, err = _json_body(request)
    if err:
        return err
    action = str(data.get('action') or '')
    try:
        ids = [int(i) for i in (data.get('ids') or [])]
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 ids'}, status=400)
    ids = ids[:500]
    if not ids:
        return JsonResponse({'status': 'error', 'message': '没有选中任何站点'}, status=400)
    sites = list(NavSite.objects.filter(id__in=ids))
    if not sites:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    if action == 'category':
        category = str(data.get('category') or '').strip()[:100]
        subcat = _compose_nav_subcat(data.get('subcat'), data.get('subcat2'))
        if not category:
            return JsonResponse({'status': 'error', 'message': '目标大类不能为空'}, status=400)
        with transaction.atomic():
            for s in sites:
                s.category = category
                s.subcat = subcat
                s.save(update_fields=['category', 'subcat'])
        return JsonResponse({'status': 'ok', 'updated': len(sites)})
    if action == 'tags':
        tags = data.get('tags')
        if not isinstance(tags, list):
            return JsonResponse({'status': 'error', 'message': 'tags 须为数组'}, status=400)
        clean = [str(t).strip()[:30] for t in tags if str(t).strip()][:20]
        if not clean:
            return JsonResponse({'status': 'error', 'message': '标签不能为空'}, status=400)
        with transaction.atomic():
            for s in sites:
                s.tags = sorted(set((s.tags or []) + clean))
                s.save(update_fields=['tags'])
        return JsonResponse({'status': 'ok', 'updated': len(sites)})
    if action in ('archive', 'unarchive'):
        on = (action == 'archive')
        with transaction.atomic():
            NavSite.objects.filter(id__in=[s.pk for s in sites]).update(
                archived_at=timezone.now() if on else None)
        return JsonResponse({'status': 'ok', 'updated': len(sites), 'archived': on})
    if action == 'delete':
        rows = []
        with transaction.atomic():
            for s in sites:
                rows.append(dict(_site_row(s), is_builtin=s.is_builtin))
                s.delete()
        return JsonResponse({'status': 'ok', 'deleted': len(rows), 'rows': rows})
    return JsonResponse({'status': 'error', 'message': '未知操作'}, status=400)


_HYGIENE_TRACK_PREFIXES = ('utm_', 'fbclid', 'gclid', 'msclkid', 'igshid', 'mc_eid', '_hsenc', '_hsmi', 'ref_src', 'ref_url')


_HYGIENE_TRACK_KEYS = {'si'}


def _hygiene_url(url):
    """返回清理后的 URL;不适用(非 http(s))或无变化则原样返回。"""
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    raw = str(url or '').strip()
    parts = urlsplit(raw)
    if parts.scheme.lower() not in ('http', 'https') or not parts.netloc:
        return raw
    scheme = parts.scheme.lower()
    host = parts.netloc.lower()
    if host.endswith(':80') and scheme == 'http':
        host = host[:-3]
    if host.endswith(':443') and scheme == 'https':
        host = host[:-4]
    qs = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
          if k.lower() not in _HYGIENE_TRACK_KEYS and not k.lower().startswith(_HYGIENE_TRACK_PREFIXES)]
    path = parts.path
    if path.endswith('/') and len(path) > 1:
        path = path.rstrip('/')
    new = urlunsplit((scheme, host, path, urlencode(qs), ''))
    return new if new != raw else raw


@require_http_methods(['GET', 'POST'])
def api_nav_hygiene(request):
    """GET:扫描全库可清理项(跟踪参数/尾斜杠/大写 host);POST {items:[{id, from}]} 应用。
    冲突保护:清理后的 URL 若与其他站点重复,该条跳过(去重合并是另一件事,不混进来)。"""
    if request.method == 'GET':
        all_urls = {}
        items = []
        for s in NavSite.objects.all().order_by('id'):
            all_urls[s.url] = s.id
        for s in NavSite.objects.all().order_by('id'):
            new = _hygiene_url(s.url)
            if new == s.url:
                continue
            if new in all_urls and all_urls[new] != s.id:
                items.append({'id': s.id, 'name': s.name, 'old': s.url, 'new': new, 'conflict': True})
                continue
            all_urls.pop(s.url, None)
            all_urls[new] = s.id
            items.append({'id': s.id, 'name': s.name, 'old': s.url, 'new': new})
        return JsonResponse({'status': 'ok', 'scanned': len(items) and sum(1 for _ in NavSite.objects.values_list('id')) or 0, 'items': items[:500]})
    data, err = _json_body(request)
    if err:
        return err
    items = data.get('items')
    if not isinstance(items, list) or not items:
        return JsonResponse({'status': 'error', 'message': '没有要清理的条目'}, status=400)
    applied = 0
    with transaction.atomic():
        for it in items[:500]:
            if not isinstance(it, dict):
                continue
            s = NavSite.objects.filter(id=int(it.get('id') or 0)).first()
            if not s or s.url != it.get('from'):
                continue   # 页面打开期间数据变过,跳过防误改
            cleaned = _hygiene_url(s.url)
            if cleaned == s.url:
                continue
            if NavSite.objects.filter(url=cleaned).exclude(id=s.id).exists():
                continue   # 清理后会和其他站撞车 → 跳过(去重合并是另一件事)
            s.url = cleaned
            s.save(update_fields=['url'])
            applied += 1
    return JsonResponse({'status': 'ok', 'applied': applied})


@require_POST
def api_nav_click(request):
    """点击埋点:卡片被点开一次,click_count + 1(「按常用度排序」的数据来源)。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        pk = int(data.get('id'))
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': '无效 id'}, status=400)
    updated = NavSite.objects.filter(id=pk).update(click_count=F('click_count') + 1)
    if not updated:
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    return JsonResponse({'status': 'ok'})


def _nav_order_scope(site):
    """同一展示分组内的其它站点:大类 +(有二级时)二级,空二级单独一组。"""
    qs = NavSite.objects.filter(category=site.category)
    qs = qs.filter(subcat=site.subcat) if site.subcat else qs.filter(subcat='')
    return qs.exclude(pk=site.pk)


def _nav_order_rows(site):
    """按当前顺序返回整组(id, order):None 排最后,便于找邻居。"""
    from django.db.models import F
    qs = NavSite.objects.filter(category=site.category)
    qs = qs.filter(subcat=site.subcat) if site.subcat else qs.filter(subcat='')
    return list(qs.order_by(F('order').asc(nulls_last=True), 'id').values_list('id', 'order'))


NAV_ORDER_STEP = 1000
NAV_ORDER_LIMIT = 10 ** 6   # 反复置顶/置底会让极值越漂越远,超过这个量级就整组归一化


@require_POST
def nav_site_pin(request):
    """置顶/置底(2026-11-12):只写 1 行,order 用 1000 步长,不做全表重排。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        site = NavSite.objects.get(pk=int(data.get('id')))
    except (TypeError, ValueError, NavSite.DoesNotExist):
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    where = (data.get('where') or 'top').strip().lower()
    if where not in ('top', 'bottom'):
        return JsonResponse({'status': 'error', 'message': 'where 只能是 top 或 bottom'}, status=400)
    from django.db.models import Max, Min
    agg = _nav_order_scope(site).aggregate(lo=Min('order'), hi=Max('order'))
    if where == 'bottom':
        site.order = (agg['hi'] if agg['hi'] is not None else 0) + 1000
    else:
        site.order = (agg['lo'] - 1000) if agg['lo'] is not None else 1000

    # 反复置顶会把 order 推到很大的负数(置底同理),长期用下来数值区间会失控。
    # 越过阈值就把整组按当前显示顺序重编成 1000 步长 —— 只在这一种情况下才写多行。
    if abs(site.order) > NAV_ORDER_LIMIT:
        rest = [pk for pk, _ in _nav_order_rows(site)]
        seq = ([site.pk] + rest) if where == 'top' else (rest + [site.pk])
        with transaction.atomic():
            NavSite.objects.bulk_update(
                [NavSite(pk=pk, order=(i + 1) * NAV_ORDER_STEP) for i, pk in enumerate(seq)],
                ['order'])
        site.order = (1 if where == 'top' else len(seq)) * NAV_ORDER_STEP
        return JsonResponse({'status': 'success', 'order': site.order, 'renumbered': True})

    site.save(update_fields=['order'])
    return JsonResponse({'status': 'success', 'order': site.order})


@require_POST
def nav_site_swap(request):
    """与相邻站点交换位置:正常只写 2 行;遇到空/重复 order 才整组重编号一次。"""
    data, err = _json_body(request)
    if err:
        return err
    try:
        site = NavSite.objects.get(pk=int(data.get('id')))
    except (TypeError, ValueError, NavSite.DoesNotExist):
        return JsonResponse({'status': 'error', 'message': '条目未找到'}, status=404)
    direction = (data.get('dir') or 'up').strip().lower()
    if direction not in ('up', 'down'):
        return JsonResponse({'status': 'error', 'message': 'dir 只能是 up 或 down'}, status=400)

    rows = _nav_order_rows(site)
    ids = [r[0] for r in rows]
    if site.pk not in ids:
        return JsonResponse({'status': 'error', 'message': '条目不在当前分组'}, status=400)
    idx = ids.index(site.pk)
    swap_with = idx - 1 if direction == 'up' else idx + 1
    if swap_with < 0 or swap_with >= len(rows):
        return JsonResponse({'status': 'success', 'moved': False})

    orders = {pk: order for pk, order in rows}
    a, b = site.pk, rows[swap_with][0]
    oa, ob = orders.get(a), orders.get(b)

    with transaction.atomic():
        if oa is None or ob is None or oa == ob:
            # 首次排序:整组按当前顺序编成 1000 的稀疏序列,再交换
            fresh = {}
            for pos, pk in enumerate(ids, start=1):
                fresh[pk] = pos * 1000
            oa, ob = fresh[a], fresh[b]
            fresh[a], fresh[b] = ob, oa
            objs = [NavSite(pk=pk, order=val) for pk, val in fresh.items()]
            NavSite.objects.bulk_update(objs, ['order'])
        else:
            NavSite.objects.filter(pk=a).update(order=ob)
            NavSite.objects.filter(pk=b).update(order=oa)
    return JsonResponse({'status': 'success', 'moved': True})
