# nav/views_nav_check.py
"""测活、跳转/搬家检测、批量检查、采用新地址、子分类拆分(2026-11-07 从 nav/views.py 按域拆出)。

公共常量与站点字段工具在 `views_nav_base`;`views.py` 只是回填门面。
"""

from .views_nav_base import (_NAV_META_UA, _clean_nav_children, _clean_nav_tags, _guard_public_url,
                             _json_body, _normalize_nav_url, logger)
from django.views.decorators.http import require_POST, require_http_methods

from .models import NavSite, NavCategory, NavTool, NavAiConfig
from concurrent.futures import ThreadPoolExecutor, as_completed
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from html import unescape as _html_unescape, escape as _html_escape
from urllib.parse import urlparse, urljoin
import re
import requests
import time


NAV_LINK_TIMEOUT_MIN = 3    # 测活单条超时可配区间(秒),页面弹窗里可改


NAV_LINK_TIMEOUT_MAX = 30


NAV_LINK_TOTAL_MIN = 10     # 测活整批总预算可配区间(秒)


NAV_LINK_TOTAL_MAX = 300


NAV_LINK_TIMEOUT = 10


NAV_LINK_MAX = 300


NAV_MOVED_MAX = 6


NAV_MOVED_READ_MAX = 200 * 1024


NAV_LINK_TOTAL_TIMEOUT = getattr(settings, 'NAV_LINK_TOTAL_TIMEOUT', 60)


NAV_LINK_UPDATE_BATCH = 200   # 体检结果 bulk_update 的分批大小


NAV_SUBCAT_SEPS = (' / ', ' > ')


NAV_LINK_REDIRECT_MAX = 3     # 测活手动跟随重定向的跳数上限(每跳都要复检 SSRF)


def _nav_split_subcat(subcat):
    """小分类名 → (父级, 子级);无分隔符(或拆出来某一侧为空)时返回 (原名, '') 表示保持两级。"""
    s = (subcat or '').strip()
    if not s:
        return '', ''
    for sep in NAV_SUBCAT_SEPS:
        if sep in s:
            parent, leaf = s.split(sep, 1)
            parent, leaf = parent.strip(), leaf.strip()
            if parent and leaf:
                return parent, leaf
    return s, ''


_NAV_CANONICAL_RE = re.compile(r'<link\b[^>]*rel=["\']canonical["\'][^>]*?href=["\']([^"\']+)["\']', re.I)


_NAV_CANONICAL2_RE = re.compile(r'<link\b[^>]*href=["\']([^"\']+)["\'][^>]*?rel=["\']canonical["\']', re.I)


_NAV_OGURL_RE = re.compile(r'<meta\b[^>]*(?:property|name)=["\']og:url["\'][^>]*?content=["\']([^"\']+)["\']', re.I)


_NAV_OGURL2_RE = re.compile(r'<meta\b[^>]*content=["\']([^"\']+)["\'][^>]*?(?:property|name)=["\']og:url["\']', re.I)


_NAV_REFRESH_RE = re.compile(r'<meta\b[^>]*http-equiv=["\']refresh["\'][^>]*?content=["\'][^"\']*?url=([^"\'>\s,]+)', re.I)


_NAV_MOVE_HINT_RE = re.compile(
    r'(?:has\s+moved|we\s+(?:have\s+)?moved|new\s+(?:site|domain|url|address|home)|now\s+at|relocat'
    r'|已迁移|现已迁移|迁至|移至|迁往|新地址|新域名|新网址|请访问新|跳转到)', re.I)


_NAV_URL_IN_TEXT_RE = re.compile(r'https?://[^\s<>"\'）)】\],，。；]+', re.I)


_NAV_A_HREF_RE = re.compile(r'<a\b[^>]*href=["\'](https?:[^"\']+)', re.I)


def _nav_site_key(host):
    host = (host or '').lower().strip('.')
    return host[4:] if host.startswith('www.') else host


def _nav_is_same_site(host_a, host_b):
    """同一站点判定:去 www 后相等,或互为子域(edu.cn 与 www.edu.cn、a.edu.cn 都算同站)。"""
    a, b = _nav_site_key(host_a), _nav_site_key(host_b)
    return bool(a and b and (a == b or a.endswith('.' + b) or b.endswith('.' + a)))


def _parse_moved_urls(page_url, text):
    """从旧页面 HTML 提取"可能的新地址"候选(纯解析,便于离线测试)。
    同站候选丢弃;按信号强度排序,去重限 NAV_MOVED_MAX 条。"""
    base_host = urlparse(page_url).hostname or ''
    out, seen = [], set()

    def add(raw, reason):
        if len(out) >= NAV_MOVED_MAX:
            return
        raw = _html_unescape((raw or '').strip()).rstrip(').,;:!?、。；：！？')
        if not raw or raw.startswith(('data:', '#', 'javascript:')):
            return
        candidate = urljoin(page_url, raw)[:300]
        parsed = urlparse(candidate)
        host = parsed.hostname or ''
        if parsed.scheme not in ('http', 'https') or not host or _nav_is_same_site(host, base_host):
            return
        key = candidate.lower().rstrip('/')
        if key in seen:
            return
        seen.add(key)
        out.append({'url': candidate, 'reason': reason})

    m = (_NAV_CANONICAL_RE.search(text) or _NAV_CANONICAL2_RE.search(text))
    if m:
        add(m.group(1), 'canonical')
    m = _NAV_OGURL_RE.search(text) or _NAV_OGURL2_RE.search(text)
    if m:
        add(m.group(1), 'og:url')
    m = _NAV_REFRESH_RE.search(text)
    if m:
        add(m.group(1), 'redirect')
    for hm in _NAV_MOVE_HINT_RE.finditer(text):
        if len(out) >= NAV_MOVED_MAX:
            break
        window = text[max(0, hm.start() - 200):hm.end() + 300]
        for um in _NAV_URL_IN_TEXT_RE.finditer(window):
            add(um.group(0), 'hint')
    if not out:
        # 无明确信号时看外链:同域名出现 ≥2 次才算迁移指向(过滤社交/CDN 噪声)
        counts, first = {}, {}
        for href in _NAV_A_HREF_RE.findall(text):
            host = (urlparse(href).hostname or '').lower()
            if not host or _nav_is_same_site(host, base_host):
                continue
            counts[host] = counts.get(host, 0) + 1
            first.setdefault(host, href)
        for host, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            if n >= 2:
                add(first[host], 'link')
    return out


def _read_html_capped(resp, limit=NAV_MOVED_READ_MAX):
    chunks, total = [], 0
    for chunk in resp.iter_content(chunk_size=8192):
        chunks.append(chunk)
        total += len(chunk)
        if total >= limit:
            break
    raw = b''.join(chunks)[:limit]
    if not raw:
        return ''
    for encoding in ('utf-8', 'gbk'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def _nav_detect_moved(resp, url):
    """text/html 响应读正文(限 200KB)提取新地址候选;任何异常都吞掉,不影响测活结果。"""
    try:
        ctype = (resp.headers.get('Content-Type') or '').lower()
        if 'text/html' not in ctype:
            return []
        text = _read_html_capped(resp)
        if not text:
            return []
        final = resp.url if isinstance(getattr(resp, 'url', None), str) else url
        return _parse_moved_urls(final, text)
    except Exception as exc:   # 正文解析纯附加功能,失败等于"没发现新地址"
        logger.debug('解析页面新地址失败 %s:%s', url, exc)
        return []


def _nav_check_link(url, proxy, timeout=None):
    # elapsed_ms:卡片状态点的"耗时"数据源。只量到响应头为止(stream=True 不读正文),
    # 所以这是"可达性耗时",不是整页加载时间。
    started = time.perf_counter()
    entry = {'url': url, 'ok': False, 'status': None, 'error': ''}
    if urlparse(url).scheme not in ('http', 'https'):
        entry['error'] = '仅支持 http/https'
        return entry
    per_timeout = timeout if isinstance(timeout, int) and timeout > 0 else NAV_LINK_TIMEOUT
    # allow_redirects=False + 手动跟随:requests 自己不判 IP 段,一个公网站点 302 到
    # 127.0.0.1:8080 就能把服务器当内网探针用,所以每一跳之前都要重跑一次 SSRF 校验。
    kwargs = {'timeout': per_timeout, 'headers': {'User-Agent': _NAV_META_UA},
              'allow_redirects': False, 'stream': True}
    if proxy:
        kwargs['proxies'] = {'http': proxy, 'https': proxy}
    current, hops, exhausted, resp = url, 0, False, None
    try:
        while True:
            try:
                _guard_public_url(current)
            except ValueError as exc:
                # 拦截不是"测活失败":单列 blocked,前端可按"已拦截"提示,也不写体检记录
                if resp is not None:
                    resp.close()
                entry['error'] = str(exc)
                entry['blocked'] = True
                entry['ms'] = int((time.perf_counter() - started) * 1000)
                return entry
            resp = requests.get(current, **kwargs)
            if not 300 <= resp.status_code < 400:
                break
            # 只认字符串 Location:没有/形状不对就是"跳转无目标",浏览器里同为白页
            location = resp.headers.get('Location') if hasattr(resp.headers, 'get') else ''
            if not isinstance(location, str) or not location.strip():
                break
            if hops >= NAV_LINK_REDIRECT_MAX:
                exhausted = True
                break
            resp.close()
            hops += 1
            current = urljoin(current, location.strip())
        try:
            entry['status'] = resp.status_code
            # 跳到第 3 跳仍是 3xx / 最终响应 3xx = 没有真正落地页,不算存活
            entry['ok'] = resp.status_code < 300
            if not entry['ok']:
                entry['error'] = f'HTTP {resp.status_code}' + (
                    '(重定向层数超限)' if exhausted else
                    ('(重定向无目标)' if 300 <= resp.status_code < 400 else ''))
            moved = _nav_detect_moved(resp, current)
            if moved:
                entry['moved'] = moved
        finally:
            resp.close()
    except requests.exceptions.RequestException as exc:
        entry['error'] = exc.__class__.__name__
    entry['ms'] = int((time.perf_counter() - started) * 1000)
    return entry


def _nav_link_param(value, default, lo, hi, label):
    """测活可配参数:缺省/空串用默认值;给了就必须是 [lo, hi] 内整数,否则 400(不是 500)。
    接受 int 与 "5" 这类数字字符串(前端 input 的值永远是字符串);拒绝小数/布尔/非数字。
    返回 (值, None) 或 (None, 错误响应)。"""
    if value is None or value == '':
        return default, None
    if isinstance(value, bool):
        return None, JsonResponse({'status': 'error', 'message': f'{label}须为整数'}, status=400)
    try:
        ivalue = int(value)
    except (TypeError, ValueError):
        return None, JsonResponse({'status': 'error', 'message': f'{label}须为整数'}, status=400)
    if isinstance(value, float) and value != ivalue:
        return None, JsonResponse({'status': 'error', 'message': f'{label}须为整数'}, status=400)
    if not lo <= ivalue <= hi:
        return None, JsonResponse(
            {'status': 'error', 'message': f'{label}须在 {lo}~{hi} 秒之间'}, status=400)
    return ivalue, None


@require_POST
def nav_link_check(request):
    """链接测活:POST {urls:[...], proxy:'', timeout?, total_timeout?},服务器端并发 GET,
    返回逐条 {url,ok,status,error};text/html 页面还会解析内容中的"可能新地址",
    有候选时附 moved:[{url,reason}]。
    本机自用工具;urls 上限 300,单条超时与整批总时长可在弹窗里临时调(默认 10s/60s),
    预算内没跑完的按 {ok:False,error:'Timeout',skipped:True} 返回(未检测,不写入体检记录),
    顺序与入参一致。前端「全库体检」按 32 条一批顺序调用本端点,逐批落库、可中断续测。"""
    data, err = _json_body(request)
    if err:
        return err
    raw_urls = data.get('urls')
    if not isinstance(raw_urls, list) or not raw_urls:
        return JsonResponse({'status': 'error', 'message': 'urls 须为非空数组'}, status=400)
    urls, seen = [], set()
    for u in raw_urls[:NAV_LINK_MAX]:
        u = _normalize_nav_url(u if isinstance(u, str) else '')
        if u and u not in seen:
            seen.add(u)
            urls.append(u)
    if not urls:
        return JsonResponse({'status': 'error', 'message': '没有可检测的网址'}, status=400)
    proxy = (data.get('proxy') or '').strip()[:200]
    if proxy and not proxy.startswith(('http://', 'https://', 'socks5://', 'socks5h://')):
        proxy = 'http://' + proxy
    timeout, err = _nav_link_param(data.get('timeout'), NAV_LINK_TIMEOUT,
                                   NAV_LINK_TIMEOUT_MIN, NAV_LINK_TIMEOUT_MAX, '单条超时')
    if err:
        return err
    total_timeout, err = _nav_link_param(data.get('total_timeout'), NAV_LINK_TOTAL_TIMEOUT,
                                         NAV_LINK_TOTAL_MIN, NAV_LINK_TOTAL_MAX, '总时长预算')
    if err:
        return err
    entries = _nav_check_links(urls, proxy, total_timeout, timeout)
    results = [entries[u] for u in urls]
    try:
        _record_link_checks(results)
    except Exception as exc:
        # 落库失败不影响这一轮的测活结果给用户(角标少更新一次而已)
        logger.warning('体检结果落库失败:%s', exc)
    return JsonResponse({'status': 'success', 'results': results})


def _nav_check_links(urls, proxy, budget, timeout=None):
    """并发测活一批网址,返回 {url: entry};总时长预算内没跑完的按超时补齐。

    预算耗尽后立刻返回(wait=False),剩余线程各自跑完自行退出,不再占用这个请求。"""
    entries = {}
    if budget is None or budget <= 0:
        budget = NAV_LINK_TOTAL_TIMEOUT
    pool = ThreadPoolExecutor(max_workers=8)
    try:
        futures = {pool.submit(_nav_check_link, u, proxy, timeout): u for u in urls}
        try:
            for fut in as_completed(futures, timeout=budget):
                u = futures[fut]
                try:
                    entries[u] = fut.result()
                except Exception as exc:   # 单条炸了不该拖垮整批
                    logger.warning('链接测活异常 %s:%s', u, exc)
                    entries[u] = {'url': u, 'ok': False, 'status': None,
                                  'error': exc.__class__.__name__}
        except TimeoutError:
            logger.warning('链接测活超出总时长预算 %ss,%s/%s 条未测完,按超时返回',
                           budget, len(urls) - len(entries), len(urls))
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    # 预算耗尽/线程异常没跑到的:补一条"未检测"占位(skipped=True) —— 与"真连着但超时"区分开。
    # 落库时不许把 skipped 写进体检记录,否则没测过的站会被误标成"打不开"(误报)
    for u in urls:
        entries.setdefault(u, {'url': u, 'ok': False, 'status': None,
                               'error': 'Timeout', 'skipped': True})
    return entries


def _record_link_checks(results):
    """把这一轮体检的结果按主站网址写回 NavSite —— 卡片上「打不开」角标的数据源。
    只写三个记录字段,绝不改 url/alternates(搬家建议仍由用户在弹窗里手动"加入备用");
    页面打开时不检测,所以没有体检过的小分类/备用网址子页永远不带标记。
    ⚠️ skipped 条目(预算耗尽没跑到)一律不写:没有结论就不该留下"打不开"记录。"""
    checked = {r['url']: r for r in results
               if isinstance(r, dict) and isinstance(r.get('url'), str)
               and not r.get('skipped')
               # blocked 是安全策略的结论(内网地址一律不发请求),不是"这个站坏了":
               # 不写库,免得用户在体检记录里看到一堆无从处理的"打不开"
               and not r.get('blocked')}
    if not checked:
        return
    now = timezone.now()
    # 300 条逐条 save() = 300 次 UPDATE,批量提交压到每批 200 条一句 SQL
    pending = []
    for site in NavSite.objects.filter(url__in=list(checked)):
        entry = checked[site.url]
        ok = bool(entry.get('ok'))
        note = '' if ok else (entry.get('error') or f"HTTP {entry.get('status')}")[:60]
        site.last_check_at = now
        site.last_check_ok = ok
        site.last_check_note = note
        # 状态点/悬停详情:成功记 HTTP 码与耗时,失败只记耗时(码可能是 5xx,也可能压根没连上)
        code = entry.get('status')
        site.last_check_code = code if isinstance(code, int) and code > 0 else None
        ms = entry.get('ms')
        site.last_check_ms = ms if isinstance(ms, int) and ms >= 0 else None
        pending.append(site)
    fields = ['last_check_at', 'last_check_ok', 'last_check_note',
              'last_check_code', 'last_check_ms']
    for start in range(0, len(pending), NAV_LINK_UPDATE_BATCH):
        NavSite.objects.bulk_update(pending[start:start + NAV_LINK_UPDATE_BATCH], fields)


@require_POST
def nav_link_adopt(request):
    """测活迁移检测的一键"加入备用":{id, url, name?},去重追加到该站点的 alternates。"""
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
    url = _normalize_nav_url(data.get('url'))
    if not url:
        return JsonResponse({'status': 'error', 'message': '网址不能为空'}, status=400)
    if url == obj.url:
        return JsonResponse({'status': 'error', 'message': '该网址已是主站'}, status=400)
    name = (data.get('name') or '').strip()[:100]
    obj.alternates = _clean_nav_children(
        (obj.alternates or []) + [{'name': name, 'url': url}])
    obj.save(update_fields=['alternates'])   # 同上:别顺手把旧的 click_count 写回去
    return JsonResponse({'status': 'success', 'id': obj.id, 'alternates': obj.alternates})


NAV_LINK_FIX_MAX = 50   # 链接修复单批条数上限


def _link_fix_text(raw, field, limit):
    """文本字段清洗:取请求里出现的键,截断到既有惯例长度(截断而不是报错)。"""
    if field not in raw:
        return None
    return str(raw.get(field) or '').strip()[:limit]


@require_POST
def nav_link_fix(request):
    """链接修复批量回填:POST {items:[{id,url,new_url?,name?,description?,tags?,category?,subcat?}], overwrite:false}。

    与 nav_edit 的全字段覆盖不同:这里只写请求里出现的键;overwrite=False 只补空字段,
    overwrite=True 才覆盖已有值;url 不受 overwrite 影响,有合法 new_url 就改。
    保存一律 update_fields 最小列,绝不回写 click_count/archived_at/last_check_*/created_at/is_builtin。
    单条异常收成该条失败结果,整批不允许 500。
    """
    data, err = _json_body(request)
    if err:
        return err
    raw_items = data.get('items')
    if not isinstance(raw_items, list) or not raw_items:
        return JsonResponse({'status': 'error', 'message': 'items 须为非空数组'}, status=400)
    if len(raw_items) > NAV_LINK_FIX_MAX:
        return JsonResponse(
            {'status': 'error', 'message': f'单批最多 {NAV_LINK_FIX_MAX} 条,当前 {len(raw_items)} 条'},
            status=400)
    overwrite = bool(data.get('overwrite', False))

    existing = {site.id: site for site in NavSite.objects.all()}
    batch_targets = {}   # 本批次已占用的新网址 → 先到先得
    results = []
    updated = 0
    failed = 0

    for raw in raw_items:
        result = {'id': None, 'url': '', 'ok': False,
                  'action': 'skip', 'new_url': '', 'message': ''}
        try:
            if not isinstance(raw, dict):
                raise ValueError('条目格式无效')
            try:
                pk = int(raw.get('id'))
            except (TypeError, ValueError):
                raise ValueError('无效 id')
            result['id'] = pk
            obj = existing.get(pk)
            if not obj:
                raise ValueError('条目未找到')
            result['url'] = obj.url
            # 前端快照过期:带来的旧网址必须等于库里当前网址,否则拒绝改这条
            if _normalize_nav_url(raw.get('url')) != obj.url:
                raise ValueError('网址已变更,请重新预览')

            changed = []
            action = 'skip'

            # 新网址:与 overwrite 无关,合法就改;先查其它站点占用,再查批次内冲突
            raw_new_url = raw.get('new_url')
            if isinstance(raw_new_url, str) and raw_new_url.strip():
                if urlparse(raw_new_url.strip()).scheme not in ('http', 'https'):
                    raise ValueError('新网址仅支持 http/https')
                new_url = _normalize_nav_url(raw_new_url)
                if urlparse(new_url).scheme not in ('http', 'https'):
                    raise ValueError('新网址仅支持 http/https')
                if new_url != obj.url:
                    if new_url in batch_targets:
                        raise ValueError('与本次批次内其它条目冲突')
                    if NavSite.objects.exclude(id=obj.id).filter(url=new_url).first():
                        raise ValueError('该网址已被其它站点占用')
                    batch_targets[new_url] = pk
                    obj.url = new_url
                    changed.append('url')
                    action = 'url'
                    result['new_url'] = new_url

            # 文本/标签字段:只补空(overwrite=False)或覆盖(overwrite=True)
            text_fields = (
                ('name', 100), ('category', 50), ('subcat', 50), ('description', 200),
            )
            for field, limit in text_fields:
                if field not in raw:
                    continue
                new_val = _link_fix_text(raw, field, limit)
                old_val = getattr(obj, field) or ''
                if overwrite or not old_val:
                    if new_val != old_val:
                        setattr(obj, field, new_val)
                        changed.append(field)
                # 非覆盖且已有值:保持原样不动

            if 'tags' in raw:
                new_tags = _clean_nav_tags(raw.get('tags'))
                old_tags = list(obj.tags or [])
                if overwrite or not old_tags:
                    if new_tags != old_tags:
                        obj.tags = new_tags
                        changed.append('tags')

            if changed:
                obj.save(update_fields=changed)
                action = 'url' if 'url' in changed else 'fill'
            else:
                action = 'skip'
            result['ok'] = True
            result['action'] = action
        except Exception as exc:   # 单条失败不拖垮整批
            result['ok'] = False
            result['action'] = 'skip'
            result['message'] = str(exc) or '处理失败'
            failed += 1
            results.append(result)
            continue
        updated += 1
        results.append(result)

    return JsonResponse({'status': 'success', 'updated': updated, 'failed': failed, 'results': results})

