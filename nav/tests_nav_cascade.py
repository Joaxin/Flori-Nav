# nav/tests_nav_cascade.py
"""R-23 级联补全 + 弹窗滚动骨架(nav-cascade.js / nav-modal-scroll.css)静态断言门。

纯静态断言,不依赖浏览器渲染、不读写数据库:

- ``nav-cascade.js``:注册表 id / priority、零网络、零存储、幂等注入与清下级守卫、
  数据源只读;不涉及 ``data-layout`` 三值白名单。
- ``nav-modal-scroll.css``:选择器只命中主人 ``#addSiteModal`` 与访客
  ``#navGuestEditModal`` 两个目标弹窗,不存在裸 ``.modal-body`` 全局规则,
  不写 dialog 宽度 / 高度 / 形态覆盖。

跑本域::

    .venv/bin/python manage.py test nav.tests_nav_cascade -v 2

浏览器双宽度真实触发取证见 ``借鉴调研/p2/15-级联与弹窗滚动.md``。
契约落点:``借鉴调研/p2/06-R22R23数据契约.md`` §4、§5。
"""

import os
import re
from django.test import SimpleTestCase

NAV_DIR = os.path.dirname(os.path.abspath(__file__))
_JS_PATH = os.path.join(NAV_DIR, 'static', 'js', 'nav-cascade.js')
_CSS_PATH = os.path.join(NAV_DIR, 'static', 'css', 'nav-modal-scroll.css')

# 零网络标记(与 p0 gate / widgets 测试同口径)。
_NETWORK_MARKERS = ['fetch(', 'XMLHttpRequest', 'sendBeacon', '$.ajax',
                    'axios', '/api/nav/', 'api/nav']
# 零存储标记:本组件既不读也不写本地存储 / cookie。
_STORAGE_MARKERS = ['localStorage', 'sessionStorage', 'document.cookie']

OWNER_MODAL = 'addSiteModal'
GUEST_MODAL = 'navGuestEditModal'
_TARGET_MODAL_IDS = (OWNER_MODAL, GUEST_MODAL)


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


def _css_rules(css):
    """拆出 ``选择器 { 声明 }`` 规则对,返回 [(selector, body), ...]。"""
    rules = []
    for match in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        selector = match.group(1).strip()
        body = match.group(2).strip()
        if selector:
            rules.append((selector, body))
    return rules


class CascadeModuleTests(SimpleTestCase):
    """nav-cascade.js 注册表 / 零网络零存储 / 幂等 / 清下级 静态断言。"""

    def setUp(self):
        self.src = _read(_JS_PATH)
        self.code = _strip_comments(self.src)

    # 1. 文件落盘且描述符挂到 window,注册 id 与 priority 符合契约。
    def test_descriptor_registered_with_id_and_priority(self):
        self.assertTrue(os.path.exists(_JS_PATH), 'nav-cascade.js 未创建')
        self.assertIn("id: 'nav-cascade'", self.src)
        self.assertIn('priority: 50', self.src)
        self.assertIn('window.__navCascadeDescriptor', self.src)
        self.assertIn('window.NavWidgets.register', self.src)
        # 注册表缺失时走 __navWidgetQueue 兜底队列,不自造第二套注册表。
        self.assertIn('__navWidgetQueue', self.src)

    # 2. 零网络:剥注释后无 fetch / XHR / sendBeacon / $.ajax / axios / 后端路径。
    def test_no_network_calls(self):
        hits = [m for m in _NETWORK_MARKERS if m in self.code]
        self.assertFalse(hits, '级联组件出现网络调用标记: %s' % hits)

    # 3. 零存储:不读写 localStorage / sessionStorage / cookie。
    def test_no_storage_access(self):
        hits = [m for m in _STORAGE_MARKERS if m in self.code]
        self.assertFalse(hits, '级联组件不得访问存储: %s' % hits)

    # 4. 不涉及 data-layout 三值白名单(本组件只碰分类表单字段)。
    def test_does_not_touch_layout_whitelist(self):
        self.assertNotIn('data-layout', self.code)
        self.assertNotIn('NAV_LAYOUT', self.code)

    # 5. 幂等注入:datalist 按 id 取 / 建,选项按 value 去重,不重复插入。
    def test_datalist_injection_is_idempotent(self):
        self.assertIn('function ensureDatalist', self.src)
        self.assertIn('function fillOptions', self.src)
        self.assertIn('existing[o.value]', self.src)
        # 访客弹窗绑定有一次性守卫,不重复挂监听。
        self.assertIn("dataset.cascadeBound", self.src)

    # 6. 清下级防循环:WeakMap 记录上级上一次值;值未变直接返回;
    #    清空只写 value,不 dispatch input/change 回流。
    def test_child_clear_guard_no_loop(self):
        self.assertIn('WeakMap', self.src)
        self.assertIn('lastParentValue', self.src)
        self.assertIn('prev === next', self.src)
        # 清空下级时不派发事件。
        self.assertNotIn('dispatchEvent', self.code)
        self.assertNotIn('.dispatch(', self.code)
        # 主人端清二级 / 三级,访客端清小分类。
        self.assertIn("querySelector('.f-subcat')", self.src)
        self.assertIn("querySelector('.f-subcat2')", self.src)
        self.assertIn("querySelector('.nge-sub')", self.src)

    # 7. 数据源全部只读:#navCatSubs JSON、访客本地 subs()、DOM data-cat。
    def test_universe_sources_read_only(self):
        self.assertIn("CAT_SUBS_SCRIPT = 'navCatSubs'", self.src)
        self.assertIn('getElementById(CAT_SUBS_SCRIPT)', self.src)
        self.assertIn('navGuestLocal', self.src)
        self.assertIn("data-site-item][data-cat", self.src)
        # 不调用本地 store 的任何写接口(addSites/patch/remove/saveNow)。
        for write_api in ('addSites', 'patchLocalSite', 'removeLocalSite',
                          'saveNow', 'bulkMove'):
            self.assertNotIn(write_api, self.code)

    # 8. 两个目标弹窗 id 都在组件内被引用;不引用其它编辑弹窗。
    def test_target_modal_ids_referenced(self):
        self.assertIn(OWNER_MODAL, self.src)
        self.assertIn(GUEST_MODAL, self.src)

    # 9. 组件不写库:无后端写接口调用痕迹,无后端 URL 拼接。
    def test_no_backend_write_trace(self):
        self.assertNotIn('POST', self.code)
        self.assertNotIn('csrf', self.code.lower())


class CascadeScrollCssTests(SimpleTestCase):
    """nav-modal-scroll.css 选择器范围 / 70vh 滚动骨架 静态断言。"""

    def setUp(self):
        self.css = _read(_CSS_PATH)
        self.rules = _css_rules(_strip_comments(self.css))

    # 10. 滚动骨架在位:max-height 70vh、纵向滚动、滚动链截断。
    def test_scroll_skeleton_present(self):
        self.assertTrue(os.path.exists(_CSS_PATH), 'nav-modal-scroll.css 未创建')
        bodies = [body for _sel, body in self.rules]
        joined = '\n'.join(bodies)
        self.assertIn('max-height: 70vh', joined)
        self.assertIn('overflow-y: auto', joined)
        self.assertIn('overscroll-behavior: contain', joined)

    # 11. 选择器只命中两个目标弹窗;不存在裸 .modal-body 全局规则。
    def test_selectors_scoped_to_two_target_modals(self):
        self.assertTrue(self.rules, 'CSS 无有效规则')
        parts = []
        for selector, _body in self.rules:
            parts.extend(p.strip() for p in selector.split(',') if p.strip())
        self.assertTrue(parts, 'CSS 无有效选择器')
        for part in parts:
            # 不允许出现脱离弹窗 id 的裸 .modal-body。
            self.assertNotRegex(part, r'^\.modal-body\s*$',
                                '出现裸 .modal-body 全局规则: %s' % part)
            for modal_id in _TARGET_MODAL_IDS:
                if '#' + modal_id in part:
                    break
            else:
                self.fail('选择器未命中目标弹窗: %s' % part)

    # 12. 不写 dialog 几何覆盖,不涉及 data-layout;与几何门共存。
    def test_no_dialog_geometry_override(self):
        joined = self.css
        self.assertNotIn('modal-dialog', joined)
        self.assertNotIn('data-layout', joined)
        self.assertNotIn('width:', joined)
        self.assertNotIn('height:', joined.replace('max-height', ''))
