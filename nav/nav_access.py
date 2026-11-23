# nav/nav_access.py
"""同一地址的角色判定:主人 / 访客(2026-11-21)。

背景:之前 `/nav/` 是主人库页、`/nav/guest/` 是另一套只读快照页,两条路由两套模板。
现在 `/nav/` 一个地址就够:

- 带令牌 → 主人全量页(分类维护、导入导出、工具、桌宠、AI 配置都在);
- 没带 / 带错 → 访客只读页(默认站点来自公开快照,自己的导入只进 localStorage);
- 网址全程不变。

令牌完全复用写接口那套 `NAV_WRITE_TOKEN`,来源与 `config.middleware.WriteTokenMiddleware`
一致:请求头 `X-Nav-Write-Token`、cookie `nav_token`、查询串 `?nav_token=`。
未配置令牌(本地开发 / Vercel 预览)→ 一律视为主人,历史行为不变。

⚠️ 访客分支必须在**任何数据库查询之前**返回:`/nav/` 的访客态要满足 0 查询契约
(见 tests_nav_guest.test_guest_page_is_readonly_and_zero_queries)。
"""

import json
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from config.middleware import (
    NAV_WRITE_TOKEN_COOKIE, NAV_WRITE_TOKEN_HEADER, NAV_WRITE_TOKEN_MAX_AGE,
    NAV_WRITE_TOKEN_QUERY, _nav_write_token, _token_eq,
)
from .views_nav_base import NAV_SEARCH_ENGINES

# 小分类层级分隔符,与 nav.views_nav_check.NAV_SUBCAT_SEPS 保持一致;
# 这里不 import 那个模块,避免视图层互相引用。
GUEST_SUBCAT_SEPS = (' / ', ' > ')


def nav_is_owner(request):
    """这个请求是不是主人本人。

    没配令牌 → True(本地自用,不给自己找麻烦)。
    配了令牌 → 三个来源任一命中才算;空值/错值都落到访客。
    """
    token = _nav_write_token()
    if not token:
        return True
    supplied = (request.headers.get(NAV_WRITE_TOKEN_HEADER)
                or request.COOKIES.get(NAV_WRITE_TOKEN_COOKIE)
                or request.GET.get(NAV_WRITE_TOKEN_QUERY)
                or '').strip()
    return bool(supplied) and _token_eq(supplied, token)


def nav_token_enabled():
    """是否配置了访问令牌(决定页面要不要显示「退出主人态」)。"""
    return bool(_nav_write_token())


def _public_snapshot_path():
    return Path(settings.BASE_DIR) / 'nav' / 'static' / 'guest' / 'nav-public.json'


def _load_public_snapshot():
    """读公开快照,不碰数据库。文件缺失/损坏时返回空结构,访客页显示空态。"""
    try:
        with open(_public_snapshot_path(), 'r', encoding='utf-8') as fp:
            data = json.load(fp)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _guest_site_row(site, index):
    """快照字段 → 自用版卡片模板需要的字段。

    卡片模板(`_nav_site_card.html`)读的是模型对象:pk / click_count / fav_url /
    host / last_check_* / created_at。公开快照只有白名单字段,这里补默认值,
    让同一张卡片模板能原样渲染,同时不带任何主人侧数据。
    """
    row = dict(site)
    row['pk'] = index
    row['click_count'] = 0
    row['pinyin_initial'] = ''
    row['last_check_at'] = None
    row['last_check_ms'] = None
    row['last_check_code'] = None
    row['check_failed'] = False
    row['check_tip'] = ''
    row['created_at'] = None
    row['host'] = urlparse(row.get('url') or '').netloc
    favicon = (row.get('favicon') or '').strip()
    try:
        hostname = urlparse(row.get('url') or '').hostname or ''
    except ValueError:
        hostname = ''
    # 与 NavSite.fav_url 同一套两级来源:快照里的 favicon 大多为空(主人页靠
    # favicon.im 现取),访客行必须自己补上，否则卡片只剩站名没有图标。
    row['fav_url'] = favicon or (
        f'https://favicon.im/{hostname}' if hostname else ''
    )
    row['fav_url_alt'] = (
        f'https://www.google.com/s2/favicons?domain={hostname}&sz=32'
        if hostname else ''
    )
    return row


def _split_guest_subcat(name):
    for sep in GUEST_SUBCAT_SEPS:
        if sep in name:
            parent, leaf = name.split(sep, 1)
            return parent.strip(), leaf.strip()
    return name, ''


def _guest_subcat_tree(subs, group_index):
    """与 nav.views_nav_sites._build_subcat_tree 同一套两级/三级的展示结构。"""
    if not any(sep in s for s in subs if s for sep in GUEST_SUBCAT_SEPS):
        return None
    parents = {}
    for s in sorted(k for k in subs if k):
        parent, leaf = _split_guest_subcat(s)
        node = parents.setdefault(parent, {'count': 0, 'leaves': {}})
        node['count'] += len(subs[s])
        node['leaves'].setdefault(leaf, []).extend(subs[s])
    tree = []
    if subs.get(''):
        tree.append({'parent': '', 'count': len(subs['']), 'anchor': '',
                     'leaves': [{'leaf': '', 'sites': subs[''], 'full': '', 'anchor': ''}]})
    for parent in sorted(parents):
        node = parents[parent]
        ti = len(tree) + 1
        leaves, li = [], 0
        for leaf in sorted(node['leaves'], key=lambda x: (x != '', x)):
            li += 1
            leaves.append({
                'leaf': leaf, 'sites': node['leaves'][leaf],
                'full': (parent + ' / ' + leaf) if leaf else parent,
                'anchor': ('navSub2%d_%d_%d' % (group_index, ti, li)) if leaf else '',
            })
        tree.append({'parent': parent, 'count': node['count'], 'leaves': leaves,
                     'anchor': 'navSub%d_%d' % (group_index, ti)})
    return tree


def _guest_groups(snapshot):
    """快照 → 模板 groups(大类 / 直属站点 / 小分类 / 三级树)。

    结构与 `views_nav_sites.nav_sites` 传给模板的 groups 完全一致,所以访客页
    用的就是自用版同一套模板和卡片,只是数据来自静态快照。
    """
    sites = snapshot.get('sites') or []
    cats = snapshot.get('categories') or []
    rows = [_guest_site_row(s, i) for i, s in enumerate(sites, 1) if isinstance(s, dict)]
    by_cat = {}
    for r in rows:
        by_cat.setdefault(r.get('category') or '未分类', {}) \
              .setdefault(r.get('subcat') or '', []).append(r)
    order = [c for c in cats if c in by_cat] + [c for c in by_cat if c not in cats]
    groups = []
    for ci, c in enumerate(order, 1):
        subs = by_cat[c]
        items = [('', subs.get('', []))] + [(s, subs[s]) for s in sorted(k for k in subs if k)]
        group = {
            'category': c,
            'count': sum(len(v) for v in subs.values()),
            'items': items,
            'sub_links': [(i, s, len(v)) for i, (s, v) in enumerate(items, 1) if s and v],
            'tree': None,
        }
        tree = _guest_subcat_tree(subs, ci)
        if tree is not None:
            group['tree'] = tree
            group['sub_links'] = [(ti, node['parent'], node['count'])
                                  for ti, node in enumerate(tree, 1)
                                  if node['parent'] and node['count']]
            group['items'] = []
        groups.append(group)
    return groups, order


def nav_render_guest(request):
    """访客态:与主人页同一套模板(nav_sites.html),同一套卡片和桌宠。

    区别只在数据与权限:
    - 站点来自公开快照(静态 JSON),不查数据库、不带工具/归档/AI 配置;
    - 模板输出 nav_guest_mode,前端据此隐藏所有写入口并拦截 /api/nav/ 请求,
      并显示「主人登录」入口。网址仍然是 /nav/。
    """
    snapshot = _load_public_snapshot()
    groups, order = _guest_groups(snapshot)
    context = {
        'nav_base_template': getattr(settings, 'NAV_BASE_TEMPLATE', 'nav/base.html'),
        'nav_guest_mode': True,
        'groups': groups,
        'total': len(snapshot.get('sites') or []),
        'archived': [],
        'all_categories': order,
        'cat_items': [(c, False) for c in order],
        'hidden_cats': [],
        'hidden_site_count': 0,
        'hidden_cat_names': [],
        'tools': [],
        'nav_cat_json': '{}',
        'nav_cat_child_json': '{}',
        'nav_cat_subs_json': '{}',
        'nav_site_map_json': '{}',
        'search_engines': NAV_SEARCH_ENGINES,
        'nav_token_enabled': False,
        'nav_site_urls': {},
    }
    return render(request, 'nav/nav_sites.html', context)


@require_POST
def nav_login(request):
    """访客页的「主人登录」:校验密码 → 写 cookie → 同一个地址变成自用版。

    只接受 POST,避免密码进浏览器历史/Referer。支持 JSON 与普通表单两种提交。
    注意它不在 `/api/nav/` 前缀下,所以走 CSRF 校验、不走写令牌中间件。
    """
    token = _nav_write_token()
    if not token:
        # 没配令牌 = 本来就不分角色,告诉前端"重新打开就是自用版",别让人以为密码错了
        return JsonResponse({'status': 'success', 'owner': True, 'token_required': False})

    supplied = ''
    if 'application/json' in (request.content_type or ''):
        try:
            payload = json.loads(request.body or b'{}')
        except (TypeError, ValueError):
            payload = {}
        if isinstance(payload, dict):
            supplied = str(payload.get('token') or '').strip()
    else:
        supplied = (request.POST.get('token') or '').strip()

    if not supplied:
        return JsonResponse({'status': 'error', 'message': '请输入访问密码'}, status=400)
    if not _token_eq(supplied, token):
        return JsonResponse({'status': 'error', 'message': '密码不对'}, status=403)

    response = JsonResponse({'status': 'success', 'owner': True})
    response.set_cookie(NAV_WRITE_TOKEN_COOKIE, token,
                        max_age=NAV_WRITE_TOKEN_MAX_AGE,
                        httponly=True,              # 前端不读它,只给服务端认人
                        secure=request.is_secure(),
                        samesite='Lax')
    return response


@require_POST
def nav_logout(request):
    """退出主人态:清 cookie,回到访客视图(网址仍然不变)。"""
    response = JsonResponse({'status': 'success', 'owner': False})
    response.delete_cookie(NAV_WRITE_TOKEN_COOKIE)
    return response
