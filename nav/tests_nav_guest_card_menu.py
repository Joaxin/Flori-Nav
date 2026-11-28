# nav/tests_nav_guest_card_menu.py
"""访客端卡片右键 / 长按菜单回归门(09 流,2026-11-21)。

契约:
- 访客态复用主人端同一套 `.card-menu` 容器 / 定位翻边 / 键盘 ↑↓·Esc / 长按防误触;
- 访客菜单只落本机:打开链接、编辑(navGuestEdit)、星标(localStorage navStars)、
  复制链接、移动到分类(快照覆盖表)、置顶/置底/上移/下移(localStorage 顺序表)、
  删除(快照覆盖表 deleteSnapshot);
- 主客两端使用同一份 actionItems 动作清单与分类选择器,菜单条目逐项一致;
- 访客分支不调 owner 写接口、不写服务器 DB;主人端排序仍走服务端接口。

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
        # 主客共用的动作清单（不再有 GUEST 分支内联串）
        self.actions = _slice_between(CARD_MENU_JS, 'function actionItems', 'function build')
        # guestAct 动作回调函数体
        self.guest_act = _slice_between(CARD_MENU_JS, 'function guestAct', 'function onAct')

    def test_guest_menu_matches_owner_actions(self):
        # 两端动作清单同源:打开 / 编辑 / 星标 / 复制 / 移动到分类 / 排序四项 / 删除
        for act in ('open', 'edit', 'star', 'copy', 'move',
                    'pin-top', 'pin-bottom', 'up', 'down', 'del'):
            self.assertIn("item('%s'" % act, self.actions)

    def test_guest_ordering_is_local_not_owner_api(self):
        # 访客排序只能落 navGuestSnapshot.reorder(localStorage 顺序表)
        self.assertIn('navGuestSnapshot.reorder', self.guest_act)
        self.assertNotIn('site-order', self.guest_act)

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

    def test_guest_card_matcher_covers_snapshot_and_local(self):
        # 快照卡与本机导入卡共用同一套菜单;HTML 工具卡不进书签菜单
        self.assertIn("guestCard", CARD_MENU_JS)
        self.assertIn("#navGuestImports", CARD_MENU_JS)
        self.assertIn("#toolsSection", CARD_MENU_JS)
        matcher = _slice_between(CARD_MENU_JS, 'function guestCard', 'function toggleStar')
        self.assertNotIn("closest('#navGuestImports')) return null", matcher)
        self.assertIn("closest('#toolsSection')", matcher)
        self.assertIn("function isLocalCard", CARD_MENU_JS)
        self.assertIn("window.navGuestLocalCard", CARD_MENU_JS)

    def test_guest_page_has_only_one_card_menu(self):
        # 模板内联 gMenu / #navGuestCardMenu 已删除,页面只留共享 card-menu.js 这一套
        for dead in ('navGuestCardMenu', 'function gMenuBuild', 'function gOnAct', 'ngMetaLinkPanel'):
            self.assertNotIn(dead, TPL)

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
        actions = _slice_between(CARD_MENU_JS, 'function actionItems', 'function build')
        for act in ('pin-top', 'pin-bottom', 'up', 'down', 'move'):
            self.assertIn("item('%s'" % act, actions)

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
