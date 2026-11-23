# -*- coding: utf-8 -*-
"""nav_sites 里两块纯逻辑的直接单测:分类索引 与 三级树。

这两段原来埋在 117 行的视图里,只有"请求一次页面看渲染结果"才能验证;
三级树的锚点编号 / 计数 / 折叠键尤其容易在改动中悄悄错位。
"""
from types import SimpleNamespace

from django.test import SimpleTestCase

from .views_nav_sites import _build_subcat_tree, _collect_site_index


def make_site(url, category='工具', subcat='', alternates=None, children=None,
              pk=1, name=None):
    return SimpleNamespace(url=url, category=category, subcat=subcat,
                           alternates=alternates or [], children=children or [],
                           pk=pk, name=name or url)


class CollectSiteIndexTests(SimpleTestCase):
    def test_groups_by_category_then_subcat(self):
        sites = [make_site('a.com', subcat=''), make_site('b.com', subcat='初询'),
                 make_site('c.com', category='素材', subcat='图')]
        by_cat, _, _, _, _ = _collect_site_index(sites)
        self.assertEqual(['工具', '素材'], list(by_cat))
        self.assertEqual(['', '初询'], list(by_cat['工具']))
        self.assertEqual(['图'], list(by_cat['素材']))

    def test_site_map_maps_url_to_id_and_name(self):
        _, _, _, _, site_map = _collect_site_index(
            [make_site('a.com', pk=7, name='甲站')])
        self.assertEqual({'id': 7, 'name': '甲站'}, site_map['a.com'])

    def test_cat_urls_include_alternates_and_dedupe(self):
        sites = [
            make_site('a.com', alternates=[{'url': 'a.cn'}, {'url': 'a.com'}]),
            make_site('b.com', alternates=[{'url': 'a.cn'}]),
        ]
        _, cat_urls, _, _, _ = _collect_site_index(sites)
        self.assertEqual(['a.com', 'a.cn', 'b.com'], cat_urls['工具'])

    def test_alternates_with_bad_shape_are_ignored(self):
        sites = [make_site('a.com', alternates=['裸字符串', {'no_url': 1}, {'url': ''}])]
        _, cat_urls, _, _, _ = _collect_site_index(sites)
        self.assertEqual(['a.com'], cat_urls['工具'])

    def test_child_urls_go_to_separate_bucket(self):
        sites = [make_site('a.com', children=[{'url': 'a.com/p1'}, {'url': 'a.com/p2'}])]
        _, cat_urls, child_urls, _, _ = _collect_site_index(sites)
        self.assertEqual(['a.com'], cat_urls['工具'])
        self.assertEqual(['a.com/p1', 'a.com/p2'], child_urls['工具'])

    def test_cat_subs_skips_empty_subcat(self):
        sites = [make_site('a.com', subcat=''), make_site('b.com', subcat='初询'),
                 make_site('c.com', subcat='初询')]
        _, _, _, cat_subs, _ = _collect_site_index(sites)
        self.assertEqual({'初询'}, cat_subs['工具'])

    def test_empty_input(self):
        by_cat, cat_urls, child_urls, cat_subs, site_map = _collect_site_index([])
        self.assertEqual({}, by_cat)
        self.assertEqual({}, cat_urls)
        self.assertEqual({}, child_urls)
        self.assertEqual({}, cat_subs)
        self.assertEqual({}, site_map)


class BuildSubcatTreeTests(SimpleTestCase):
    def test_none_when_no_separator(self):
        self.assertIsNone(_build_subcat_tree({'': [], '初询': []}, 1))

    def test_none_when_only_empty_subcat(self):
        self.assertIsNone(_build_subcat_tree({'': []}, 1))

    def test_parent_leaf_split_with_counts(self):
        subs = {'Google / 搜索': [1, 2], 'Google / 地图': [3], 'Bing / 搜索': [4]}
        tree = _build_subcat_tree(subs, 2)
        self.assertEqual(['Bing', 'Google'], [n['parent'] for n in tree])
        self.assertEqual(1, tree[0]['count'])
        self.assertEqual(3, tree[1]['count'])
        self.assertEqual('navSub2_1', tree[0]['anchor'])
        self.assertEqual('navSub2_2', tree[1]['anchor'])

    def test_leaf_anchors_are_numbered_within_parent(self):
        subs = {'A / 子一': [1], 'A / 子二': [2]}
        tree = _build_subcat_tree(subs, 3)
        leaves = tree[0]['leaves']
        self.assertEqual(['子一', '子二'], [leaf['leaf'] for leaf in leaves])
        self.assertEqual('navSub23_1_1', leaves[0]['anchor'])
        self.assertEqual('navSub23_1_2', leaves[1]['anchor'])
        self.assertEqual('A / 子一', leaves[0]['full'])

    def test_direct_sites_become_first_node_with_empty_anchor(self):
        subs = {'': [9, 10], 'A / 子': [1]}
        tree = _build_subcat_tree(subs, 1)
        self.assertEqual('', tree[0]['parent'])
        self.assertEqual(2, tree[0]['count'])
        self.assertEqual('', tree[0]['anchor'])
        self.assertEqual('', tree[0]['leaves'][0]['leaf'])
        self.assertEqual('navSub1_2', tree[1]['anchor'])   # 直属站点占了第 1 位

    def test_parent_without_separator_keeps_empty_leaf(self):
        # 「Google」这类没写子级的名字整名当父级,leaf 为空 → 不生成折叠键与二级锚点
        subs = {'Google': [1, 2], 'Google / 地图': [3]}
        tree = _build_subcat_tree(subs, 1)
        node = tree[0]
        self.assertEqual('Google', node['parent'])
        self.assertEqual(3, node['count'])
        empty_leaves = [leaf for leaf in node['leaves'] if leaf['leaf'] == '']
        self.assertEqual(1, len(empty_leaves))
        self.assertEqual('Google', empty_leaves[0]['full'])
        self.assertEqual('', empty_leaves[0]['anchor'])
        # 空 leaf 排在第一位
        self.assertEqual('', node['leaves'][0]['leaf'])

    def test_gt_separator_also_works(self):
        tree = _build_subcat_tree({'甲 > 乙': [1]}, 1)
        self.assertEqual('甲', tree[0]['parent'])
        self.assertEqual('乙', tree[0]['leaves'][0]['leaf'])
