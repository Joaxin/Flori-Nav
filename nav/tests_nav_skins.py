# nav/tests_nav_skins.py
"""P2 R-25 背景皮肤(nav-skins.js / nav-skins.css)Python 侧契约单测。

定位:纯静态 / 源码断言,不依赖浏览器、不依赖 node、不写库、不联网。
浏览器矩阵证据见 ``借鉴调研/p2/verify/f-e2e-skins.json``(11 格:层叠序、body
底色不变、壁纸不被遮、访客零 api);本文件只补静态契约层,不重复跑 E2E。

跑本域::

    .venv/bin/python manage.py test nav.tests_nav_skins -v 2

回归对照::

    .venv/bin/python manage.py test nav.tests_nav_widgets nav.tests_nav_p0_gate

契约边界(与 09-背景皮肤C.md §2.3 / §3.2 对齐):
- 皮肤层是独立 fixed ``#navSkinLayer``,只做最底层视觉叠加;
- 不改 body 背景、不覆盖 navWall*、不写 navTheme / navColorMode;
- 本机存储键仅 ``navBgSkin`` / ``navBgSkinFollow``;访客零写库。
"""
import os
import re

from django.test import SimpleTestCase

NAV_DIR = os.path.dirname(os.path.abspath(__file__))
JS_PATH = os.path.join(NAV_DIR, 'static', 'js', 'nav-skins.js')
CSS_PATH = os.path.join(NAV_DIR, 'static', 'css', 'nav-skins.css')
TEMPLATE_PATH = os.path.join(NAV_DIR, 'templates', 'nav', 'nav_sites.html')

# 合法取值集合(与源码常量 SKINS / follow 归一逻辑同源)。
ALLOWED_SKINS = {'none', 'aurora', 'grid'}
ALLOWED_FOLLOW = {'0', '1'}
ALLOWED_LAYOUTS = {'card', 'icon', 'list'}
ALLOWED_STORAGE_KEYS = {'navBgSkin', 'navBgSkinFollow'}

# body 背景内联赋值黑名单(反例写法;皮肤层不得回写 body 背景层)。
_BODY_BG_BLACKLIST = [
    'body.style.background',
    'document.body.style.background',
]

# 零网络标记(与 p0 gate / widgets 测试同口径,但本文件独立列一份)。
_NETWORK_MARKERS = [
    'fetch(', 'XMLHttpRequest', 'sendBeacon', '$.ajax', 'axios', '/api/',
]


def _read(path):
    if not os.path.exists(path):
        return ''
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def _strip_comments(src):
    """剥掉块注释与行注释,只留可执行代码,避免注释里的禁词误报。"""
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'//[^\n]*', '', src)
    return src


def _strip_django_comments(src):
    """剥掉 Django 模板注释,被注释掉的引用不算接线。"""
    src = re.sub(r'\{%\s*comment\s*%\}.*?\{%\s*endcomment\s*%\}', '', src, flags=re.S)
    src = re.sub(r'\{#.*?#\}', '', src, flags=re.S)
    return src


class NavSkinsContractTests(SimpleTestCase):
    """nav-skins.js / nav-skins.css 静态契约断言。"""

    def setUp(self):
        self.src = _read(JS_PATH)
        self.css = _read(CSS_PATH)
        self.code = _strip_comments(self.src)

    # 1. 注册契约:注册表 register 路径与 __navWidgetQueue 兜底分支都在位。
    def test_register_protocol_present(self):
        self.assertTrue(os.path.exists(JS_PATH), 'nav-skins.js 未创建')
        self.assertIn('window.NavWidgets.register', self.code)
        self.assertIn('__navWidgetQueue', self.code)
        # 兜底分支:注册表缺失时把描述符推入队列,不自造第二套挂载系统。
        self.assertRegex(self.code, r'__navWidgetQueue\s*=\s*window\.__navWidgetQueue')
        self.assertIn('.push(widget)', self.code)

    # 2. 描述符字段:id === 'nav-skin'、priority === 30、selector 指向快捷设置分组。
    def test_descriptor_id_priority_selector(self):
        self.assertRegex(self.code, r"id:\s*'nav-skin'")
        self.assertRegex(self.code, r'priority:\s*30\b')
        m = re.search(r"selector:\s*'([^']+)'", self.code)
        self.assertIsNotNone(m, '描述符缺 selector 字符串')
        selector = m.group(1)
        self.assertIn('#navQuickSettingsMenu', selector,
                      'selector 未指向快捷设置分组: %s' % selector)
        # 描述符同时带 mount / unmount 回调,符合注册表 schema。
        self.assertIn('mount: mount', self.code)
        self.assertIn('unmount: unmount', self.code)

    # 3. 只读视觉层:独立 #navSkinLayer 元素由脚本创建并挂到 body。
    def test_visual_layer_is_independent_element(self):
        self.assertRegex(self.code, r"document\.createElement\('div'\)")
        self.assertIn("layer.id = 'navSkinLayer'", self.code)
        self.assertRegex(self.code, r'document\.body\.appendChild\(layer\)')
        # 层节点 aria-hidden,不参与可访问树。
        self.assertIn("setAttribute('aria-hidden', 'true')", self.code)

    # 4. 只读视觉层:源码不得回写 body 背景(background / backgroundImage 黑名单)。
    def test_no_body_background_write(self):
        for marker in _BODY_BG_BLACKLIST:
            self.assertNotIn(marker, self.code,
                             '皮肤层不得回写 body 背景: %s' % marker)
        # CSS 规则也不得对 body 做 background 内联压写(配方只写自己这一层)。
        body_bg = re.search(r'body\s*\{[^}]*background[^}]*\}', self.css)
        self.assertIsNone(body_bg, 'CSS 不得给 body 注入 background 规则')

    # 5. CSS 层规则:#navSkinLayer 含 pointer-events:none 与负 z-index(解析实际数值)。
    def test_layer_css_pointer_events_and_negative_z(self):
        rule = re.search(r'#navSkinLayer\s*\{([^}]*)\}', self.css)
        self.assertIsNotNone(rule, 'CSS 缺 #navSkinLayer 规则')
        body = rule.group(1)
        self.assertRegex(body, r'pointer-events:\s*none')
        z_match = re.search(r'z-index:\s*(-?\d+)', body)
        self.assertIsNotNone(z_match, '#navSkinLayer 规则缺 z-index')
        self.assertLess(int(z_match.group(1)), 0,
                        '皮肤层 z-index 必须为负(垫底背景层),实际: %s' % z_match.group(1))

    # 6. 不改布局白名单:JS 与 CSS 均不出现 data-layout 写入/赋值,不注入白名单外布局值。
    def test_no_data_layout_write(self):
        for marker in ('data-layout', 'dataset.layout', "setAttribute('data-layout'"):
            self.assertNotIn(marker, self.code, 'JS 不得写 data-layout: %s' % marker)
            self.assertNotIn(marker, self.css, 'CSS 不得写 data-layout: %s' % marker)
        # 源码出现的布局取值只能是 card/icon/list 三值之一(本皮肤域不应出现布局值)。
        for value in re.findall(r"['\"](card|icon|list)['\"]", self.code):
            self.assertIn(value, ALLOWED_LAYOUTS)

    # 7. 不写库 / 不联网:无 fetch / XHR / sendBeacon / $.ajax / axios / 后端路径 / 表单提交。
    def test_no_network_or_submit(self):
        hits = [m for m in _NETWORK_MARKERS if m in self.code]
        self.assertFalse(hits, '皮肤模块出现网络调用标记: %s' % hits)
        for marker in ('submit(', 'XMLHttpRequest', 'navigator.sendBeacon'):
            self.assertNotIn(marker, self.code, '不得出现: %s' % marker)

    # 8. 存储键白名单:写操作只允许 navBgSkin / navBgSkinFollow;不写 navTheme / navColorMode / navWall。
    def test_storage_key_whitelist(self):
        # 直接写:setItem 调用与 localStorage.<key> 直赋,均不得命中禁止前缀。
        forbidden_write = ['navTheme', 'navColorMode', 'navWall']
        for key in forbidden_write:
            self.assertNotIn("setItem('%s'" % key, self.code)
            self.assertNotIn('localStorage.%s' % key, self.code)
        # 允许的两个本机键必须在位;源码声明的 KEY 常量集合 == 白名单。
        self.assertIn("var SKIN_KEY = 'navBgSkin'", self.code)
        self.assertIn("var FOLLOW_KEY = 'navBgSkinFollow'", self.code)
        declared_keys = set(re.findall(r"KEY = '([^']+)'", self.code))
        self.assertEqual(declared_keys, ALLOWED_STORAGE_KEYS)
        # 所有写入只经由 writeKey,且实参只能是两个允许键常量(排除函数定义行)。
        for line in self.code.splitlines():
            if 'writeKey(' not in line or 'function writeKey' in line:
                continue
            m = re.search(r'writeKey\((\w+)', line)
            self.assertIsNotNone(m)
            self.assertIn(m.group(1), ('SKIN_KEY', 'FOLLOW_KEY'),
                          '写入未登记的存储键: %s' % m.group(1))
        # 注:'navSkinLayer' / 'navThemeMenu' 是 DOM 节点 id,不是存储键,不在白名单扫描范围。

    # 9. 非法值归一:合法皮肤集合 none/aurora/grid;follow 合法 0/1;默认值 none / 1。
    def test_invalid_value_normalization(self):
        skins_match = re.search(r"SKINS\s*=\s*\[([^\]]*)\]", self.code)
        self.assertIsNotNone(skins_match, '缺合法皮肤集合声明')
        skins = {s.strip().strip("'\"") for s in skins_match.group(1).split(',') if s.strip()}
        self.assertEqual(skins, ALLOWED_SKINS)
        # readSkin 非法回落 none;readFollow 非法回落 1。
        self.assertRegex(self.code, r"indexOf\(v\)\s*>=\s*0\s*\?\s*v\s*:\s*'none'")
        self.assertRegex(self.code, r"=== '0'\s*\?\s*'0'\s*:\s*'1'")
        self.assertTrue({'0', '1'} <= ALLOWED_FOLLOW)

    # 10. 对外调试句柄在位:window.navSkins 暴露 apply/setSkin/setFollow/readSkin。
    def test_public_debug_handle(self):
        self.assertIn('window.navSkins', self.code)
        for fn in ('apply', 'setSkin', 'setFollow', 'readSkin'):
            self.assertIn(fn, self.code)


class NavSkinsWiringTests(SimpleTestCase):
    """模板接线断言:两份静态引用各出现一次、带版本参数,渲染页可取到。"""

    # 渲染 /nav/ 会读库(只读站点清单),放开 default 库访问;本类不写库。
    databases = '__all__'

    _REFS = [
        ('js/nav-skins.js', 'script'),
        ('css/nav-skins.css', 'link'),
    ]

    def setUp(self):
        self.template = _read(TEMPLATE_PATH)
        self.live_template = _strip_django_comments(self.template)
        self.rendered = self.client.get('/nav/').content.decode('utf-8')

    # W1. 两份引用在模板源码与渲染页中都存在。
    def test_wired_references_present(self):
        for path, _tag in self._REFS:
            self.assertIn(path, self.template, '模板缺引用: %s' % path)
            self.assertIn(path, self.rendered, '渲染页缺引用: %s' % path)

    # W2. 每份引用只出现一次,无重复 <script src> / <link href>。
    def test_wired_references_unique(self):
        for path, _tag in self._REFS:
            self.assertEqual(self.template.count(path), 1,
                             '引用重复出现: %s(%d 次)' % (path, self.template.count(path)))

    # W3. 引用带版本参数 ?v={{ static_version }};渲染后以 ?v= 形态出现。
    def test_wired_references_carry_version(self):
        for path, _tag in self._REFS:
            line = next((ln for ln in self.template.splitlines() if path in ln), None)
            self.assertIsNotNone(line, '模板缺引用行: %s' % path)
            self.assertIn('?v={{ static_version }}', line,
                          '引用缺版本参数: %s' % path)
            self.assertRegex(self.rendered, re.escape(path) + r'\?v=',
                             '渲染引用缺版本查询: %s' % path)

    # W4. 两段引用均为活代码(未被 Django 模板注释掉)。
    def test_wired_references_live(self):
        for path, _tag in self._REFS:
            self.assertIn(path, self.live_template, '引用被注释或缺失: %s' % path)
