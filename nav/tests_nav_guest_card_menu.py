# nav/tests_nav_guest_card_menu.py
"""访客端卡片右键 / 长按菜单回归门(09 流,2026-11-21)。

契约:
- 访客态复用主人端同一套 `.card-menu` 容器 / 定位翻边 / 键盘 ↑↓·Esc / 长按防误触;
- 访客菜单只落本机:打开链接、编辑(navGuestEdit)、星标(localStorage navStars)、
  复制链接、删除本机书签(快照覆盖表 deleteSnapshot);
- 访客分支不调 owner 写接口、不写服务器 DB;不提供置顶/置底/上移/下移;
- 主人端菜单动作(排序写库)原样保留,不受访客分支改动影响。

静态断言为主;浏览器实测(开/关、长按、五项动作、刷新持久化、主人态未变)见
docs/并行改造/09-访客卡片菜单.md §5/§6。

跑法:`python manage.py test nav.tests_nav_guest_card_menu`
"""

import pathlib
import re

from django.conf import settings
from django.test import TestCase
from django.urls import reverse

NAV_DIR = pathlib.Path(settings.BASE_DIR) / 'nav'
CARD_MENU_JS = (NAV_DIR / 'static' / 'js' / 'card-menu.js').read_text(encoding='utf-8')
CSS = (NAV_DIR / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')
TPL = (NAV_DIR / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')


def _slice_between(src, start_marker, end_marker):
    i = src.index(start_marker)
    j = src.index(end_marker, i)
    return src[i:j]


class GuestMenuSourceStructureTests(TestCase):
    """源码静态断言:访客菜单项数 / 动作回调 / 边界。"""

    def setUp(self):
        # build() 里 GUEST 分支的菜单项串
        self.guest_items = _slice_between(CARD_MENU_JS, 'if (GUEST) {', '} else {')
        # guestAct 动作回调函数体
        self.guest_act = _slice_between(CARD_MENU_JS, 'function guestAct', 'function onAct')

    def test_guest_menu_five_local_actions(self):
        # 访客菜单:打开 / 编辑 / 星标 / 复制 / 删除,共五个动作项
        acts = re.findall(r'data-act="([^"]+)"', self.guest_items)
        self.assertEqual(acts, ['open', 'edit', 'star', 'copy', 'del'])

    def test_guest_menu_has_no_ordering_actions(self):
        # 快照数据没有书签级排序持久化:访客菜单不得出现置顶/置底/上移/下移
        for forbidden in ('pin-top', 'pin-bottom', 'data-act="up"', 'data-act="down"'):
            self.assertNotIn(forbidden, self.guest_items)

    def test_guest_act_does_not_call_owner_api(self):
        # 访客动作回调里禁止出现服务端写接口 / fetch / csrf 提交
        self.assertNotIn('/api/nav/', self.guest_act)
        self.assertNotIn('fetch(', self.guest_act)
        self.assertNotIn('csrf', self.guest_act.lower())

    def test_guest_act_delegates_to_local_snapshot_api(self):
        # 编辑走快照组件暴露的 editSite;删除走 hideSite;星标点既有 .site-star;复制走本机剪贴板
        self.assertIn('navGuestSnapshot.editSite', self.guest_act)
        self.assertIn('navGuestSnapshot.hideSite', self.guest_act)
        self.assertIn(".site-star", self.guest_act)
        self.assertIn('copyText', self.guest_act)

    def test_guest_card_matcher_keeps_snapshot_only(self):
        # 本机导入书签卡由模板内联 gMenu 接管;HTML 工具卡不进书签菜单
        self.assertIn("guestCard", CARD_MENU_JS)
        self.assertIn("#navGuestImports", CARD_MENU_JS)
        self.assertIn("#toolsSection", CARD_MENU_JS)
        matcher = _slice_between(CARD_MENU_JS, 'function guestCard', 'function toggleStar')
        self.assertIn("closest('#navGuestImports')", matcher)
        self.assertIn("closest('#toolsSection')", matcher)

    def test_shared_container_and_geometry_reused(self):
        # 主客共用同一个 .card-menu 容器类与既有定位/翻边/滚动规则,CSS 不另写访客菜单几何
        self.assertIn("menu.className = 'card-menu'", CARD_MENU_JS)
        self.assertIn('.card-menu {', CSS)
        self.assertIn('position: fixed; z-index: 1085', CSS)
        self.assertNotRegex(CSS, r'html\.nav-guest-mode\s+\.card-menu[^{]*\{[^}]*width')

    def test_keyboard_and_long_press_behavior_kept(self):
        # 键盘 ↑↓/Esc、长按 550ms、移动 10px 取消、松手 click 吞咽,主客共用一套
        for snippet in ("ArrowDown", "ArrowUp", "Escape", "550", "10px", "swallowClick"):
            self.assertIn(snippet, CARD_MENU_JS)


class OwnerMenuUnchangedTests(TestCase):
    """主人端菜单动作与服务端排序接口原样保留。"""

    def test_owner_branch_ordering_actions_kept(self):
        owner_items = _slice_between(CARD_MENU_JS, '} else {', "menu.innerHTML = items.join('')")
        for act in ('pin-top', 'pin-bottom', 'up', 'down'):
            self.assertIn('data-act="' + act + '"', owner_items)

    def test_owner_reorder_api_kept(self):
        # 主人端置顶/移动仍走服务端 order 接口;这段不能被访客分支删掉
        self.assertIn('/api/nav/site-order/pin/', CARD_MENU_JS)
        self.assertIn('/api/nav/site-order/swap/', CARD_MENU_JS)
        self.assertIn('function reorder', CARD_MENU_JS)

    def test_owner_star_and_copy_kept(self):
        self.assertIn('toggleStar', CARD_MENU_JS)
        self.assertIn('legacyCopy', CARD_MENU_JS)


class GuestMenuPageLoadTests(TestCase):
    """页面加载:两端都挂 card-menu.js;访客页不泄漏库内站点。"""

    def test_guest_page_loads_shared_menu_script(self):
        resp = self.client.get(reverse('nav_guest'))
        self.assertEqual(resp.status_code, 200)
        html = resp.content.decode('utf-8')
        self.assertIn('NAV_GUEST_MODE', html)
        self.assertIn('js/card-menu.js', html)

    def test_owner_page_menu_script_intact(self):
        resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(resp.status_code, 200)
        html = resp.content.decode('utf-8')
        self.assertIn('js/card-menu.js', html)
        # 主人端排序配置岛仍在(主人菜单排序动作依赖)
        self.assertIn('navStarsUrls', html)
