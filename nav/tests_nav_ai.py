# nav/tests_nav_ai.py
"""AI 找站 / 生成 / 导入 / 配置 / 元数据抓取 / 域名迁移检测(2026-11-07 从 nav/tests.py 按域拆出)。

只跑本域:`python manage.py test nav.tests_nav_ai`;公共底座见 `tests_nav_common.py`。
"""
from .tests_nav_common import (
    NavAiConfig,
    NavSite,
    SimpleUploadedFile,
    TestCase,
    _json,
    json,
    mock,
    reverse,
)


class NavFetchMetaTests(TestCase):
    """添加站点时抓取标题/favicon(离线,mock requests)。"""

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def _mock_response(self, html, url='https://example.com/'):
        from unittest import mock

        resp = mock.Mock()
        resp.content = html.encode('utf-8')
        resp.url = url
        # 出站请求统一走 _safe_get(逐跳校验重定向),它要读 status_code/headers
        resp.status_code = 200
        resp.headers = {'Content-Type': 'text/html; charset=utf-8'}
        resp.raise_for_status.return_value = None
        return resp

    def test_parse_site_meta(self):
        from .views import _parse_site_meta
        html = ('<html><head><title>  示例 &amp; 公司\n第二行 </title>'
                '<link rel="shortcut icon" href="/icons/site.png">')
        meta = _parse_site_meta('https://example.com/x', html.encode('utf-8'))
        self.assertEqual('示例 &amp; 公司 第二行', meta['title'])
        self.assertEqual('https://example.com/icons/site.png', meta['favicon'])
        # href 在 rel 前面的写法 + 绝对地址 + data: URI 忽略
        html2 = '<html><head><link href="https://cdn.a.com/fav.ico" rel="icon">'
        self.assertEqual('https://cdn.a.com/fav.ico',
                         _parse_site_meta('https://example.com', html2.encode())['favicon'])
        html3 = '<html><head><link rel="icon" href="data:image/png;base64,AAA">'
        self.assertEqual('', _parse_site_meta('https://example.com', html3.encode())['favicon'])
        self.assertEqual({'title': '', 'favicon': '', 'description': ''},
                         _parse_site_meta('https://example.com', b'<html>no title'))

    def test_parse_site_meta_description(self):
        from .views import _parse_site_meta
        # meta name 在前、content 在后
        html = ('<html><head><meta name="description" content="  出口 &amp; 进口\n商 ">')
        self.assertEqual('出口 & 进口 商', _parse_site_meta('https://example.com', html.encode())['description'])
        # content 在前
        html2 = '<html><head><meta content="反向写法" name="description">'
        self.assertEqual('反向写法', _parse_site_meta('https://example.com', html2.encode())['description'])
        # og:description 兜底 + property 写法
        html3 = '<html><head><meta property="og:description" content="OG 简介">'
        self.assertEqual('OG 简介', _parse_site_meta('https://example.com', html3.encode())['description'])
        # description 优先于 og:description
        html4 = ('<html><head><meta name="description" content="正主">'
                 '<meta property="og:description" content="兜底">')
        self.assertEqual('正主', _parse_site_meta('https://example.com', html4.encode())['description'])
        # 超长截断 200
        html5 = f'<html><head><meta name="description" content="{"x" * 300}">'
        self.assertEqual(200, len(_parse_site_meta('https://example.com', html5.encode())['description']))

    def test_fetch_meta_api(self):
        from unittest import mock
        html = ('<html><head><title>Acme Ltd</title><link rel="icon" href="/fav.ico">'
                '<meta name="description" content="Acme widgets export"></head>')
        with mock.patch('nav.views.requests.get',
                        return_value=self._mock_response(html, url='https://acme.example/')) as get:
            response = self._post_json('nav_fetch_meta', {'url': 'acme.example'})
        data = json.loads(response.content)
        self.assertEqual(200, response.status_code)
        self.assertEqual('Acme Ltd', data['title'])
        self.assertEqual('https://acme.example/fav.ico', data['favicon'])
        self.assertEqual('Acme widgets export', data['description'])
        self.assertIn('User-Agent', get.call_args.kwargs['headers'])
        self.assertEqual(400, self._post_json('nav_fetch_meta', {'url': ''}).status_code)
        with mock.patch('nav.views.requests.get', side_effect=ConnectionError()):
            self.assertEqual(502, self._post_json('nav_fetch_meta', {'url': 'down.example'}).status_code)

    def test_fetch_meta_flags_moved_urls(self):
        # 添加表单的自动识别同带"迁移新地址"提示(零额外请求)
        from unittest import mock
        html = ('<html><head><title>Old</title>'
                '<link rel="canonical" href="https://new.example/"></head>'
                '<body>已迁移到新域名 https://alt.example</body></html>')
        with mock.patch('nav.views.requests.get',
                        return_value=self._mock_response(html, url='https://old.example/')):
            data = json.loads(self._post_json('nav_fetch_meta', {'url': 'old.example'}).content)
        self.assertEqual('Old', data['title'])
        self.assertEqual([('https://new.example/', 'canonical'), ('https://alt.example', 'hint')],
                         [(c['url'], c['reason']) for c in data['moved']])

    def test_fetch_meta_no_moved_key_for_normal_pages(self):
        from unittest import mock
        html = '<html><head><title>Fine</title></head><body><a href="https://twitter.com/x">t</a></body></html>'
        with mock.patch('nav.views.requests.get',
                        return_value=self._mock_response(html, url='https://ok.example/')):
            data = json.loads(self._post_json('nav_fetch_meta', {'url': 'ok.example'}).content)
        self.assertNotIn('moved', data)

    def test_nav_add_stores_meta_and_page_renders(self):
        response = self._post_json('nav_add', {'name': 'Acme', 'url': 'https://acme.example',
                                               'category': '自定义', 'site_title': 'Acme Ltd',
                                               'favicon': 'https://acme.example/fav.ico'})
        self.assertEqual(200, response.status_code)
        site = NavSite.objects.get(url='https://acme.example')
        self.assertEqual('Acme Ltd', site.site_title)
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, 'https://acme.example/fav.ico')
        # 无 favicon 的内置站点走 favicon.im 兜底图标,失败再级联 google s2
        self.assertContains(page, 'favicon.im/')
        self.assertContains(page, 'google.com/s2/favicons')

    def test_export_import_roundtrip_keeps_favicon(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        NavSite.objects.create(name='Fav', url='https://fav.example', category='自定义',
                               site_title='Fav 标题', favicon='https://fav.example/i.png')
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        item = next(s for s in payload['sites'] if s['url'] == 'https://fav.example')
        self.assertEqual('https://fav.example/i.png', item['favicon'])
        NavSite.objects.filter(url='https://fav.example').delete()
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.client.post(reverse('nav_import'), {'nav_file': upload})
        site = NavSite.objects.get(url='https://fav.example')
        self.assertEqual('Fav 标题', site.site_title)
        self.assertEqual('https://fav.example/i.png', site.favicon)


class NavMovedDetectTests(TestCase):
    """测活"网站内容存在新网址"检测:纯解析函数 + link-check 集成(离线)。"""

    def _post_json(self, payload):
        return self.client.post(reverse('nav_link_check'), data=json.dumps(payload),
                                content_type='application/json')

    def test_strong_signals_ranked_and_normalized(self):
        from .views import _parse_moved_urls
        html = ('<link rel="canonical" href="https://new.example.com">'
                '<meta property="og:url" content="https://brand.new.example.com">'
                '<meta http-equiv="refresh" content="0; url=https://jump.example/go">')
        got = _parse_moved_urls('https://old.example.com/', html)
        self.assertEqual([('https://new.example.com', 'canonical'),
                          ('https://brand.new.example.com', 'og:url'),
                          ('https://jump.example/go', 'redirect')],
                         [(c['url'], c['reason']) for c in got])
        # href 在 rel 前面的 canonical 写法
        got2 = _parse_moved_urls('https://old.example', '<link href="https://n.example" rel="canonical">')
        self.assertEqual('https://n.example', got2[0]['url'])

    def test_same_site_candidates_dropped(self):
        from .views import _parse_moved_urls
        # www / 子域都算同站;站内路径不算迁移
        self.assertEqual([], _parse_moved_urls('https://old.example.com/',
                                               '<link rel="canonical" href="https://www.old.example.com/">'))
        self.assertEqual([], _parse_moved_urls('https://old.example.com/',
                                               '<link rel="canonical" href="https://cdn.old.example.com/">'))

    def test_move_hint_window_extraction(self):
        from .views import _parse_moved_urls
        html = '<p>我们已迁移,请访问新地址 https://newsite.example, 原网址停止服务。</p>'
        got = _parse_moved_urls('https://old.example', html)
        self.assertEqual([('https://newsite.example', 'hint')], [(c['url'], c['reason']) for c in got])
        # 英文提示 + HTML 实体 &amp;
        got2 = _parse_moved_urls('https://old.example',
                                 '<div>We have moved to https://new.example/path?a=1&amp;b=2</div>')
        self.assertEqual('https://new.example/path?a=1&b=2', got2[0]['url'])

    def test_link_fallback_needs_repeat_domain_and_caps(self):
        from .views import _parse_moved_urls
        html = ('<a href="https://new.example/a">1</a><a href="https://new.example/b">2</a>'
                '<a href="https://twitter.com/x">t</a>')
        got = _parse_moved_urls('https://old.example', html)
        self.assertEqual([('https://new.example/a', 'link')], [(c['url'], c['reason']) for c in got])
        many = ''.join(f'<p>已迁移 https://n{i}.example</p>' for i in range(10))
        self.assertEqual(6, len(_parse_moved_urls('https://old.example', many)))

    def test_link_check_api_returns_moved(self):
        html = ('<html><head><link rel="canonical" href="https://new.example/"></head>'
                '<body>网站已迁移,新域名 https://alt.example</body></html>')
        resp = mock.Mock(status_code=200, url='https://old.example',
                         headers={'Content-Type': 'text/html; charset=utf-8'}, close=mock.Mock())
        resp.iter_content = lambda **kw: iter([html.encode('utf-8')])
        with mock.patch('nav.views.requests.get', return_value=resp):
            data = json.loads(self._post_json({'urls': ['https://old.example']}).content)
        moved = data['results'][0]['moved']
        self.assertEqual([('https://new.example/', 'canonical'), ('https://alt.example', 'hint')],
                         [(c['url'], c['reason']) for c in moved])

    def test_link_check_non_html_has_no_moved(self):
        resp = mock.Mock(status_code=200, url='https://api.example',
                         headers={'Content-Type': 'application/json'}, close=mock.Mock())
        with mock.patch('nav.views.requests.get', return_value=resp):
            data = json.loads(self._post_json({'urls': ['https://api.example']}).content)
        self.assertNotIn('moved', data['results'][0])


class NavAiConfigApiTests(TestCase):
    """导航 AI 配置:GET 脱敏状态;POST 保存(key 留空保持原值)。"""

    def test_get_unconfigured(self):
        resp = self.client.get(reverse('api_nav_ai_config'))
        data = resp.json()
        self.assertFalse(data['configured'])

    def test_post_saves(self):
        resp = self.client.post(reverse('api_nav_ai_config'),
                                data=_json.dumps({'base_url': 'https://api.test/',
                                                  'api_key': 'sk-1', 'model': 'm1'}),
                                content_type='application/json')
        self.assertTrue(resp.json()['configured'])
        cfg = NavAiConfig.get_solo()
        self.assertEqual(cfg.base_url, 'https://api.test')
        # key 留空保持原值
        self.client.post(reverse('api_nav_ai_config'),
                         data=_json.dumps({'base_url': 'https://api.test',
                                           'api_key': '', 'model': 'm2'}),
                         content_type='application/json')
        self.assertEqual(NavAiConfig.get_solo().api_key, 'sk-1')
        self.assertEqual(NavAiConfig.get_solo().model, 'm2')


class NavAiGenerateTests(TestCase):
    """生成候选:AI 返回的草稿过滤同域名已有站点;未配置/空输入给明确报错。"""

    def setUp(self):
        NavSite.objects.create(name='已有站', url='https://www.existing.com',
                               category='设计资源', subcat='素材库')

    def test_generate_filters_same_domain(self):
        NavAiConfig.objects.create(base_url='https://api.test', api_key='k', model='m')
        fake = _json.dumps([
            {'name': '新站', 'url': 'https://newsite.com', 'description': '新站',
             'subcat': '素材库'},
            {'name': '同域', 'url': 'https://sub.existing.com/page', 'description': '同域',
             'subcat': ''},
        ])
        with mock.patch('nav.ai.chat', return_value=fake):
            resp = self.client.post(reverse('api_nav_ai_generate'),
                                    data=_json.dumps({'category': '设计资源',
                                                      'subcat': '素材库',
                                                      'scene': '设计素材站'}),
                                    content_type='application/json')
        data = resp.json()
        self.assertEqual('ok', data['status'])
        self.assertEqual(['新站'], [d['name'] for d in data['drafts']])
        self.assertEqual(1, len(data['skipped']))
        self.assertIn('同域名', data['skipped'][0]['skipped_reason'])

    def test_generate_returns_model_and_elapsed_meta(self):
        """候选列表要能标注「本次用的哪个模型、花了几秒」(2026-11-19)。"""
        NavAiConfig.objects.create(base_url='https://api.test', api_key='k', model='m')
        fake = _json.dumps([{'name': '新站', 'url': 'https://newsite.com',
                             'description': 'x', 'subcat': ''}])
        meta = {'content': fake, 'reasoning': '', 'model': 'auto/deepseek-v4.1-flash-free',
                'elapsed_ms': 1234}
        with mock.patch('nav.ai.chat_with_meta', return_value=meta):
            data = self.client.post(reverse('api_nav_ai_generate'),
                                    data=_json.dumps({'category': '设计资源', 'count': 1,
                                                      'scene': '设计素材站'}),
                                    content_type='application/json').json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('auto/deepseek-v4.1-flash-free', data['model'])
        self.assertEqual(1234, data['elapsed_ms'])
        self.assertFalse(data['repaired'])

    def test_generate_meta_sums_repair_time(self):
        """触发格式修复时,耗时要把两次调用加起来,并标明修过(不能只报第一次)。"""
        NavAiConfig.objects.create(base_url='https://api.test', api_key='k', model='m')
        good = _json.dumps([{'name': '新站', 'url': 'https://newsite.com',
                             'description': 'x', 'subcat': ''}])
        first = {'content': '这里没有数组', 'reasoning': '', 'model': 'm', 'elapsed_ms': 800}
        second = {'content': good, 'reasoning': '', 'model': 'm', 'elapsed_ms': 400}
        with mock.patch('nav.ai.chat_with_meta', side_effect=[first, second]):
            data = self.client.post(reverse('api_nav_ai_generate'),
                                    data=_json.dumps({'category': '设计资源', 'count': 1,
                                                      'scene': '设计素材站'}),
                                    content_type='application/json').json()
        self.assertEqual(1200, data['elapsed_ms'])
        self.assertTrue(data['repaired'])

    def test_find_ai_preview_shows_call_meta(self):
        from pathlib import Path
        js = (Path(__file__).resolve().parent / 'static' / 'js' / 'find-ai.js').read_text(encoding='utf-8')
        for token in ("window.navAiRenderDrafts = function(drafts, skipped, meta)",
                      "id=\"navAiMeta\"",
                      "{model: d.model, elapsed_ms: d.elapsed_ms, repaired: d.repaired}",
                      "' · '"):
            self.assertIn(token, js)

    def test_generate_requires_category(self):
        resp = self.client.post(reverse('api_nav_ai_generate'),
                                data=_json.dumps({'scene': 'x'}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)

    def test_generate_rejects_non_string_scene(self):
        # scene 传数字/数组等曾是 AttributeError 500
        NavAiConfig.objects.create(base_url='https://api.test', api_key='k', model='m')
        resp = self.client.post(reverse('api_nav_ai_generate'),
                                data=_json.dumps({'category': '设计资源', 'scene': 123}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)

    def test_generate_rejects_non_int_count(self):
        # count 传非数字曾是 ValueError 500
        NavAiConfig.objects.create(base_url='https://api.test', api_key='k', model='m')
        resp = self.client.post(reverse('api_nav_ai_generate'),
                                data=_json.dumps({'category': '设计资源',
                                                  'scene': 'x', 'count': 'abc'}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)


class NavAiManualModeTests(TestCase):
    """「无 API 手动模式」:复制提示词到任意外部 AI → 回复粘贴回来 → 解析进既有预览测活导入。

    硬约束:构造提示词不依赖 NavAiConfig(没 key 也能用);解析与 API 管线共用一套。"""

    def test_prompt_endpoint_works_without_api_config(self):
        NavAiConfig.objects.all().delete()   # 未配置接口也必须能用
        resp = self.client.post(reverse('api_nav_ai_prompt'),
                                data=_json.dumps({'category': '设计资源',
                                                  'scene': '设计素材站', 'count': 5}),
                                content_type='application/json')
        data = resp.json()
        self.assertEqual('ok', data['status'])
        self.assertIn('设计素材站', data['prompt'])
        self.assertIn('设计资源', data['prompt'])
        self.assertIn('JSON 数组', data['prompt'])   # 输出契约合在提示词里

    def test_prompt_endpoint_validates_input(self):
        resp = self.client.post(reverse('api_nav_ai_prompt'),
                                data=_json.dumps({'scene': 123}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)
        resp = self.client.post(reverse('api_nav_ai_prompt'),
                                data=_json.dumps({'category': '', 'scene': 'x'}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)

    def test_parse_accepts_fenced_json_with_surrounding_text(self):
        pasted = ('好的,以下是推荐网站:\n```json\n'
                  + _json.dumps([{'name': '新站', 'url': 'https://newsite.com',
                                  'description': '简介', 'subcat': '素材库'}])
                  + '\n```\n希望有帮助!')
        resp = self.client.post(reverse('api_nav_ai_parse'),
                                data=_json.dumps({'text': pasted, 'count': 8}),
                                content_type='application/json')
        data = resp.json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('新站', data['drafts'][0]['name'])
        self.assertEqual('https://newsite.com', data['drafts'][0]['url'])

    def test_parse_skips_invalid_entries(self):
        pasted = '```json\n' + _json.dumps([
            {'name': '好站', 'url': 'https://good.com', 'description': '', 'subcat': ''},
            {'name': '没地址', 'url': 'newsite.com'},
            {'url': 'https://noname.com'},
        ]) + '\n```'
        resp = self.client.post(reverse('api_nav_ai_parse'),
                                data=_json.dumps({'text': pasted}),
                                content_type='application/json')
        data = resp.json()
        self.assertEqual('ok', data['status'])
        self.assertEqual(['好站'], [d['name'] for d in data['drafts']])

    def test_parse_rejects_garbage_and_empty(self):
        resp = self.client.post(reverse('api_nav_ai_parse'),
                                data=_json.dumps({'text': '抱歉,我无法提供该内容。'}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)
        self.assertIn('JSON 数组', resp.json()['message'])
        resp = self.client.post(reverse('api_nav_ai_parse'),
                                data=_json.dumps({'text': '   '}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)

    def test_generate_without_config(self):
        resp = self.client.post(reverse('api_nav_ai_generate'),
                                data=_json.dumps({'category': '设计资源', 'scene': 'x'}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)
        self.assertIn('AI 尚未配置', resp.json()['message'])


class NavAiImportTests(TestCase):
    """一键导入:测活通过才入库(自动抓标题/图标);死链与同域重复分桶返回。"""

    def setUp(self):
        NavAiConfig.objects.create(base_url='https://api.test', api_key='k', model='m')
        self.existing = NavSite.objects.create(name='已有站', url='https://www.existing.com',
                                               category='设计资源')

    def _post(self, sites):
        return self.client.post(reverse('api_nav_ai_import'),
                                data=_json.dumps({'category': '设计资源',
                                                  'subcat': '素材库',
                                                  'proxy': '', 'sites': sites}),
                                content_type='application/json')

    def test_import_per_item_subcat_wins_over_global(self):
        # AI 给了每条候选的小分类建议时,按条目入库;全局下拉只作空值兜底
        def fake_check(url, proxy, *args, **kwargs):
            return {'url': url, 'ok': True, 'status': 200, 'error': ''}
        with mock.patch('nav.views_nav_check._nav_check_link', side_effect=fake_check), \
                mock.patch('nav.views_nav_ai._nav_meta_best_effort', return_value={}):
            resp = self._post([
                {'name': '自带建议', 'url': 'https://s1.example', 'subcat': 'AI 建议的小类'},
                {'name': '没有建议', 'url': 'https://s2.example'},
            ])
        data = resp.json()
        self.assertEqual(2, len(data['imported']))
        s1 = NavSite.objects.get(url='https://s1.example')
        s2 = NavSite.objects.get(url='https://s2.example')
        self.assertEqual('AI 建议的小类', s1.subcat)
        self.assertEqual('素材库', s2.subcat)   # 空值兜底用全局下拉
        self.assertEqual('设计资源', s1.category)

    def test_import_truncates_at_20_with_feedback(self):
        # 超出单次 20 条上限:只导入前 20,并明确报告被截断的条数与名单
        def fake_check(url, proxy, *args, **kwargs):
            return {'url': url, 'ok': True, 'status': 200, 'error': ''}
        sites = [{'name': f'S{i}', 'url': f'https://s{i}.example'} for i in range(22)]
        with mock.patch('nav.views_nav_check._nav_check_link', side_effect=fake_check), \
                mock.patch('nav.views_nav_ai._nav_meta_best_effort', return_value={}):
            resp = self._post(sites)
        data = resp.json()
        self.assertEqual(20, len(data['imported']))
        self.assertEqual(2, data['truncated'])
        self.assertIn('S20', data['truncated_names'])
        self.assertIn('S21', data['truncated_names'])

    def test_import_ok_dead_and_duplicates(self):
        def fake_check(url, proxy, *args, **kwargs):
            if 'dead' in url:
                return {'url': url, 'ok': False, 'status': None, 'error': 'NameResolution'}
            return {'url': url, 'ok': True, 'status': 200, 'error': ''}
        # mock 形状必须与 _parse_site_meta 的真实返回一致(键是 title 不是 site_title),
        # 否则测试测的是 mock 自己、掩盖真实键名 bug
        meta = {'title': 'NewSite - Home', 'favicon': 'https://newsite.com/fav.ico',
                'description': 'A useful site'}
        with mock.patch('nav.views_nav_check._nav_check_link', side_effect=fake_check), \
                mock.patch('nav.views_nav_ai._nav_meta_best_effort', return_value=meta):
            resp = self._post([
                {'name': '好站', 'url': 'https://newsite.com', 'description': 'AI 简介'},
                {'name': '死站', 'url': 'https://dead-site.example', 'description': ''},
                {'name': '重复站', 'url': 'https://existing.com/other-page', 'description': ''},
            ])
        data = resp.json()
        self.assertEqual(1, len(data['imported']))
        self.assertEqual('好站', data['imported'][0]['name'])
        self.assertEqual(1, len(data['dead']))
        self.assertEqual('NameResolution', data['dead'][0]['reason'])
        self.assertEqual(1, len(data['duplicates']))
        obj = NavSite.objects.get(url='https://newsite.com')
        self.assertEqual('设计资源', obj.category)
        self.assertEqual('素材库', obj.subcat)
        self.assertEqual('NewSite - Home', obj.site_title)
        self.assertEqual('AI 简介', obj.description)  # AI 简介优先于 meta

    def test_import_batch_internal_dedupe(self):
        def fake_check(url, proxy, *args, **kwargs):
            return {'url': url, 'ok': True, 'status': 200, 'error': ''}
        with mock.patch('nav.views_nav_check._nav_check_link', side_effect=fake_check), \
                mock.patch('nav.views_nav_ai._nav_meta_best_effort', return_value={}):
            resp = self._post([
                {'name': '第一', 'url': 'https://same.com'},
                {'name': '第二', 'url': 'https://same.com/other'},
            ])
        data = resp.json()
        self.assertEqual(1, len(data['imported']))
        self.assertEqual(1, len(data['duplicates']))


class NavAiModelsTests(TestCase):
    """接口地址自动检测模型(2026-11-18):服务端代取 {base_url}/models。

    浏览器直连本机网关会被 CORS / 混合内容拦住,所以这段逻辑必须在后端。
    """

    def _post(self, payload):
        return self.client.post(reverse('api_nav_ai_models'), data=json.dumps(payload),
                                content_type='application/json')

    @staticmethod
    def _resp(status=200, payload=None):
        r = mock.Mock()
        r.status_code = status
        r.content = json.dumps(payload if payload is not None else {}).encode('utf-8')
        r.json.return_value = payload if payload is not None else {}
        return r

    def test_lists_models_and_dedupes(self):
        payload = {'data': [
            {'id': 'auto/deepseek', 'display_name': 'DeepSeek 路由组', 'owned_by': 'magpie'},
            {'id': 'auto/deepseek'},
            'plain-model',
        ]}
        with mock.patch('nav.views_nav_ai.requests.get',
                        return_value=self._resp(200, payload)) as get:
            data = self._post({'base_url': 'http://127.0.0.1:3425/v1/'}).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual(['auto/deepseek', 'plain-model'], [m['id'] for m in data['models']])
        self.assertEqual(2, data['count'])
        self.assertEqual('http://127.0.0.1:3425/v1/models', get.call_args[0][0])   # 末尾斜杠去掉

    def test_requires_http_base(self):
        self.assertEqual(400, self._post({'base_url': '127.0.0.1:3425'}).status_code)
        self.assertEqual(400, self._post({'base_url': 'ftp://example.com'}).status_code)

    def test_auth_failure_reports_key(self):
        with mock.patch('nav.views_nav_ai.requests.get', return_value=self._resp(401)):
            resp = self._post({'base_url': 'https://api.deepseek.com/v1'})
        self.assertEqual(502, resp.status_code)
        self.assertIn('API Key', resp.json()['message'])

    def test_deepseek_style_base_retries_with_v1(self):
        """DeepSeek 官方常写不带 /v1 的地址:404 后补一次 /v1/models。"""
        with mock.patch('nav.views_nav_ai.requests.get',
                        side_effect=[self._resp(404), self._resp(200, {'data': [{'id': 'deepseek-chat'}]})]) as get:
            data = self._post({'base_url': 'https://api.deepseek.com'}).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual(['https://api.deepseek.com/models',
                          'https://api.deepseek.com/v1/models'],
                         [c[0][0] for c in get.call_args_list])

    def test_uses_saved_key_when_blank(self):
        cfg = NavAiConfig.get_solo()
        cfg.base_url, cfg.api_key, cfg.model = 'https://x.example/v1', 'stored-key', 'm'
        cfg.save()
        with mock.patch('nav.views_nav_ai.requests.get',
                        return_value=self._resp(200, {'data': []})) as get:
            self._post({'base_url': 'https://x.example/v1'})
        self.assertEqual('Bearer stored-key', get.call_args.kwargs['headers']['Authorization'])

    def test_modal_resize_grip_is_clickable(self):
        """`.modal-dialog` 在 tailwind 里是 pointer-events:none,原生缩放抓手收不到事件。"""
        from pathlib import Path
        shim = (Path(__file__).resolve().parent / 'static' / 'bootstrap-shim.js').read_text(encoding='utf-8')
        self.assertIn("dialog.style.resize = 'both'", shim)
        self.assertIn("dialog.style.pointerEvents = 'auto'", shim)

    def _post_test(self, payload):
        return self.client.post(reverse('api_nav_ai_model_test'), data=json.dumps(payload),
                                content_type='application/json')

    def test_model_probe_ok(self):
        with mock.patch('nav.views_nav_ai.requests.post',
                        return_value=self._resp(200, {'choices': [{'message': {'content': 'OK'}}]})) as post:
            data = self._post_test({'base_url': 'http://127.0.0.1:3425/v1',
                                    'model': 'auto/deepseek'}).json()
        self.assertTrue(data['ok'])
        self.assertEqual('auto/deepseek', post.call_args.kwargs['json']['model'])
        self.assertEqual(8, post.call_args.kwargs['json']['max_tokens'])   # 探活只要几个 token

    def test_model_probe_reports_quota_error(self):
        r = self._resp(429, {'error': {'message': 'Free usage limit reached'}})
        with mock.patch('nav.views_nav_ai.requests.post', return_value=r):
            data = self._post_test({'base_url': 'http://x.example/v1',
                                    'model': 'our-free-model/x'}).json()
        self.assertFalse(data['ok'])
        self.assertIn('Free usage limit reached', data['message'])

    def test_model_probe_rejects_empty_or_error_body(self):
        """200 也可能是假成功:choices 为空 / 200 里带 error 都不能算可用。"""
        for body, needle in (({'choices': []}, 'choices 为空'),
                             ({'error': {'message': 'quota exhausted'}}, 'quota exhausted'),
                             ({'choices': [{'message': {'content': ''}}]}, '内容为空')):
            with mock.patch('nav.views_nav_ai.requests.post', return_value=self._resp(200, body)):
                data = self._post_test({'base_url': 'http://x.example/v1',
                                        'model': 'm'}).json()
            self.assertFalse(data['ok'])
            self.assertIn(needle, data['message'])

    def test_model_probe_timeout_and_bad_request(self):
        import requests as real_requests
        with mock.patch('nav.views_nav_ai.requests.post', side_effect=real_requests.Timeout):
            data = self._post_test({'base_url': 'http://x.example/v1',
                                    'model': 'slow'}).json()
        self.assertFalse(data['ok'])
        self.assertIn('超时', data['message'])
        self.assertEqual(400, self._post_test({'base_url': 'http://x.example/v1',
                                               'model': ''}).status_code)

    def test_model_probe_retries_once_on_busy_gateway(self):
        """2026-11-19「显示可用却保存失败」:批量测完 31 个模型后网关排队,单次 10s 超时
        会把可用模型判死。第一次 429 要再给一次机会。"""
        busy = self._resp(429, {'error': {'message': 'queue full'}})
        good = self._resp(200, {'choices': [{'message': {'content': 'OK'}}]})
        with mock.patch('nav.views_nav_ai.requests.post', side_effect=[busy, good]) as post:
            data = self._post_test({'base_url': 'http://127.0.0.1:3425/v1',
                                    'model': 'auto/x'}).json()
        self.assertTrue(data['ok'])
        self.assertEqual(2, post.call_count)
        self.assertEqual(10, post.call_args_list[0].kwargs['timeout'])
        self.assertEqual(15, post.call_args_list[1].kwargs['timeout'])

    def test_model_probe_timeout_then_success(self):
        import requests as real_requests
        good = self._resp(200, {'choices': [{'message': {'content': 'OK'}}]})
        with mock.patch('nav.views_nav_ai.requests.post',
                        side_effect=[real_requests.Timeout, good]):
            data = self._post_test({'base_url': 'http://x.example/v1',
                                    'model': 'slow'}).json()
        self.assertTrue(data['ok'])

    def test_pet_ai_time_helper_is_defined(self):
        """2026-11-19:petAiRenderDiag 调了未定义的 petAiFmtAt,保存成功后被 catch 吞成
        「请求失败,未保存」—— 用户看到「显示可用却保存失败」。这个函数必须存在且容错。"""
        from pathlib import Path
        js = (Path(__file__).resolve().parent / 'static' / 'js' / 'pet.js').read_text(encoding='utf-8')
        self.assertIn('function petAiFmtAt(', js)
        self.assertIn('isFinite(ts)', js)
        self.assertIn('petAiFmtAt(new Date(d.last_check_at).getTime())', js)

    def test_model_test_cache_is_persisted(self):
        """测试结果要存 localStorage,下次打开不重复测(用户明确要求)。"""
        from pathlib import Path
        js = (Path(__file__).resolve().parent / 'static' / 'js' / 'pet.js').read_text(encoding='utf-8')
        for token in ('PET_AI_TEST_LS', 'navPetAiModelTestV1', 'petAiWriteTestCache',
                      'petAiReadTestCache', '已存本机，无需重测',
                      'petAiTestThenSave', '✗ 当场复测没通过，未保存',
                      '正在批量测试模型，等它跑完再点保存',
                      'if (modelMenu) modelMenu.addEventListener'):
            self.assertIn(token, js)

    def test_config_modal_exposes_detector(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for token in ('id="petAiModelsBtn"', 'id="petAiModelMenu"',
                      'id="petAiTestModelsBtn"', 'id="petAiSaveHint"',
                      'id="petAiModelBtn"', 'api/nav/ai/models/',
                      'api/nav/ai/model-test/'):
            self.assertIn(token, html)

    def test_model_probe_persists_diagnosis(self):
        """探活结果要落库(2026-11-19):关掉弹窗后还能看到上次是哪个模型、为什么不可用。"""
        ok_body = {'choices': [{'message': {'content': 'OK'}}]}
        with mock.patch('nav.views_nav_ai.requests.post', return_value=self._resp(200, ok_body)):
            self._post_test({'base_url': 'http://x.example/v1', 'model': 'auto/deepseek'})
        cfg = NavAiConfig.get_solo()
        self.assertTrue(cfg.last_check_ok)
        self.assertEqual('auto/deepseek', cfg.last_check_model)
        self.assertIsNotNone(cfg.last_check_at)
        self.assertGreaterEqual(cfg.last_check_ms, 0)

        quota = self._resp(429, {'error': {'message': 'Free usage limit reached'}})
        with mock.patch('nav.views_nav_ai.requests.post', return_value=quota):
            self._post_test({'base_url': 'http://x.example/v1', 'model': 'our-free-model/x'})
        cfg = NavAiConfig.get_solo()
        self.assertFalse(cfg.last_check_ok)
        self.assertIn('Free usage limit reached', cfg.last_check_message)
        data = self.client.get(reverse('api_nav_ai_config')).json()
        self.assertFalse(data['last_check_ok'])
        self.assertEqual('our-free-model/x', data['last_check_model'])

    def test_config_modal_exposes_task_models_and_logs(self):
        from pathlib import Path
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for token in ('id="petAiModelClassify"',
                      'id="petAiClassifyModelBtn"', 'id="petAiClassifyModelMenu"',
                      '默认（跟随主模型）',
                      'id="petAiDiag"', 'id="petAiLogBtn"', 'id="petAiLogList"',
                      'api/nav/ai/logs/'):
            self.assertIn(token, html)
        self.assertNotIn('留空 = 默认模型', html)   # 默认项只在下拉里出现一次
        # 桌宠模型 2026-11-19 搬进宠物设置(JS 构建),AI 弹窗只剩分类模型
        self.assertNotIn('id="petAiModelPet"', html)
        js = (Path(__file__).resolve().parent / 'static' / 'js' / 'pet.js').read_text(encoding='utf-8')
        for token in ('petAiRenderDiag', 'petAiLoadLogs', 'petAiTaskLabel',
                      'last_check_ok', 'model_classify', 'model_pet',
                      'petAiBalanceApplicable',
                      # 任务模型改成「输入 + ▾ 下拉」:分类/桌宠各一套菜单,
                      # 列表里的 default/默认 被剔掉,默认项只留一个
                      'petAiRenderTaskModelMenus', 'petAiCleanModelList',
                      'petAiPrefetchModels', 'id="petAiModelPetBtn"',
                      'id="petAiModelPetMenu"', '默认（跟随主模型）'):
            self.assertIn(token, js)


class NavAiLocalKeylessTests(TestCase):
    """API Key 可空(2026-11-19):本地 Ollama / 本机网关不验 Key,不能因为没 Key 就当没配置。"""

    def test_configured_without_api_key(self):
        NavAiConfig.objects.create(base_url='http://127.0.0.1:11434/v1', model='qwen2.5')
        self.assertTrue(NavAiConfig.is_configured())
        data = self.client.get(reverse('api_nav_ai_config')).json()
        self.assertTrue(data['configured'])
        self.assertFalse(data['api_key_set'])

    def test_still_unconfigured_without_model(self):
        NavAiConfig.objects.create(base_url='http://127.0.0.1:11434/v1', model='')
        self.assertFalse(NavAiConfig.is_configured())

    def test_get_config_allows_blank_key(self):
        NavAiConfig.objects.create(base_url='http://127.0.0.1:11434/v1', model='qwen2.5')
        from .ai import get_config
        cfg = get_config()
        self.assertEqual('', cfg['api_key'])
        self.assertEqual('qwen2.5', cfg['model'])


class NavAiTaskModelTests(TestCase):
    """按任务分配模型 + 任务级参数(2026-11-19)。"""

    def test_resolve_model_precedence(self):
        from .ai import resolve_model
        cfg = {'model': 'base', 'model_classify': 'cls', 'model_pet': 'pet'}
        self.assertEqual('base', resolve_model(task='site', cfg=cfg))
        self.assertEqual('cls', resolve_model(task='classify', cfg=cfg))
        self.assertEqual('pet', resolve_model(task='pet', cfg=cfg))
        self.assertEqual('pet', resolve_model(task='whisper', cfg=cfg))
        self.assertEqual('explicit', resolve_model(task='classify', override='explicit', cfg=cfg))

    def test_resolve_model_falls_back_when_override_blank(self):
        from .ai import resolve_model
        cfg = {'model': 'base', 'model_classify': '', 'model_pet': ''}
        self.assertEqual('base', resolve_model(task='classify', cfg=cfg))
        self.assertEqual('base', resolve_model(task='pet', cfg=cfg))

    def test_task_defaults_are_distinct(self):
        from .ai import TASK_DEFAULTS
        self.assertLess(TASK_DEFAULTS['classify']['temperature'],
                        TASK_DEFAULTS['pet']['temperature'])      # 分类要稳,桌宠要活
        self.assertGreaterEqual(TASK_DEFAULTS['classify']['timeout'], 120)

    def test_config_api_saves_task_models(self):
        self.client.post(reverse('api_nav_ai_config'),
                         data=_json.dumps({'base_url': 'https://api.test', 'api_key': '',
                                           'model': 'base-model',
                                           'model_classify': 'cls-model',
                                           'model_pet': 'pet-model'}),
                         content_type='application/json')
        data = self.client.get(reverse('api_nav_ai_config')).json()
        self.assertEqual('cls-model', data['model_classify'])
        self.assertEqual('pet-model', data['model_pet'])

    def test_config_api_keeps_task_models_when_omitted(self):
        cfg = NavAiConfig.get_solo()
        cfg.model_classify, cfg.model_pet = 'cls', 'pet'
        cfg.save()
        # 老调用不带这两个字段:不能把已存的覆盖模型清空
        self.client.post(reverse('api_nav_ai_config'),
                         data=_json.dumps({'base_url': 'https://api.test', 'model': 'm2'}),
                         content_type='application/json')
        cfg = NavAiConfig.get_solo()
        self.assertEqual('cls', cfg.model_classify)
        self.assertEqual('pet', cfg.model_pet)

    def test_pet_config_api_saves_task_models(self):
        from .models import NavAiConfig as C
        self.client.post(reverse('api_nav_pet_ai_config'),
                         data=_json.dumps({'base_url': 'https://api.test', 'model': 'm',
                                           'model_classify': 'c', 'model_pet': 'p'}),
                         content_type='application/json')
        cfg = C.get_solo()
        self.assertEqual('c', cfg.model_classify)
        self.assertEqual('p', cfg.model_pet)


class NavAiCallLogTests(TestCase):
    """调用日志:成功/失败都记一条摘要,环形保留不无限增长。"""

    def test_log_trims_to_keep_limit(self):
        from .ai import NAV_AI_LOG_KEEP, log_call
        from .models import NavAiCallLog
        for i in range(NAV_AI_LOG_KEEP + 6):
            log_call('site', 'm%d' % i, True, 10, 200, 'ok')
        self.assertEqual(NAV_AI_LOG_KEEP, NavAiCallLog.objects.count())
        # 留下的是最新的那批
        self.assertEqual('m%d' % (NAV_AI_LOG_KEEP + 5),
                         NavAiCallLog.objects.order_by('-id').first().model)

    def test_chat_logs_success_with_task_and_model(self):
        from .ai import chat_with_meta
        from .models import NavAiCallLog
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {'choices': [{'message': {'content': '结果'}}]}
        with mock.patch('nav.ai.get_config', return_value={
                'base_url': 'http://x/v1', 'api_key': '', 'model': 'base',
                'model_classify': 'cls', 'model_pet': ''}), \
                mock.patch('nav.ai.requests.post', return_value=resp) as post:
            meta = chat_with_meta([], task='classify')
        # 空 Key 也照样发请求(本地接口不验 Key)
        self.assertNotIn('Authorization', post.call_args.kwargs['headers'])
        self.assertEqual('cls', meta['model'])
        row = NavAiCallLog.objects.latest('id')
        self.assertEqual(('classify', 'cls', True), (row.task, row.model, row.ok))

    def test_chat_retries_once_on_gateway_5xx_then_fails(self):
        from .ai import AiNotConfigured, chat_with_meta
        from .models import NavAiCallLog
        bad = mock.Mock(status_code=503, text='gateway down')
        with mock.patch('nav.ai.get_config', return_value={
                'base_url': 'http://x/v1', 'api_key': 'k', 'model': 'm'}), \
                mock.patch('nav.ai.time.sleep'), \
                mock.patch('nav.ai.requests.post', return_value=bad) as post:
            with self.assertRaises(AiNotConfigured):
                chat_with_meta([])
        self.assertEqual(2, post.call_count)        # 只重试一次
        row = NavAiCallLog.objects.latest('id')
        self.assertFalse(row.ok)
        self.assertEqual(503, row.http_status)

    def test_chat_does_not_retry_on_network_error(self):
        import requests as real_requests
        from .ai import AiNotConfigured, chat_with_meta
        with mock.patch('nav.ai.get_config', return_value={
                'base_url': 'http://x/v1', 'api_key': 'k', 'model': 'm'}), \
                mock.patch('nav.ai.requests.post', side_effect=real_requests.ConnectionError('boom')) as post:
            with self.assertRaises(AiNotConfigured):
                chat_with_meta([])
        self.assertEqual(1, post.call_count)

    def test_logs_endpoint_lists_recent(self):
        from .models import NavAiCallLog
        NavAiCallLog.objects.create(task='site', model='m1', ok=True, elapsed_ms=12)
        NavAiCallLog.objects.create(task='classify', model='m2', ok=False, message='HTTP 429')
        data = self.client.get(reverse('api_nav_ai_logs')).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual(2, len(data['logs']))
        self.assertEqual('classify', data['logs'][0]['task'])     # 最新在前
        self.assertFalse(data['logs'][0]['ok'])


class NavAiJsonRepairTests(TestCase):
    """结构化任务解析失败:回传原回复只修一次格式,仍失败才报第一次的错误。"""

    def setUp(self):
        NavAiConfig.objects.create(base_url='https://api.test', model='m')

    def test_site_drafts_repair_once_after_bad_json(self):
        from .ai import generate_site_drafts
        good = _json.dumps([{'name': '新站', 'url': 'https://n.example',
                             'description': '简介', 'subcat': ''}])
        with mock.patch('nav.ai.chat', side_effect=['抱歉我先说两句', good]) as chat:
            drafts = generate_site_drafts('场景', '设计资源', count=1)
        self.assertEqual('新站', drafts[0]['name'])
        self.assertEqual(2, chat.call_count)
        repair_messages = chat.call_args_list[1][0][0]
        self.assertIn('无法解析', repair_messages[-1]['content'])

    def test_repair_gives_up_with_first_error(self):
        from .ai import generate_site_drafts
        with mock.patch('nav.ai.chat', return_value='没有 JSON'):
            with self.assertRaises(Exception) as ctx:
                generate_site_drafts('场景', '设计资源', count=1)
        # 报的是第一次的错误(提示词没被改坏),不是第二次的
        self.assertIn('没有 JSON 数组', str(ctx.exception))

    def test_classify_uses_same_repair_path(self):
        from .ai import classify_sites
        good = _json.dumps([{'i': 1, 'category': '设计', 'subcat': '素材', 'tags': []}])
        with mock.patch('nav.ai.chat', side_effect=['废话', good]):
            rows = classify_sites([{'name': 'A', 'url': 'https://a.example'}], ['设计'])
        self.assertEqual('设计', rows[0]['category'])
