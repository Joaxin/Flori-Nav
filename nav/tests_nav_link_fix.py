# nav/tests_nav_link_fix.py
"""链接修复端点 /api/nav/link-fix/ 的服务端契约测试(2026-11-20)。

只测本端点:批量回填名称/分类/简介/标签与改网址;不碰测活链路,也不往访客闸门
白名单里加任何路径。写令牌由 config.middleware.WriteTokenMiddleware 统一覆盖,
本文件不重复判断令牌。
"""
import json
import os
from pathlib import Path
from unittest import mock

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import NavSite


def _post(client, payload, **extra):
    return client.post(reverse('api_nav_link_fix'), data=json.dumps(payload),
                       content_type='application/json', **extra)


class LinkFixPermissionTests(TestCase):
    """写令牌:开启后缺令牌 403,带头放行;中间件自动覆盖 /api/nav/ 下 POST。"""

    TOKEN = 's3cret-token'

    def setUp(self):
        self._env = mock.patch.dict(os.environ, {'NAV_WRITE_TOKEN': self.TOKEN})
        self._env.start()
        self.addCleanup(self._env.stop)
        NavSite.objects.create(name='权限站', url='https://perm.example', category='测试')

    def test_missing_token_forbidden(self):
        resp = _post(self.client, {'items': [{'id': 1, 'url': 'https://perm.example'}]})
        self.assertEqual(403, resp.status_code)

    def test_header_token_allows_write(self):
        resp = _post(self.client, {'items': [{'id': 1, 'url': 'https://perm.example',
                                              'name': '权限站改'}]},
                     HTTP_X_NAV_WRITE_TOKEN=self.TOKEN)
        self.assertEqual(200, resp.status_code)
        self.assertEqual('success', resp.json()['status'])


class LinkFixValidationTests(TestCase):
    """入参校验:空数组 / 超上限 400;单条非法网址只失败该条,不炸整批。"""

    def test_empty_items_rejected(self):
        resp = _post(self.client, {'items': []})
        self.assertEqual(400, resp.status_code)
        self.assertIn('items', resp.json()['message'])

    def test_too_many_items_rejected(self):
        items = [{'id': i, 'url': f'https://s{i}.example'} for i in range(51)]
        resp = _post(self.client, {'items': items})
        self.assertEqual(400, resp.status_code)
        self.assertIn('50', resp.json()['message'])

    def test_invalid_scheme_only_fails_that_item(self):
        NavSite.objects.create(name='甲', url='https://a.example', category='测试')
        NavSite.objects.create(name='乙', url='https://b.example', category='测试')
        resp = _post(self.client, {'items': [
            {'id': 1, 'url': 'https://a.example', 'new_url': 'ftp://x.example'},
            {'id': 2, 'url': 'https://b.example', 'name': '乙改'},
        ]})
        self.assertEqual(200, resp.status_code)
        body = resp.json()
        self.assertEqual(body['updated'], 1)
        self.assertEqual(body['failed'], 1)
        by_id = {r['id']: r for r in body['results']}
        self.assertFalse(by_id[1]['ok'])
        self.assertIn('http/https', by_id[1]['message'])
        self.assertTrue(by_id[2]['ok'])


class LinkFixConflictTests(TestCase):
    """网址冲突:占用其它站点 / 批次内重复目标,都按对应消息判失败。"""

    def setUp(self):
        self.a = NavSite.objects.create(name='甲', url='https://a.example', category='测试')
        self.b = NavSite.objects.create(name='乙', url='https://b.example', category='测试')

    def test_target_occupied_by_other_site(self):
        resp = _post(self.client, {'items': [
            {'id': self.a.id, 'url': 'https://a.example', 'new_url': 'https://b.example'}]})
        self.assertEqual(200, resp.status_code)
        r = resp.json()['results'][0]
        self.assertFalse(r['ok'])
        self.assertEqual('该网址已被其它站点占用', r['message'])
        self.a.refresh_from_db()
        self.assertEqual('https://a.example', self.a.url)

    def test_batch_internal_conflict_first_come_first_served(self):
        resp = _post(self.client, {'items': [
            {'id': self.a.id, 'url': 'https://a.example', 'new_url': 'https://c.example'},
            {'id': self.b.id, 'url': 'https://b.example', 'new_url': 'https://c.example'},
        ]})
        self.assertEqual(200, resp.status_code)
        results = resp.json()['results']
        self.assertTrue(results[0]['ok'])
        self.assertFalse(results[1]['ok'])
        self.assertEqual('与本次批次内其它条目冲突', results[1]['message'])


class LinkFixPreservedFieldsTests(TestCase):
    """成功回填后:点击数 / 归档 / 体检记录 / 创建时间 / 内置标记一律原样保留。"""

    def setUp(self):
        self.site = NavSite.objects.create(
            name='保留站', url='https://keep.example', category='测试',
            click_count=7, archived_at=timezone.now(),
            last_check_at=timezone.now(), last_check_ok=False,
            last_check_note='坏链', last_check_code=500, last_check_ms=1234)

    def test_protected_fields_untouched_after_url_change(self):
        before = {
            'click_count': self.site.click_count,
            'archived_at': self.site.archived_at,
            'last_check_at': self.site.last_check_at,
            'last_check_ok': self.site.last_check_ok,
            'last_check_note': self.site.last_check_note,
            'last_check_code': self.site.last_check_code,
            'last_check_ms': self.site.last_check_ms,
        }
        resp = _post(self.client, {'items': [
            {'id': self.site.id, 'url': 'https://keep.example',
             'new_url': 'https://keep2.example', 'name': '保留站改'}]})
        self.assertEqual(200, resp.status_code)
        self.assertTrue(resp.json()['results'][0]['ok'])
        self.site.refresh_from_db()
        self.assertEqual('https://keep2.example', self.site.url)
        for field, value in before.items():
            self.assertEqual(getattr(self.site, field), value, f'{field} 被误改')


class LinkFixFillOverwriteTests(TestCase):
    """overwrite=False 只补空;overwrite=True 才覆盖已有值。"""

    def test_fill_only_when_empty(self):
        site = NavSite.objects.create(name='', url='https://fill.example',
                                       category='', description='')
        resp = _post(self.client, {'overwrite': False, 'items': [
            {'id': site.id, 'url': 'https://fill.example',
             'name': '新名', 'description': '新简介', 'category': '新分类'}]})
        self.assertEqual(200, resp.status_code)
        site.refresh_from_db()
        self.assertEqual('新名', site.name)
        self.assertEqual('新简介', site.description)
        self.assertEqual('新分类', site.category)

    def test_overwrite_false_keeps_existing_description(self):
        site = NavSite.objects.create(name='旧名', url='https://ow0.example',
                                       category='测试', description='旧简介')
        _post(self.client, {'overwrite': False, 'items': [
            {'id': site.id, 'url': 'https://ow0.example', 'description': '新简介'}]})
        site.refresh_from_db()
        self.assertEqual('旧简介', site.description)

    def test_overwrite_true_replaces_description(self):
        site = NavSite.objects.create(name='旧名', url='https://ow1.example',
                                       category='测试', description='旧简介')
        _post(self.client, {'overwrite': True, 'items': [
            {'id': site.id, 'url': 'https://ow1.example', 'description': '新简介'}]})
        site.refresh_from_db()
        self.assertEqual('新简介', site.description)


class LinkFixSnapshotTests(TestCase):
    """前端快照过期:带来的旧网址与库内当前网址不一致时拒绝该条。"""

    def test_stale_snapshot_rejected(self):
        site = NavSite.objects.create(name='快照站', url='https://stale.example', category='测试')
        resp = _post(self.client, {'items': [
            {'id': site.id, 'url': 'https://stale-old.example', 'name': '改名'}]})
        self.assertEqual(200, resp.status_code)
        r = resp.json()['results'][0]
        self.assertFalse(r['ok'])
        self.assertEqual('网址已变更,请重新预览', r['message'])
        site.refresh_from_db()
        self.assertEqual('快照站', site.name)


class LinkFixGuestGateTests(TestCase):
    """访客闸门白名单是 GET 只读清单;本端点不得出现在 GUEST_PUBLIC_GET 段内。"""

    def test_not_in_guest_public_get_whitelist(self):
        template = (Path(__file__).resolve().parent / 'templates' / 'nav' /
                    'nav_sites.html').read_text(encoding='utf-8')
        start = template.index('var GUEST_PUBLIC_GET = [')
        end = template.index('];', start)
        block = template[start:end]
        self.assertNotIn('/api/nav/link-fix/', block)
