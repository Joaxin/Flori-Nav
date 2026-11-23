# nav/tests_nav_identity.py
"""单入口角色判定（2026-11-21）。

只跑本域：`python manage.py test nav.tests_nav_identity`。

契约：
- 没配 `NAV_WRITE_TOKEN` → `/nav/` 一直是主人页，本地开发零负担；
- 配了令牌 → 同一个 `/nav/`：带对令牌=主人页，没带/带错=访客只读页，URL 不变；
- 访客分支 0 查询，且 HTML 里不出现任何 `/api/nav/` 写接口；
- `/nav/guest/` 强制访客态，即使浏览器里有主人 cookie；
- 登录只走 POST，密码不落 URL。
"""

import os
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from .models import NavSite


TOKEN = 'owner-secret'


class NavIdentityTests(TestCase):
    def setUp(self):
        NavSite.objects.all().delete()
        # 放一条站点：既是主人页有内容可渲染，也避免 `_seed_nav_sites()` 拖慢用例
        NavSite.objects.create(name='身份测试站', url='https://id.example.com/',
                               category='工具', description='测试用')
        self._env_patch = mock.patch.dict(os.environ, {}, clear=False)
        self._env_patch.start()
        os.environ.pop('NAV_WRITE_TOKEN', None)
        self.addCleanup(self._env_patch.stop)

    def _enable_token(self, token=TOKEN):
        os.environ['NAV_WRITE_TOKEN'] = token

    def _is_owner_page(self, resp):
        # 访客态与主人页现在是同一套模板,唯一的稳定分界是模板输出的
        # `window.NAV_GUEST_MODE = true`;脚本里的属性名本身在主客两态都会出现。
        return b'window.NAV_GUEST_MODE = true;' not in resp.content

    # --- 未配置令牌:保持历史行为 -------------------------------------------
    def test_without_token_always_owner_page(self):
        resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, resp.status_code)
        self.assertTrue(self._is_owner_page(resp))
        self.assertNotIn(b'window.NAV_GUEST_MODE = true;', resp.content)

    # --- 配置令牌后的三种来源 ---------------------------------------------
    def test_same_url_falls_back_to_guest_without_token(self):
        self._enable_token()
        with self.assertNumQueries(0):
            resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, resp.status_code)
        self.assertFalse(self._is_owner_page(resp))
        self.assertIn(b'NAV_GUEST_MODE', resp.content)
        # 访客分支不查库:测试库里的这条站点不能出现在 HTML 里
        self.assertNotIn('身份测试站', resp.content.decode('utf-8'))

    def test_cookie_token_opens_owner_page(self):
        self._enable_token()
        self.client.cookies['nav_token'] = TOKEN
        resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, resp.status_code)
        self.assertTrue(self._is_owner_page(resp))
        self.assertContains(resp, '身份测试站')

    def test_header_token_opens_owner_page(self):
        self._enable_token()
        resp = self.client.get(reverse('nav_sites'), HTTP_X_NAV_WRITE_TOKEN=TOKEN)
        self.assertTrue(self._is_owner_page(resp))

    def test_query_token_opens_owner_page_and_sets_cookie(self):
        self._enable_token()
        resp = self.client.get(reverse('nav_sites'), {'nav_token': TOKEN})
        self.assertTrue(self._is_owner_page(resp))
        self.assertEqual(TOKEN, resp.cookies['nav_token'].value)

    def test_wrong_token_stays_guest(self):
        self._enable_token()
        self.client.cookies['nav_token'] = 'wrong'
        resp = self.client.get(reverse('nav_sites'))
        self.assertFalse(self._is_owner_page(resp))
        self.assertIn(b'NAV_GUEST_MODE', resp.content)

    def test_guest_branch_never_leaks_owner_data(self):
        """访客页不能出现数据库里的站点:它连库都不查,站点来自公开快照。"""
        self._enable_token()
        resp = self.client.get(reverse('nav_sites'))
        html = resp.content.decode('utf-8')
        self.assertNotIn('身份测试站', html)
        self.assertNotIn('https://id.example.com/', html)

    # --- 兼容入口 ----------------------------------------------------------
    def test_guest_route_stays_guest_even_with_owner_cookie(self):
        self._enable_token()
        self.client.cookies['nav_token'] = TOKEN
        with self.assertNumQueries(0):
            resp = self.client.get(reverse('nav_guest'))
        self.assertFalse(self._is_owner_page(resp))
        self.assertIn(b'NAV_GUEST_MODE', resp.content)

    # --- 登录 / 退出 -------------------------------------------------------
    def test_login_with_correct_token_sets_cookie(self):
        self._enable_token()
        resp = self.client.post(reverse('nav_login'), data='{"token": "%s"}' % TOKEN,
                                content_type='application/json')
        self.assertEqual(200, resp.status_code)
        self.assertEqual('success', resp.json()['status'])
        cookie = resp.cookies['nav_token']
        self.assertEqual(TOKEN, cookie.value)
        self.assertTrue(cookie['httponly'])
        self.assertEqual('Lax', cookie['samesite'])
        # 带上这个 cookie,同一个地址就是主人页
        self.client.cookies['nav_token'] = TOKEN
        self.assertTrue(self._is_owner_page(self.client.get(reverse('nav_sites'))))

    def test_login_form_post_also_works(self):
        self._enable_token()
        resp = self.client.post(reverse('nav_login'), {'token': TOKEN})
        self.assertEqual(200, resp.status_code)
        self.assertEqual(TOKEN, resp.cookies['nav_token'].value)

    def test_login_with_wrong_token_is_403(self):
        self._enable_token()
        resp = self.client.post(reverse('nav_login'), data='{"token": "nope"}',
                                content_type='application/json')
        self.assertEqual(403, resp.status_code)
        self.assertNotIn('nav_token', resp.cookies)

    def test_login_without_token_is_400(self):
        self._enable_token()
        resp = self.client.post(reverse('nav_login'), data='{}', content_type='application/json')
        self.assertEqual(400, resp.status_code)

    def test_login_when_token_not_configured(self):
        """没配令牌时不报错,直接告诉前端"不用登录";不写 cookie 也不重要。"""
        resp = self.client.post(reverse('nav_login'), data='{"token": "x"}',
                                content_type='application/json')
        self.assertEqual(200, resp.status_code)
        self.assertFalse(resp.json()['token_required'])

    def test_login_requires_post(self):
        self.assertEqual(405, self.client.get(reverse('nav_login')).status_code)

    def test_logout_clears_cookie(self):
        self._enable_token()
        self.client.cookies['nav_token'] = TOKEN
        resp = self.client.post(reverse('nav_logout'))
        self.assertEqual(200, resp.status_code)
        self.assertEqual('', resp.cookies['nav_token'].value)
        # 清掉之后同一个地址变回访客页
        self.client.cookies.pop('nav_token', None)
        self.assertFalse(self._is_owner_page(self.client.get(reverse('nav_sites'))))
