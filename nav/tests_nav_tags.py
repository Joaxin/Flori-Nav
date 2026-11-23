# nav/tests_nav_tags.py
"""P2 R-23 标签词表 + 稳定哈希配色(nav-tags.js / nav-tags.css)静态断言测试。

只跑本域::

    .venv/bin/python manage.py test nav.tests_nav_tags -v 2

断法与 ``tests_nav_widgets.py`` 一致:Django SimpleTestCase + 直接读源码文本做
稳定断言,不引入新依赖、不模拟浏览器运行。真实 DOM / 双宽度双端触发取证另见
``借鉴调研/p2/14-标签词表.md``。

契约落点:``借鉴调研/p2/06-R22R23数据契约.md`` §3.2 档位 A(前端词表 + 前端哈希色)。
"""
import os
import re

from django.test import SimpleTestCase

NAV_DIR = os.path.dirname(os.path.abspath(__file__))
_JS_PATH = os.path.join(NAV_DIR, 'static', 'js', 'nav-tags.js')
_CSS_PATH = os.path.join(NAV_DIR, 'static', 'css', 'nav-tags.css')

# 零网络标记(与 p0 gate NETWORK_MARKERS 同口径)。
_NETWORK_MARKERS = ['fetch(', 'XMLHttpRequest', 'sendBeacon', '$.ajax',
                    'axios', '/api/nav/', 'api/nav']

# 零存储标记:本模块不读写任何本机存储。
_STORAGE_MARKERS = ['localStorage', 'sessionStorage', 'document.cookie']


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


def _function_body(src, fn_name):
    """取出 `function <fn_name>(...) { ... }` 函数体文本。"""
    match = re.search(
        r'function ' + re.escape(fn_name) + r'\([^)]*\) \{\n(.*?)\n\}', src, re.S)
    return match.group(1) if match else ''


class NavTagsModuleTests(SimpleTestCase):
    """nav-tags.js 注册协议 / 零网络零存储 / 词表与哈希配色 静态断言。"""

    def setUp(self):
        self.src = _read(_JS_PATH)
        self.code = _strip_comments(self.src)

    # 1. 模块文件存在;描述符注册 id 为 nav-tags、priority 40。
    def test_module_exists_and_descriptor(self):
        self.assertTrue(os.path.exists(_JS_PATH), 'nav-tags.js 未创建')
        self.assertIn("id: 'nav-tags'", self.src)
        self.assertIn('priority: 40', self.src)

    # 2. 零网络:无 fetch / XHR / sendBeacon / $.ajax / axios / 后端路径。
    def test_no_network_calls(self):
        hits = [m for m in _NETWORK_MARKERS if m in self.code]
        self.assertFalse(hits, '标签模块出现网络调用标记: %s' % hits)

    # 3. 零存储:不读写 localStorage / sessionStorage / cookie。
    def test_no_storage_access(self):
        for marker in _STORAGE_MARKERS:
            self.assertNotIn(marker, self.code, '标签模块不得访问存储: %s' % marker)

    # 4. 不写 data-layout 三值白名单。
    def test_does_not_touch_layout_whitelist(self):
        self.assertNotIn('data-layout', self.code)

    # 5. 注册机制唯一:只走 NavWidgets.register + 标准 __navWidgetQueue 兜底,
    #    不自造第二套注册表 / 自定义全局注册表。
    def test_single_registration_mechanism(self):
        self.assertIn('window.NavWidgets.register', self.src)
        self.assertIn('__navWidgetQueue', self.src)
        # 不得出现自造的第二套注册表全局表。
        for banned in ('__navTagRegistry', '__navTagRegister', 'window.__registry'):
            self.assertNotIn(banned, self.code)

    # 6. 词表:datalist id 常量在位;词表上限常量在位;收集去重 / 频次排序逻辑存在。
    def test_vocabulary_datalist_wired(self):
        self.assertIn('navTagWordList', self.src)
        self.assertIn('TAG_DATALIST_ID', self.src)
        self.assertIn('MAX_SUGGEST_WORDS', self.src)
        self.assertIn('collectWords', self.src)
        self.assertIn('suggestWords', self.src)
        # 重复注入幂等:datalist 只在不存在时创建。
        self.assertIn('datalistExists', self.src)

    # 7. 稳定配色:哈希函数存在;调色板固定且不少于 10 个色相;同名同色落点齐全。
    def test_stable_hash_coloring(self):
        self.assertIn('function hashTag', self.src)
        self.assertIn('PALETTE_HUES', self.src)
        palette = re.search(r'PALETTE_HUES\s*=\s*\[([^\]]*)\]', self.src)
        self.assertIsNotNone(palette, '调色板常量缺失')
        hues = re.findall(r'\d+', palette.group(1))
        self.assertGreaterEqual(len(hues), 10, '调色板色相不足 10 个')
        self.assertIn('data-nav-tag-color', self.src)
        self.assertIn('--nav-tag-c', self.src)
        # 配色路径不得引入随机数 / 当前时间,保证确定性。
        self.assertNotIn('Math.random', self.code)
        self.assertNotIn('Date.now', self.code)

    # 8. 卸载回调在位:observer 断开、datalist 移除、输入 list 解绑。
    def test_unmount_cleanup(self):
        self.assertIn('function unmount', self.src)
        self.assertIn('stopObserver', self.src)
        self.assertIn('removeChild', self.src)
        self.assertIn('removeAttribute', self.src)

    # 9. 自激回归:body 子树观察器会看见 datalist 的 childList 变化;
    #    refreshDatalist 必须在词表未变时直接返回,不能每帧清空重填。
    def test_datalist_refresh_is_change_guarded(self):
        # 取 refreshDatalist 开头到清空动作之间的守卫段,避免函数体正则
        # 被后续嵌套函数干扰。
        head = self.src.split('function refreshDatalist', 1)
        self.assertEqual(len(head), 2, 'refreshDatalist 函数未找到')
        guard = head[1].split('while (datalist.firstChild)', 1)
        self.assertEqual(len(guard), 2, 'refreshDatalist 缺清空动作')
        segment = guard[0]
        self.assertIn('existing.length === words.length', segment)
        self.assertIn(')) return;', segment)


class NavTagsStyleTests(SimpleTestCase):
    """nav-tags.css 视觉规则静态断言。"""

    def setUp(self):
        raw = _read(_CSS_PATH)
        self.css = re.sub(r'/\*.*?\*/', '', raw, flags=re.S)

    # 1. 样式文件存在;命中哈希色相的 chip 选择器在位。
    def test_css_exists_and_chip_rule(self):
        self.assertTrue(os.path.exists(_CSS_PATH), 'nav-tags.css 未创建')
        self.assertIn('.site-tagchip[data-nav-tag-color]', self.css)
        self.assertIn('--nav-tag-c', self.css)

    # 2. datalist 是浏览器原生控件,本文件不写 datalist 样式。
    def test_css_skips_datalist(self):
        self.assertNotIn('datalist', self.css)

    # 3. 不用 !important 压既有规则。
    def test_css_no_important(self):
        self.assertNotIn('!important', self.css)
