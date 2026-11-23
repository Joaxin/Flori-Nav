# -*- coding: utf-8 -*-
"""2026-11-14 审查修复的回归测试。

这些用例盯的是"修好的隐性 bug 不许被改回去":
输入法守卫、下拉 auto-close、SSRF 逐跳校验、写令牌比较、缓存版本、内联事件。

约定:前端部分仍是源码契约断言(项目没有 JS 运行器);后端部分尽量做成真行为测试。
"""

import os
from unittest.mock import patch, MagicMock

from django.conf import settings
from django.test import TestCase, SimpleTestCase

from config.middleware import _token_eq
from nav.views_nav_base import _safe_get


def static_text(rel):
    base = os.path.join(settings.BASE_DIR, 'nav', 'static')
    with open(os.path.join(base, rel), encoding='utf-8') as fh:
        return fh.read()


class ImeCompositionTests(SimpleTestCase):
    """中文输入法:候选窗开着时,↑↓/Enter/Esc 不能被搜索框抢走。"""

    def test_search_box_ignores_composition_keys(self):
        js = static_text('js/nav-search.js')
        self.assertIn('isComposing', js)
        self.assertIn("'compositionstart'", js)
        self.assertIn("'compositionend'", js)
        self.assertIn("if (composing || (e.originalEvent && e.originalEvent.isComposing)) return;", js)

    def test_card_keyboard_nav_ignores_composition(self):
        js = static_text('js/stars-filter.js')
        self.assertIn('if (e.isComposing || e.keyCode === 229) return;', js)


class SearchPanelIndexTests(SimpleTestCase):
    """搜索建议复用 stars-filter 的内存索引,不再每次按键全量扫 DOM。"""

    def test_index_is_exposed(self):
        self.assertIn('window.navFilterIndex = navFilterIndex;', static_text('js/stars-filter.js'))

    def test_panel_uses_index_with_dom_fallback(self):
        js = static_text('js/nav-search.js')
        self.assertIn('window.navFilterIndex', js)
        self.assertIn('function cardPool()', js)
        self.assertIn("$('.nav-hub [data-site-item]').each", js)   # 索引缺失时的兜底仍在

    def test_panel_render_is_coalesced(self):
        js = static_text('js/nav-search.js')
        self.assertIn('requestAnimationFrame', js)
        self.assertIn('flushRender', js)


class DropdownAutoCloseTests(SimpleTestCase):
    """垫片必须实现 data-bs-auto-close,并按它决定点条目后收不收。"""

    def test_shim_reads_auto_close(self):
        js = static_text('bootstrap-shim.js')
        self.assertIn('data-bs-auto-close', js)
        self.assertIn('_uiAutoClose', js)
        self.assertIn("(m._uiAutoClose || 'true') === 'true'", js)

    def test_closing_menu_fires_events_and_syncs_aria(self):
        js = static_text('bootstrap-shim.js')
        self.assertIn('function closeMenu(menu)', js)
        self.assertIn("uiFire(menu, 'hide.bs.dropdown')", js)
        self.assertIn("uiFire(menu, 'hidden.bs.dropdown')", js)
        self.assertIn("setAttribute('aria-expanded', 'false')", js)

    def test_no_manual_body_click_hack(self):
        js = static_text('js/nav-sites.js')
        self.assertNotIn('document.body.click()', js)


class SsrfRedirectTests(SimpleTestCase):
    """出站请求必须逐跳校验,不能被 302 带去内网。"""

    def _resp(self, status, location=None):
        resp = MagicMock()
        resp.status_code = status
        resp.headers = {'Location': location} if location else {}
        return resp

    def test_redirect_to_private_ip_is_blocked(self):
        # 首跳放行(不想在测试里依赖 DNS),第二跳的 127.0.0.1 必须被拦下
        def fake_guard(url):
            if '127.0.0.1' in url:
                raise ValueError('不允许访问内网地址')
            return url

        with patch('nav.views_nav_base._guard_public_url', side_effect=fake_guard):
            with patch('requests.get', return_value=self._resp(302, 'http://127.0.0.1:8080/')) as get:
                with self.assertRaises(ValueError):
                    _safe_get('http://example.com/', timeout=1)
                self.assertEqual(1, get.call_count)

    @patch('nav.views_nav_base._guard_public_url', side_effect=lambda u: u)
    def test_redirect_is_followed_hop_by_hop(self, _guard):
        seq = [self._resp(302, 'http://example.com/b'), self._resp(200)]
        with patch('requests.get', side_effect=seq) as get:
            resp = _safe_get('http://example.com/a', timeout=1)
            self.assertEqual(200, resp.status_code)
            self.assertEqual(2, get.call_count)
            self.assertEqual('http://example.com/b', get.call_args_list[1][0][0])

    def test_meta_fetch_uses_safe_get(self):
        src = open(os.path.join(settings.BASE_DIR, 'nav', 'views_nav_sites.py'), encoding='utf-8').read()
        self.assertIn('_safe_get(url, timeout=8', src)
        assets = open(os.path.join(settings.BASE_DIR, 'nav', 'views_nav_assets.py'), encoding='utf-8').read()
        self.assertIn('_safe_get(url, timeout=6', assets)
        self.assertIn('_safe_get(meta[\'url\'], timeout=12', assets)


class WriteTokenTests(SimpleTestCase):
    """令牌比较要常量时间,cookie 要 HttpOnly。"""

    def test_token_compare_is_constant_time(self):
        self.assertTrue(_token_eq('abc', 'abc'))
        self.assertFalse(_token_eq('abc', 'abd'))
        self.assertFalse(_token_eq('', 'abc'))

    def test_middleware_uses_httponly_cookie(self):
        src = open(os.path.join(settings.BASE_DIR, 'config', 'middleware.py'), encoding='utf-8').read()
        self.assertIn('httponly=True', src)
        self.assertIn('hmac.compare_digest', src)


class CacheAndSwTests(SimpleTestCase):
    def test_static_version_only_scans_app_static(self):
        src = open(os.path.join(settings.BASE_DIR, 'config', 'context_processors.py'), encoding='utf-8').read()
        self.assertNotIn("'nav' / 'static', settings.BASE_DIR / 'static'", src)
        self.assertIn("> 2", src)

    def test_sw_skips_favicons_and_range(self):
        src = open(os.path.join(settings.BASE_DIR, 'nav', 'views_nav_tools.py'), encoding='utf-8').read()
        self.assertIn("url.pathname.startsWith('/nav-fav/')", src)
        self.assertIn("req.headers.get('range')", src)


class InlineHandlerTests(TestCase):
    """模板里不许再有内联 onclick:统一走 data-on-click 委托。"""

    def test_rendered_page_has_no_inline_onclick(self):
        resp = self.client.get('/nav/')
        html = resp.content.decode('utf-8')
        self.assertNotIn('onclick=', html)
        self.assertIn('data-on-click="navAiOpen"', html)
        self.assertIn('data-on-click="toggle"', html)
        self.assertIn('data-on-click="copy-value"', html)

    def test_dispatcher_exists(self):
        js = static_text('js/nav-sites.js')
        self.assertIn("[data-on-click]", js)
        self.assertIn("act === 'toggle'", js)


class HelpBubbleRemovedTests(SimpleTestCase):
    """问号说明已并入统一 tooltip,不该再有第三套气泡。"""

    def test_help_bubble_gone(self):
        self.assertNotIn('nav-help-bubble', static_text('js/nav-sites.js'))
        self.assertNotIn('.nav-help-bubble {', static_text('css/nav-sites.css'))

    def test_help_icons_use_data_tip(self):
        with open(os.path.join(settings.BASE_DIR, 'nav', 'templates', 'nav', 'nav_sites.html'),
                  encoding='utf-8') as fh:
            html = fh.read()
        self.assertNotIn('data-help=', html)
