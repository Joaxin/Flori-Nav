#!/usr/bin/env python3
"""P0(R-01～R-07)验收门命令行脚本。

用法::

    python scripts/p0_accept.py            # 默认 pre 阶段
    python scripts/p0_accept.py --stage pre
    python scripts/p0_accept.py --stage post

阶段语义(务必先读,避免把"没接线"误报成 PASS):

- ``pre`` : 并行实施进行中。依赖尚未落盘的新模块 / 模板接线 / CSS 收口的项,
  产物不存在时一律判 ``SKIP``(未接线,等集成),绝不允许判 ``PASS``。
- ``post`` : 集成子代理已合入并释放热点后跑。同样的产物缺失判 ``FAIL``;
  产物存在但违反契约也判 ``FAIL``。

三态定义:

- ``PASS`` : 已接线且符合契约第 7 节。
- ``FAIL`` : 已接线但违反契约(pre/post 都报),或 post 阶段应接线却缺失。
- ``SKIP`` : pre 阶段尚未接线;或热点文件哈希漂移需先 rebase。

本脚本纯标准库,不发任何网络请求,不改任何既有文件。
契约来源:``借鉴调研/p0/00-接口契约.md`` 第 2/4/5/7 节。
"""

import argparse
import hashlib
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# 路径与契约基线
# ---------------------------------------------------------------------------

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TEMPLATE_REL = os.path.join('nav', 'templates', 'nav', 'nav_sites.html')
CSS_REL = os.path.join('nav', 'static', 'css', 'nav-sites.css')
SITES_JS_REL = os.path.join('nav', 'static', 'js', 'nav-sites.js')
BATCH_JS_REL = os.path.join('nav', 'static', 'js', 'batch.js')
CARD_MENU_JS_REL = os.path.join('nav', 'static', 'js', 'card-menu.js')
PRESETS_JS_REL = os.path.join('nav', 'static', 'js', 'nav-presets.js')
GATE_TEST_REL = os.path.join('nav', 'tests_nav_p0_gate.py')

TEMPLATE = os.path.join(ROOT, TEMPLATE_REL)
CSS = os.path.join(ROOT, CSS_REL)
SITES_JS = os.path.join(ROOT, SITES_JS_REL)
BATCH_JS = os.path.join(ROOT, BATCH_JS_REL)
CARD_MENU_JS = os.path.join(ROOT, CARD_MENU_JS_REL)
PRESETS_JS = os.path.join(ROOT, PRESETS_JS_REL)
GATE_TEST = os.path.join(ROOT, GATE_TEST_REL)

# 契约第 1 节:热点文件 sha256 前 16 位基线(R-21~R-25 第二批收口刷新,2026-11-22;用于后续检测漂移)。
# 三处同值:本脚本 / nav/tests_nav_p0_gate.py / 00-接口契约.md §1,改一处必须同步另两处。
# 本批:模板 +4 行接线(tags/cascade 补丁过户);css 回顶钮 z-index 1030→1038;js/batch/card-menu 零改动。
BASELINE_HASH = {
    TEMPLATE_REL: '03061ab673956d72',
    CSS_REL: 'f63bf0b6b712fb6d',
    SITES_JS_REL: 'b4c423c0a26afb93',
    BATCH_JS_REL: 'a37a483d115296e2',
    CARD_MENU_JS_REL: '3ce17321ef79e03b',
}

# 契约第 2 节:五档 preset id(顺序即 UI 顺序)。
PRESET_IDS = ['classic', 'compact', 'portal', 'gallery', 'app-first']
ALLOWED_LAYOUTS = ['card', 'icon', 'list']
ALLOWED_TOC_STYLES = ['default', 'seeseed', 'timeline', 'pill', 'soft', 'ribbon']
KEY_PRESET = 'navLayoutPreset'
KEY_MIGRATED = 'navPresetMigrated'

# 契约第 3 节:preset 包内允许写的既有键(不含 preset 键 / 迁移旗标)。
PRESET_KEYS = {
    'navLayout', 'navDensity', 'navTocStyle', 'navShowToc', 'navTocMode',
    'navFontScale', 'navShowClock', 'navShowSearch', 'navShowRecent',
    'navShowTools', 'navShowUrl', 'navShowTags', 'navShowHealth',
    'navShowActions', 'navUrlMode', 'navPageWidth', 'navCardDescLines',
}
# 迁移旧值 → preset id(契约第 2 节 resolveLegacy)。
LEGACY_MAP = {'card': 'classic', 'icon': 'compact', 'list': 'compact'}

NETWORK_MARKERS = ['fetch(', 'XMLHttpRequest', 'sendBeacon', '$.ajax',
                   'axios', '/api/nav/', 'api/nav']

# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------


def _read(path):
    """读文本;文件不存在返回 None。"""
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as fh:
        return fh.read()


_RENDERED_CACHE = None


def _rendered_html():
    """渲染后的主页 HTML(与 gate 测试同一口径:经 Django 模板合并 base.html)。

    源模板 nav_sites.html 只含 ``{% block extra_head %}``,``</head>`` 在
    base.html 内;直接扫源模板无法判定 head/body 顺序,故走 test Client 取渲染页。
    """
    global _RENDERED_CACHE
    if _RENDERED_CACHE is None:
        sys.path.insert(0, ROOT)
        import django
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
        django.setup()
        from django.test import Client
        _RENDERED_CACHE = Client().get('/nav/').content.decode('utf-8')
    return _RENDERED_CACHE


def _sha16(path):
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        h.update(fh.read())
    return h.hexdigest()[:16]


def strip_js_comments(src):
    """剥掉 JS 的 ``//`` 行注释与 ``/* */`` 块注释(保留字符串字面量内容)。

    防误判:注释里提到接口路径 / 旧令牌不算违约;剥完再扫网络标记与键名。
    """
    out = []
    i, n = 0, len(src)
    state = None  # None | "'" | '"' | '`'
    while i < n:
        c = src[i]
        if state is None:
            if c in ("'", '"', '`'):
                state = c
                out.append(c)
                i += 1
            elif c == '/' and i + 1 < n and src[i + 1] == '/':
                while i < n and src[i] != '\n':
                    i += 1
            elif c == '/' and i + 1 < n and src[i + 1] == '*':
                i += 2
                while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                    i += 1
                i += 2
            else:
                out.append(c)
                i += 1
        else:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == state:
                state = None
            i += 1
    return ''.join(out)


def strip_css_comments(src):
    """剥掉 CSS ``/* */`` 注释,避免注释里的旧令牌误报值域检查。"""
    return re.sub(r'/\*.*?\*/', '', src, flags=re.S)


def strip_html_comments(src):
    """剥掉 HTML ``<!-- -->`` 注释(模板里的旧令牌注释不算值域)。"""
    return re.sub(r'<!--.*?-->', '', src, flags=re.S)


def _extract_array(text, name):
    """从 JS 源码里取 ``NAME: [...]`` 或 ``const NAME = [...]`` 的字符串数组。"""
    m = re.search(r'%s\s*[:=]\s*\[(.*?)\]' % re.escape(name), text, re.S)
    if not m:
        return None
    return [t[0] or t[1] for t in
            re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1))]


def _media_blocks(css):
    """按花括号配对抽出所有 @media 规则块,返回 [(条件, 块体)]。"""
    blocks = []
    for m in re.finditer(r'@media\s*([^{]+)\{', css):
        cond = m.group(1).strip()
        depth = 1
        i = m.end()
        start = i
        while i < len(css) and depth:
            if css[i] == '{':
                depth += 1
            elif css[i] == '}':
                depth -= 1
            i += 1
        blocks.append((cond, css[start:i - 1]))
    return blocks


def _css_rules(css):
    """抽出所有普通 CSS 规则块(忽略 @media/@supports 头部),返回 [(selector, body)]。

    嵌套在 @media 内的规则同样抽出(递归进块体);选择器取块前最近的
    ``{``/``}``/``;`` 之间文本。供"同块消费"断言使用:声明必须落在同一规则块体内,
    不接受跨块拼凑。
    """
    rules = []

    def walk(text):
        i, n = 0, len(text)
        while i < n:
            if text[i] == '{':
                depth, j = 1, i + 1
                while j < n and depth:
                    if text[j] == '{':
                        depth += 1
                    elif text[j] == '}':
                        depth -= 1
                    j += 1
                body = text[i + 1:j - 1]
                k = i - 1
                while k >= 0 and text[k] not in '{};':
                    k -= 1
                selector = text[k + 1:i].strip()
                if selector and not selector.startswith('@'):
                    rules.append((selector, body))
                walk(body)
                i = j
            else:
                i += 1

    walk(css)
    return rules


# C-07 目录 sticky 变量名(契约 §7.6a)。
TOC_STICKY_VAR = '--nav-toc-sticky-top'
# 目录容器选择器:.nav-toc / #navToc(排除 .nav-toc-rail / .nav-toc-backdrop 等同前缀类)。
_TOC_CONTAINER_RE = re.compile(r'\.nav-toc(?![-\w])|#navToc(?![-\w])')
# 目录内层滚动容器:.nav-toc 后代 .toc-scroll。
_TOC_SCROLL_RE = re.compile(r'\.nav-toc(?![-\w])[^{}]*\.toc-scroll\b')
# :root / html 层变量定义选择器。
_ROOT_SEL_RE = re.compile(r'^(html\s*:root|:root\s+html|:root|html)$')
# 操作钮 hover/focus-within/常显开关等"非默认态"选择器修饰。
_ACTION_STATE_RE = re.compile(
    r':hover|:focus-within|:active|\.show-actions|\.hide-actions|bulk-mode')


def _toc_sticky_candidate(rules):
    """找目录容器 sticky 规则块:同块内含 sticky + top 消费变量 + max-height。

    返回 ``(candidate, scroll_rules)``;candidate 为 ``(selector, body)`` 或 None。
    """
    scroll_rules = [(sel, body) for sel, body in rules if _TOC_SCROLL_RE.search(sel)]
    candidate = None
    for sel, body in rules:
        if not _TOC_CONTAINER_RE.search(sel):
            continue
        has_sticky = ('position: sticky' in body or 'position:sticky' in body)
        consumes_var = re.search(
            r'top\s*:\s*var\(\s*%s\b' % re.escape(TOC_STICKY_VAR), body)
        has_maxh = re.search(r'max-height\s*:\s*calc\(\s*100d?vh\s*-', body)
        if has_sticky and consumes_var and has_maxh:
            candidate = (sel, body)
            break
    return candidate, scroll_rules


def _root_var_value(rules, var_name):
    """取 :root/html 层对某变量的定义值;未定义返回 None。"""
    for sel, body in rules:
        if not _ROOT_SEL_RE.match(sel.strip()):
            continue
        m = re.search(r'%s\s*:\s*([^;]+)' % re.escape(var_name), body)
        if m:
            return m.group(1).strip()
    return None


class Report:
    """收集检查结果并出表。"""

    def __init__(self, stage):
        self.stage = stage
        self.rows = []

    def add(self, code, item, status, evidence):
        self.rows.append((code, item, status, evidence))

    def skip_missing(self, code, item, what):
        """产物缺失的统一接线判定:pre→SKIP,post→FAIL。"""
        if self.stage == 'post':
            self.add(code, item, 'FAIL', '应接线但缺失: %s' % what)
        else:
            self.add(code, item, 'SKIP', '未接线(等集成): %s' % what)

    def counts(self):
        p = sum(1 for r in self.rows if r[2] == 'PASS')
        f = sum(1 for r in self.rows if r[2] == 'FAIL')
        s = sum(1 for r in self.rows if r[2] == 'SKIP')
        return p, f, s

    def print_table(self):
        line_fmt = '{:<5} | {:<34} | {:<4} | {}'
        print(line_fmt.format('编号', '检查项', '结果', '证据'))
        print('-' * 100)
        for code, item, status, evidence in self.rows:
            print(line_fmt.format(code, item, status, evidence))
        p, f, s = self.counts()
        print('-' * 100)
        print('PASS %d / FAIL %d / SKIP %d' % (p, f, s))
        return 1 if f else 0


# ---------------------------------------------------------------------------
# 检查项
# ---------------------------------------------------------------------------


def check_c01_enum_and_buttons(rep):
    """契约 §7.1:五档枚举与 UI 按钮一一对应。"""
    js = _read(PRESETS_JS)
    tpl = _read(TEMPLATE)
    if js is None:
        rep.skip_missing('C-01', '五档枚举与 UI 按钮一一对应',
                         'nav-presets.js 尚未落盘')
        return
    ids = _extract_array(js, 'PRESET_IDS')
    if ids != PRESET_IDS:
        rep.add('C-01', '五档枚举与 UI 按钮一一对应', 'FAIL',
                'PRESET_IDS=%s(契约=%s)' % (ids, PRESET_IDS))
        return
    btns = re.findall(r'data-preset="([^"]+)"', tpl or '')
    btn_set = sorted(set(btns))
    if not btns:
        rep.skip_missing('C-01', '五档枚举与 UI 按钮一一对应',
                         '模板尚无 data-preset 按钮')
        return
    if btn_set == sorted(PRESET_IDS) and len(btns) == 10:
        rep.add('C-01', '五档枚举与 UI 按钮一一对应', 'PASS',
                'PRESET_IDS 五档;两组按钮共 %d 个,取值集合一致' % len(btns))
    else:
        rep.add('C-01', '五档枚举与 UI 按钮一一对应', 'FAIL',
                '按钮取值=%s(应为两组各五档)' % btn_set)


def check_c02_apply_keys(rep):
    """契约 §7.2a:apply 只写既有键 + preset 键,不扩白名单。"""
    js = _read(PRESETS_JS)
    if js is None:
        rep.skip_missing('C-02', 'applyPreset 只写既有键 + preset 键',
                         'nav-presets.js 尚未落盘')
        return
    js = strip_js_comments(js)
    allowed = PRESET_KEYS | {KEY_PRESET, KEY_MIGRATED}
    # 写入收口在 _storageSet 包装内:扫包装调用的字面量首参 + PRESETS 包内键名。
    written = set(re.findall(r"_storageSet\(\s*['\"]([^'\"]+)['\"]", js))
    for keys_block in re.findall(r'keys:\s*\{(.*?)\}', js, re.S):
        written.update(re.findall(r"['\"]?(\w+)['\"]?\s*:", keys_block))
    unknown = sorted(k for k in written if k not in allowed)
    layouts = _extract_array(js, 'ALLOWED_LAYOUTS')
    problems = []
    if unknown:
        problems.append('越权写键: %s' % unknown)
    if layouts != ALLOWED_LAYOUTS:
        problems.append('ALLOWED_LAYOUTS=%s(契约=%s)' % (layouts, ALLOWED_LAYOUTS))
    if KEY_PRESET not in js or KEY_MIGRATED not in js:
        problems.append('preset 键 / 迁移旗标常量缺失')
    if problems:
        rep.add('C-02', 'applyPreset 只写既有键 + preset 键', 'FAIL',
                '; '.join(problems))
    else:
        rep.add('C-02', 'applyPreset 只写既有键 + preset 键', 'PASS',
                '_storageSet 写键集合 ⊆ 包内键 + preset 键;布局白名单未放宽')


def check_c03_data_layout_whitelist(rep):
    """契约 §7.2b:模板 data-layout 仍只有 card/icon/list。"""
    tpl = strip_html_comments(_read(TEMPLATE) or '')
    css = strip_css_comments(_read(CSS) or '')
    values = re.findall(r'data-layout="([^"]+)"', tpl + '\n' + css)
    extra = sorted(set(values) - set(ALLOWED_LAYOUTS))
    if extra:
        rep.add('C-03', 'data-layout 取值集合 ⊆ {card,icon,list}', 'FAIL',
                '越值: %s;全量取值=%s' % (extra, sorted(set(values))))
    else:
        rep.add('C-03', 'data-layout 取值集合 ⊆ {card,icon,list}', 'PASS',
                '全量取值=%s' % sorted(set(values)))


def check_c04_migration(rep):
    """契约 §7.3:旧值映射三对齐全且 navPresetMigrated 存在。"""
    js = _read(PRESETS_JS)
    if js is None:
        rep.skip_missing('C-04', '旧值迁移三对齐全 + 迁移旗标',
                         'nav-presets.js 尚未落盘')
        return
    js = strip_js_comments(js)
    problems = []
    for old, new in LEGACY_MAP.items():
        if not re.search(r"['\"]?%s['\"]?\s*:\s*['\"]%s['\"]" % (old, new), js):
            problems.append('%s→%s 缺失' % (old, new))
    if KEY_MIGRATED not in js:
        problems.append('KEY_MIGRATED=%s 未定义' % KEY_MIGRATED)
    if 'migrate' not in js:
        problems.append('migrate() 未定义')
    if problems:
        rep.add('C-04', '旧值迁移三对齐全 + 迁移旗标', 'FAIL', '; '.join(problems))
    else:
        rep.add('C-04', '旧值迁移三对齐全 + 迁移旗标', 'PASS',
                'card→classic;icon→compact;list→compact;%s 存在' % KEY_MIGRATED)


def check_c05_head_order(rep):
    """契约 §7.4:head 内 nav-presets.js 早于 body 脚本,migrate() 在 head。"""
    tpl = _rendered_html()
    if not tpl:
        rep.add('C-05', 'head 内脚本早于 body、migrate() 在 head', 'FAIL',
                '模板缺失或渲染失败')
        return
    preset_ref = tpl.find('nav-presets.js')
    head_close = tpl.find('</head>')
    body_open = tpl.find('<body')
    if preset_ref < 0:
        rep.skip_missing('C-05', 'head 内脚本早于 body、migrate() 在 head',
                         '模板未引用 nav-presets.js')
        return
    problems = []
    if not (0 < preset_ref < head_close):
        problems.append('nav-presets.js 不在 head 内')
    head_block = tpl[:head_close]
    if 'NavPresets.migrate()' not in head_block:
        problems.append('head 内未见 migrate() 调用')
    body_scripts = re.findall(r'<script src=', tpl[body_open:])
    if body_scripts and preset_ref > head_close:
        problems.append('preset 脚本晚于 body 脚本')
    if problems:
        rep.add('C-05', 'head 内脚本早于 body、migrate() 在 head', 'FAIL',
                '; '.join(problems))
    else:
        rep.add('C-05', 'head 内脚本早于 body、migrate() 在 head', 'PASS',
                'preset 脚本与 migrate() 均在 </head> 之前')


def check_c06_shared_sync(rep):
    """契约 §7.5:两组按钮存在,选中态由同一同步函数写入。"""
    tpl = _read(TEMPLATE) or ''
    js = (_read(SITES_JS) or '') + '\n' + (_read(PRESETS_JS) or '')
    g1 = 'id="navPresetGroup"' in tpl
    g2 = 'id="navPresetQuickGroup"' in tpl
    if not (g1 and g2):
        rep.skip_missing('C-06', '两组按钮存在且同一同步函数写选中态',
                         '模板缺 navPresetGroup/navPresetQuickGroup')
        return
    # 找函数体同时引用两组 id 的同步函数;定义必须唯一。
    writers = []
    for m in re.finditer(r'function\s+(\w+)\s*\([^)]*\)\s*\{', js):
        name = m.group(1)
        depth, i = 1, m.end()
        while i < len(js) and depth:
            if js[i] == '{':
                depth += 1
            elif js[i] == '}':
                depth -= 1
            i += 1
        body = js[m.end():i - 1]
        if 'navPresetGroup' in body and 'navPresetQuickGroup' in body:
            writers.append(name)
    if len(writers) == 1:
        rep.add('C-06', '两组按钮存在且同一同步函数写选中态', 'PASS',
                '同步函数=%s(定义 1 处,两组 id 同体引用)' % writers[0])
    elif not writers:
        rep.add('C-06', '两组按钮存在且同一同步函数写选中态', 'FAIL',
                '未找到同时引用两组 id 的同步函数')
    else:
        rep.add('C-06', '两组按钮存在且同一同步函数写选中态', 'FAIL',
                '同步函数重复定义: %s' % writers)


def check_c07_toc_sticky_icon(rep):
    """契约 §7.6a:目录 sticky 规则同块消费变量 + 图标 20×20 / 右间距 12px。

    C-07 收紧口径(2026-11-21,补 18 审计 §3.3 漏检):不再接受"变量名在 CSS 全文
    出现即算接线",改为三条同块断言,缺一即 FAIL:

    1. 存在一个目录容器 sticky 规则块(.nav-toc / #navToc 域),声明体内同时有
       ``position: sticky`` 与 ``top: var(--nav-toc-sticky-top)``(允许
       ``var(--nav-toc-sticky-top, 20px)`` 回退写法;写死 ``top: 20px`` 不引变量
       不算消费)。
    2. 该 sticky 块同块还带 ``max-height: calc(100vh - ...)``;长目录栏内滚动的
       ``overflow: auto|scroll`` 落在内层 ``.toc-scroll`` 滚动容器规则上
       (既有结构:sticky 挂外层 aside、滚动挂内层栏,与 ≥768 既有规则一致);
       三者不允许分散到三个无关块里拼凑。
    3. ``--nav-toc-sticky-top`` 必须在 ``:root``/``html`` 层有定义,且被上面那个
       sticky 块实际消费;只定义不消费 = FAIL。
    """
    css_raw = _read(CSS)
    if css_raw is None:
        rep.add('C-07', '目录 sticky + 图标 20/12', 'FAIL', 'CSS 缺失')
        return
    css = strip_css_comments(css_raw)
    rules = _css_rules(css)
    candidate, scroll_rules = _toc_sticky_candidate(rules)
    root_value = _root_var_value(rules, TOC_STICKY_VAR)
    # 图标规范:20×20 与右间距 12px 必须落在同一条图标规则块内(不允许跨块拼凑)。
    icon_blocks = [m.group(1) for m in re.finditer(
        r'\.toc-item[^{]*\.toc-(?:icon|fav)[^{]*\{(.*?)\}', css, re.S)]
    icon_rule = any('20px' in b and '12px' in b for b in icon_blocks)
    # 既有 .nav-toc 的 84px sticky 不算 P0 新接线;以契约变量/图标规范为接线标记。
    wired = (TOC_STICKY_VAR in css) or icon_rule
    if not wired:
        rep.skip_missing('C-07', '目录 sticky + 图标 20/12',
                         '目录 sticky/图标规范 CSS 尚未收口')
        return
    problems = []
    # 先定位"消费变量的 sticky 块",max-height 必须落在同一个块内(不允许跨块拼凑)。
    sticky_var_blocks = [
        (sel, body) for sel, body in rules
        if _TOC_CONTAINER_RE.search(sel)
        and ('position: sticky' in body or 'position:sticky' in body)
        and re.search(r'top\s*:\s*var\(\s*%s\b' % re.escape(TOC_STICKY_VAR), body)
    ]
    if not sticky_var_blocks:
        any_sticky = any(
            _TOC_CONTAINER_RE.search(sel) and
            ('position: sticky' in body or 'position:sticky' in body)
            for sel, body in rules)
        if not any_sticky:
            problems.append('目录容器规则块未见 position: sticky')
        else:
            problems.append('sticky 块 top 未消费 %s(不允许写死 top: 20px)'
                            % TOC_STICKY_VAR)
    else:
        sticky_sel, sticky_body = sticky_var_blocks[0]
        if not re.search(r'max-height\s*:\s*calc\(\s*100d?vh\s*-', sticky_body):
            problems.append('sticky 块内未见 max-height: calc(100vh - ...)')
    if root_value is None:
        problems.append('%s 未在 :root/html 层定义' % TOC_STICKY_VAR)
    elif candidate is not None and TOC_STICKY_VAR not in candidate[1]:
        problems.append('变量仅定义,未被 sticky 规则块消费')
    overflow_ok = any(
        re.search(r'overflow(?:-y|-x)?\s*:\s*(auto|scroll)\b', body)
        for _, body in scroll_rules)
    if not overflow_ok:
        problems.append('目录内层滚动容器(.toc-scroll)未见 overflow: auto/scroll')
    if not icon_rule:
        problems.append('目录图标规范 20×20 / 右间距 12px 未见')
    if problems:
        rep.add('C-07', '目录 sticky + 图标 20/12', 'FAIL', '; '.join(problems))
    else:
        rep.add('C-07', '目录 sticky + 图标 20/12', 'PASS',
                'sticky 块同块消费 %s(定义=%s);max-height 与内层栏内滚动就位;'
                '图标 20×20 / margin-right 12px' % (TOC_STICKY_VAR, root_value))


def check_c08_card_css(rep):
    """契约 §7.6b:卡片 hover 上浮(仅精细指针)、标题两行、操作钮悬停显现。

    C-08 收紧口径(2026-11-21):``opacity: 0`` 必须落在 `.site-edit`/`.site-del`
    的默认态规则块内(与 hover / focus-within 显现规则同域),不再接受"别处的
    opacity:0"(如目录箭头、返回顶部、确认弹窗)冒充默认隐藏接线。
    """
    css_raw = _read(CSS)
    if css_raw is None:
        rep.add('C-08', '卡片 hover/标题两行/操作钮悬停', 'FAIL', 'CSS 缺失')
        return
    css = strip_css_comments(css_raw)
    rules = _css_rules(css)
    fine = [body for cond, body in _media_blocks(css)
            if 'hover: hover' in cond and 'pointer: fine' in cond]
    fine_text = '\n'.join(fine)
    title_blocks = [m.group(1) for m in re.finditer(r'\.site-title\s*\{(.*?)\}', css, re.S)]
    title_clamp = any('-webkit-line-clamp: 2' in b or 'line-clamp: 2' in b for b in title_blocks)
    btn_focus = re.search(
        r'site-(?:star|edit|del)[^{}]*:focus-within|:focus-within[^{}]*site-(?:star|edit|del)',
        css)
    # 默认态操作钮规则块:选择器命中 .site-edit/.site-del,且不带 hover/focus-within/
    # active/常显开关等非默认态修饰;opacity:0 必须落在这类块内。
    edit_del_re = re.compile(r'\.site-(?:edit|del)\b')
    default_blocks = [(sel, body) for sel, body in rules
                      if edit_del_re.search(sel) and not _ACTION_STATE_RE.search(sel)]
    default_hidden = any(
        re.search(r'opacity\s*:\s*0\b', body) for _, body in default_blocks)
    wired = bool(fine) or '-webkit-line-clamp: 2' in '\n'.join(title_blocks) or bool(btn_focus)
    if not wired:
        rep.skip_missing('C-08', '卡片 hover/标题两行/操作钮悬停',
                         '卡片 hover/标题/操作钮 CSS 尚未收口')
        return
    problems = []
    if 'translateY(-3px)' not in fine_text:
        problems.append('精细指针媒体查询内未见 translateY(-3px) 上浮')
    if not title_clamp:
        problems.append('标题未见两行 clamp(2)')
    if not btn_focus:
        problems.append('操作钮未见 :focus-within 显现规则')
    if not default_hidden:
        problems.append('默认态 .site-edit/.site-del 规则块内未见 opacity: 0'
                        '(不接受别处 opacity:0 冒充)')
    if problems:
        rep.add('C-08', '卡片 hover/标题两行/操作钮悬停', 'FAIL', '; '.join(problems))
    else:
        rep.add('C-08', '卡片 hover/标题两行/操作钮悬停', 'PASS',
                'hover:hover+pointer:fine 内上浮 3px;标题两行;钮默认态块内 opacity:0、'
                'hover/focus-within 显现')


def check_c09_no_network(rep):
    """契约 §7.7a:nav-presets.js 零网络调用、无 /api/nav/。"""
    js = _read(PRESETS_JS)
    if js is None:
        rep.skip_missing('C-09', 'preset 模块零网络调用',
                         'nav-presets.js 尚未落盘')
        return
    js = strip_js_comments(js)
    hits = [m for m in NETWORK_MARKERS if m in js]
    if hits:
        rep.add('C-09', 'preset 模块零网络调用', 'FAIL',
                '发现网络调用标记: %s' % hits)
    else:
        rep.add('C-09', 'preset 模块零网络调用', 'PASS',
                '无 fetch/XHR/sendBeacon/$.ajax/api/nav')


def check_c16_localstorage_in_try(rep):
    """契约 §2:nav-presets.js 所有 localStorage 读写必须包在 try/catch 内。

    判定方式:剥注释后按花括号配对取每个 ``try { ... }`` 的区间,
    每个 ``localStorage.`` 出现位置必须落在某个 try 区间内(行距近似)。
    """
    js = _read(PRESETS_JS)
    if js is None:
        rep.skip_missing('C-16', 'localStorage 调用均在 try 块内',
                         'nav-presets.js 尚未落盘')
        return
    code = strip_js_comments(js)
    try_spans = []
    for m in re.finditer(r'\btry\b\s*\{', code):
        depth, i = 1, m.end()
        while i < len(code) and depth:
            if code[i] == '{':
                depth += 1
            elif code[i] == '}':
                depth -= 1
            i += 1
        try_spans.append((m.start(), i - 1))
    bad = []
    for m in re.finditer(r'localStorage\.', code):
        pos = m.start()
        if not any(a <= pos <= b for a, b in try_spans):
            bad.append(pos)
    if bad:
        rep.add('C-16', 'localStorage 调用均在 try 块内', 'FAIL',
                '%d 处 localStorage 读写未包在 try/catch 内(偏移 %s)'
                % (len(bad), bad[:5]))
    else:
        rep.add('C-16', 'localStorage 调用均在 try 块内', 'PASS',
                '全部 localStorage 读写落在 try 块区间内')


def check_c10_guest_gate(rep):
    """契约 §7.7b:访客闸门未被绕过(只读标记仍在,preset 接线不碰主人 API)。"""
    tpl = strip_html_comments(_read(TEMPLATE) or '')
    if 'NAV_GUEST_MODE' not in tpl:
        rep.add('C-10', '访客只读闸门未被绕过', 'FAIL',
                '模板未见 NAV_GUEST_MODE 闸门标记(闸门被改)')
        return
    preset_js = _read(PRESETS_JS)
    if preset_js is None:
        rep.skip_missing('C-10', '访客只读闸门未被绕过',
                         'preset 接线未落盘,访客态行为待集成后核')
        return
    preset_js = strip_js_comments(preset_js)
    leaks = [m for m in ('/api/nav/', 'fetch(', 'api/nav') if m in preset_js]
    if leaks:
        rep.add('C-10', '访客只读闸门未被绕过', 'FAIL',
                'preset 模块触碰主人写接口: %s' % leaks)
    else:
        rep.add('C-10', '访客只读闸门未被绕过', 'PASS',
                '访客标记保留;preset 模块无写接口调用')


def check_c11_layout_regression(rep):
    """防回归:既有三档白名单未被放宽(markup 断言的三个值仍在)。"""
    tpl = strip_html_comments(_read(TEMPLATE) or '')
    js = strip_js_comments(_read(SITES_JS) or '')
    problems = []
    for v in ALLOWED_LAYOUTS:
        if 'data-layout="%s"' % v not in tpl:
            problems.append('模板缺 data-layout="%s"' % v)
    survivors = _extract_array(js, 'NAV_LAYOUT_SURVIVORS')
    if survivors != ALLOWED_LAYOUTS:
        problems.append('NAV_LAYOUT_SURVIVORS=%s' % survivors)
    for retired in ('mag', 'min', 'cols'):
        if 'data-layout="%s"' % retired in tpl:
            problems.append('退役档 %s 回潮' % retired)
    if problems:
        rep.add('C-11', '三档布局白名单未被放宽', 'FAIL', '; '.join(problems))
    else:
        rep.add('C-11', '三档布局白名单未被放宽', 'PASS',
                'card/icon/list 三档按钮与 SURVIVORS 白名单一致')


def check_c12_toc_regression(rep):
    """防回归:目录样式仍六档,未出现新 data-toc-style 值。"""
    tpl = strip_html_comments(_read(TEMPLATE) or '')
    css = strip_css_comments(_read(CSS) or '')
    values = sorted(set(re.findall(r'data-toc-style="([^"]+)"', tpl + '\n' + css)))
    extra = sorted(set(values) - set(ALLOWED_TOC_STYLES))
    if extra or values != sorted(ALLOWED_TOC_STYLES):
        rep.add('C-12', '目录样式仍六档未扩值', 'FAIL',
                '取值=%s;越值=%s' % (values, extra))
    else:
        rep.add('C-12', '目录样式仍六档未扩值', 'PASS',
                '六档=%s' % values)


def check_c13_baseline_hash(rep):
    """防回归:热点文件哈希与契约第 1 节基线对比,漂移则 SKIP 待 rebase。"""
    drifted = []
    for rel, base in BASELINE_HASH.items():
        actual = _sha16(os.path.join(ROOT, rel))
        if actual != base:
            drifted.append('%s(基线 %s / 实跑 %s)' % (rel, base, actual))
    if drifted:
        rep.add('C-13', '热点文件哈希基线对比', 'SKIP',
                '并行流又动过热点,需 rebase 后再验收: %s' % '; '.join(drifted))
    else:
        rep.add('C-13', '热点文件哈希基线对比', 'PASS',
                '五个热点文件 sha256 前 16 位与契约基线一致')


def check_c14_tests(rep):
    """契约 §7.8:相关模块测试绿(全量测试由集成阶段跑,本门只跑 gate 模块)。"""
    if not os.path.exists(GATE_TEST):
        rep.skip_missing('C-14', 'gate 测试模块存在且可运行',
                         'tests_nav_p0_gate.py 尚未落盘')
        return
    py = os.path.join(ROOT, '.venv', 'bin', 'python')
    if not os.path.exists(py):
        rep.add('C-14', 'gate 测试模块存在且可运行', 'SKIP',
                '未找到 .venv/bin/python,留待集成环境执行')
        return
    if rep.stage == 'pre':
        rep.add('C-14', 'gate 测试模块存在且可运行', 'SKIP',
                'pre 阶段不跑接线断言;集成后执行 manage.py test nav.tests_nav_p0_gate')
        return
    proc = subprocess.run(
        [py, 'manage.py', 'test', 'nav.tests_nav_p0_gate', '-v', '1'],
        cwd=ROOT, capture_output=True, text=True)
    if proc.returncode == 0:
        rep.add('C-14', 'gate 测试模块存在且可运行', 'PASS',
                'nav.tests_nav_p0_gate 全绿')
    else:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
        rep.add('C-14', 'gate 测试模块存在且可运行', 'FAIL',
                'gate 测试未绿: %s' % ' | '.join(tail))


def check_c15_screenshots(rep):
    """契约 §7.9:1440 / 390 两宽度截图证据(主页面 + 设置抽屉 + 悬停态)。"""
    shot_dirs = [
        os.path.join(ROOT, 'docs', '并行改造', 'shots'),
        os.path.join(ROOT, '..', '借鉴调研', 'p0', 'shots'),
    ]
    found = []
    for d in shot_dirs:
        if os.path.isdir(d):
            for name in os.listdir(d):
                if re.search(r'1440|390', name) and 'preset' in name.lower():
                    found.append(os.path.join(d, name))
    if rep.stage == 'post' and not found:
        rep.add('C-15', '1440/390 截图证据齐全', 'FAIL',
                'post 阶段未找到 preset 相关 1440/390 截图')
    elif found:
        rep.add('C-15', '1440/390 截图证据齐全', 'PASS',
                '证据: %s' % ', '.join(os.path.basename(f) for f in found[:6]))
    else:
        rep.add('C-15', '1440/390 截图证据齐全', 'SKIP',
                '截图待集成后补拍(主页面/设置抽屉布局页/悬停态)')


def main(argv=None):
    parser = argparse.ArgumentParser(description='P0 验收门脚本(契约第 7 节)')
    parser.add_argument('--stage', choices=['pre', 'post'], default='pre',
                        help='pre=并行实施中,未接线项判 SKIP;post=集成后,缺失判 FAIL')
    args = parser.parse_args(argv)

    rep = Report(args.stage)
    check_c01_enum_and_buttons(rep)
    check_c02_apply_keys(rep)
    check_c03_data_layout_whitelist(rep)
    check_c04_migration(rep)
    check_c05_head_order(rep)
    check_c06_shared_sync(rep)
    check_c07_toc_sticky_icon(rep)
    check_c08_card_css(rep)
    check_c09_no_network(rep)
    check_c16_localstorage_in_try(rep)
    check_c10_guest_gate(rep)
    check_c11_layout_regression(rep)
    check_c12_toc_regression(rep)
    check_c13_baseline_hash(rep)
    check_c14_tests(rep)
    check_c15_screenshots(rep)

    sys.exit(rep.print_table())


if __name__ == '__main__':
    main()
