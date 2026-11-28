# nav/tests_nav_modal_geometry.py
"""弹层几何一致性回归门(G2,2026-11-21)。

静态断言,不依赖浏览器渲染:主人端模板弹层与访客端 JS 动态弹层,
同用途的一对必须复用同一组容器 class / 共享 CSS 变量;
禁止访客端另写一套宽度/高度/形态覆盖。

跑法:`python manage.py test nav.tests_nav_modal_geometry`
几何实测(rect 差 ≤1px、两断点两主题)见 docs/并行改造/07-弹层几何统一.md。
"""

import pathlib
import re

from django.conf import settings
from django.test import TestCase

NAV_DIR = pathlib.Path(settings.BASE_DIR) / 'nav'
# 2026-11-24:模板已拆 partials。这里做静态断言,必须看"全部模板",只看主文件会漏掉拆出去的弹层。
def _all_template():
    root = NAV_DIR / 'templates' / 'nav'
    main = (root / 'nav_sites.html').read_text(encoding='utf-8')
    partials = sorted((root / 'partials').glob('*.html')) if (root / 'partials').is_dir() else []
    return main + '\n' + '\n'.join(p.read_text(encoding='utf-8') for p in partials)


TPL = _all_template()
CSS = (NAV_DIR / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')


def _js(rel):
    return (NAV_DIR / 'static' / 'js' / rel).read_text(encoding='utf-8')


GUEST_MANAGE = _js('nav-guest-manage.js')
GUEST_CARE = _js('nav-guest-care.js')
GUEST_AI = _js('nav-guest-ai.js')
FOOTPRINT_JS = _js('footprint.js')


def _owner_dialog_classes(modal_id):
    """从模板里取某主人 modal 根节点之后第一个 dialog/offcanvas 的 class 串。"""
    m = re.search(r'<div class="modal fade" id="' + re.escape(modal_id) + r'"', TPL)
    if not m:
        return None
    chunk = TPL[m.start():m.start() + 1200]
    d = re.search(r'class="(modal-dialog[^"]*)"', chunk)
    return d.group(1) if d else None


def _owner_root_classes(modal_id):
    m = re.search(r'<div class="([^"]*)" id="' + re.escape(modal_id) + r'"', TPL)
    return m.group(1) if m else None


def _guest_dialog_classes(js, modal_id):
    """从访客 JS 里取某动态弹层根节点之后第一个 dialog/offcanvas 的 class 串。"""
    m = re.search(r"id = '" + re.escape(modal_id) + r"'", js)
    if not m:
        return None
    chunk = js[max(0, m.start() - 300):m.start() + 1600]
    d = re.search(r"class=\"(modal-dialog[^\"]*)\"", chunk)
    if d:
        return d.group(1)
    d = re.search(r"className = '([^']*)'", chunk)
    return d.group(1) if d else None


def _tokens(cls):
    return set(cls.split()) if cls else set()


class ModalSkeletonParityTests(TestCase):
    """六对同用途浮层:访客 dialog/抽屉 class 与主人对齐。"""

    def test_pair_add_site_vs_guest_edit(self):
        owner = _tokens(_owner_dialog_classes('addSiteModal'))
        guest = _tokens(_guest_dialog_classes(GUEST_MANAGE, 'navGuestEditModal'))
        self.assertEqual(owner, {'modal-dialog', 'modal-lg'})
        self.assertEqual(guest, {'modal-dialog', 'modal-lg'})
        # 主人非居中、非 scrollable;访客不得自行加回 centered/scrollable
        self.assertNotIn('modal-dialog-centered', guest)
        self.assertNotIn('modal-dialog-scrollable', guest)

    def test_pair_tool_edit_vs_guest_tool_edit(self):
        owner = _tokens(_owner_dialog_classes('toolEditModal'))
        guest = _tokens(_guest_dialog_classes(GUEST_MANAGE, 'navGuestToolEditModal'))
        self.assertEqual(owner, {'modal-dialog'})
        self.assertEqual(guest, {'modal-dialog'})
        self.assertNotIn('modal-dialog-centered', guest)

    def test_pair_basket_drawer_vs_guest_basket(self):
        owner_root = _tokens(_owner_root_classes('navBasketDrawer'))
        m = re.search(r"id = 'navGuestBasketModal'", GUEST_MANAGE)
        chunk = GUEST_MANAGE[max(0, m.start() - 300):m.start() + 600]
        g = re.search(r"className = '([^']*)'", chunk)
        guest_root = _tokens(g.group(1))
        self.assertIn('offcanvas', owner_root)
        self.assertIn('offcanvas-end', owner_root)
        self.assertIn('nav-drawer', owner_root)
        self.assertEqual(guest_root, owner_root)

    def test_guest_care_lives_in_basket_not_its_own_drawer(self):
        """2026-11-27:访客「保养 / URL 卫生」不再自开抽屉,改挂进体检篮第 2、3 个页签,
        与主人 navBasketDrawer 的「死链篮 / 保养 / URL 卫生」三页签同构。"""
        self.assertNotIn("id = 'navGuestCareModal'", GUEST_CARE)
        self.assertIn('window.navGuestCare = { mount: mount, openLink: openLinkModal }', GUEST_CARE)
        for text in ('死链篮', '保养', 'URL 卫生'):
            self.assertIn(text, GUEST_MANAGE)
        for tab in ('ngbTabBasket', 'ngbTabCare', 'ngbTabHygiene'):
            self.assertIn(tab, GUEST_MANAGE)

    def test_pair_pet_ai_vs_guest_ai_panel(self):
        """AI 接口配置:访客侧 #navGuestAiPanel 与主人 #petAiModal 同一套 modal 外壳与同一组分区。
        (2026-11-27:访客面板原来是一整块「接口+对话+开关+日志」大杂烩,已收成主人同序列:
         接口状态 → 地址/Key 两列 → 模型 + ▾ → 检测/测试 → 高级 → 保存 → 调用日志)"""
        owner = _tokens(_owner_dialog_classes('petAiModal'))
        self.assertEqual(owner, {'modal-dialog'})
        self.assertIn("panel.className = 'modal fade'", GUEST_AI)
        for cls in ('modal-dialog', 'modal-content', 'modal-header', 'modal-body'):
            self.assertIn(cls, GUEST_AI)
        for token in ('nav-ai-config-row', 'nav-ai-field-base', 'nav-ai-field-key', 'nav-ai-adv'):
            self.assertIn(token, GUEST_AI)
        # 接口/Key/模型三件套 id 与主人同位置
        for gid in ('gaiBase', 'gaiKey', 'gaiModel', 'gaiModelMenu', 'gaiSaveBtn', 'gaiLogBox'):
            self.assertIn(gid, GUEST_AI)

    def test_pair_ai_modal_vs_guest_ai(self):
        owner = _tokens(_owner_dialog_classes('navAiModal'))
        guest = _tokens(_guest_dialog_classes(GUEST_AI, 'navGuestAiModal'))
        self.assertEqual(owner, {'modal-dialog', 'modal-lg', 'nav-ai-dialog'})
        self.assertEqual(guest, owner)
        # 主人 AI 内容区/内层骨架类,访客同一套
        self.assertIn('nav-ai-content', GUEST_AI)
        self.assertIn('nav-ai-body', GUEST_AI)

    def test_pair_foot_panel_vs_guest_stats(self):
        # 主人足迹面板(footprint.js 动态创建)与访客统计面板都复用
        # .nav-foot / .nav-foot__box 同一容器骨架
        self.assertIn('nav-foot', FOOTPRINT_JS)
        self.assertIn('nav-foot__box', FOOTPRINT_JS)
        self.assertIn("className = 'nav-foot'", GUEST_MANAGE)
        self.assertIn('nav-foot__box', GUEST_MANAGE)
        # 缺陷回归:openStats 必须真正把面板显示出来(旧版只挂 DOM 不 show)
        open_stats = GUEST_MANAGE[GUEST_MANAGE.index('function openStats'):]
        self.assertIn("classList.add('show')", open_stats)


class SharedGeometryTokensTests(TestCase):
    """共享 CSS 变量与类存在,且访客端不允许单写几何补丁。"""

    def test_shared_variables_defined(self):
        for var in ('--nav-modal-w-sm', '--nav-modal-w-md', '--nav-modal-w-lg',
                    '--nav-modal-w-xl', '--nav-modal-max-h', '--nav-modal-pad',
                    '--nav-modal-radius', '--nav-drawer-w'):
            self.assertIn(var, CSS, '缺少共享变量 ' + var)

    def test_shared_drawer_class_consumed(self):
        self.assertIn('.offcanvas-end.nav-drawer', CSS)
        self.assertIn('nav-drawer', TPL)
        self.assertIn('nav-drawer', GUEST_MANAGE)

    def test_no_guest_side_geometry_patch(self):
        # 不允许按端选择器单写 modal/offcanvas 宽度/高度/圆角补丁
        self.assertNotRegex(CSS, r'html\.nav-guest-mode\s+\.modal[^{]*\{[^}]*width')
        self.assertNotRegex(CSS, r'html\.nav-guest-mode\s+\.offcanvas[^{]*\{[^}]*width')

    def test_no_undefined_modal_xl_in_guest_js(self):
        for js in (GUEST_MANAGE, GUEST_CARE, GUEST_AI, _js('nav-guest-batch.js')):
            self.assertNotIn('modal-xl', js)

    def test_owner_drawer_width_not_inline(self):
        # 抽屉宽度走共享变量/类,不再保留行内 style 宽度
        m = re.search(r'<div class="offcanvas offcanvas-end nav-drawer" id="navBasketDrawer"[^>]*>', TPL)
        self.assertIsNotNone(m)
        self.assertNotIn('style=', m.group(0))
