# nav/tests_nav_security.py
"""后端加固(2026-11-12):测活出站 SSRF 防护 + 可选写令牌中间件。

只跑本域:`python manage.py test nav.tests_nav_security`。
全程 mock `socket.getaddrinfo` 与 `requests.get`,不打真实网络;写令牌用环境变量临时注入。
"""

import json
import os
import socket
from unittest import mock

from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from .views_nav_base import _guard_public_url


PUBLIC_IP = '93.184.216.34'      # example.com 段的公网地址(只用作 mock 返回值)


def _addrinfo(ip, family=socket.AF_INET):
    """构造一条 getaddrinfo 结果:只有第 5 项的地址位被真正读取。"""
    if family == socket.AF_INET6:
        return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (ip, 0, 0, 0))
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (ip, 0))


def _fake_dns(ip, family=socket.AF_INET):
    return mock.patch('nav.views_nav_base.socket.getaddrinfo',
                      return_value=[_addrinfo(ip, family)])


def _clear_private_net_env():
    """测试期间保证 NAV_ALLOW_PRIVATE_NET 不被外部环境影响。"""
    patcher = mock.patch.dict(os.environ, {}, clear=False)
    patcher.start()
    os.environ.pop('NAV_ALLOW_PRIVATE_NET', None)
    return patcher


class NavSsrfGuardTests(SimpleTestCase):
    """_guard_public_url:只放行 http/https + 公网 IP。"""

    def setUp(self):
        self._env = _clear_private_net_env()
        self.addCleanup(self._env.stop)

    def test_loopback_rejected(self):
        for url in ('http://127.0.0.1/admin', 'http://127.0.0.1:8080/',
                    'https://localhost:8000/', 'http://[::1]/'):
            with self.subTest(url=url):
                with self.assertRaises(ValueError) as ctx:
                    _guard_public_url(url)
                self.assertIn('内网', str(ctx.exception))

    def test_private_and_link_local_rejected(self):
        # 10.0.0.5 是任务点名的内网段;169.254.169.254 是云元数据服务
        for url in ('http://10.0.0.5/', 'http://192.168.1.1/',
                    'http://169.254.169.254/latest/meta-data', 'http://172.16.0.1/'):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    _guard_public_url(url)

    def test_non_http_scheme_rejected(self):
        for url in ('javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com/x',
                    'data:text/html,<b>x</b>'):
            with self.subTest(url=url):
                with self.assertRaises(ValueError) as ctx:
                    _guard_public_url(url)
                self.assertIn('http', str(ctx.exception))

    def test_public_url_passes_with_mocked_dns(self):
        with _fake_dns(PUBLIC_IP):
            self.assertEqual('https://example.com/a?b=1',
                             _guard_public_url('https://example.com/a?b=1'))

    def test_domain_resolving_to_private_ip_rejected(self):
        """域名不是免死金牌:解析结果是内网就拒绝(防 DNS 指向内网的绕过)。"""
        with _fake_dns('10.0.0.5'):
            with self.assertRaises(ValueError):
                _guard_public_url('https://looks-public.example/')

    def test_ipv6_private_and_mapped_rejected(self):
        with _fake_dns('fd00::1', socket.AF_INET6):
            with self.assertRaises(ValueError):
                _guard_public_url('https://v6.example/')
        with _fake_dns('::ffff:127.0.0.1', socket.AF_INET6):
            with self.assertRaises(ValueError):
                _guard_public_url('https://mapped.example/')

    def test_dns_failure_is_not_a_block(self):
        """解析不出来交给下游请求自然失败,不能在这里误判成"内网"。"""
        with mock.patch('nav.views_nav_base.socket.getaddrinfo',
                        side_effect=socket.gaierror('no dns')):
            self.assertEqual('https://nxdomain.example/', _guard_public_url('https://nxdomain.example/'))

    def test_allow_private_env_bypasses_ip_check(self):
        with mock.patch.dict(os.environ, {'NAV_ALLOW_PRIVATE_NET': '1'}):
            self.assertEqual('http://127.0.0.1:8000/',
                             _guard_public_url('http://127.0.0.1:8000/'))
        # 关掉开关后又该拒绝(scheme 白名单始终生效)
        with self.assertRaises(ValueError):
            _guard_public_url('http://127.0.0.1:8000/')

    def test_allow_private_flag_argument(self):
        self.assertEqual('http://10.0.0.5/', _guard_public_url('http://10.0.0.5/', allow_private=True))


class NavLinkCheckSsrfTests(TestCase):
    """测活入口:内网目标按 blocked 返回,不 500;重定向逐跳复检。"""

    def _post(self, urls):
        return self.client.post(reverse('nav_link_check'),
                                data=json.dumps({'urls': urls}),
                                content_type='application/json')

    def setUp(self):
        self._env = _clear_private_net_env()
        self.addCleanup(self._env.stop)

    def test_private_target_blocked_without_request(self):
        with mock.patch('nav.views.requests.get') as get:
            resp = self._post(['http://127.0.0.1:8000/', 'http://10.0.0.5/'])
        self.assertEqual(200, resp.status_code)      # 拦下来不是 500
        self.assertFalse(get.called)                 # 一个出站请求都不发
        for entry in resp.json()['results']:
            self.assertFalse(entry['ok'])
            self.assertTrue(entry.get('blocked'))
            self.assertIn('内网', entry['error'])

    def test_redirect_to_internal_blocked(self):
        redirect = mock.Mock(status_code=302, url='https://ok.example/',
                             headers={'Location': 'http://127.0.0.1:8080/admin'})
        redirect.close = mock.Mock()
        with mock.patch('nav.views.requests.get', return_value=redirect) as get:
            entry = self.client.post(reverse('nav_link_check'),
                                     data=json.dumps({'urls': ['https://ok.example/']}),
                                     content_type='application/json').json()['results'][0]
        self.assertEqual(1, get.call_count)          # 只请求了第一跳
        self.assertTrue(entry.get('blocked'))
        self.assertIn('内网', entry['error'])

    def test_redirect_chain_followed_up_to_limit(self):
        """公网 302 仍按原行为跟随(最多 3 跳),最终 200 判存活。"""
        hop = mock.Mock(status_code=302, url='https://a.example/',
                        headers={'Location': 'https://b.example/final'})
        hop.close = mock.Mock()
        final = mock.Mock(status_code=200, url='https://b.example/final', headers={})
        final.close = mock.Mock()
        with _fake_dns(PUBLIC_IP), \
                mock.patch('nav.views.requests.get', side_effect=[hop, final]):
            entry = self.client.post(reverse('nav_link_check'),
                                     data=json.dumps({'urls': ['https://a.example/']}),
                                     content_type='application/json').json()['results'][0]
        self.assertTrue(entry['ok'])
        self.assertEqual(200, entry['status'])


class NavWriteTokenTests(TestCase):
    """WriteTokenMiddleware:默认关闭;开启后写接口要令牌,读接口永远放行。"""

    TOKEN = 's3cret-token'

    def setUp(self):
        self._env = mock.patch.dict(os.environ, {'NAV_WRITE_TOKEN': self.TOKEN})
        self._env.start()
        self.addCleanup(self._env.stop)

    def _add(self, url='https://sec.example', **extra):
        payload = {'name': '安全测试站', 'url': url, 'category': '自定义'}
        return self.client.post(reverse('nav_add'), data=json.dumps(payload),
                                content_type='application/json', **extra)

    def test_missing_token_forbidden(self):
        resp = self._add()
        self.assertEqual(403, resp.status_code)
        self.assertEqual({'status': 'error', 'message': '未授权'}, resp.json())

    def test_wrong_token_forbidden(self):
        resp = self._add(HTTP_X_NAV_WRITE_TOKEN='wrong')
        self.assertEqual(403, resp.status_code)

    def test_header_token_allows_write(self):
        resp = self._add(HTTP_X_NAV_WRITE_TOKEN=self.TOKEN)
        self.assertEqual(200, resp.status_code)
        self.assertEqual('success', resp.json()['status'])

    def test_cookie_token_allows_write(self):
        self.client.cookies['nav_token'] = self.TOKEN
        self.assertEqual(200, self._add().status_code)

    def test_get_never_restricted(self):
        """GET 不会 403:没带令牌只是**降级成访客只读页**,不是拒绝访问。

        2026-11-21 单入口后,`/nav/` 的 GET 本身按角色分流(见 tests_nav_identity);
        这里守的是"读请求永不 403"这条底线,不再断言它一定是主人页。
        """
        resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, resp.status_code)

    def test_query_token_sets_cookie(self):
        resp = self.client.get(reverse('nav_sites'), {'nav_token': self.TOKEN})
        self.assertEqual(200, resp.status_code)
        cookie = resp.cookies['nav_token']
        self.assertEqual(self.TOKEN, cookie.value)
        self.assertTrue(cookie['httponly'])       # 前端从不读它,2026-11-14 改为 HttpOnly
        self.assertEqual('Lax', cookie['samesite'])

    def test_non_write_method_path_unaffected(self):
        """不在 /api/nav/ 前缀下的路径不受令牌影响。"""
        self.assertEqual(200, self.client.post('/healthz').status_code)

    def test_disabled_when_token_empty(self):
        with mock.patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}):
            self.assertEqual(200, self._add('https://sec-empty.example').status_code)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('NAV_WRITE_TOKEN', None)
            self.assertEqual(200, self._add('https://sec-unset.example').status_code)


class NavDeployHardeningTests(TestCase):
    """只读文件系统(Serverless)与测活入口硬化:失败要降级提示,不能 500。"""

    def test_link_check_rejects_get(self):
        """GET 不再能触发并发出站请求 + 写入体检记录。"""
        self.assertEqual(405, self.client.get(reverse('nav_link_check')).status_code)

    def test_icon_upload_readonly_returns_503(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        up = SimpleUploadedFile('i.png', b'\x89PNG\r\n\x1a\nreadonly', content_type='image/png')
        with override_settings(MEDIA_ROOT='/proc/nav-readonly-media'):
            resp = self.client.post(reverse('api_nav_icon_upload'), data={'file': up})
        self.assertEqual(503, resp.status_code)
        self.assertEqual('error', resp.json()['status'])

    def test_snapshot_write_readonly_returns_false(self):
        from django.test import override_settings
        from .signals import write_public_snapshot
        with override_settings(BASE_DIR='/proc/nav-readonly-base'):
            self.assertFalse(write_public_snapshot(force=True))
