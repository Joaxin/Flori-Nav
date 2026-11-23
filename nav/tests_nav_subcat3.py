# nav/tests_nav_subcat3.py
"""三级分类(2026-11-12):大类 → 二级 → 三级。

存储层沿用「小分类含分隔符即视为有子级」的既有约定(二级 + " / " + 三级),
所以这里既测新表单字段 subcat2 的合成,也测旧数据(单级小分类)完全不受影响。
"""

import json
import pathlib

from django.conf import settings
from django.test import TestCase
from django.urls import reverse


def static_text(rel):
    return (pathlib.Path(settings.BASE_DIR) / 'nav' / 'static' / rel).read_text(encoding='utf-8')

from .models import NavSite
from .views_nav_base import _compose_nav_subcat


class ComposeSubcatTests(TestCase):
    """二级/三级 → 存储串。"""

    def test_parent_and_leaf_joined(self):
        self.assertEqual('视频 / 图生视频', _compose_nav_subcat('视频', '图生视频'))

    def test_leaf_only_falls_back_to_second_level(self):
        self.assertEqual('图生视频', _compose_nav_subcat('', '图生视频'))

    def test_parent_only_unchanged(self):
        self.assertEqual('视频', _compose_nav_subcat('视频', ''))

    def test_blank_both(self):
        self.assertEqual('', _compose_nav_subcat('   ', '  '))

    def test_composite_fits_field_limit(self):
        out = _compose_nav_subcat('二' * 40, '三' * 40)
        self.assertLessEqual(len(out), 50)
        self.assertIn(' / ', out)
        self.assertTrue(out.endswith('三'))     # 截断不能把三级整个吃掉


class Subcat3ApiTests(TestCase):
    """新增/编辑接口接受 subcat2。"""

    def _post(self, name, payload):
        return self.client.post(reverse(name), data=json.dumps(payload),
                                content_type='application/json')

    def test_add_with_third_level(self):
        resp = self._post('nav_add', {'name': '可灵', 'url': 'https://kling.example',
                                      'category': '多模态生成',
                                      'subcat': '视频', 'subcat2': '图生视频'})
        self.assertEqual(200, resp.status_code)
        self.assertEqual('视频 / 图生视频', NavSite.objects.get().subcat)

    def test_edit_with_third_level(self):
        site = NavSite.objects.create(name='S', url='https://s.example',
                                      category='多模态生成', subcat='视频')
        resp = self._post('nav_edit', {'id': site.id, 'name': 'S', 'url': 'https://s.example',
                                       'category': '多模态生成',
                                       'subcat': '视频', 'subcat2': '文生视频'})
        self.assertEqual(200, resp.status_code)
        site.refresh_from_db()
        self.assertEqual('视频 / 文生视频', site.subcat)

    def test_edit_back_to_two_levels_clears_third(self):
        site = NavSite.objects.create(name='S', url='https://s2.example',
                                      category='多模态生成', subcat='视频 / 图生视频')
        self._post('nav_edit', {'id': site.id, 'name': 'S', 'url': 'https://s2.example',
                                'category': '多模态生成', 'subcat': '视频', 'subcat2': ''})
        site.refresh_from_db()
        self.assertEqual('视频', site.subcat)


class Subcat3RenderTests(TestCase):
    """页面按 大类 → 二级 → 三级 渲染,且两级数据仍走老分支。"""

    def setUp(self):
        NavSite.objects.create(name='可灵', url='https://kling.example',
                               category='多模态生成', subcat='视频 / 图生视频')
        NavSite.objects.create(name='即梦', url='https://jimeng.example',
                               category='多模态生成', subcat='视频 / 文生视频')
        NavSite.objects.create(name='Midjourney', url='https://mj.example',
                               category='多模态生成', subcat='图像')

    def test_group_builds_parent_leaf_tree(self):
        page = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, page.status_code)
        group = next(g for g in page.context['groups'] if g['category'] == '多模态生成')
        self.assertIsNotNone(group['tree'])
        parents = {node['parent']: node for node in group['tree']}
        self.assertEqual({'图像', '视频'}, set(parents))
        video = parents['视频']
        self.assertEqual(2, video['count'])
        self.assertEqual(['图生视频', '文生视频'], [lv['leaf'] for lv in video['leaves']])
        self.assertEqual('视频 / 图生视频', video['leaves'][0]['full'])

    def test_html_has_three_level_anchors(self):
        html = self.client.get(reverse('nav_sites')).content.decode()
        self.assertIn('data-collapse-id="多模态生成/视频"', html)
        self.assertIn('data-collapse-id="多模态生成/视频 / 图生视频"', html)
        self.assertIn('navSub2', html)          # 三级锚点前缀
        self.assertIn('图生视频', html)
        self.assertIn('文生视频', html)

    def test_two_level_category_keeps_flat_branch(self):
        NavSite.objects.all().delete()
        NavSite.objects.create(name='X', url='https://x.example',
                               category='工具', subcat='搜索')
        page = self.client.get(reverse('nav_sites'))
        group = next(g for g in page.context['groups'] if g['category'] == '工具')
        self.assertIsNone(group['tree'])
        self.assertEqual('搜索', group['items'][1][0])

    def test_toc_lists_third_level(self):
        """目录里三级分类要有入口,并且能关掉。"""
        html = self.client.get(reverse('nav_sites')).content.decode()
        self.assertIn('toc-sub3', html)
        self.assertIn('图生视频', html)
        self.assertIn('id="tocShowSub3"', html)
        self.assertIn('hide-sub3', static_text('js/nav-sites.js'))

    def test_subcat_datalist_carries_composite(self):
        html = self.client.get(reverse('nav_sites')).content.decode()
        self.assertIn('视频 / 图生视频', html)      # navCatSubs JSON 里带完整串,前端再拆两级
