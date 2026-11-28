# nav/tests_nav_widgets.py
"""P2 R-21 小组件注册表(nav-widgets.js)静态断言测试。

只跑本域::

    .venv/bin/python manage.py test nav.tests_nav_widgets -v 2

断法与既有 ``tests_nav_presets.py`` 一致:Django TestCase + 直接读 JS 源码文本做
稳定断言,不引入新依赖、不模拟浏览器运行。真实 DOM / 双宽度触发取证另见
``借鉴调研/p2/07-注册表A.md``。

契约落点:``借鉴调研/p2/07-注册表A.md`` 第 1 节 schema 全文。

接线口径(集成后,2026-11-22):三份旁路补丁已由单一模板写者过户到
``nav_sites.html``;本域守卫语义从"模板不得改动"转为"模板必须已正确接线"。
"""
import os
import re

from django.test import TestCase

NAV_DIR = os.path.dirname(os.path.abspath(__file__))
_JS_PATH = os.path.join(NAV_DIR, 'static', 'js', 'nav-widgets.js')
_FIXBAR_JS_PATH = os.path.join(NAV_DIR, 'static', 'js', 'nav-fixbar.js')
_TEMPLATE_PATH = os.path.join(NAV_DIR, 'templates', 'nav', 'nav_sites.html')

# 集成后模板接线的五个静态引用(路径 → 标签类型)。
_WIRED_REFS = [
    ('js/nav-widgets.js', 'script'),
    ('js/nav-fixbar.js', 'script'),
    ('js/nav-skins.js', 'script'),
    ('css/nav-fixbar.css', 'link'),
    ('css/nav-skins.css', 'link'),
]

# 零网络标记(与 p0 gate NETWORK_MARKERS 同口径)。
_NETWORK_MARKERS = ['fetch(', 'XMLHttpRequest', 'sendBeacon', '$.ajax',
                    'axios', '/api/nav/', 'api/nav']


def _read_js():
    if not os.path.exists(_JS_PATH):
        return ''
    with open(_JS_PATH, encoding='utf-8') as fh:
        return fh.read()


def _read_fixbar_js():
    if not os.path.exists(_FIXBAR_JS_PATH):
        return ''
    with open(_FIXBAR_JS_PATH, encoding='utf-8') as fh:
        return fh.read()


def _read_template():
    if not os.path.exists(_TEMPLATE_PATH):
        return ''
    with open(_TEMPLATE_PATH, encoding='utf-8') as fh:
        return fh.read()


def _strip_django_comments(src):
    """剥掉 Django 模板注释 ``{% comment %}…{% endcomment %}`` 与 ``{# … #}``。

    接线断言必须在"活代码"上判定:被注释掉的引用不算接线。
    """
    src = re.sub(r'\{%\s*comment\s*%\}.*?\{%\s*endcomment\s*%\}', '', src, flags=re.S)
    src = re.sub(r'\{#.*?#\}', '', src, flags=re.S)
    return src


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


class NavWidgetsRegistryTests(TestCase):
    """nav-widgets.js 注册表 schema / 队列兜底 / 幂等 / 隔离 静态断言。"""

    def setUp(self):
        self.src = _read_js()
        self.code = _strip_comments(self.src)

    # 1. 模块文件存在且挂 window.NavWidgets。
    def test_file_exists_and_exposes_global(self):
        self.assertTrue(os.path.exists(_JS_PATH), 'nav-widgets.js 未创建')
        self.assertIn('window.NavWidgets', self.src)
        self.assertIn('window.NavWidgets = {', self.src)

    # 2. 公开 API 面齐全:version/register/mountAll/unmount/get/list/remount。
    def test_public_api_surface_complete(self):
        for name in ('version', 'register', 'mountAll', 'unmount', 'get',
                     'list', 'remount'):
            self.assertIn(name, self.src, 'NavWidgets 缺公开成员: %s' % name)
        for fn in ('register', 'mountAll', 'unmount', 'get', 'list', 'remount'):
            self.assertRegex(self.src, r'function\s+' + fn + r'\s*\(')
        self.assertIn("version: WIDGET_VERSION", self.src)

    # 3. 零网络调用:无 fetch / XHR / sendBeacon / $.ajax / axios / 后端路径。
    def test_no_network_calls(self):
        hits = [m for m in _NETWORK_MARKERS if m in self.code]
        self.assertFalse(hits, '注册表出现网络调用标记: %s' % hits)

    # 4. 队列兜底:__navWidgetQueue 键存在,载入后 drain 并清空。
    def test_queue_fallback_exists_and_drains(self):
        self.assertIn('__navWidgetQueue', self.src)
        self.assertIn('QUEUE_KEY', self.src)
        self.assertIn('function _drainQueue', self.src)
        drain_body = _function_body(self.src, '_drainQueue')
        self.assertIn('Array.isArray', drain_body)
        self.assertIn('register(def)', drain_body)
        self.assertIn('queue.length = 0', drain_body)
        # 启动段必须在挂载(DOMContentLoaded 回调 / 直接 autoStart)之前 drain 队列。
        drain_call = self.src.index('_drainQueue();')
        self.assertLess(drain_call, self.src.index("addEventListener('DOMContentLoaded'"))
        self.assertLess(drain_call, self.src.rindex('_autoStart();'))

    # 5. 异常隔离:mount 包在 try/catch 内,错误记进 state.error,不中断后续组件。
    def test_mount_isolated_by_try_catch(self):
        body = _function_body(self.src, '_mountOne')
        self.assertIn('try', body)
        self.assertIn('catch', body)
        self.assertIn('state.error', body)
        self.assertIn('STATUS_ERROR', body)
        # 隔离状态进 list():error 字段对外可见。
        list_body = _function_body(self.src, 'list')
        self.assertIn('error', list_body)

    # 6. priority 升序:排序比较器按 priority 数值差,缺省优先级常量在位。
    def test_priority_ascending_sort(self):
        self.assertIn('DEFAULT_PRIORITY', self.src)
        mount_body = _function_body(self.src, 'mountAll')
        self.assertIn('sort', mount_body)
        self.assertIn('pa - pb', mount_body)
        self.assertIn('Number(def.priority)', self.src)

    # 7. 幂等:已挂载守卫 + 已占用元素表;重复 register 覆盖定义但不重复 mount。
    def test_idempotent_register_guard(self):
        register_body = _function_body(self.src, 'register')
        self.assertIn('state.mounted', register_body)
        mount_body = _function_body(self.src, '_mountOne')
        self.assertIn('state.mounted', mount_body)
        self.assertIn('_mountedEls', self.src)
        self.assertIn('indexOf', mount_body)
        # 重复挂载不产生重复 DOM:已占用元素表去重。
        self.assertIn('_mountedEls.push', mount_body)
        self.assertIn('_mountedEls.indexOf', mount_body)

    # 8. 零存储:不读写 localStorage / sessionStorage / cookie。
    def test_no_storage_access(self):
        for marker in ('localStorage', 'sessionStorage', 'document.cookie'):
            self.assertNotIn(marker, self.code, '注册表不得访问存储: %s' % marker)

    # 9. unmount / remount 协议:unmount 回调卸载;remount 先全卸再重跑。
    def test_unmount_and_remount_protocol(self):
        unmount_body = _function_body(self.src, 'unmount')
        self.assertIn('def.unmount', unmount_body)
        self.assertIn('STATUS_UNMOUNTED', unmount_body)
        remount_body = _function_body(self.src, 'remount')
        self.assertIn('unmount(id)', remount_body)
        self.assertIn('mountAll(null)', remount_body)

    # 10. 选择器无落点记 skipped;缺选择器回落 root/body,不抛错。
    def test_missing_selector_marked_skipped(self):
        resolve_body = _function_body(self.src, '_resolveEl')
        self.assertIn('querySelector', resolve_body)
        mount_body = _function_body(self.src, '_mountOne')
        self.assertIn('STATUS_SKIPPED', mount_body)
        self.assertIn('no-match', mount_body)
        self.assertIn('el-busy', mount_body)


class NavWidgetsWiringTests(TestCase):
    """集成后接线断言:模板必须已正确挂载 widgets / fixbar / skins 五份静态引用。"""

    def setUp(self):
        self.template = _read_template()
        self.live_template = _strip_django_comments(self.template)
        self.rendered = self.client.get('/nav/').content.decode('utf-8')

    def _ref_line(self, path):
        """取模板中含该静态路径的行;不存在返回 None。"""
        for line in self.template.splitlines():
            if path in line:
                return line
        return None

    # W1. 五份静态引用在模板源码与渲染页中都存在。
    def test_wired_five_references_present(self):
        for path, _tag in _WIRED_REFS:
            self.assertIn(path, self.template, '模板缺引用: %s' % path)
            self.assertIn(path, self.rendered, '渲染页缺引用: %s' % path)

    # W2. 每份引用都带版本参数 ?v={{ static_version }},不允许裸引用。
    def test_wired_references_carry_version_param(self):
        for path, _tag in _WIRED_REFS:
            line = self._ref_line(path)
            self.assertIsNotNone(line, '模板缺引用行: %s' % path)
            self.assertIn('?v={{ static_version }}', line,
                          '引用缺版本参数: %s' % path)
        # 渲染后版本参数以实际 static_version 值以 ?v= 形态出现。
        for path, _tag in _WIRED_REFS:
            self.assertRegex(self.rendered, re.escape(path) + r'\?v=',
                             '渲染引用缺版本查询: %s' % path)

    # W3. 每份静态路径在模板中只出现一次,无重复 <script src> / <link href>。
    def test_wired_references_unique_in_template(self):
        for path, _tag in _WIRED_REFS:
            count = self.template.count(path)
            self.assertEqual(count, 1,
                             '引用重复出现: %s(%d 次)' % (path, count))

    # W4. 三段脚本在主序列(未被模板注释掉);物理顺序 widgets → fixbar → skins。
    def test_wired_scripts_live_and_ordered(self):
        js_paths = [p for p, tag in _WIRED_REFS if tag == 'script']
        for path in js_paths:
            self.assertIn(path, self.live_template, '脚本被注释或缺失: %s' % path)
        # 物理行序:widgets(head) < fixbar.js(scripts 块前段) < skins.js(scripts 块后段)。
        positions = [self.template.index(p) for p in js_paths]
        self.assertEqual(positions, sorted(positions),
                         '脚本物理顺序应为 widgets → fixbar → skins')
        widgets_pos, fixbar_pos, skins_pos = positions
        block_scripts = self.template.index('{% block scripts %}')
        self.assertLess(widgets_pos, block_scripts, 'widgets 应在 head 区,先于 scripts 块')
        self.assertGreater(fixbar_pos, block_scripts)
        self.assertGreater(skins_pos, block_scripts)
        # 两份 CSS 入 head 样式组,先于 scripts 块。
        css_paths = [p for p, tag in _WIRED_REFS if tag == 'link']
        for path in css_paths:
            self.assertLess(self.template.index(path), block_scripts,
                            'CSS 应在 head 样式组: %s' % path)
        # 协议本身靠 __navWidgetQueue 队列兜底,不依赖加载顺序;此处仅记录当前物理顺序。


class NavFixbarSelfMutationGuardTests(TestCase):
    """fixbar 的 body 观察器会看见自身 style/class 写入;同步函数必须变更才落 DOM。"""

    def setUp(self):
        self.src = _read_fixbar_js()
        self.code = _strip_comments(self.src)

    def test_sync_avoid_writes_only_on_change(self):
        body = _function_body(self.src, 'syncAvoid')
        self.assertTrue(body, 'syncAvoid 函数未找到')
        self.assertIn("if (root.style.bottom !== bottom)", body)
        self.assertIn("root.style.bottom = bottom", body)
        self.assertIn("dodging !== root.classList.contains('nav-fixbar-dodging')", body)


class NavFixbarActionsTests(TestCase):
    """2026-11-28:工具条从「单颗回顶」扩成可配置动作组,但收起/展开仍只有一套状态。"""

    def setUp(self):
        self.js = _read_fixbar_js()
        self.tpl = _read_template()

    def test_action_catalog_and_settings_slot(self):
        for frag in ('ACTION_KEY', "'navFixbarActionsV1'", "id: 'top'",
                     "id: 'collapse'", "id: 'focus'", "id: 'bottom'",
                     "id: 'prevcat'", "id: 'nextcat'", 'navFixbarActionList',
                     '至少保留一个工具条动作'):
            self.assertIn(frag, self.js)
        # 2026-11-28:用户确认去掉「随机一站」,不再保留卡片池和随机打开逻辑。
        for gone in ("id: 'random'", 'visibleCards()', 'window.open(url'):
            self.assertNotIn(gone, self.js)
        self.assertIn('id="navFixbarActionList"', self.tpl)
        self.assertIn('id="navFocusExit"', self.tpl)
        self.assertIn('快捷工具条动作', self.tpl)

    def test_owner_actions_use_shared_page_api(self):
        for frag in ('window.navCollapse.page', 'window.NavUiMode.toggleFocus',
                     'nav-fixbar-expanded-has-top'):
            self.assertIn(frag, self.js)

    def test_fixbar_css_has_action_grid_and_backtop_dedupe(self):
        css = open(os.path.join(NAV_DIR, 'static', 'css', 'nav-fixbar.css'), encoding='utf-8').read()
        self.assertIn('#navFixbarActionList', css)
        self.assertIn('body.nav-fixbar-expanded-has-top #navBackTop', css)
        self.assertIn('body.nav-focus-mode .nav-topbar', css)
        self.assertIn('body.nav-focus-mode #navFixbar', css)
        self.assertIn('body.nav-focus-mode #navFocusExit', css)
        # 设置抽屉 show 态被兼容层写成 display:block 时,动作列表会掉到 1200px 外且滚不到。
        sites_css = open(os.path.join(NAV_DIR, 'static', 'css', 'nav-sites.css'), encoding='utf-8').read()
        self.assertIn('#navSettingsMenu.offcanvas.show', sites_css)
        self.assertIn('display: flex !important', sites_css)

    def test_nav_ui_mode_exposes_focus_toggle(self):
        sites = open(os.path.join(NAV_DIR, 'static', 'js', 'nav-sites.js'), encoding='utf-8').read()
        self.assertIn('window.NavUiMode = {', sites)
        self.assertIn('toggleFocus: navToggleFocus', sites)
        self.assertIn('navUiModeBeforeFocus', sites)
        self.assertIn('navSyncFocusClass()', sites)
        self.assertIn("e.key === 'Escape'", sites)
