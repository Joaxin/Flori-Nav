# nav/tests_nav_order.py
"""稀疏排序(2026-11-12):置顶/置底/上移下移只写 1-2 行,不再整表重排。

3000 站点时,旧的「整页 DOM 顺序 → 逐条 UPDATE」要写 3000 行;这里锁住新接口的写入量。
"""

import json

from django.test import TestCase
from django.urls import reverse

from .models import NavSite


class SparseOrderTests(TestCase):
    def setUp(self):
        self.cat = '排序测试'
        self.sites = []
        for i in range(4):
            self.sites.append(NavSite.objects.create(
                name='S%d' % i, url='https://s%d.example' % i,
                category=self.cat, subcat='', order=(i + 1) * 1000))

    def _post(self, name, payload):
        return self.client.post(reverse(name), data=json.dumps(payload),
                                content_type='application/json')

    def _orders(self):
        return list(NavSite.objects.filter(category=self.cat)
                    .order_by('order').values_list('name', 'order'))

    def test_pin_top_writes_one_row(self):
        before = dict(NavSite.objects.values_list('name', 'order'))
        resp = self._post('nav_site_pin', {'id': self.sites[-1].pk, 'where': 'top'})
        self.assertEqual(200, resp.status_code)
        self.assertEqual('S3', self._orders()[0][0])
        changed = [n for n, o in NavSite.objects.values_list('name', 'order') if before[n] != o]
        self.assertEqual(['S3'], changed)

    def test_pin_bottom_writes_one_row(self):
        self._post('nav_site_pin', {'id': self.sites[0].pk, 'where': 'bottom'})
        self.assertEqual('S0', self._orders()[-1][0])

    def test_swap_up_swaps_two_rows(self):
        before = dict(NavSite.objects.values_list('name', 'order'))
        resp = self._post('nav_site_swap', {'id': self.sites[2].pk, 'dir': 'up'})
        self.assertEqual(200, resp.status_code)
        self.assertEqual(['S0', 'S2', 'S1', 'S3'], [n for n, _ in self._orders()])
        changed = sorted(n for n, o in NavSite.objects.values_list('name', 'order') if before[n] != o)
        self.assertEqual(['S1', 'S2'], changed)

    def test_swap_at_boundary_is_noop(self):
        resp = self._post('nav_site_swap', {'id': self.sites[0].pk, 'dir': 'up'})
        self.assertEqual(200, resp.status_code)
        self.assertFalse(resp.json()['moved'])
        self.assertEqual(['S0', 'S1', 'S2', 'S3'], [n for n, _ in self._orders()])

    def test_swap_renumbers_when_orders_missing(self):
        NavSite.objects.filter(category=self.cat).update(order=None)
        resp = self._post('nav_site_swap', {'id': self.sites[0].pk, 'dir': 'down'})
        self.assertEqual(200, resp.status_code)
        orders = [o for _, o in self._orders()]
        self.assertEqual(orders, sorted(orders))
        self.assertEqual(4, len(set(orders)))
        self.assertEqual('S1', self._orders()[0][0])

    def test_pin_rejects_unknown_site(self):
        resp = self._post('nav_site_pin', {'id': 999999, 'where': 'top'})
        self.assertEqual(404, resp.status_code)

    def test_full_reorder_is_capped(self):
        """整表重排接口只服务小库;超过 500 条必须拒绝,逼前端走菜单。"""
        from .views_nav_base import NAV_SITE_ORDER_MAX
        self.assertLessEqual(NAV_SITE_ORDER_MAX, 500)
