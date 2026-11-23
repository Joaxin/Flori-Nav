# nav/tests_nav_backtop_hit.py
"""回顶按钮命中层级回归门(2026-11-22,R 路回顶缺陷修复)。

缺陷事实:
- ``#navBackTop`` 原 z-index 1030,桌宠 ``#navPet`` z-index 1035;
  桌宠内部 ``.nav-pet-video`` 宽 128px,painted 区域正好覆盖右下角 42px 回顶钮,
  ``elementFromPoint`` 命中的是 ``VIDEO.nav-pet-video``,按钮真实点不到
  (取证:``借鉴调研/p2/verify/f-e2e-fixbar-v2.json``,rect 1359,842 42×42,hitInsideBackTop=false)。

修复口径(只动 nav-sites.css):
- 回顶 z-index 提到桌宠之上,但仍低于桌宠聊天窗 / 设置抽屉 / 多选工具条;
- 不隐藏桌宠、不缩小回顶可点面积、不改桌宠 pointer-events、不把回顶抬到多选条/抽屉之上。

本文件纯静态解析 CSS 源码,不依赖浏览器渲染。

跑法::

    python manage.py test nav.tests_nav_backtop_hit -v 2
"""

import os
import re

from django.test import SimpleTestCase

from .tests_nav_common import static_text

NAV_DIR = os.path.dirname(os.path.abspath(__file__))

CSS_RAW = static_text('css/nav-sites.css')
BOOTSTRAP_RAW = static_text('vendor/css/bootstrap.min.css')


def _strip_comments(src):
    return re.sub(r'/\*.*?\*/', '', src, flags=re.S)


def _rules(css):
    """把顶层 CSS 拆成 ``(selector, body)`` 列表;@media/@supports 内层规则随父块保留。"""
    rules = []
    i, n = 0, len(css)
    while i < n:
        brace = css.find('{', i)
        if brace == -1:
            break
        sel = css[i:brace].strip()
        depth, j = 1, brace + 1
        while j < n and depth:
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
            j += 1
        rules.append((sel, css[brace + 1:j - 1]))
        i = j
    return rules


CSS = _strip_comments(CSS_RAW)
RULES = _rules(CSS)


def _rule_for(target_id):
    """取选择器列表里命中 ``target_id``(id 边界匹配)的第一条规则。"""
    token = re.compile(r'#' + re.escape(target_id) + r'(?![\w-])')
    for sel, body in RULES:
        for part in sel.split(','):
            if token.search(part):
                return sel, body
    return None, None


def _z_index(body):
    if not body:
        return None
    m = re.search(r'z-index\s*:\s*(-?\d+)', body)
    return int(m.group(1)) if m else None


def _prop(body, prop):
    if not body:
        return None
    m = re.search(re.escape(prop) + r'\s*:\s*([^;]+)', body)
    return m.group(1).strip() if m else None


# Bootstrap offcanvas 基线 z-index(设置抽屉 #navSettingsMenu 挂 .offcanvas)。
# 契约口径 1045;bootstrap.min.css 可解析时以解析值为准,解析不到回落到基线常量。
def _drawer_z_index():
    m = re.search(r'--bs-offcanvas-zindex\s*:\s*(\d+)', BOOTSTRAP_RAW)
    if m:
        return int(m.group(1))
    return 1045


BACKTOP_SEL, BACKTOP_BODY = _rule_for('navBackTop')
PET_SEL, PET_BODY = _rule_for('navPet')
BULK_SEL, BULK_BODY = _rule_for('navMsBar')

BACKTOP_Z = _z_index(BACKTOP_BODY)
PET_Z = _z_index(PET_BODY)
BULK_Z = _z_index(BULK_BODY)
DRAWER_Z = _drawer_z_index()


class BackTopZOrderTests(SimpleTestCase):
    """回顶 / 桌宠 / 多选条 / 抽屉 四者层级关系。"""

    def test_rules_present(self):
        """四条目标规则都能在 CSS 里解析到,防止选择器改名后断言空转。"""
        self.assertIsNotNone(BACKTOP_SEL, '未解析到 #navBackTop 规则')
        self.assertIsNotNone(PET_SEL, '未解析到 #navPet 规则')
        self.assertIsNotNone(BULK_SEL, '未解析到多选条(#navMsBar)规则')
        self.assertIsNotNone(BACKTOP_Z, '#navBackTop 缺少 z-index')
        self.assertIsNotNone(PET_Z, '#navPet 缺少 z-index')
        self.assertIsNotNone(BULK_Z, '多选条缺少 z-index')

    def test_backtop_above_pet(self):
        """回顶必须高于桌宠:128px 视频覆盖 42px 按钮,层级压过时点不到。"""
        self.assertGreater(BACKTOP_Z, PET_Z,
                            '回顶 z-index(%s)未高于桌宠 %s' % (BACKTOP_Z, PET_Z))

    def test_backtop_below_bulkbar(self):
        """回顶不得压过多选工具条;多选条激活态压住回顶属正确行为。"""
        self.assertLess(BACKTOP_Z, BULK_Z,
                        '回顶 z-index(%s)不应高于多选条 %s' % (BACKTOP_Z, BULK_Z))

    def test_backtop_below_drawer(self):
        """回顶不得压过设置抽屉;抽屉展开态压住回顶属正确行为。"""
        self.assertLess(BACKTOP_Z, DRAWER_Z,
                        '回顶 z-index(%s)不应高于设置抽屉 %s' % (BACKTOP_Z, DRAWER_Z))

    def test_backtop_in_fix_band(self):
        """回顶落在桌宠(1035)与抽屉(1045)之间的修复带,不得越界到多选条一侧。"""
        self.assertGreaterEqual(BACKTOP_Z, 1036)
        self.assertLessEqual(BACKTOP_Z, 1044)

    def test_ladder_values_recorded(self):
        """层级对照值可追溯:桌宠 1035 < 回顶 < 抽屉 1045 < 多选条 1055。"""
        self.assertEqual(PET_Z, 1035)
        self.assertEqual(BULK_Z, 1055)
        self.assertEqual(DRAWER_Z, 1045)


class BackTopGeometryTests(SimpleTestCase):
    """防顺手把回顶钮缩小 / 挪位;可点面积仍是 42×42、右下 24px。"""

    def test_geometry_unchanged(self):
        self.assertEqual(_prop(BACKTOP_BODY, 'right'), '24px')
        self.assertEqual(_prop(BACKTOP_BODY, 'bottom'), '24px')
        self.assertEqual(_prop(BACKTOP_BODY, 'width'), '42px')
        self.assertEqual(_prop(BACKTOP_BODY, 'height'), '42px')

    def test_safe_area_override_keeps_24px_baseline(self):
        """安全区覆盖段只加 env() 偏移,基准边距仍是 24px。"""
        safe = [body for sel, body in RULES
                if '#navBackTop' in sel and 'safe-area-inset' in body]
        self.assertEqual(len(safe), 1, '应仅有一处安全区覆盖段')
        self.assertIn('calc(24px + env(safe-area-inset-right', safe[0])
        self.assertIn('calc(24px + env(safe-area-inset-bottom', safe[0])

    def test_show_toggle_class_still_only_show(self):
        """显隐开关仍只认 .show,未另起一套显隐类。"""
        show_sel = [sel for sel, body in RULES
                    if '#navBackTop' in sel and '.show' in sel]
        self.assertTrue(show_sel, '缺少 #navBackTop.show 显隐规则')


class NoForbiddenBypassTests(SimpleTestCase):
    """禁止用隐藏桌宠 / 关桌宠指针事件 / 关回顶指针事件绕过命中缺陷。"""

    def test_pet_video_keeps_pointer_events(self):
        pet_video = [body for sel, body in RULES
                     if 'nav-pet-video' in sel]
        for body in pet_video:
            self.assertNotRegex(body, r'pointer-events\s*:\s*none',
                                '桌宠视频被关掉 pointer-events,会削弱桌宠交互')

    def test_backtop_pointer_events_not_disabled(self):
        self.assertNotRegex(BACKTOP_BODY, r'pointer-events\s*:\s*none')

    def test_pet_not_hidden_in_css(self):
        for prop in ('display', 'visibility'):
            val = _prop(PET_BODY, prop)
            self.assertNotIn(val, ('none', 'hidden'))
