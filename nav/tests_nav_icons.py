# nav/tests_nav_icons.py
"""图标 / favicon 本地化 / 备用地址 / 导出与批量导入 / Bing 背景(2026-11-07 从 nav/tests.py 按域拆出)。

只跑本域:`python manage.py test nav.tests_nav_icons`;公共底座见 `tests_nav_common.py`。
"""
from .tests_nav_common import (
    NavSite,
    SimpleUploadedFile,
    TestCase,
    _json,
    json,
    mock,
    override_settings,
    reverse,
)


class NavAlternatesTests(TestCase):
    """备用网址 alternates:[{name,url}] 镜像/资源站/备份地址 —— 清洗、渲染、导入导出、测活填入与一键加入。"""

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def test_nav_add_cleans_alternates(self):
        response = self._post_json('nav_add', {
            'name': 'Acme', 'url': 'acme.example', 'category': '自定义',
            'alternates': [
                {'name': '镜像', 'url': 'acme.cn'},
                {'name': '无网址'},
                {'url': 'https://m.acme.example'},
                {'url': 'https://m.acme.example'},
                '不是字典',
            ]})
        self.assertEqual(200, response.status_code)
        site = NavSite.objects.get(url='https://acme.example')
        self.assertEqual([{'name': '镜像', 'url': 'https://acme.cn'},
                          {'name': 'm.acme.example', 'url': 'https://m.acme.example'}], site.alternates)

    def test_edit_updates_alternates(self):
        site = NavSite.objects.create(name='Old', url='https://old.example', category='A',
                                      alternates=[{'name': '旧备用', 'url': 'https://old1.example'}])
        response = self._post_json('nav_edit', {
            'id': site.id, 'name': 'Old', 'url': 'https://old.example',
            'alternates': [{'name': '新镜像', 'url': 'https://mirror.example'}]})
        self.assertEqual(200, response.status_code)
        site.refresh_from_db()
        self.assertEqual([{'name': '新镜像', 'url': 'https://mirror.example'}], site.alternates)

    def test_page_renders_alternates_badge_and_links(self):
        NavSite.objects.create(name='Acme', url='https://acme.example', category='自定义',
                               alternates=[{'name': '镜像站', 'url': 'https://mirror.example'}])
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, '备用 1')
        self.assertContains(page, 'site-alt')
        self.assertContains(page, 'https://mirror.example')
        # 无子页但有备用网址:卡片同样走弹窗选择(data-has-sub)
        self.assertContains(page, 'data-has-sub="1"')
        self.assertContains(page, 'id="navSiteMap"')

    def test_link_check_fill_includes_alternates_and_site_map(self):
        site = NavSite.objects.create(name='Acme', url='https://acme.example', category='自定义',
                                       alternates=[{'name': '镜像', 'url': 'https://mirror.example'}])
        page = self.client.get(reverse('nav_sites'))
        self.assertEqual(['https://acme.example', 'https://mirror.example'],
                         json.loads(page.context['nav_cat_json'])['自定义'])
        self.assertEqual({'id': site.pk, 'name': 'Acme'},
                         json.loads(page.context['nav_site_map_json'])['https://acme.example'])

    def test_export_import_roundtrip_alternates(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        NavSite.objects.create(name='Alt', url='https://alt.example', category='自定义',
                               alternates=[{'name': '备份', 'url': 'https://backup.example'}])
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        item = next(s for s in payload['sites'] if s['url'] == 'https://alt.example')
        self.assertEqual([{'name': '备份', 'url': 'https://backup.example'}], item['alternates'])
        NavSite.objects.filter(url='https://alt.example').delete()
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.client.post(reverse('nav_import'), {'nav_file': upload})
        site = NavSite.objects.get(url='https://alt.example')
        self.assertEqual('https://backup.example', site.alternates[0]['url'])

    def test_seed_applies_alternates(self):
        from unittest import mock
        from . import views as v
        NavSite.objects.all().delete()
        fake = [{'name': 'S1', 'url': 'https://s1.example', 'category': '测试类',
                 'alternates': [{'name': '镜像', 'url': 's1.example/mirror'}]}]
        with mock.patch('nav.views_nav_base.DEFAULT_SITES', fake):
            v._seed_nav_sites()
        site = NavSite.objects.get(url='https://s1.example')
        self.assertEqual([{'name': '镜像', 'url': 'https://s1.example/mirror'}], site.alternates)

    def test_adopt_appends_dedups_and_validates(self):
        site = NavSite.objects.create(name='S', url='https://s.example', category='自定义')
        response = self._post_json('nav_link_adopt', {'id': site.id, 'url': 'new.example', 'name': '新地址'})
        self.assertEqual(200, response.status_code)
        site.refresh_from_db()
        self.assertEqual([{'name': '新地址', 'url': 'https://new.example'}], site.alternates)
        # 重复采纳:幂等,不新增
        self._post_json('nav_link_adopt', {'id': site.id, 'url': 'https://new.example'})
        site.refresh_from_db()
        self.assertEqual(1, len(site.alternates))
        # 主站网址 / 空网址 / 无效 id / 不存在的条目
        self.assertEqual(400, self._post_json('nav_link_adopt', {'id': site.id, 'url': 'https://s.example'}).status_code)
        self.assertEqual(400, self._post_json('nav_link_adopt', {'id': site.id, 'url': ''}).status_code)
        self.assertEqual(400, self._post_json('nav_link_adopt', {'id': 'x', 'url': 'https://a.example'}).status_code)
        self.assertEqual(404, self._post_json('nav_link_adopt', {'id': 999999, 'url': 'https://a.example'}).status_code)


class NavFaviconLocalizeTests(TestCase):
    """图标本地化(默认不本地化,手动触发):热链下载存本机,失败的保持热链。"""

    def setUp(self):
        # 隔离 MEDIA_ROOT:否则会往真实 media/nav_favicons/ 落 fav_<uuid>.png,每跑一次多一份永久文件
        import shutil
        import tempfile
        self.tmp = tempfile.mkdtemp(prefix='nav_fav_')
        self._override = override_settings(MEDIA_ROOT=self.tmp)
        self._override.enable()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(self._override.disable)

    def _mock_resp(self, content=b'pngdata', ctype='image/png'):
        # 2026-10-06 起视图改用 stream + with 下载(限单张大小),mock 要贴真实形状
        resp = mock.MagicMock()
        resp.__enter__.return_value = resp
        resp.__exit__.return_value = False
        resp.status_code = 200
        resp.headers = {'Content-Type': ctype}
        resp.iter_content.return_value = [content]
        return resp

    def test_localize_downloads_and_rewrites(self):
        from unittest import mock
        from . import views as v
        NavSite.objects.create(name='A', url='https://a.example', category='自定义',
                               favicon='https://a.example/f.png')
        NavSite.objects.create(name='B', url='https://b.example', category='自定义',
                               favicon='https://b.example/f.ico')
        with mock.patch('nav.views.requests.get',
                        side_effect=[self._mock_resp(), ConnectionError()]) as get:
            resp = self.client.post(reverse('api_nav_favicon_localize'),
                                    content_type='application/json')
        data = resp.json()
        self.assertEqual(1, data['done'])
        self.assertEqual(1, data['failed'])
        a = NavSite.objects.get(name='A')
        self.assertTrue(a.favicon.startswith('/nav-fav/fav_'))
        self.assertEqual('https://b.example/f.ico', NavSite.objects.get(name='B').favicon)
        self.assertTrue(get.called)
        # 本地图标经专用视图取回
        r = self.client.get(a.favicon)
        self.assertEqual(200, r.status_code)
        self.assertEqual('image/png', r['Content-Type'])
        self.assertEqual(b'pngdata', r.content)

    def test_localize_file_view_blocks_traversal(self):
        from .views import _nav_check_link  # noqa: F401  确认模块可导入
        self.assertEqual(404, self.client.get('/nav-fav/..%2Fsecrets.png').status_code)
        self.assertEqual(404, self.client.get('/nav-fav/fav_' + '0' * 32 + '.png').status_code)

    def test_localize_skips_already_local(self):
        from unittest import mock
        NavSite.objects.create(name='L', url='https://l.example', category='自定义',
                               favicon='/nav-fav/fav_' + '0' * 32 + '.png')
        with mock.patch('nav.views.requests.get') as get:
            resp = self.client.post(reverse('api_nav_favicon_localize'),
                                    content_type='application/json')
        self.assertEqual(0, resp.json()['done'])
        self.assertFalse(get.called)

    def test_localize_dedupes_same_favicon_url(self):
        """相同图标 URL 只下载一次,两个站点都改写到同一本地文件。"""
        NavSite.objects.create(name='A', url='https://a.example', category='自定义',
                               favicon='https://cdn.example/f.png')
        NavSite.objects.create(name='B', url='https://b.example', category='自定义',
                               favicon='https://cdn.example/f.png')
        with mock.patch('nav.views.requests.get', return_value=self._mock_resp()) as get:
            data = self.client.post(reverse('api_nav_favicon_localize'),
                                    content_type='application/json').json()
        self.assertEqual(1, get.call_count)
        self.assertEqual(2, data['done'])
        a = NavSite.objects.get(name='A').favicon
        self.assertTrue(a.startswith('/nav-fav/fav_'))
        self.assertEqual(a, NavSite.objects.get(name='B').favicon)

    def test_localize_rejects_oversize(self):
        """超过 512KB 的图标判失败并保持热链,不落盘。"""
        NavSite.objects.create(name='Big', url='https://big.example', category='自定义',
                               favicon='https://big.example/f.png')
        big = mock.MagicMock()
        big.__enter__.return_value = big
        big.__exit__.return_value = False
        big.status_code = 200
        big.headers = {'Content-Type': 'image/png'}
        big.iter_content.return_value = [b'x' * (513 * 1024)]
        with mock.patch('nav.views.requests.get', return_value=big) as get:
            data = self.client.post(reverse('api_nav_favicon_localize'),
                                    content_type='application/json').json()
        self.assertEqual(1, get.call_count)
        self.assertEqual(1, data['failed'])
        self.assertEqual('https://big.example/f.png', NavSite.objects.get(name='Big').favicon)

    def test_localize_uses_proxy(self):
        """代理参数(与测活同款补全规则)透传给下载请求。"""
        NavSite.objects.create(name='P', url='https://p.example', category='自定义',
                               favicon='https://p.example/f.png')
        with mock.patch('nav.views.requests.get', return_value=self._mock_resp()) as get:
            self.client.post(reverse('api_nav_favicon_localize'),
                             data=json.dumps({'proxy': '127.0.0.1:7890'}),
                             content_type='application/json')
        self.assertEqual('http://127.0.0.1:7890', get.call_args.kwargs['proxies']['http'])


class NavBingBgRawTests(TestCase):
    """必应壁纸原图代理:同源输出图片字节给 canvas 取色;失败给 502。"""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()   # 测试进程共享 locmem 缓存,清掉避免命中真实必应数据

    def test_raw_proxies_image(self):
        from unittest import mock
        meta = mock.Mock()
        meta.json.return_value = {'images': [{'urlbase': '/az/hprichbg/rb/test', 'copyright': 'c'}]}
        meta.status_code = 200
        meta.headers = {}
        img = mock.Mock()
        img.content = b'jpeg-bytes'
        img.status_code = 200          # _safe_get 会先看状态码再决定要不要跟跳
        img.headers = {}
        img.raise_for_status = mock.Mock()
        with mock.patch('nav.views.requests.get', side_effect=[meta, img]):
            resp = self.client.get(reverse('api_nav_bing_bg_raw'))
        self.assertEqual(200, resp.status_code)
        self.assertEqual('image/jpeg', resp['Content-Type'])
        self.assertEqual(b'jpeg-bytes', resp.content)

    def test_raw_error_returns_502(self):
        from unittest import mock
        with mock.patch('nav.views.requests.get', side_effect=Exception('网络断开')):
            resp = self.client.get(reverse('api_nav_bing_bg_raw'))
        self.assertEqual(502, resp.status_code)
        self.assertEqual('error', resp.json()['status'])


class NavIconCustomTests(TestCase):
    """自定义图标:纯色字母图标字段入库 + 本地图标上传端点。"""

    def setUp(self):
        # 同上:本地图标上传端点会写 MEDIA_ROOT,测试期间必须指向临时目录
        import shutil
        import tempfile
        self.tmp = tempfile.mkdtemp(prefix='nav_icon_')
        self._override = override_settings(MEDIA_ROOT=self.tmp)
        self._override.enable()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(self._override.disable)

    def _png(self):
        return (b'\x89PNG\r\n\x1a\n' + b'0' * 64, 'image/png')

    def test_add_with_icon_fields(self):
        resp = self.client.post(reverse('nav_add'),
                                data=_json.dumps({'name': '谷歌', 'url': 'https://www.google.com',
                                                  'category': '搜索引擎', 'icon_text': 'Go',
                                                  'icon_color': '#e74c3c', 'icon_size': 34}),
                                content_type='application/json')
        self.assertEqual('success', resp.json()['status'])
        site = NavSite.objects.get(url='https://www.google.com')
        self.assertEqual('Go', site.icon_text)
        self.assertEqual('#e74c3c', site.icon_color)
        self.assertEqual(34, site.icon_size)

    def test_add_invalid_color_sanitized(self):
        resp = self.client.post(reverse('nav_add'),
                                data=_json.dumps({'name': 'X 站', 'url': 'https://x.example.com',
                                                  'icon_text': 'X', 'icon_color': 'javascript:alert(1)'}),
                                content_type='application/json')
        self.assertEqual('success', resp.json()['status'])
        site = NavSite.objects.get(url='https://x.example.com')
        self.assertEqual('', site.icon_color)   # 非法颜色静默清空
        self.assertEqual('X', site.icon_text)

    def test_edit_updates_icon_fields(self):
        site = NavSite.objects.create(name='A', url='https://a.example.com', category='T')
        resp = self.client.post(reverse('nav_edit'),
                                data=_json.dumps({'id': site.id, 'name': 'A', 'url': 'https://a.example.com',
                                                  'icon_text': 'AB', 'icon_color': '#2ecc71', 'icon_size': 40}),
                                content_type='application/json')
        self.assertEqual('success', resp.json()['status'])
        site.refresh_from_db()
        self.assertEqual('AB', site.icon_text)
        self.assertEqual(40, site.icon_size)

    def test_icon_upload(self):
        content, ctype = self._png()
        from django.core.files.uploadedfile import SimpleUploadedFile
        up = SimpleUploadedFile('i.png', content, content_type=ctype)
        resp = self.client.post(reverse('api_nav_icon_upload'), data={'file': up})
        self.assertEqual('ok', resp.json()['status'])
        url = resp.json()['url']
        self.assertRegex(url, r'^/nav-fav/fav_[0-9a-f]{32}\.png$')
        # 同一文件再传:md5 同名去重,覆盖同路径
        up2 = SimpleUploadedFile('i2.png', content, content_type=ctype)
        resp2 = self.client.post(reverse('api_nav_icon_upload'), data={'file': up2})
        self.assertEqual(url, resp2.json()['url'])

    def test_icon_upload_rejects_bad_type_and_size(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        up = SimpleUploadedFile('a.exe', b'MZxxx', content_type='application/x-msdownload')
        self.assertEqual(400, self.client.post(reverse('api_nav_icon_upload'), data={'file': up}).status_code)
        big = SimpleUploadedFile('b.png', b'\x89PNG\r\n\x1a\n' + b'0' * (301 * 1024), content_type='image/png')
        self.assertEqual(400, self.client.post(reverse('api_nav_icon_upload'), data={'file': big}).status_code)

    def test_card_renders_letter_icon(self):
        NavSite.objects.create(name='谷歌', url='https://www.google.com', category='搜索',
                               icon_text='Go', icon_color='#e74c3c', icon_size=34)
        html = self.client.get('/nav/').content.decode('utf-8')
        self.assertIn('>Go</span>', html)
        self.assertIn('background:#e74c3c', html)


class NavExportBuiltinTests(TestCase):
    """导出 v7:内置站点默认不导出;被用户改过的内置站点要跟着导出,
    否则 nav_edit 允许改内置条目、导出却只认 is_builtin=False → 换机丢修改(2026-10-06 修复)。"""

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _payload(self):
        return json.loads(self.client.get(reverse('nav_export')).content)

    def test_unmodified_builtin_not_exported(self):
        site = NavSite.objects.filter(is_builtin=True).first()
        urls = {s['url'] for s in self._payload()['sites']}
        self.assertNotIn(site.url, urls)

    def test_edited_builtin_exported_and_import_keeps_builtin_flag(self):
        site = NavSite.objects.filter(is_builtin=True).first()
        site.name = site.name + ' 备用'
        site.favicon = 'https://icon.example/x.png'
        site.save()
        payload = self._payload()
        item = next(s for s in payload['sites'] if s['url'] == site.url)
        self.assertEqual(site.name, item['name'])
        self.assertEqual('https://icon.example/x.png', item['favicon'])
        # 导入回库:更新到同一内置条目,is_builtin 不被导入数据改动
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.client.post(reverse('nav_import'), {'nav_file': upload})
        site.refresh_from_db()
        self.assertTrue(site.is_builtin)
        self.assertEqual(site.name, item['name'])


class NavExportIconTests(TestCase):
    """导出 v8:自定义字母图标与点击数一起带走(此前 _nav_payload 漏了 icon_* / click_count,
    换机后图标退回默认、常用度排序清零)。"""

    def setUp(self):
        from .views import _seed_nav_sites
        NavSite.objects.all().delete()
        _seed_nav_sites()

    def _json_upload(self, payload):
        return SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                  content_type='application/json')

    def test_export_carries_icon_and_click_fields(self):
        NavSite.objects.create(name='字母站', url='https://abc.example/', category='自定义',
                               icon_text='AB', icon_color='#0a0a0a', icon_size=44, click_count=7)
        item = next(s for s in json.loads(self.client.get(reverse('nav_export')).content)['sites']
                    if s['url'] == 'https://abc.example/')
        self.assertEqual({'icon_text': 'AB', 'icon_color': '#0a0a0a',
                          'icon_size': 44, 'click_count': 7},
                         {k: item[k] for k in ('icon_text', 'icon_color', 'icon_size', 'click_count')})

    def test_import_restores_icon_and_clicks(self):
        NavSite.objects.create(name='字母站', url='https://abc.example/', category='自定义',
                               icon_text='AB', icon_color='#0a0a0a', icon_size=44, click_count=7)
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        NavSite.objects.filter(url='https://abc.example/').delete()
        resp = self.client.post(reverse('nav_import'), {'nav_file': self._json_upload(payload)})
        self.assertEqual(200, resp.status_code)
        site = NavSite.objects.get(url='https://abc.example/')
        self.assertEqual('AB', site.icon_text)
        self.assertEqual('#0a0a0a', site.icon_color)
        self.assertEqual(44, site.icon_size)
        self.assertEqual(7, site.click_count)

    def test_legacy_file_without_new_keys_keeps_local_values(self):
        """v7 及更早的文件没有这几个键:导入不许把本机已设的图标和常用度抹掉。"""
        site = NavSite.objects.create(name='字母站', url='https://abc.example/', category='自定义',
                                      icon_text='AB', icon_color='#0a0a0a', icon_size=44, click_count=7)
        legacy = {'format': 'pinsflora-nav', 'version': 7, 'sites': [
            {'name': '字母站改名', 'url': 'https://abc.example/', 'category': '自定义'}]}
        self.assertEqual(200, self.client.post(reverse('nav_import'),
                                               {'nav_file': self._json_upload(legacy)}).status_code)
        site.refresh_from_db()
        self.assertEqual('字母站改名', site.name)   # 文件里有的键照常更新
        self.assertEqual('AB', site.icon_text)
        self.assertEqual(7, site.click_count)


class NavBookmarkExportTests(TestCase):
    """书签导出(Netscape 格式):大类/小分类 → 文件夹;直属站点挂大类下;HTML 转义;范围与 JSON 导出一致。"""
    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _export(self):
        resp = self.client.get(reverse('api_nav_export_bookmark'))
        self.assertEqual(200, resp.status_code)
        self.assertIn('text/html', resp['Content-Type'])
        self.assertIn('nav_bookmarks.html', resp['Content-Disposition'])
        return resp.content.decode('utf-8')

    def test_structure_folders_and_direct_sites(self):
        NavSite.objects.create(name='直属站', url='https://direct.example', category='物流')
        NavSite.objects.create(name='小分类站', url='https://sub.example', category='物流', subcat='追踪')
        html = self._export()
        self.assertTrue(html.startswith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'))
        self.assertIn('<DT><H3>物流</H3>', html)
        self.assertIn('<DT><H3>追踪</H3>', html)
        self.assertIn('<DT><A HREF="https://direct.example">直属站</A>', html)
        self.assertIn('<DT><A HREF="https://sub.example">小分类站</A>', html)
        self.assertTrue(html.rstrip().endswith('</DL><p>'))
        # 直属站在大类文件夹内、小分类文件夹之后(不钻进子文件夹)
        self.assertLess(html.index('<DT><H3>物流</H3>'), html.index('<DT><H3>追踪</H3>'))
        self.assertLess(html.index('<DT><H3>追踪</H3>'), html.index('https://direct.example'))

    def test_no_link_is_exported_twice(self):
        """整份导出里每条链接只能出现一次。

        2026-11-17 复核:直属站点在 _render_subtree 里追加过一次,调用处又补了一次,
        实测 422 个站点导出 428 条(6 个无小分类的站点各多一条)。
        这里对整份导出做"链接全唯一"的断言,再单独钉住直属站点那条路径。
        """
        import re as _re
        NavSite.objects.create(name='直属站', url='https://once.example', category='物流')
        NavSite.objects.create(name='小分类站', url='https://sub2.example', category='物流', subcat='追踪')
        html = self._export()
        self.assertEqual(1, html.count('HREF="https://once.example"'))
        hrefs = _re.findall(r'<DT><A HREF="([^"]+)"', html)
        self.assertEqual(len(hrefs), len(set(hrefs)), '导出里有重复链接')

    def test_description_as_dd_and_html_escaping(self):
        NavSite.objects.create(name='A&B<c>"站"', url='https://esc.example/?a=1&b=2',
                               category='自定义', description='<script>alert(1)</script>')
        html = self._export()
        self.assertIn('A&amp;B&lt;c&gt;&quot;站&quot;', html)
        self.assertIn('HREF="https://esc.example/?a=1&amp;b=2"', html)
        # <DD> 按 Netscape 惯例不闭合(浏览器导出同样如此),重点是简介被转义、不出现可执行脚本
        self.assertIn('<DD>&lt;script&gt;alert(1)&lt;/script&gt;', html)
        self.assertNotIn('<script>alert(1)</script>', html)

    def test_scope_matches_json_export(self):
        html = self._export()
        self.assertNotIn('https://www.importyeti.com', html)   # 内置未改过,两个导出都不带
        NavSite.objects.create(name='mine', url='https://mine.example', category='自定义')
        self.assertIn('https://mine.example', self._export())


class NavBatchImportTests(TestCase):
    """书签「移除 500 上限 / 分批幂等导入」契约。

    契约约定:
      1. 单次 POST 任意大负载(>500 条)到 nav_import,后端须全量 upsert 入库,
         不得因 NAV_IMPORT_MAX 之类上限而截断或返回 400。
      2. 同一批 items 重复 POST,结果条数不变(按 url upsert,不重复创建)。
    """

    # 远超旧的 500 上限;如需对齐真实书签样本(Firefox.html 2154 条)可改为 2154
    BIG = 1200

    def _make_sites(self, n):
        return [
            {
                'name': f'Site {i}',
                'url': f'https://site-{i}.example.com/',
                'category': '契约测试',
                'description': f'batch import contract row {i}',
            }
            for i in range(n)
        ]

    def _post_import(self, sites):
        payload = {'sites': sites}
        upload = SimpleUploadedFile(
            'nav.json',
            json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            content_type='application/json',
        )
        return self.client.post(reverse('nav_import'), {'nav_file': upload})

    def test_large_import_no_truncation(self):
        """单次导入 BIG(>500)条,后端须全部创建,无 500 截断、无 400 拒绝。"""
        n = self.BIG
        resp = self._post_import(self._make_sites(n))
        self.assertEqual(200, resp.status_code, resp.content.decode('utf-8'))
        data = resp.json()
        self.assertEqual('success', data.get('status'))
        self.assertEqual(n, data.get('created'))
        # 落库条数 == 提交条数(用专属 url 前缀隔离,避免与种子数据混淆)
        self.assertEqual(
            n,
            NavSite.objects.filter(url__startswith='https://site-').count(),
        )

    def test_import_idempotent_upsert(self):
        """同一批 items POST 两次,总数不变(按 url upsert,不重复创建)。"""
        n = self.BIG
        sites = self._make_sites(n)

        first = self._post_import(sites)
        self.assertEqual(200, first.status_code, first.content.decode('utf-8'))
        self.assertEqual(n, first.json().get('created'))

        second = self._post_import(sites)
        self.assertEqual(200, second.status_code, second.content.decode('utf-8'))
        self.assertEqual(0, second.json().get('created'))
        self.assertEqual(n, second.json().get('updated'))
        # 关键契约:重复导入后条数不增长
        self.assertEqual(
            n,
            NavSite.objects.filter(url__startswith='https://site-').count(),
        )


class NavImportKeepsDescriptionTests(TestCase):
    """导入行的 description 为空时,不得清掉本机已抓好的简介。

    导入时抓简介是可选开关,不勾/抓不到时 payload 里的 description 就是空串;
    旧实现照 defaults 写库,会把库里已有的简介一起清空(2026-11-12 实测)。
    """

    def _post_import(self, sites):
        upload = SimpleUploadedFile(
            'nav.json',
            json.dumps({'sites': sites}, ensure_ascii=False).encode('utf-8'),
            content_type='application/json',
        )
        return self.client.post(reverse('nav_import'), {'nav_file': upload})

    def test_empty_description_does_not_wipe_existing(self):
        site = NavSite.objects.create(name='站点', url='https://keep.example', category='测试',
                                      description='原有 meta 简介')
        resp = self._post_import([{'name': '站点', 'url': 'https://keep.example',
                                   'category': '测试', 'description': ''}])
        self.assertEqual(200, resp.status_code, resp.content.decode('utf-8'))
        site.refresh_from_db()
        self.assertEqual('原有 meta 简介', site.description)

    def test_non_empty_description_still_updates(self):
        site = NavSite.objects.create(name='站点', url='https://upd.example', category='测试',
                                      description='旧简介')
        self._post_import([{'name': '站点', 'url': 'https://upd.example',
                            'category': '测试', 'description': '新抓的'}])
        site.refresh_from_db()
        self.assertEqual('新抓的', site.description)

    def test_fallback_text_does_not_wipe_real_description(self):
        """浏览器书签没有 <DD> 时前端填的「书签分类:xxx」是占位,不能盖掉真简介。"""
        site = NavSite.objects.create(name='站点', url='https://keep2.example', category='测试',
                                      description='真正的 meta 简介')
        self._post_import([{'name': '站点', 'url': 'https://keep2.example', 'category': '测试',
                            'description': '书签分类:测试 / 子'}])
        site.refresh_from_db()
        self.assertEqual('真正的 meta 简介', site.description)

    def test_real_description_replaces_fallback(self):
        site = NavSite.objects.create(name='站点', url='https://fb.example', category='测试',
                                      description='书签分类:测试')
        self._post_import([{'name': '站点', 'url': 'https://fb.example', 'category': '测试',
                            'description': '抓到的真简介'}])
        site.refresh_from_db()
        self.assertEqual('抓到的真简介', site.description)

    def test_children_are_imported(self):
        """同域名合并后的子网页要跟着主站一起入库。"""
        self._post_import([{'name': '主站', 'url': 'https://main2.example', 'category': '测试',
                            'description': '主站简介',
                            'children': [{'name': '文档', 'url': 'https://main2.example/docs'}]}])
        site = NavSite.objects.get(url='https://main2.example')
        self.assertEqual([{'name': '文档', 'url': 'https://main2.example/docs'}], site.children)


class NavAltSwapTests(TestCase):
    """体检篮"试备用/设为主站"(2026-10-26 点单):GET 备用列表;POST 换主站,旧主站转入 alternates。"""

    def setUp(self):
        NavSite.objects.create(name='示例站', url='https://main.example.com', category='测试',
                               alternates=[{'name': '备一', 'url': 'https://alt1.example.com'},
                                           {'name': '备二', 'url': 'https://alt2.example.com'}])

    def _site(self):
        return NavSite.objects.get(url='https://main.example.com')

    def test_get_alternates(self):
        r = self.client.get(reverse('api_nav_alt_swap'), {'id': self._site().id}).json()
        self.assertEqual('ok', r['status'])
        self.assertEqual(2, len(r['alternates']))

    def test_swap_promotes_alt_and_demotes_main(self):
        sid = self._site().id
        r = self.client.post(reverse('api_nav_alt_swap'),
                             data=json.dumps({'id': sid, 'new_url': 'https://alt1.example.com'}),
                             content_type='application/json').json()
        self.assertEqual('ok', r['status'])
        site = NavSite.objects.get(id=sid)
        self.assertEqual('https://alt1.example.com', site.url)          # 备用升主
        alt_urls = [a['url'] for a in site.alternates]
        self.assertIn('https://main.example.com', alt_urls)             # 旧主站降备用
        self.assertNotIn('https://alt1.example.com', alt_urls)          # 被提升的不再留在备用
        self.assertIn('https://alt2.example.com', alt_urls)             # 其余备用保留

    def test_swap_rejects_same_url_and_unknown_alt(self):
        sid = self._site().id
        for payload in ({'id': sid, 'new_url': 'https://main.example.com'},
                        {'id': sid, 'new_url': 'https://not-in-alts.com'},
                        {'new_url': 'https://x.com'}):
            resp = self.client.post(reverse('api_nav_alt_swap'),
                                    data=json.dumps(payload), content_type='application/json')
            self.assertEqual(400, resp.status_code, payload)

    def test_health_js_and_island_marks(self):
        import os as _os
        js = open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                'static', 'js', 'health.js'), encoding='utf-8').read()
        for frag in ('basketTryAlts', 'basketSwap', 'HEALTH_URLS.swap', '设为主站', 'LT_CHECK_URL'):
            self.assertIn(frag, js, frag)
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('/api/nav/alt-swap/', html)   # 配置岛带上了 swap 端点(渲染后是路径不是 URL 名)

