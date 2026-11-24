# nav/tests_nav_p0_gate.py
"""P0(R-01～R-07)验收门 · Django 静态契约测试。

与 ``scripts/p0_accept.py`` 同源同口径:
- 现在就该成立的防回归项(三档布局白名单、六档目录样式、热点基线哈希)直接断言;
- 依赖 ``nav-presets.js`` 落盘的模块契约(零网络、迁移映射、键白名单、try 包裹)
  在模块缺失时 ``skipTest``,模块落盘后自动转为实跑;
- 依赖模板 / CSS 接线的项(head 顺序、双按钮组、sticky/hover 收口)同样
  ``skipTest``,docstring 写明"等集成后自动生效",绝不断言恒真。

跑本域::

    .venv/bin/python manage.py test nav.tests_nav_p0_gate -v 2

契约来源:``借鉴调研/p0/00-接口契约.md`` 第 2/4/5/7 节。
"""

import os
import re

from django.test import TestCase
from django.urls import reverse

from .tests_nav_common import static_text

NAV_DIR = os.path.dirname(os.path.abspath(__file__))

PRESET_IDS = ['classic', 'compact', 'portal', 'gallery', 'app-first']
# 2026-11-23:六档布局回迁后,模板 data-layout 白名单同步恢复六值。
ALLOWED_LAYOUTS = ['card', 'icon', 'list', 'mag', 'min', 'cols']
ALLOWED_TOC_STYLES = ['default', 'seeseed', 'timeline', 'pill', 'soft', 'ribbon']
KEY_PRESET = 'navLayoutPreset'
KEY_MIGRATED = 'navPresetMigrated'
LEGACY_MAP = {'card': 'classic', 'icon': 'compact', 'list': 'compact'}

# 契约第 3 节:preset 包内允许写的既有键(不含 preset 键 / 迁移旗标)。
PRESET_KEYS = {
    'navLayout', 'navDensity', 'navTocStyle', 'navShowToc', 'navTocMode',
    'navFontScale', 'navShowClock', 'navShowSearch', 'navShowRecent',
    'navShowTools', 'navShowUrl', 'navShowTags', 'navShowHealth',
    'navShowActions', 'navUrlMode', 'navPageWidth', 'navCardDescLines',
}
NETWORK_MARKERS = ['fetch(', 'XMLHttpRequest', 'sendBeacon', '$.ajax',
                   'axios', '/api/nav/', 'api/nav']

# 与 scripts/p0_accept.py 的 C-07/C-08 同口径常量,防止两套检查漂移。
TOC_STICKY_VAR = '--nav-toc-sticky-top'
_TOC_CONTAINER_RE = re.compile(r'\.nav-toc(?![-\w])|#navToc(?![-\w])')
_TOC_SCROLL_RE = re.compile(r'\.nav-toc(?![-\w])[^{}]*\.toc-scroll\b')
_ROOT_SEL_RE = re.compile(r'^(html\s*:root|:root\s+html|:root|html)$')
_ACTION_STATE_RE = re.compile(
    r':hover|:focus-within|:active|\.show-actions|\.hide-actions|bulk-mode')


def _strip_js_comments(src):
    """剥 JS ``//`` 行注释与 ``/* */`` 块注释(保留字符串字面量),再扫标记。"""
    out, i, n, state = [], 0, len(src), None
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


def _strip_css_comments(src):
    return re.sub(r'/\*.*?\*/', '', src, flags=re.S)


def _strip_html_comments(src):
    return re.sub(r'<!--.*?-->', '', src, flags=re.S)


def _css_rules(css):
    """抽出所有普通 CSS 规则块(忽略 @media 头部),返回 [(selector, body)]。

    与 ``scripts/p0_accept.py`` 的 ``_css_rules`` 同口径:嵌套在 @media 内的规则
    递归抽出;声明必须落在同一规则块体内,不接受跨块拼凑。
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


def _toc_sticky_candidate(rules):
    """找目录容器 sticky 规则块:同块内含 sticky + top 消费变量 + max-height。

    与 p0_accept C-07 同口径;返回 ``(candidate, scroll_rules)``。
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


class P0LayoutTocRegressionTests(TestCase):
    """防回归:布局六档 / 目录六档白名单不许被 preset 改造放宽或回退。"""

    def setUp(self):
        self.html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.html = _strip_html_comments(self.html)
        self.sites_js = _strip_js_comments(static_text('js/nav-sites.js'))
        self.css = _strip_css_comments(static_text('css/nav-sites.css'))

    def test_layout_whitelist_still_six(self):
        """2026-11-23 六档布局:模板 data-layout 取值 ⊆ 六值,六档按钮齐全。"""
        values = set(re.findall(r'data-layout="([^"]+)"', self.html))
        self.assertTrue(values.issubset(set(ALLOWED_LAYOUTS)),
                        'data-layout 越值: %s' % sorted(values - set(ALLOWED_LAYOUTS)))
        for v in ALLOWED_LAYOUTS:
            self.assertIn('data-layout="%s"' % v, self.html)

    def test_toc_style_whitelist_still_six(self):
        """契约防回归:data-toc-style 仍六档,不得出现新值或 cards 回潮。"""
        values = set(re.findall(r'data-toc-style="([^"]+)"', self.html + self.css))
        self.assertEqual(values, set(ALLOWED_TOC_STYLES),
                         '目录样式取值=%s' % sorted(values))
        self.assertNotIn('data-toc-style="cards"', self.html)



class P0PresetModuleTests(TestCase):
    """preset 模块契约:模块落盘后实跑;未落盘 skipTest,等集成后自动生效。"""

    def setUp(self):
        self.js_raw = static_text('js/nav-presets.js')
        self.html = self.client.get(reverse('nav_sites')).content.decode('utf-8')

    def _require_module(self):
        if not self.js_raw:
            self.skipTest('等集成后自动生效:nav-presets.js 尚未落盘')
        return _strip_js_comments(self.js_raw)

    def test_preset_enum_matches_contract(self):
        """契约 §7.1:PRESET_IDS 恰好五档,顺序与契约一致。"""
        js = self._require_module()
        m = re.search(r'PRESET_IDS\s*[:=]\s*\[(.*?)\]', js, re.S)
        self.assertIsNotNone(m, 'PRESET_IDS 注册表缺失')
        ids = [t[0] or t[1] for t in re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1))]
        self.assertEqual(ids, PRESET_IDS)

    def test_preset_module_has_no_network(self):
        """契约 §7.7a:剥注释后零 fetch/XHR/sendBeacon/$.ajax/api/nav。"""
        js = self._require_module()
        hits = [m for m in NETWORK_MARKERS if m in js]
        self.assertFalse(hits, 'preset 模块出现网络调用标记: %s' % hits)

    def test_preset_migration_mapping_complete(self):
        """契约 §7.3:card→classic、icon→compact、list→compact,迁移旗标存在。"""
        js = self._require_module()
        for old, new in LEGACY_MAP.items():
            self.assertRegex(
                js, r"['\"]?%s['\"]?\s*:\s*['\"]%s['\"]" % (old, new),
                '迁移映射 %s→%s 缺失' % (old, new))
        self.assertIn(KEY_MIGRATED, js)
        self.assertIn('migrate', js)

    def test_preset_apply_keys_within_whitelist(self):
        """契约 §7.2a:apply 只写包内既有键 + preset 键,不越权写别的键。"""
        js = self._require_module()
        allowed = PRESET_KEYS | {KEY_PRESET, KEY_MIGRATED}
        written = set(re.findall(r"_storageSet\(\s*['\"]([^'\"]+)['\"]", js))
        for keys_block in re.findall(r'keys:\s*\{(.*?)\}', js, re.S):
            written.update(re.findall(r"['\"]?(\w+)['\"]?\s*:", keys_block))
        unknown = sorted(k for k in written if k not in allowed)
        self.assertFalse(unknown, '越权写键: %s' % unknown)
        layouts = re.search(r'ALLOWED_LAYOUTS\s*[:=]\s*\[(.*?)\]', js, re.S)
        self.assertIsNotNone(layouts, 'ALLOWED_LAYOUTS 白名单缺失')
        layout_vals = [t[0] or t[1] for t in
                       re.findall(r"'([^']+)'|\"([^\"]+)\"", layouts.group(1))]
        self.assertEqual(layout_vals, ALLOWED_LAYOUTS)

    def test_preset_localstorage_wrapped_in_try(self):
        """契约 §2:所有 localStorage 读写必须处于 try 块内(花括号配对近似)。"""
        js = self._require_module()
        try_spans = []
        for m in re.finditer(r'\btry\b\s*\{', js):
            depth, i = 1, m.end()
            while i < len(js) and depth:
                if js[i] == '{':
                    depth += 1
                elif js[i] == '}':
                    depth -= 1
                i += 1
            try_spans.append((m.start(), i - 1))
        bare = [m.start() for m in re.finditer(r'localStorage\.', js)
                if not any(a <= m.start() <= b for a, b in try_spans)]
        self.assertFalse(bare, '%d 处 localStorage 未包在 try/catch 内' % len(bare))


class P0WiringCssTests(TestCase):
    """模板 / CSS 接线契约:未接线时 skipTest,集成落盘后自动转为实跑。"""

    def setUp(self):
        self.html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.css = static_text('css/nav-sites.css')

    def test_preset_script_loaded_in_head_before_body(self):
        """契约 §7.4:nav-presets.js 在 head 内,migrate() 调用早于 body 脚本。"""
        if 'nav-presets.js' not in self.html:
            self.skipTest('等集成后自动生效:模板 head 尚未接线 nav-presets.js')
        preset_ref = self.html.find('nav-presets.js')
        head_close = self.html.find('</head>')
        body_open = self.html.find('<body')
        self.assertGreater(preset_ref, 0)
        self.assertLess(preset_ref, head_close)
        self.assertIn('NavPresets.migrate()', self.html[:head_close])
        self.assertLess(head_close, body_open)

    def test_preset_groups_share_one_sync_writer(self):
        """契约 §7.5:#navPresetGroup 与 #navPresetQuickGroup 同由一个函数写选中态。"""
        if 'id="navPresetGroup"' not in self.html or \
                'id="navPresetQuickGroup"' not in self.html:
            self.skipTest('等集成后自动生效:两组 preset 按钮容器尚未接入模板')
        sites_js = static_text('js/nav-sites.js')
        preset_js = static_text('js/nav-presets.js')
        js = sites_js + '\n' + preset_js
        writers = []
        for m in re.finditer(r'function\s+(\w+)\s*\([^)]*\)\s*\{', js):
            depth, i = 1, m.end()
            while i < len(js) and depth:
                if js[i] == '{':
                    depth += 1
                elif js[i] == '}':
                    depth -= 1
                i += 1
            body = js[m.end():i - 1]
            if 'navPresetGroup' in body and 'navPresetQuickGroup' in body:
                writers.append(m.group(1))
        self.assertEqual(len(writers), 1,
                         '同步函数必须唯一,实际: %s' % writers)

    def test_toc_sticky_and_icon_spec(self):
        """契约 §7.6a:目录 sticky 同块消费变量 + 图标 20×20 / 右间距 12px。

        与 p0_accept C-07 同口径,防止两套检查漂移(2026-11-21 收紧):
        1. 目录容器 sticky 块同块内含 ``position: sticky`` 与
           ``top: var(--nav-toc-sticky-top)``(允许 var 回退;写死 top: 20px 不算);
        2. 同块带 ``max-height: calc(100vh - ...)``,内层 ``.toc-scroll`` 带
           ``overflow: auto|scroll``;
        3. 变量在 ``:root``/``html`` 层有定义且被 sticky 块消费,只定义不消费失败。
        """
        css = _strip_css_comments(self.css)
        rules = _css_rules(css)
        candidate, scroll_rules = _toc_sticky_candidate(rules)
        root_value = _root_var_value(rules, TOC_STICKY_VAR)
        icon_blocks = [m.group(1) for m in re.finditer(
            r'\.toc-item[^{]*\.toc-(?:icon|fav)[^{]*\{(.*?)\}', css, re.S)]
        icon_rule = any('20px' in b and '12px' in b for b in icon_blocks)
        if TOC_STICKY_VAR not in css and not icon_rule:
            self.skipTest('等集成后自动生效:目录 sticky 变量/规则尚未收口')
        self.assertIsNotNone(root_value,
                             '%s 未在 :root/html 层定义' % TOC_STICKY_VAR)
        self.assertIsNotNone(
            candidate,
            '目录容器 sticky 块须同块含 position:sticky + top: var(%s) + '
            'max-height: calc(100vh - ...),不接受跨块拼凑' % TOC_STICKY_VAR)
        self.assertIn(TOC_STICKY_VAR, candidate[1],
                      '变量仅定义,未被 sticky 规则块消费')
        overflow_ok = any(
            re.search(r'overflow(?:-y|-x)?\s*:\s*(auto|scroll)\b', body)
            for _, body in scroll_rules)
        self.assertTrue(overflow_ok,
                        '目录内层滚动容器(.toc-scroll)未见 overflow: auto/scroll')
        self.assertTrue(icon_blocks, '目录图标规范选择器缺失')
        self.assertTrue(any('20px' in b and '12px' in b for b in icon_blocks),
                        '图标须同一条规则内同时含 20×20 与右间距 12px')

    def test_portal_mobile_is_compact_and_safe(self):
        """门户手机端:两列、卡片不继承 78px 空高、顶栏单行、隐藏常驻操作钮。"""
        css = _strip_css_comments(self.css)
        for token in (
            '--portal-label-w: 64px',
            'grid-template-columns: repeat(2, minmax(0, 1fr))',
            '.nav-hub.nav-preset-portal .site-card-box { min-height: 0 !important; }',
            '.nav-bar-ctrl { flex: 1 1 auto;',
            '.nav-hub.nav-preset-portal .site-card-box .site-edit',
        ):
            self.assertIn(token, css, '门户手机端规则缺失: %s' % token)

    def test_portal_hides_redundant_label_without_subcats(self):
        """门户大类无二级分类时,左侧大类名与顶部 Tabs 重复,应收起并让站点区吃满整行。"""
        css = _strip_css_comments(self.css)
        for token in (
            '.nav-hub.nav-preset-portal .nav-cat:not(:has(.nav-sub))',
            'grid-template-columns: minmax(0, 1fr)',
            '.nav-hub.nav-preset-portal .nav-cat:not(:has(.nav-sub)) .nav-cat-title',
            'display: none !important',
        ):
            self.assertIn(token, css, '无子分类收起行标签规则缺失: %s' % token)

    def test_card_hover_title_action_contract(self):
        """契约 §7.6b:精细指针内上浮 3px、标题两行、操作钮 hover/focus-within 显现。

        与 p0_accept C-08 同口径,防止两套检查漂移(2026-11-21 收紧):
        ``opacity: 0`` 必须落在 `.site-edit`/`.site-del` 默认态规则块内,
        不接受别处(目录箭头/返回顶部/确认弹窗等)的 opacity:0 冒充。
        """
        css = _strip_css_comments(self.css)
        rules = _css_rules(css)
        blocks = []
        for m in re.finditer(r'@media\s*([^{]+)\{', css):
            depth, i = 1, m.end()
            while i < len(css) and depth:
                if css[i] == '{':
                    depth += 1
                elif css[i] == '}':
                    depth -= 1
                i += 1
            blocks.append((m.group(1), css[m.end():i - 1]))
        fine_text = '\n'.join(b for c, b in blocks
                              if 'hover: hover' in c and 'pointer: fine' in c)
        title_blocks = [m.group(1) for m in re.finditer(r'\.site-title\s*\{(.*?)\}', css, re.S)]
        title_clamp = any('-webkit-line-clamp: 2' in b or 'line-clamp: 2' in b for b in title_blocks)
        btn_focus = re.search(
            r'site-(?:star|edit|del)[^{}]*:focus-within'
            r'|:focus-within[^{}]*site-(?:star|edit|del)', css)
        # 默认态操作钮规则块:命中 .site-edit/.site-del 且不带 hover/focus-within/
        # active/常显开关等非默认态修饰。
        edit_del_re = re.compile(r'\.site-(?:edit|del)\b')
        default_blocks = [(sel, body) for sel, body in rules
                          if edit_del_re.search(sel) and not _ACTION_STATE_RE.search(sel)]
        default_hidden = any(
            re.search(r'opacity\s*:\s*0\b', body) for _, body in default_blocks)
        wired = bool(fine_text) or title_clamp or bool(btn_focus)
        if not wired:
            self.skipTest('等集成后自动生效:卡片 hover/标题/操作钮 CSS 尚未收口')
        self.assertIn('translateY(-3px)', fine_text)
        self.assertTrue(title_clamp, '标题须在同一条 .site-title 规则内 clamp(2)')
        self.assertRegex(css, r'site-(?:star|edit|del)')
        self.assertIsNotNone(btn_focus)
        self.assertTrue(
            default_hidden,
            '默认态 .site-edit/.site-del 规则块内未见 opacity: 0'
            '(不接受别处 opacity:0 冒充)')
