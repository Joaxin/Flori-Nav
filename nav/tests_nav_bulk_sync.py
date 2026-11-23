# nav/tests_nav_bulk_sync.py
"""多选工具条 syncBar 写前比对回归门(D7 修法①,2026-11-22)。

背景:#navMsBar 子树挂了 childList 观察器(barObserver);syncBar 若在值未变时
仍重写文案/属性,同值重写会再触发子树变更 → 观察器回调 syncBar → 自激循环。
修法①:所有写入先读回当前 DOM 值比对,相等直接跳过;barObserver 原样保留,
不许删 observer 绕过,也不许用 setTimeout/节流/时间窗去重掩盖。

静态断言为主;headed Chromium 实测(收敛计数 / 几何 / 0 项禁用态)见
借鉴调研/p2/verify/ 与 04-P2收口报告.md「D7 修复」一节。

跑法:`python manage.py test nav.tests_nav_bulk_sync`
"""

import pathlib
import re

from django.conf import settings
from django.test import TestCase

NAV_DIR = pathlib.Path(settings.BASE_DIR) / 'nav'
SITES_JS = (NAV_DIR / 'static' / 'js' / 'nav-sites.js').read_text(encoding='utf-8')


def _function_body(src, name):
    """按花括号配对截取 `function name(...) { ... }` 的函数体全文。"""
    marker = 'function %s(' % name
    start = src.index(marker)
    brace = src.index('{', start)
    depth = 0
    for i in range(brace, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                return src[brace:i + 1]
    raise ValueError('未闭合的函数体: %s' % name)


class BulkSyncCompareHelpersTests(TestCase):
    """比对工具本身存在,且带 return-early 分支。"""

    def test_compare_helpers_defined(self):
        for helper in ('setTextIfChanged', 'setAttrIfChanged', 'setPropIfChanged'):
            self.assertIn('function %s(' % helper, SITES_JS)

    def test_helpers_return_early_on_equal_dom_value(self):
        # 文本:读回 textContent 相等即跳过
        self.assertRegex(SITES_JS, r'textContent === text\) return false')
        # 属性:读回 getAttribute 相等即跳过
        self.assertRegex(SITES_JS, r'getAttribute\(name\) === want\) return false')
        # 特性:读回 prop 相等即跳过
        self.assertRegex(SITES_JS, r'\$el\.prop\(name\) === val\) return false')


class BulkSyncBarBodyTests(TestCase):
    """syncBar 内写入全部经由比对工具,无裸 .text()/.attr()/.prop() 写入。"""

    def setUp(self):
        self.body = _function_body(SITES_JS, 'syncBar')

    def test_no_bare_dom_write_in_sync_bar(self):
        # 函数体内不允许出现裸 jQuery 写入调用;文案/属性/特性必须走比对工具。
        bare = re.findall(r'\.(text|attr|prop)\s*\(', self.body)
        self.assertEqual(bare, [], 'syncBar 内存在未走比对工具的裸写入: %s' % bare)

    def test_sync_bar_uses_compare_helpers(self):
        self.assertIn('setTextIfChanged(', self.body)
        self.assertIn('setAttrIfChanged(', self.body)
        self.assertIn('setPropIfChanged(', self.body)

    def test_no_timeout_or_throttle_dedup(self):
        # 修法①禁止用 setTimeout/节流/时间窗去重掩盖自激。
        self.assertNotIn('setTimeout', self.body)
        self.assertNotIn('throttle', self.body)

    def test_reentrancy_guard_kept(self):
        # 既有 syncingBar 守卫保留(防重入),不被改成时间窗去重。
        self.assertIn('syncingBar', self.body)


class BulkSyncObserverTests(TestCase):
    """barObserver 原样保留:仍观察 #navMsBar 子树 childList。"""

    def test_bar_observer_still_watches_ms_bar(self):
        self.assertIn("const $bar = $('#navMsBar');", SITES_JS)
        self.assertIn('barObserver = new MutationObserver(syncBar)', SITES_JS)
        self.assertIn(
            'barObserver.observe($bar[0], { childList: true, subtree: true })',
            SITES_JS,
        )

    def test_observer_lazy_mount_kept(self):
        # 懒挂载逻辑不变:仅在 observer 缺失时创建,不重复 new。
        self.assertIn('if (window.MutationObserver && !barObserver)', SITES_JS)


class GuestSnapshotBulkContractTests(TestCase):
    """G3:访客快照多选并入 window.navBulk 统一口径,不再自成一套 API。

    快照侧只暴露 navGuestSnapshotBulk(同形方法),由 nav-guest-batch.js 在 ready
    末尾按「#navGroups 是否有站点卡」路由进 window.navBulk;自有 #ngSnapBulkBar
    UI 保留(共享吸底/禁用/靠右样式),但状态与动作必须走统一入口。
    """

    def setUp(self):
        base = pathlib.Path(settings.BASE_DIR) / 'nav' / 'static' / 'js'
        self.snap_js = (base / 'nav-guest-snapshot.js').read_text(encoding='utf-8')
        self.batch_js = (base / 'nav-guest-batch.js').read_text(encoding='utf-8')

    def test_snapshot_exposes_routeable_bridge(self):
        self.assertIn('window.navGuestSnapshotBulk = {', self.snap_js)
        for method in ('active:', 'enter:', 'exit:', 'count:', 'render:', 'selectAll:'):
            self.assertIn(method, self.snap_js, '快照桥缺方法: %s' % method)

    def test_snapshot_select_all_shared_by_ui_and_api(self):
        # 条上的「全选」按钮与 navBulk.selectAll 必须同源,不许各写一份。
        self.assertIn('selectAll: selectAllVisible', self.snap_js)
        self.assertIn('function selectAllVisible()', self.snap_js)
        self.assertGreaterEqual(self.snap_js.count('selectAllVisible()'), 2)

    def test_nav_bulk_routes_snapshot_first(self):
        # 有快照站点卡时,统一入口必须先路由到快照,否则会落到本机书签导入区。
        self.assertIn('window.navGuestSnapshotBulk', self.batch_js)
        self.assertIn("document.querySelector('#navGroups [data-site-item]')", self.batch_js)
        for method in ('enter:', 'exit:', 'isActive:', 'count:', 'render:', 'selectAll:'):
            self.assertIn(method, self.batch_js, 'navBulk 路由缺方法: %s' % method)

    def test_snapshot_bulk_has_no_native_dialog(self):
        # 与全站口径一致:二次确认走 navConfirm,禁止原生 confirm。
        self.assertNotIn('window.confirm(', self.snap_js)
        self.assertIn('window.navConfirm', self.snap_js)
