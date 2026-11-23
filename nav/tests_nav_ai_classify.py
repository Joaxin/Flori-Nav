# nav/tests_nav_ai_classify.py
"""AI 分类 + 标签(2026-11-12)。

这块的产品约定(用户提出的):
  1. 一个模型调用同时给大类/小分类和标签;
  2. 前端只展示"建议调整"的条目,本来就对的藏掉 —— 这里测数据侧:老分类/老标签要一起返回,
     前端才有得比;
  3. 没配 AI 时提示词模式必须能独立工作(不碰 NavAiConfig);
  4. 应用只写被采纳的条目,空大类一律拒绝。

只跑本域:`python manage.py test nav.tests_nav_ai_classify`。
"""
from .tests_nav_common import (
    NavAiConfig,
    NavSite,
    TestCase,
    _json,
    json,
    mock,
    reverse,
)
from .ai import (AiNotConfigured, build_classify_prompts, build_site_prompts,
                 parse_classify_result)


class ClassifyPromptTests(TestCase):
    def test_prompt_carries_categories_tags_and_rows(self):
        items = [{'name': 'Figma', 'url': 'https://figma.com', 'category': '设计',
                  'tags': ['免费']}]
        system, user = build_classify_prompts(
            items, ['设计', 'AI 工具'], {'设计': ['素材', '配色']}, ['免费', '国产'])
        self.assertIn('设计 / AI 工具', user)
        self.assertIn('- 设计:素材、配色', user)
        self.assertIn('免费、国产', user)
        self.assertIn('1 | Figma | https://figma.com | 现分类:设计 | 现标签:免费', user)
        self.assertIn('"tags"', user)
        self.assertIn('"reason"', user)          # 改动原因随分类建议一起返回
        self.assertIn('只输出 JSON 数组', system)

    def test_prompt_carries_description_context(self):
        """简介进提示词(2026-11-19):只给名字,模型容易按字面猜分类;
        带上简介(截断)才能判断它到底干什么。没有简介时明确写「无」而不是留空。"""
        items = [{'name': 'Figma', 'url': 'https://figma.com', 'category': '设计',
                  'tags': [], 'description': '在线协作设计工具'},
                 {'name': '某站', 'url': 'https://b.example', 'category': '未分类',
                  'tags': [], 'description': ''}]
        _, user = build_classify_prompts(items, ['设计'], {}, ['免费'])
        self.assertIn('简介:在线协作设计工具', user)
        self.assertIn('简介:无', user)
        # 简介过长要截断,别把整段塞进提示词里烧 token
        long_item = {'name': '长站', 'url': 'https://c.example', 'category': '未分类',
                     'tags': [], 'description': '很' * 400}
        _, user2 = build_classify_prompts([long_item], ['设计'], {}, ['免费'])
        self.assertNotIn('很' * 200, user2)

    def test_prompt_enforces_closed_tag_vocab(self):
        """标签词表封闭(2026-11-18):只能从词表选、禁止自造词、允许空数组;
        种子白名单并入词表 —— 库里一条标签都没有时模型也有固定维度可选。"""
        system, user = build_classify_prompts(
            [{'name': 'X', 'url': 'https://x.example', 'category': '未分类', 'tags': []}],
            ['设计'], {}, ['免费'])
        self.assertIn('禁止自造词', system)
        self.assertIn('宁缺毋滥', system)
        self.assertIn('空数组', user)
        # 词表 = 已有标签在前 + 种子白名单在后(去重)
        self.assertIn('免费、开源、需代理、免登录、需订阅', user)
        self.assertIn('tags 可以为空数组', user)

    def test_parse_handles_fence_and_cleans_tags(self):
        raw = ('好的,结果如下:\n```json\n[{"i": 1, "category": " AI 工具 ", '
               '"subcat": "对话", "tags": ["国产", "国产", "免费", "需要科学上网的站"], '
               '"reason": "站点能力属于对话助手"},'
               '{"i": 9, "category": "越界"},{"i": 2, "category": ""}]\n```')
        out = parse_classify_result(raw, 2)
        self.assertEqual(1, len(out))
        self.assertEqual('AI 工具', out[0]['category'])
        self.assertEqual('对话', out[0]['subcat'])
        # 去重 + 单个标签截到 10 字
        self.assertEqual(['国产', '免费', '需要科学上网的站'[:10]], out[0]['tags'])
        self.assertEqual('站点能力属于对话助手', out[0]['reason'])

    def test_parse_rejects_garbage(self):
        with self.assertRaises(ValueError):
            parse_classify_result('模型拒绝回答', 3)


class SitePromptTests(TestCase):
    """「AI 找网站」提示词契约(2026-11-18 改版)。

    人设从旧版行业导航编辑改为通用选站编辑，领域由当次场景决定；
    新增:允许少给(宁缺毋滥写进 user prompt)、sub_options 传入对齐小分类命名。"""

    def test_prompt_has_no_legacy_persona(self):
        system, user = build_site_prompts(
            '免费的设计素材站', '搜索导航', count=5,
            existing_sites=[{'name': '旧站', 'url': 'https://old.example'}],
            sub_options=['素材', '配色'])
        self.assertIn('选站编辑', system)
        self.assertIn('宁缺毋滥', system)
        self.assertIn('可以少于这个数', user)
        self.assertIn('素材、配色', user)          # sub_options 对齐命名
        self.assertIn('旧站', user)                # 去重清单还在


class ClassifyItemsTests(TestCase):
    def setUp(self):
        self.a = NavSite.objects.create(name='A', url='https://a.example', category='设计',
                                        subcat='素材', tags=['免费'])
        self.b = NavSite.objects.create(name='B', url='https://b.example', category='未分类')
        self.c = NavSite.objects.create(name='C', url='https://c.example', category='自定义')
        self.d = NavSite.objects.create(name='D', url='https://d.example', category='AI 工具')

    def _post(self, payload):
        return self.client.post(reverse('api_nav_ai_classify_items'),
                                data=_json.dumps(payload), content_type='application/json')

    def test_scope_all_and_catalog(self):
        data = self._post({'scope': 'all'}).json()
        self.assertEqual(4, data['total'])
        self.assertEqual(4, len(data['items']))
        self.assertIn('设计', data['categories'])
        self.assertIn('免费', data['tags'])          # 标签词表一起下发,前端做 datalist
        self.assertFalse(data['configured'])

    def test_scope_uncategorized_includes_custom(self):
        names = [i['name'] for i in self._post({'scope': 'uncategorized'}).json()['items']]
        self.assertEqual(['B', 'C'], names)

    def test_scope_single_category_and_limit(self):
        data = self._post({'scope': 'category', 'category': '设计', 'limit': 1}).json()
        self.assertEqual(['A'], [i['name'] for i in data['items']])
        self.assertEqual(1, data['limit'])

    def test_items_carry_old_tags_for_diff(self):
        row = [i for i in self._post({'scope': 'all'}).json()['items'] if i['name'] == 'A'][0]
        self.assertEqual(['免费'], row['tags'])
        self.assertEqual('素材', row['subcat'])


class ClassifyBatchTests(TestCase):
    def setUp(self):
        NavAiConfig.objects.create(base_url='https://api.test', api_key='k', model='m')

    def _post(self, payload):
        return self.client.post(reverse('api_nav_ai_classify_batch'),
                                data=_json.dumps(payload), content_type='application/json')

    def test_batch_returns_rows_with_tags_and_old_values(self):
        fake = _json.dumps([{'i': 1, 'category': 'AI 工具', 'subcat': '对话',
                             'tags': ['国产', '免费']}])
        items = [{'id': 7, 'name': '豆包', 'url': 'https://doubao.com', 'category': '未分类',
                  'tags': ['旧标签']}]
        with mock.patch('nav.ai.chat', return_value=fake):
            data = self._post({'items': items}).json()
        self.assertEqual('ok', data['status'])
        row = data['rows'][0]
        self.assertEqual(7, row['id'])
        self.assertEqual('未分类', row['old_category'])
        self.assertEqual(['旧标签'], row['old_tags'])     # 前端靠它判断"有没有变"
        self.assertEqual('AI 工具', row['category'])
        self.assertEqual(['国产', '免费'], row['tags'])

    def test_batch_reports_not_configured_code(self):
        with mock.patch('nav.ai.chat', side_effect=AiNotConfigured('还没配接口')):
            resp = self._post({'items': [{'id': 1, 'name': 'x', 'url': 'https://x.example'}]})
        self.assertEqual(400, resp.status_code)
        self.assertEqual('ai_not_configured', resp.json()['code'])

    def test_batch_rejects_empty_items(self):
        self.assertEqual(400, self._post({'items': []}).status_code)


class ClassifyPromptModeTests(TestCase):
    """提示词模式:没有 NavAiConfig 也必须能用(用户的核心诉求)。"""

    def test_prompt_works_without_config(self):
        NavSite.objects.create(name='豆包', url='https://doubao.com', category='未分类')
        items = [{'id': 1, 'name': '豆包', 'url': 'https://doubao.com', 'category': '未分类'}]
        resp = self.client.post(reverse('api_nav_ai_classify_prompt'),
                                data=_json.dumps({'items': items}),
                                content_type='application/json')
        data = resp.json()
        self.assertEqual('ok', data['status'])
        self.assertIn('豆包', data['prompt'])
        self.assertIn('"tags"', data['prompt'])
        self.assertEqual(1, data['count'])

    def test_prompt_is_not_capped_to_one_batch(self):
        """提示词是一次性整段交给外部 AI,不该被「喂模型 40 条/批」的上限截断。

        2026-11-12 复核发现:两个接口共用 40 的清洗上限,选 60 条时提示词里只有前 40 条,
        剩下 20 条既不报错也不提示,用户以为全处理了。
        """
        items = [{'id': i, 'name': '站点%d' % i, 'url': 'https://s%d.example' % i,
                  'category': '未分类', 'subcat': '', 'tags': []} for i in range(1, 61)]
        resp = self.client.post(reverse('api_nav_ai_classify_prompt'),
                                 data=_json.dumps({'items': items}),
                                 content_type='application/json')
        data = resp.json()
        self.assertEqual(60, data['count'])
        self.assertIn('站点60', data['prompt'])

    def test_parse_endpoint_maps_pasted_reply(self):
        items = [{'id': 11, 'name': 'Figma', 'url': 'https://figma.com', 'category': '未分类'}]
        reply = ('```json\n[{"i":1,"category":"设计","subcat":"素材","tags":["免费"]}]\n```')
        resp = self.client.post(reverse('api_nav_ai_classify_parse'),
                                data=_json.dumps({'text': reply, 'items': items}),
                                content_type='application/json')
        rows = resp.json()['rows']
        self.assertEqual(11, rows[0]['id'])
        self.assertEqual(['免费'], rows[0]['tags'])
        self.assertEqual('未分类', rows[0]['old_category'])


class ClassifyApplyTests(TestCase):
    def setUp(self):
        self.site = NavSite.objects.create(name='豆包', url='https://doubao.com',
                                           category='未分类', tags=['旧'])

    def _post(self, rows):
        return self.client.post(reverse('api_nav_ai_classify_apply'),
                                data=_json.dumps({'rows': rows}), content_type='application/json')

    def test_apply_updates_category_subcat_and_tags(self):
        data = self._post([{'id': self.site.id, 'category': 'AI 工具', 'subcat': '对话',
                            'tags': ['国产', '免费']}]).json()
        self.assertEqual(1, data['updated'])
        self.site.refresh_from_db()
        self.assertEqual(('AI 工具', '对话'), (self.site.category, self.site.subcat))
        self.assertEqual(['国产', '免费'], self.site.tags)

    def test_apply_without_tags_key_keeps_tags(self):
        """前端没传 tags = 这次不动标签(兼容只改分类的调用)。"""
        self._post([{'id': self.site.id, 'category': 'AI 工具', 'subcat': ''}])
        self.site.refresh_from_db()
        self.assertEqual(['旧'], self.site.tags)

    def test_apply_skips_unchanged_rows(self):
        data = self._post([{'id': self.site.id, 'category': '未分类', 'subcat': '',
                            'tags': ['旧']}]).json()
        self.assertEqual(0, data['updated'])

    def test_apply_rejects_empty_category(self):
        self.assertEqual(400, self._post([{'id': self.site.id, 'category': ''}]).status_code)
        self.site.refresh_from_db()
        self.assertEqual('未分类', self.site.category)
