# nav/views_nav_base.py
"""公共常量、正则与站点字段工具(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""


from .models import NavSite, NavCategory, NavTool, NavAiConfig
from .nav_data import DEFAULT_SITES
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from html import unescape as _html_unescape, escape as _html_escape
from urllib.parse import urlparse, urljoin
import base64
import ipaddress
import json
import logging
import os
import re
import socket


logger = logging.getLogger(__name__)

try:
    from .nav_data import NAV_SEARCH_ENGINES
except ImportError:  # nav_data 是移植时可整包替换的文件,少了定义也不该炸
    NAV_SEARCH_ENGINES = [{'name': 'Google', 'url': 'https://www.google.com/search?q={query}'}]


NAV_AI_IMPORT_MAX = 20   # AI 候选单次导入上限(测活逐条最久 8s 超时)


NAV_CHILDREN_MAX = 30


NAV_SITE_ORDER_MAX = 500   # 卡片拖拽只在少量站点时可用;大库走右键菜单的单条排序


NAV_TAG_MAX = 8           # 单站点标签个数上限


NAV_TAG_NAME_MAX = 10     # 单个标签名长度上限(与卡片徽章宽度相称)


NAV_ALLOW_PRIVATE_NET_ENV = 'NAV_ALLOW_PRIVATE_NET'   # 本机自测开关:置 1 时跳过 IP 段检查


def _nav_allow_private_net():
    """本机自测开关是否打开(每次调用现读,改环境变量不用重启测试进程)。"""
    raw = (os.environ.get(NAV_ALLOW_PRIVATE_NET_ENV) or '').strip().lower()
    return raw in ('1', 'true', 'yes', 'on')


def _nav_ip_is_public(raw_ip):
    """单个 IP 是否公网可直连:私有/环回/链路本地/保留/组播/未指定 一律不算。

    IPv6 走同一套判定(ipaddress 的 IPv6Address 同样带这些属性);
    `::ffff:127.0.0.1` 这类 IPv4 映射地址取内层 IPv4 再判一次,
    否则内核会把它当成本机地址而这里看着是"公网"。
    """
    try:
        addr = ipaddress.ip_address(str(raw_ip).split('%', 1)[0])   # 去掉 IPv6 zone id(fe80::1%eth0)
    except ValueError:
        return False          # 认不出来的地址按内网处理(宁可拒绝,不放行)
    candidates = [addr]
    mapped = getattr(addr, 'ipv4_mapped', None)
    if mapped is not None:
        candidates.append(mapped)
    for ip in candidates:
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified
                or not ip.is_global):
            return False
    return True


def _guard_public_url(url, allow_private=False):
    """出站请求的 SSRF 防护:只放行 http/https,且域名解析出的每个 IP 都必须是公网地址。

    测活/图标本地化/元信息抓取都是"用户给个网址,服务器去取",不设防就成了内网探针
    (云环境的 169.254.169.254 元数据、127.0.0.1 上的管理端口)。做法是最小可用版:
    scheme 白名单 + getaddrinfo 拿全部 IP 后逐个判段,任一命中内网段就整体拒绝。

    返回原 url(便于链式写),不合规抛 ValueError(中文消息,由调用方转成错误响应);
    NAV_ALLOW_PRIVATE_NET=1 时跳过 IP 检查(本机自测内网站点用)。
    域名解析不出来时不在这里判死(离线/沙箱无 DNS 都会 gaierror),交给下游请求自然失败。
    """
    parsed = urlparse((url or '').strip())
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('仅支持 http/https 地址')
    host = parsed.hostname or ''
    if not host:
        raise ValueError('地址缺少主机名')
    if allow_private or _nav_allow_private_net():
        return url
    try:
        port = parsed.port
    except ValueError:
        raise ValueError('地址端口不合法')
    try:
        infos = socket.getaddrinfo(host, port or (443 if parsed.scheme == 'https' else 80),
                                   proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError):
        return url
    for info in infos:
        if not _nav_ip_is_public(info[4][0]):
            raise ValueError('不允许访问内网地址')
    return url


NAV_SAFE_REDIRECT_MAX = 3


def _safe_get(url, max_hops=None, **kwargs):
    """带 SSRF 校验的 GET:每一跳重定向都要重新过 `_guard_public_url`。

    为什么不能直接用 requests.get:`requests` 默认自动跟随 302,而它不判 IP 段 ——
    一个公网地址把 Location 指到 169.254.169.254 / 127.0.0.1 就能绕过一开始的校验
    (2026-11-14 审查发现:测活已经在手动跟跳,meta 抓取 / 图标本地化 / 壁纸原图没跟上)。

    参数与 requests.get 一致(proxies / headers / timeout / stream 都能传),
    返回最后一跳的响应;不合规的跳转抛 ValueError(中文消息,调用方转成 502)。
    """
    import requests

    hops = NAV_SAFE_REDIRECT_MAX if max_hops is None else max_hops
    current = url
    options = dict(kwargs)
    options['allow_redirects'] = False      # 自己跟,才能逐跳校验
    response = None
    for _ in range(hops + 1):
        _guard_public_url(current)          # 每一跳之前都判:首跳 + 每次 Location
        response = requests.get(current, **options)
        if not (300 <= response.status_code < 400):
            return response
        location = response.headers.get('Location') if hasattr(response.headers, 'get') else ''
        if not isinstance(location, str) or not location.strip():
            return response                   # 3xx 但没有目标:交给调用方当普通响应处理
        if response is not None:
            response.close()
        current = urljoin(current, location.strip())
    raise ValueError('重定向层数过多')


def _json_body(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return None, JsonResponse({'status': 'error', 'message': '无效的请求数据'}, status=400)
    if not isinstance(data, dict):
        # 合法 JSON 但非对象(如 "null"/"[]")会让下游 data.get 直接 500
        return None, JsonResponse({'status': 'error', 'message': '请求体必须是 JSON 对象'}, status=400)
    return data, None


def _seed_nav_sites():
    """幂等种子:内置站点按 url upsert,重复调用安全。返回内置条数。

    只覆盖 is_builtin=True 的行:用户自己收录/导入过的同 URL 站点(哪怕名称、分类
    都被改过)不会被「恢复内置」抢走 —— 内置只有 17 条,冲突概率不高,但一旦被覆盖
    就是静默改名换分类,比不做更糟。
    """
    for item in DEFAULT_SITES:
        existing = NavSite.objects.filter(url=item['url']).first()
        if existing is not None and not existing.is_builtin:
            continue
        NavSite.objects.update_or_create(
            url=item['url'],
            defaults={'name': item['name'], 'category': item['category'],
                      'subcat': item.get('subcat', ''),
                      'description': item.get('description', ''),
                      'tags': _clean_nav_tags(item.get('tags')),
                      'children': _clean_nav_children(item.get('children')),
                      'alternates': _clean_nav_children(item.get('alternates')),
                      'is_builtin': True})
    return len(DEFAULT_SITES)


def _normalize_nav_url(url):
    url = (url or '').strip()
    if url and not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    return url[:300]


def _clean_nav_children(raw):
    """规范化 [{name, url}] 列表(children/alternates 共用):仅保留 url 合法的条目,去重限长。"""
    if not isinstance(raw, list):
        return []
    cleaned, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = _normalize_nav_url(item.get('url'))
        if not url or url in seen:
            continue
        name = (item.get('name') or '').strip()[:100] or (urlparse(url).hostname or url)
        cleaned.append({'name': name, 'url': url})
        seen.add(url)
        if len(cleaned) >= NAV_CHILDREN_MAX:
            break
    return cleaned


def _save_category_order(pairs):
    """整体替换分类排序表。pairs 为 [(分类名, 是否隐藏), ...]。"""
    with transaction.atomic():   # delete 与 bulk_create 之间崩溃会清空排序表
        NavCategory.objects.all().delete()
        NavCategory.objects.bulk_create(
            [NavCategory(name=n[:50], order=i, hidden=bool(h)) for i, (n, h) in enumerate(pairs)])


def _parse_category_order_items(items):
    """兼容 ["分类名"] 与 [{"name","hidden"}] 两种写法,去重清洗为 [(name, hidden)]。"""
    parsed, seen = [], set()
    for it in items:
        if isinstance(it, str):
            name, hidden = it.strip()[:50], False
        elif isinstance(it, dict):
            name, hidden = (it.get('name') or '').strip()[:50], bool(it.get('hidden'))
        else:
            continue
        if not name or name in seen:
            continue
        seen.add(name)
        parsed.append((name, hidden))
    return parsed


def _builtin_customized(site, seed):
    """内置站点是否被用户改过(与种子比对):改过的要进导出,否则换机会丢这些修改。"""
    if (site.name != seed['name'] or site.category != seed['category']
            or site.subcat != seed.get('subcat', '')
            or site.description != seed.get('description', '')):
        return True
    if (site.children != _clean_nav_children(seed.get('children'))
            or site.alternates != _clean_nav_children(seed.get('alternates'))):
        return True
    # 种子不含这些字段,凡非空必是用户设置(抓取的标题/图标、自定义字母图标)
    return bool(site.favicon or site.site_title or site.icon_text
                or site.icon_color or site.icon_size)


def _clean_nav_tags(raw):
    """标签清洗:接受字符串数组(或 {name} 对象),去空白/去重/限长,最多 NAV_TAG_MAX 个。
    非列表输入按空处理,与 children 的宽容策略一致(导入脏数据不该整条失败)。"""
    if not isinstance(raw, list):
        return []
    out, seen = [], set()
    for t in raw[:NAV_TAG_MAX]:
        if isinstance(t, dict):
            t = t.get('name')
        if not isinstance(t, str):
            continue
        t = t.strip()[:NAV_TAG_NAME_MAX]
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


NAV_SUBCAT_JOIN = ' / '


def _compose_nav_subcat(subcat, subcat2=''):
    """二级 + 三级 → 存储用的 `二级 / 三级`(2026-11-12 三级分类)。

    存储层不新增字段:沿用「小分类名含分隔符即视为有子级」的既有约定
    (见 views_nav_check.NAV_SUBCAT_SEPS),所以存量数据、导入导出 v10、
    折叠状态键都不用迁移。只填三级时按二级存;总长压在字段上限 50 内。
    """
    first = (subcat or '').strip()
    second = (subcat2 or '').strip()
    if not second:
        return first[:50]
    if not first:
        return second[:50]
    room = 50 - len(NAV_SUBCAT_JOIN) - len(first)
    if room < 1:                      # 二级太长,保证三级至少留 1 个字
        first = first[:max(1, 50 - len(NAV_SUBCAT_JOIN) - 1)]
        room = 50 - len(NAV_SUBCAT_JOIN) - len(first)
    return first + NAV_SUBCAT_JOIN + second[:room]


def _site_row(s):
    """站点 → JSON 行(导出与"删除后可恢复"共用一套键,别漂成两个形状)。"""
    return {'name': s.name, 'url': s.url, 'category': s.category,
            'subcat': s.subcat, 'description': s.description,
            'site_title': s.site_title, 'favicon': s.favicon,
            'icon_text': s.icon_text, 'icon_color': s.icon_color,
            'icon_size': s.icon_size,
            'children': s.children or [], 'alternates': s.alternates or [],
            'tags': s.tags or [],
            'order': s.order, 'click_count': s.click_count,
            # 休眠状态必须跟着走(v10 新增键):否则换机后收起来的站全部自己复活
            'archived': s.archived_at.isoformat() if s.archived_at else ''}


# 浏览器书签没有 <DD> 时,前端会拿「书签分类:xxx」兜底填 description。
# 这类文案只算占位,不是站点真简介 —— 导入时不能拿它盖掉已抓到的 meta 简介。
NAV_FALLBACK_DESC_PREFIX = '书签分类:'


def _nav_real_description(desc):
    """只有非空且不是书签兜底文案的简介,才算"已有真简介"。"""
    d = (desc or '').strip()
    return bool(d) and not d.startswith(NAV_FALLBACK_DESC_PREFIX)


def _site_defaults(item):
    """JSON 行 → NavSite 字段字典(导入/恢复共用,逐字段清洗)。
    图标与点击数是 v8 新增键:缺键时不写进 defaults,免得导入旧文件把本机已设值清零。"""
    defaults = {'name': (item.get('name') or '').strip()[:100],
                'category': (item.get('category') or '').strip()[:50] or '自定义',
                'subcat': (item.get('subcat') or '').strip()[:50],
                'description': (item.get('description') or '').strip()[:200],
                'site_title': (item.get('site_title') or '').strip()[:200],
                'favicon': (item.get('favicon') or '').strip()[:300],
                'children': _clean_nav_children(item.get('children')),
                'alternates': _clean_nav_children(item.get('alternates'))}
    if 'icon_text' in item or 'icon_color' in item or 'icon_size' in item:
        defaults['icon_text'] = (item.get('icon_text') or '').strip()[:8]
        defaults['icon_color'] = _clean_icon_color(item.get('icon_color'))
        try:
            defaults['icon_size'] = max(0, min(64, int(item.get('icon_size') or 0)))
        except (TypeError, ValueError):
            defaults['icon_size'] = 0
    if 'tags' in item:   # v9 新增键:缺键时不写进 defaults,免得旧文件把本机标签抹掉
        defaults['tags'] = _clean_nav_tags(item.get('tags'))
    if 'archived' in item:   # v10 新增键:缺键(v9 及更早)时保持本机休眠状态不变
        raw = item.get('archived')
        if raw in (None, '', False):
            defaults['archived_at'] = None          # 文件明确写了"没休眠"
        elif isinstance(raw, bool):
            defaults['archived_at'] = timezone.now()  # 只写了 true:按现在休眠
        else:
            from django.utils.dateparse import parse_datetime
            parsed = parse_datetime(str(raw).strip())
            if parsed:
                defaults['archived_at'] = parsed
            # 认不出的值什么都不写——宁可保留本机原样,也不猜一个把人的休眠状态洗掉
    if isinstance(item.get('click_count'), int):
        defaults['click_count'] = max(0, item['click_count'])
    ord_val = item.get('order')
    defaults['order'] = ord_val if isinstance(ord_val, int) and ord_val > 0 else None
    return defaults


def _nav_payload():
    # 导出自定义站点;内置站点只在与种子 nav_data.py 有差异时导出
    # (nav_edit 允许改内置条目,v6 一律不导导致这些修改换机即丢)
    seed_by_url = {item['url']: item for item in DEFAULT_SITES}
    sites = []
    for s in NavSite.objects.all():
        if s.is_builtin:
            seed = seed_by_url.get(s.url)
            if seed and not _builtin_customized(s, seed):
                continue
        sites.append(_site_row(s))
    tools = []
    for t in NavTool.objects.all():
        try:
            with t.file.open('rb') as f:
                raw = f.read()
        except (FileNotFoundError, OSError) as exc:
            # 静默跳过会让"换机后少几个工具"无从下手,至少留一行日志
            logger.warning('导出跳过工具(name=%s):文件读不到(%s)', t.name, exc)
            continue
        if isinstance(raw, str):
            raw = raw.encode('utf-8')
        tools.append({'name': t.name, 'category': t.category, 'description': t.description,
                      'favicon': t.favicon,
                      'original_filename': t.original_filename,
                      'html_b64': base64.b64encode(raw).decode('ascii')})
    return {'format': 'pinsflora-nav', 'version': 10,
            'exportedAt': timezone.now().isoformat(),
            'category_order': [{'name': r.name, 'hidden': r.hidden}
                               for r in NavCategory.objects.order_by('order', 'name')],
            'sites': sites, 'tools': tools}


_NAV_META_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.I | re.S)


_NAV_ICON_HREF1_RE = re.compile(r'<link\b[^>]*rel=["\'][^"\']*icon[^"\']*["\'][^>]*?href=["\']([^"\']+)["\']', re.I)


_NAV_ICON_HREF2_RE = re.compile(r'<link\b[^>]*href=["\']([^"\']+)["\'][^>]*?rel=["\'][^"\']*icon[^"\']*["\']', re.I)


_NAV_DESC_NAME_RE = re.compile(r'<meta\b[^>]*(?:name|property)=["\']description["\'][^>]*?content=["\']([^"\']*)["\']', re.I)


_NAV_DESC_NAME2_RE = re.compile(r'<meta\b[^>]*content=["\']([^"\']*)["\'][^>]*?(?:name|property)=["\']description["\']', re.I)


_NAV_OGDESC_RE = re.compile(r'<meta\b[^>]*(?:name|property)=["\']og:description["\'][^>]*?content=["\']([^"\']*)["\']', re.I)


_NAV_META_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def _decode_nav_html(raw_bytes):
    for encoding in ('utf-8', 'gbk'):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw_bytes.decode('utf-8', errors='replace')


def _parse_site_meta(final_url, raw_bytes):
    """从首页 HTML 提取标题和 favicon 绝对地址(纯解析,便于离线测试)。"""
    text = _decode_nav_html(raw_bytes)
    title = ''
    m = _NAV_META_TITLE_RE.search(text)
    if m:
        title = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', m.group(1))).strip()[:200]
    favicon = ''
    m = _NAV_ICON_HREF1_RE.search(text) or _NAV_ICON_HREF2_RE.search(text)
    if m:
        href = m.group(1).strip()
        if href.startswith('data:'):
            href = ''
        favicon = urljoin(final_url, href)[:300] if href else ''
    description = ''
    m = (_NAV_DESC_NAME_RE.search(text) or _NAV_DESC_NAME2_RE.search(text)
         or _NAV_OGDESC_RE.search(text))
    if m:
        description = re.sub(r'\s+', ' ', _html_unescape(m.group(1))).strip()[:200]
    return {'title': title, 'favicon': favicon, 'description': description}


def _parse_tool_meta(raw_bytes):
    """从上传的单文件工具 HTML 提取标题/简介/图标;图标只认 data:image 或绝对 http(s) 地址(相对路径对本地文件无意义)。"""
    meta = _parse_site_meta('https://nav-tool.local/', raw_bytes)
    text = _decode_nav_html(raw_bytes)
    favicon = ''
    m = _NAV_ICON_HREF1_RE.search(text) or _NAV_ICON_HREF2_RE.search(text)
    if m:
        href = m.group(1).strip()
        if href.startswith('data:image/') and len(href) <= 2000:
            favicon = href
        elif href.startswith(('http://', 'https://')):
            favicon = href[:2000]
    meta['favicon'] = favicon
    return meta


def _clean_icon_color(v):
    """自定义图标底色:只接受 #RGB/#RRGGBB/#RRGGBBAA,非法给空。"""
    v = (v or '').strip()
    return v if re.fullmatch(r'#[0-9a-fA-F]{3,8}', v) else ''

