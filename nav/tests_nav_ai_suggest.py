"""AI 录入建议(2026-11-25):添加站点时给分类/标签/图标文字,按需附子网页与备用网址。

只测契约(提示词去看看什么、解析怎么清洗、接口在未配置/异常时的降级),
真模型调用由 mock 顶掉 —— 这些断言都要能在断网机器上跑。
"""

import json
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from .ai import _clean_assist_links, build_site_assist_prompts, parse_site_assist
from .models import NavAiConfig, NavCategory, NavSite


class AssistPromptContractTests(TestCase):
    def test_prompt_carries_catalog_tags_and_icons(self):
        system, user = build_site_assist_prompts(
            {'name': '豆包', 'url': 'https://www.doubao.com', 'description': '字节的 AI 助手'},
            ['AI 工具', '开发工具'], {'AI 工具': ['对话', '绘图']}, ['免费', '需代理'],
            ['DB', 'GP'], want_subs=True, want_alts=True)
        self.assertIn('AI 工具', user)
        self.assertIn('对话', user)
        self.assertIn('免费', user)
        self.assertIn('DB', user)
        self.assertIn('子网页', user)
        self.assertIn('备用网址', user)
        # 分类优先复用 + 链接宁缺毋滥,都写在系统提示里
        self.assertIn('原样选一个', system)
        self.assertIn('绝不编造', system)
        self.assertIn('避开', system)

    def test_prompt_drops_links_when_not_asked(self):
        _, user = build_site_assist_prompts({'name': 'x', 'url': 'https://x.example'},
                                            ['A'], want_subs=False, want_alts=False)
        self.assertNotIn('"subs"', user)
        self.assertNotIn('"alts"', user)
        self.assertIn('子网页=不要', user)


class AssistParseTests(TestCase):
    def test_parse_cleans_and_keeps_http_links_only(self):
        raw = ('```json\n[{"category":"AI 工具","subcat":"对话","subcat2":"","new_category":false,'
               '"tags":["免费","AI 工具","免费"],"icon_text":"db",'
               '"subs":[{"name":"文档","url":"https://www.doubao.com/docs"},{"url":"ftp://nope"}],'
               '"alts":[{"name":"镜像","url":"http://mirror.example"}]}]\n```')
        d = parse_site_assist(raw)
        self.assertEqual(d['category'], 'AI 工具')
        self.assertEqual(d['icon_text'], 'DB')
        self.assertEqual(d['tags'], ['免费', 'AI 工具'])
        self.assertEqual([x['url'] for x in d['subs']], ['https://www.doubao.com/docs'])
        self.assertEqual(len(d['alts']), 1)

    def test_parse_requires_category(self):
        with self.assertRaises(ValueError):
            parse_site_assist('[{"tags": [], "icon_text": "A"}]')

    def test_clean_links_caps_and_dedupes(self):
        rows = [{'url': 'https://a.example/%d' % i} for i in range(8)]
        rows.append({'url': 'https://a.example/0'})
        out = _clean_assist_links(rows, 3)
        self.assertEqual(len(out), 3)
        self.assertEqual(out[0]['url'], 'https://a.example/0')


class AssistApiTests(TestCase):
    def setUp(self):
        NavCategory.objects.create(name='AI 工具')
        NavSite.objects.create(name='已有站', url='https://a.example', category='AI 工具',
                               icon_text='AB')

    def _post(self, payload):
        return self.client.post(reverse('api_nav_ai_suggest'),
                                data=json.dumps(payload), content_type='application/json')

    def test_unconfigured_returns_clear_code(self):
        NavAiConfig.objects.all().delete()
        r = self._post({'name': '豆包', 'url': 'https://www.doubao.com'})
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertEqual(body['code'], 'ai_not_configured')
        self.assertIn('AI 接口', body['message'])

    def test_returns_suggestion_from_pipeline(self):
        cfg = NavAiConfig.get_solo()
        cfg.base_url, cfg.model = 'http://127.0.0.1:9999/v1', 'test-model'
        cfg.save()
        fake = {'category': 'AI 工具', 'subcat': '对话', 'subcat2': '', 'new_category': False,
                'reason': '', 'tags': ['免费'], 'icon_text': 'DB',
                'subs': [{'name': '文档', 'url': 'https://www.doubao.com/docs'}], 'alts': []}
        with patch('nav.views_nav_ai.ai_pipeline.assist_site', return_value=fake) as m:
            r = self._post({'name': '豆包', 'url': 'https://www.doubao.com',
                            'want_subs': True, 'want_alts': False})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(body['suggestion']['icon_text'], 'DB')
        self.assertEqual(body['suggestion']['subs'][0]['url'], 'https://www.doubao.com/docs')
        # 传给 pipeline 的 icon_used 必须带上库里已占用的字母,供模型避让
        self.assertIn('AB', m.call_args[0][4])

    def test_bad_model_answer_returns_human_message(self):
        cfg = NavAiConfig.get_solo()
        cfg.base_url, cfg.model = 'http://127.0.0.1:9999/v1', 'test-model'
        cfg.save()
        with patch('nav.views_nav_ai.ai_pipeline.assist_site', side_effect=RuntimeError('timeout')):
            r = self._post({'name': '豆包', 'url': 'https://www.doubao.com'})
        self.assertEqual(r.status_code, 502)
        self.assertIn('AI 这次没给出可用的推荐', r.json()['message'])

    def test_blank_name_and_url_is_rejected(self):
        cfg = NavAiConfig.get_solo()
        cfg.base_url, cfg.model = 'http://127.0.0.1:9999/v1', 'test-model'
        cfg.save()
        r = self._post({'name': '  ', 'url': ''})
        self.assertEqual(r.status_code, 400)
        self.assertIn('名称或网址', r.json()['message'])
