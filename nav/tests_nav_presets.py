# nav/tests_nav_presets.py
"""P0 preset 引擎(R-01 / R-04 / R-07)静态断言测试。

只跑本域:`.venv/bin/python manage.py test nav.tests_nav_presets -v 2`。

断法与既有 `tests_nav_sites.py` 一致:Django TestCase + 直接读 JS 源码文本做
稳定断言,不引入新依赖、不模拟浏览器运行。行为自测另由 node 脚本在 /tmp 完成,
结论记录在 `借鉴调研/p0/11-引擎说明.md`。
"""
import os
import re

from django.test import TestCase

_JS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'static', 'js', 'nav-presets.js',
)

# 契约第 3 节:每套预设包内键名清单(17 个,顺序不参与断言)。
_EXPECTED_KEYS = {
    'navLayout', 'navDensity', 'navTocStyle', 'navShowToc', 'navTocMode',
    'navFontScale', 'navShowClock', 'navShowSearch', 'navShowRecent',
    'navShowTools', 'navShowUrl', 'navShowTags', 'navShowHealth',
    'navShowActions', 'navUrlMode', 'navPageWidth', 'navCardDescLines',
}

_EXPECTED_IDS = ['classic', 'compact', 'portal', 'gallery', 'app-first']
_ALLOWED_LAYOUTS = {'card', 'icon', 'list'}


def _read_js():
    if not os.path.exists(_JS_PATH):
        return ''
    with open(_JS_PATH, encoding='utf-8') as fh:
        return fh.read()


def _preset_block(src, pid):
    """取出 `    <pid>: { ... }` 预设块文本(4 空格缩进的顶层块,允许引号 id)。"""
    match = re.search(
        r"\n    ['\"]?" + re.escape(pid) + r"['\"]?: \{\n(.*?)\n    \},?",
        src, re.S,
    )
    return match.group(1) if match else ''


def _strip_comments(src):
    """剥掉块注释与行注释,只留可执行代码,避免注释里的禁词误报。"""
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'//[^\n]*', '', src)
    return src


def _function_body(src, fn_name):
    """取出 `function <fn_name>(...) { ... }` 函数体文本。"""
    match = re.search(
        r'function ' + re.escape(fn_name) + r'\([^)]*\) \{\n(.*?)\n\}', src, re.S
    )
    return match.group(1) if match else ''


class NavPresetsEngineTests(TestCase):
    """nav-presets.js 注册表 / 合并 / 迁移引擎静态断言。"""

    def setUp(self):
        self.src = _read_js()

    # 1. 模块文件存在且挂 window.NavPresets。
    def test_module_file_exists_and_exposes_global(self):
        self.assertTrue(os.path.exists(_JS_PATH), 'nav-presets.js 未创建')
        self.assertIn('window.NavPresets', self.src)
        self.assertIn('window.NavPresets = {', self.src)

    # 2. PRESET_IDS 恰好 5 个,顺序 classic/compact/portal/gallery/app-first。
    def test_preset_ids_exactly_five_in_order(self):
        match = re.search(r"PRESET_IDS\s*=\s*\[\s*'([^']+)'"
                          r"(?:\s*,\s*'([^']+)')*\s*\]", self.src)
        self.assertIsNotNone(match, '未找到 PRESET_IDS 数组定义')
        ids = re.findall(r"'([^']+)'", match.group(0))
        self.assertEqual(ids, _EXPECTED_IDS)

    # 3. 五个 id 各有 keys 块且包含 navLayout。
    def test_each_preset_has_keys_block_with_navlayout(self):
        for pid in _EXPECTED_IDS:
            block = _preset_block(self.src, pid)
            self.assertTrue(block, '预设 %s 块缺失' % pid)
            self.assertIn('keys: {', block, '预设 %s 缺 keys 块' % pid)
            self.assertIn('navLayout:', block, '预设 %s 缺 navLayout 键' % pid)

    # 4. navLayout 值只出现 card/icon/list(扫 navLayout: 行的值)。
    def test_navlayout_values_within_whitelist(self):
        values = re.findall(r"navLayout:\s*'([^']*)'", self.src)
        self.assertEqual(len(values), 5, '应有 5 个包内 navLayout 值')
        for value in values:
            self.assertIn(value, _ALLOWED_LAYOUTS, '越界 layout 值: %s' % value)

    # 5. 零网络调用:无 fetch / XHR / sendBeacon / /api/nav/ / $.ajax。
    def test_no_network_calls(self):
        code = _strip_comments(self.src)
        self.assertNotIn('fetch(', code)
        self.assertNotIn('XMLHttpRequest', code)
        self.assertNotIn('sendBeacon', code)
        self.assertNotIn('/api/nav/', code)
        self.assertNotIn('$.ajax', code)

    # 6. 存储键契约:KEY_PRESET / KEY_MIGRATED 写死。
    def test_storage_keys_contract(self):
        self.assertIn("KEY_PRESET = 'navLayoutPreset'", self.src)
        self.assertIn("KEY_MIGRATED = 'navPresetMigrated'", self.src)

    # 7. resolveLegacy 三个映射:card→classic、icon→compact、list→compact。
    def test_resolve_legacy_mappings_present(self):
        match = re.search(r'LEGACY_LAYOUT_MAP\s*=\s*\{(.*?)\}', self.src, re.S)
        self.assertIsNotNone(match, '未找到 LEGACY_LAYOUT_MAP 映射表')
        body = match.group(1)
        self.assertIn("card: 'classic'", body)
        self.assertIn("icon: 'compact'", body)
        self.assertIn("list: 'compact'", body)

    # 8. migrate 同时出现 KEY_MIGRATED 与幂等判断(重复调用 changed=false)。
    def test_migrate_uses_migrated_flag_and_is_idempotent(self):
        body = _function_body(self.src, 'migrate')
        self.assertIn('KEY_MIGRATED', body)
        self.assertIn('changed: false', body)
        self.assertIn('changed: true', body)
        # 已有 preset 键时直接返回,不覆盖包内键。
        self.assertIn('existing', body)

    # 9. apply 有白名单校验:ALLOWED_LAYOUTS 越界拒绝 + fallback 回落。
    def test_apply_rejects_out_of_whitelist_layout(self):
        body = _function_body(self.src, 'apply')
        self.assertIn('ALLOWED_LAYOUTS', body)
        self.assertIn('fallback: true', body)
        self.assertIn('indexOf', body)

    # 10. 派发 nav:presetchange CustomEvent。
    def test_presetchange_custom_event_dispatched(self):
        self.assertIn("new CustomEvent('nav:presetchange'", self.src)
        self.assertIn('document.dispatchEvent', self.src)

    # 11. localStorage 调用全部被 try/catch 包裹;try/catch 数量与存储访问匹配。
    def test_localstorage_access_all_try_caught(self):
        code = _strip_comments(self.src)
        storage_refs = code.count('localStorage')
        self.assertGreaterEqual(storage_refs, 1)
        self.assertGreaterEqual(code.count('catch'), storage_refs,
                                '存在未被 catch 包裹的 localStorage 访问')
        # 所有 localStorage 访问必须收口在两个 _storage 助手函数内。
        for line in code.splitlines():
            if 'localStorage' in line:
                self.assertRegex(line, r'window\.localStorage\.(get|set)Item',
                                 'localStorage 未走统一助手: %s' % line.strip())

    # 12. 模块内不依赖 DOM 选择器(无 querySelector / getElementById / jQuery 选择器)。
    def test_no_dom_selector_dependency(self):
        self.assertNotIn('querySelector', self.src)
        self.assertNotIn('getElementById', self.src)
        self.assertNotIn('$(', self.src)

    # 13. 每套预设 keys 恰好等于契约 17 键清单。
    def test_preset_key_sets_match_contract(self):
        for pid in _EXPECTED_IDS:
            block = _preset_block(self.src, pid)
            keys = set(re.findall(r'^\s{12}([A-Za-z]+):', block, re.M))
            self.assertEqual(keys, _EXPECTED_KEYS,
                             '预设 %s 键清单与契约不符' % pid)

    # 14. 值类型:navCardDescLines 为数字;classic 的 navFontScale 为空串。
    def test_value_types_match_contract(self):
        desc_lines = re.findall(r'navCardDescLines:\s*(\d+)', self.src)
        self.assertEqual(len(desc_lines), 5)
        self.assertEqual(sorted(desc_lines), ['1', '1', '1', '2', '2'])
        classic_block = _preset_block(self.src, 'classic')
        self.assertIn("navFontScale: ''", classic_block)

    # 15. 门户预设:卡片密排、隐藏目录/简介/标签,不新增 navLayout 值。
    def test_portal_preset_is_dense_and_hides_toc(self):
        block = _preset_block(self.src, 'portal')
        self.assertTrue(block, 'portal 预设块缺失')
        for token in ("navLayout: 'card'", "navDensity: 'compact'",
                      "navShowToc: '0'", "navShowTags: '0'",
                      "navPageWidth: '100'"):
            self.assertIn(token, block, 'portal 缺关键键: %s' % token)
