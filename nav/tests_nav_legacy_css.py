# nav/tests_nav_legacy_css.py
"""#9 遗留样式清理 / #3 访客小按钮隐藏 / #11 两端统一吸底工具条 —— CSS 静态断言门。

契约(2026-11-21,11-CSS清理与统一 流):
- #9:退役三档布局(杂志 mag / 极简 min / 分栏 cols)的 CSS 规则已全部删除;模板排列按钮
  只留 card / icon / list,老 localStorage 值由 nav-sites.js 归并到保留档;默认档
  (card / icon / list)规则必须原样保留。
- #3:访客态(html.nav-guest-mode)卡片编辑/删除小按钮默认隐藏,覆盖 hover / show-actions /
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
    """#9:退役三档规则已删,保留档规则仍在。"""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.css = static_text('css/nav-sites.css')

    def test_legacy_layout_tokens_gone_from_css(self):
        """mag / min / cols 三档遗留选择器与从属变量不再出现。"""
        for token in ('lyr-mag', 'lyr-min', 'lyr-cols', 'cols-even',
                      'data-cards-cols', '--cols-count', 'cols-count'):
            self.assertNotIn(token, self.css, '遗留布局规则未清干净: ' + token)

    def test_survivor_layout_rules_kept(self):
        """保留档 card / icon / list 的规则仍在,默认卡片 280px 栅格未被误删。"""
        self.assertIn('.nav-hub.lyr-icon .site-card', self.css)
        self.assertIn('.nav-hub.lyr-list .site-card', self.css)
        self.assertIn('minmax(280px, 1fr)', self.css)
        # 默认档 :not() 守卫只保留 icon / list 两个保留档
        self.assertIn(':not(.lyr-icon):not(.lyr-list)', self.css)

    def test_legacy_values_merged_in_js_not_css(self):
        """JS 归并链路保留(只读核对):老值 mag/min/cols 映射到 card/list。"""
        js = static_text('js/nav-sites.js')
        self.assertIn('NAV_LAYOUT_LEGACY', js)
        self.assertIn("mag: 'card'", js)
        self.assertIn("min: 'list'", js)
        self.assertIn("cols: 'card'", js)

    def test_template_layout_buttons_only_survivors(self):
        """模板排列按钮只输出 card / icon / list 三个 data-layout。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for legacy in ('data-layout="mag"', 'data-layout="min"', 'data-layout="cols"'):
            self.assertNotIn(legacy, html)
        for survivor in ('data-layout="card"', 'data-layout="icon"', 'data-layout="list"'):
            self.assertIn(survivor, html)


class GuestSmallButtonsTests(TestCase):
    """#3:访客小按钮默认隐藏,开关开启成对恢复;主人端 / 星标不受影响。"""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.css = static_text('css/nav-sites.css')
        cls.blocks = _rule_blocks(cls.css)

    def test_guest_hide_rule_covers_all_action_buttons(self):
        """隐藏规则同时覆盖 .site-edit / .site-del,且用 !important 压过既有露出态。"""
        hide_blocks = [
            (sel, body) for sel, body in self.blocks
            if 'html.nav-guest-mode' in sel and 'nav-guest-cardbtns' in sel
            and '.site-edit' in sel and '.site-del' in sel
        ]
        self.assertTrue(hide_blocks, '未找到访客态编辑/删除隐藏规则')
        for sel, body in hide_blocks:
            self.assertIn('display: none !important', body)
            # 排除开关开启态:恢复走既有露出规则,不靠第二条反向覆盖
            self.assertIn('body:not(.nav-guest-cardbtns)', sel)

    def test_guest_hide_rule_uses_guest_root_class(self):
        """访客隐藏块的选择器必须挂在 html.nav-guest-mode 根类下,不得写成全局隐藏。"""
        for sel, body in self.blocks:
            if 'html.nav-guest-mode' in sel and '.site-edit' in sel:
                self.assertIn('.site-del', sel)
                self.assertIn('display: none !important', body)

    def test_guest_mode_root_class_marked_in_template(self):
        """访客页模板内联脚本给 <html> 挂 nav-guest-mode 根类(主人页不输出该分支)。"""
        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertIn("classList.add('nav-guest-mode')", html)

    def test_star_button_default_kept(self):
        """.site-star 原本常显,访客隐藏规则不得波及星标。"""
        self.assertIn('.site-card .site-star', self.css)
        star_blocks = [(sel, body) for sel, body in self.blocks if '.site-star' in sel]
        self.assertTrue(star_blocks)
        for sel, body in star_blocks:
            if 'nav-guest-mode' in sel:
                self.fail('访客态规则误伤了 .site-star: ' + sel)


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
