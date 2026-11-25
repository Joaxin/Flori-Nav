# nav/tests_nav_legacy_css.py
"""#9 布局规则 / #3 访客小按钮隐藏 / #11 两端统一吸底工具条 —— CSS 静态断言门。

契约(2026-11-23 修订,六档布局恢复):
- #9:2026-11-21 曾把 杂志 mag / 极简 min / 分栏 cols 三档删除;2026-11-23 按用户要求
  全部恢复。现在 CSS 必须保留六档规则(lyr-mag / lyr-min / lyr-cols 与分栏从属
  cols-even / data-cards-cols / --cols-count),JS 白名单六值、旧值归并表清空,模板
  排列按钮输出六个 data-layout。默认卡片栅格的 :not() 守卫同时排除三档恢复布局。
- 2026-11-25:访客态不再单独隐藏卡片编辑/删除小按钮,与主人共用 hover / show-actions /
  触屏全部态;body.nav-guest-cardbtns 开关开启后回落既有露出规则;主人端与 .site-star 不动。
- #11:主人 #navMsBar 的 fixed 吸底为基准,主客共用同一套定位 / 安全区 / 宽度口径;
  访客 .ng-bulkbar 不再 sticky;退出钮靠右;禁用态 / 0 项计数 / 多选操作簇让位规则在位。

静态断言为主;浏览器实测(访客按钮显隐、两端工具条 rect、截图)见
docs/并行改造/11-CSS清理与统一.md §验证记录。

跑法:`python manage.py test nav.tests_nav_legacy_css`
"""

import re

from django.test import TestCase
from django.urls import reverse

from .tests_nav_common import static_text


def _rule_blocks(css):
    """按 } 切出规则块,返回选择器串 + 声明体 成对列表(剥离注释)。"""
    blocks = []
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    for chunk in css.split('}'):
        if '{' not in chunk:
            continue
        sel, body = chunk.split('{', 1)
        blocks.append((sel.strip(), body.strip()))
    return blocks


class LegacyLayoutCleanupTests(TestCase):
    """#9:六档布局规则齐备(2026-11-23 从三档恢复成六档)。"""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.css = static_text('css/nav-sites.css')

    def test_six_layout_rules_present_in_css(self):
        """mag / min / cols 三档选择器与从属变量必须留在 CSS 里。"""
        for token in ('lyr-mag', 'lyr-min', 'lyr-cols', 'cols-even',
                      'data-cards-cols', '--cols-count', 'cols-count'):
            self.assertIn(token, self.css, '六档布局规则缺失: ' + token)

    def test_survivor_layout_rules_kept(self):
        """保留档 card / icon / list 的规则仍在,默认卡片 280px 栅格未被误删。"""
        self.assertIn('.nav-hub.lyr-icon .site-card', self.css)
        self.assertIn('.nav-hub.lyr-list .site-card', self.css)
        self.assertIn('minmax(280px, 1fr)', self.css)
        # 默认卡片栅格的 :not() 守卫必须排除六个布局里的另外五档
        self.assertIn(':not(.lyr-icon):not(.lyr-list)', self.css)

    def test_js_layout_whitelist_is_six(self):
        """JS 白名单六值齐全,旧值归并表已清空(不再静默降级)。"""
        js = static_text('js/nav-sites.js')
        self.assertIn('NAV_LAYOUT_SURVIVORS', js)
        for value in ("'card'", "'icon'", "'list'", "'mag'", "'min'", "'cols'"):
            self.assertIn(value, js)
        self.assertIn('const NAV_LAYOUT_LEGACY = {};', js)

    def test_template_layout_buttons_has_six(self):
        """模板排列按钮输出六个 data-layout,一个不少。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for layout in ('card', 'icon', 'list', 'mag', 'min', 'cols'):
            self.assertIn('data-layout="' + layout + '"', html)


class GuestSmallButtonsTests(TestCase):
    """2026-11-25:访客卡面 ✎/× 与主人共用同一套露出规则(两端统一,不再单写访客样式/JS)。"""

    def test_no_guest_scoped_hide_rule(self):
        """访客端不得再有任何只针对 nav-guest-mode 的卡片按钮隐藏块。"""
        css = static_text('css/nav-sites.css')
        for sel, body in _rule_blocks(css):
            if 'nav-guest-mode' in sel and ('.site-edit' in sel or '.site-del' in sel):
                self.fail('访客端不应再单独隐藏卡面按钮: ' + sel)

    def test_shared_reveal_rules_still_cover_cards(self):
        """共用的 hover / 常显 / 总开关三套规则仍在,两端都靠它。"""
        css = static_text('css/nav-sites.css')
        self.assertIn('.site-card:hover .site-edit', css)
        self.assertIn('.nav-hub.show-actions .site-card .site-edit', css)
        self.assertIn('.nav-hub.hide-actions .site-card-box .site-edit', css)

    def test_guest_page_has_no_dedicated_switch(self):
        """访客页不再渲染 #setGuestCardBtns;两端设置项完全一致(显示按钮 + 常显)。"""
        guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertNotIn('setGuestCardBtns', guest)
        self.assertIn('id="setCardActions"', guest)
        self.assertIn('id="setShowActions"', guest)

    def test_guest_mode_root_class_marked_in_template(self):
        """访客页模板内联脚本给 <html> 挂 nav-guest-mode 根类(其他访客样式仍靠它)。"""
        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertIn("classList.add('nav-guest-mode')", html)


class UnifiedBulkbarTests(TestCase):
    """#11:两端工具条同一套 fixed 吸底几何,退出靠右,禁用 / 0 项 / 多选簇让位在位。"""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.css = static_text('css/nav-sites.css')
        cls.blocks = _rule_blocks(cls.css)

    def test_bars_share_fixed_bottom_geometry(self):
        """主人条 / 访客快照条 / 访客本机书签条 / 新契约条共用 fixed 吸底规则组。"""
        geo_blocks = [
            (sel, body) for sel, body in self.blocks
            if ('#navMsBar' in sel or '#ngSnapBulkBar' in sel or '#navBulkBar' in sel
                or '.ng-bulkbar' in sel) and 'position: fixed' in body
        ]
        self.assertTrue(geo_blocks, '未找到工具条 fixed 吸底规则组')
        for sel, body in geo_blocks:
            self.assertIn('bottom:', body)
            self.assertIn('left: 50%', body)
            self.assertIn('translateX(-50%)', body)
            self.assertIn('max-width: min(94vw, 760px)', body)
        sel_all = ' '.join(sel for sel, _ in geo_blocks)
        for hook in ('#navMsBar', '#ngSnapBulkBar', '#navBulkBar', '.ng-bulkbar'):
            self.assertIn(hook, sel_all)

    def test_guest_bar_no_longer_sticky(self):
        """访客工具条不再保留 sticky 吸顶规则(其余 toc / 表格 / Tab 的 sticky 不在本条目范围)。"""
        sticky_bars = [
            sel for sel, body in self.blocks
            if '.ng-bulkbar' in sel and 'position: sticky' in body
        ]
        self.assertEqual(sticky_bars, [], '访客条仍为 sticky: ' + '; '.join(sticky_bars))

    def test_exit_button_rightmost(self):
        """退出 / 取消钮 margin-left:auto 靠右,覆盖既有钩子与新契约 #navBulkExit。"""
        exit_blocks = [
            (sel, body) for sel, body in self.blocks
            if 'margin-left: auto' in body and (
                '[data-ngs-exit]' in sel or '#navMsCancel' in sel
                or '#navBulkExit' in sel or '[data-bulk-exit]' in sel)
        ]
        self.assertTrue(exit_blocks, '未找到退出钮靠右规则')
        sel_all = ' '.join(sel for sel, _ in exit_blocks)
        self.assertIn('#navBulkExit', sel_all)
        self.assertIn('[data-ngs-exit]', sel_all)
        self.assertIn('#navMsCancel', sel_all)

    def test_disabled_state_shared_across_bars(self):
        """0 项 / 不可用按钮禁用态覆盖两端工具条与新契约条。"""
        dis_blocks = [
            body for sel, body in self.blocks
            if ':disabled' in sel and 'opacity: .5' in body
        ]
        self.assertTrue(dis_blocks, '未找到禁用态规则')
        sel_all = ' '.join(sel for sel, _ in self.blocks if ':disabled' in sel)
        self.assertIn('#navMsBar', sel_all)
        self.assertIn('#ngSnapBulkBar', sel_all)
        self.assertIn('#navBulkBar', sel_all)

    def test_bulk_mode_hides_card_action_cluster(self):
        """多选态隐藏卡片操作簇(星标/编辑/删除)规则保留,两端同一处理。"""
        cluster = [
            (sel, body) for sel, body in self.blocks
            if 'body.bulk-mode' in sel and '.site-edit' in sel and '.site-del' in sel
        ]
        self.assertTrue(cluster, '多选态操作簇让位规则缺失')
        for _, body in cluster:
            self.assertIn('display: none !important', body)


class CollapseVisibilityConflictTests(TestCase):
    """「高级选项」折叠区靠 Bootstrap 的 .collapse + .show 展开。

    tailwind.gen.css 里有个同名工具类 .collapse{visibility:collapse},对非表格元素
    等于 hidden,且无条件命中 —— 展开后高度 120px 但一片空白。nav-sites.css 必须
    显式把 visibility 拨回 visible;收起仍由 .collapse:not(.show) 的 display:none 负责。
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.css = static_text('css/nav-sites.css')
        cls.tw = static_text('css/tailwind.gen.css')

    def test_tailwind_still_ships_visibility_collapse(self):
        """回归的前提还在:Tailwind 仍在输出这条 visibility 工具类。"""
        self.assertIn('.collapse{visibility:collapse}', self.tw.replace('\n', '').replace(' ', ''))

    def test_nav_css_overrides_collapse_visibility(self):
        """nav-sites.css 必须留一条把 .collapse 拨回 visible 的规则。"""
        rules = dict(_rule_blocks(self.css))
        self.assertIn('.collapse', rules)
        self.assertIn('visibility: visible', rules['.collapse'])

    def test_collapse_not_show_hides(self):
        """兼容层没生成 Bootstrap 的收起规则,必须自己补 .collapse:not(.show){display:none};
        否则折叠区默认摊开、点开也收不回去(「高级选项」实测 h=120 display=block)。"""
        rules = dict(_rule_blocks(self.css))
        self.assertIn('.collapse:not(.show)', rules)
        self.assertIn('display: none', rules['.collapse:not(.show)'])
