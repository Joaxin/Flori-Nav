# nav/tests_nav_seed_guard.py
"""内置种子不得覆盖用户自己的同 URL 条目(2026-11-12)。

内置精简到 10 条、统一放「内置网站」分类后,「恢复内置」仍会按 URL upsert。
如果用户早就自己收录了同一个网址(改过名字/分类),种子不能把它抢过去。
"""

from django.test import TestCase

from .models import NavSite
from .nav_data import DEFAULT_SITES
from .views_nav_base import _seed_nav_sites


class SeedGuardTests(TestCase):
    def test_user_row_with_same_url_is_untouched(self):
        seed = DEFAULT_SITES[0]
        mine = NavSite.objects.create(name='我的 ChatGPT', url=seed['url'],
                                      category='我的工具', subcat='常用',
                                      description='自己写的备注', is_builtin=False)
        _seed_nav_sites()
        mine.refresh_from_db()
        self.assertEqual('我的 ChatGPT', mine.name)
        self.assertEqual('我的工具', mine.category)
        self.assertEqual('常用', mine.subcat)
        self.assertEqual('自己写的备注', mine.description)
        self.assertFalse(mine.is_builtin)
        self.assertEqual(1, NavSite.objects.filter(url=seed['url']).count())

    def test_builtin_row_is_refreshed(self):
        seed = DEFAULT_SITES[0]
        NavSite.objects.create(name='旧名字', url=seed['url'],
                               category='旧分类', is_builtin=True)
        _seed_nav_sites()
        row = NavSite.objects.get(url=seed['url'])
        self.assertEqual(seed['name'], row.name)
        self.assertEqual(seed['category'], row.category)

    def test_all_seeds_share_one_flat_category(self):
        _seed_nav_sites()
        self.assertEqual({'内置网站'}, set(NavSite.objects.values_list('category', flat=True)))
        # 平铺:不再分二级分类,否则目录里又会多一层分组
        self.assertEqual({''}, set(NavSite.objects.values_list('subcat', flat=True)))
        self.assertEqual(len(DEFAULT_SITES), NavSite.objects.count())
