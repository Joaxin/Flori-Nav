# nav/tests_nav_shell.py
"""模板基座 / PWA / 主题 / 时钟 / 工具页 / UI 模式 / 布局 / 弹窗 / 维护(2026-11-07 从 nav/tests.py 按域拆出)。

只跑本域:`python manage.py test nav.tests_nav_shell`;公共底座见 `tests_nav_common.py`。
"""
from .tests_nav_common import (
    NavTool,
    SimpleUploadedFile,
    TestCase,
    _health_js,
    _ie_js,
    _json,
    _lt_js,
    _theme_js,
    json,
    os,
    override_settings,
    patch,
    re,
    reverse,
    static_text,
)


class NavToolTests(TestCase):
    """导航托管的单文件 HTML 工具:上传校验、打开、删除、JSON v2 导入导出。"""

    HTML = b'<!DOCTYPE html><html><head><title>calc</title></head><body><h1>1+1</h1></body></html>'

    def setUp(self):
        import shutil
        import tempfile
        from .models import NavTool
        self.tmp = tempfile.mkdtemp(prefix='nav_tool_')
        self._override = override_settings(MEDIA_ROOT=self.tmp)
        self._override.enable()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(self._override.disable)
        NavTool.objects.all().delete()

    def _upload(self, fname='calc.html', content=None, **post):
        from django.core.files.uploadedfile import SimpleUploadedFile
        data = {'tool_file': SimpleUploadedFile(fname, self.HTML if content is None else content,
                                                content_type='text/html')}
        data.update(post)
        return self.client.post(reverse('nav_tool_upload'), data)

    def test_upload_success_and_page_shows_tool(self):
        from .models import NavTool
        response = self._upload(fname='quote.html', name='报价器', category='报价计算')
        self.assertEqual(200, response.status_code)
        tool = NavTool.objects.get()
        self.assertEqual('报价器', tool.name)
        self.assertTrue(os.path.exists(tool.file.path))
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, '报价器')
        self.assertContains(page, 'nav/tools/')

    def test_upload_rejects_bad_extension_content_and_size(self):
        from .models import NavTool
        self.assertEqual(400, self._upload(fname='notes.txt').status_code)
        self.assertEqual(400, self._upload(fname='fake.html', content=b'plain text without tags').status_code)
        with patch('nav.views_nav_tools.NAV_TOOL_MAX_BYTES', 100):
            self.assertEqual(400, self._upload(fname='big.html', content=b'<html>' + b'x' * 200).status_code)
        self.assertEqual(0, NavTool.objects.count())

    def test_open_returns_html_missing_404_and_deleted_file_410(self):
        from .models import NavTool
        response = self._upload(fname='a.html', name='工具A')
        tool = NavTool.objects.get()
        response = self.client.get(reverse('nav_tool_open', args=[tool.pk]))
        self.assertEqual(200, response.status_code)
        self.assertEqual('text/html; charset=utf-8', response['Content-Type'])
        self.assertIn(b'<h1>1+1</h1>', response.content)
        self.assertEqual(404, self.client.get(reverse('nav_tool_open', args=[999999])).status_code)
        os.remove(tool.file.path)
        response = self.client.get(reverse('nav_tool_open', args=[tool.pk]))
        self.assertEqual(410, response.status_code)
        NavTool.objects.all().delete()

    def test_tool_page_is_sandboxed_but_still_runs_scripts(self):
        """托管 HTML 必须是 sandbox 隔离源:脚本照跑、同源存储与 cookie 读不到。

        2026-11-05:此前只设 Cache-Control:no-store,等于让"网上下载来的 HTML"
        在本站源执行,能读 document.cookie、能带凭据打本机任意端点。
        ⚠️ 这条测试成对锁两端:① sandbox 在位且**不带** allow-same-origin
        (带了等于没隔离);② 仍允许脚本,否则工具全变静态页。
        """
        from .models import NavTool
        self._upload(fname='a.html', name='工具A')
        tool = NavTool.objects.get()
        csp = self.client.get(reverse('nav_tool_open', args=[tool.pk]))['Content-Security-Policy']
        self.assertIn('sandbox', csp)
        self.assertIn('allow-scripts', csp)
        self.assertNotIn('allow-same-origin', csp)
        NavTool.objects.all().delete()

    def test_svg_favicon_keeps_its_own_stricter_csp(self):
        """SVG 图标那处的 CSP 是更严的另一套(default-src 'none'),别被工具那处顺手统一掉。"""
        import uuid
        from pathlib import Path
        from django.conf import settings as dj_settings
        name = f'fav_{uuid.uuid4().hex}.svg'
        d = Path(dj_settings.MEDIA_ROOT) / 'nav_favicons'
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding='utf-8')
        try:
            resp = self.client.get(reverse('nav_favicon_file', args=[name]))
            self.assertEqual(200, resp.status_code)
            self.assertEqual("sandbox; default-src 'none'; style-src 'unsafe-inline'",
                             resp['Content-Security-Policy'])
        finally:
            (d / name).unlink(missing_ok=True)

    def test_delete_removes_row_and_file(self):
        from .models import NavTool
        self._upload(fname='b.html', name='工具B')
        tool = NavTool.objects.get()
        path = tool.file.path
        response = self._post_json('nav_tool_delete', {'id': tool.id})
        self.assertEqual(200, response.status_code)
        self.assertFalse(NavTool.objects.filter(id=tool.id).exists())
        self.assertFalse(os.path.exists(path))
        self.assertEqual(404, self._post_json('nav_tool_delete', {'id': tool.id}).status_code)

    def test_upload_auto_extracts_title_desc_and_icon(self):
        from .models import NavTool
        html = ('<!DOCTYPE html><html><head><title>我的计算器</title>'
                '<meta name="description" content="算报价用">'
                '<link rel="icon" href="data:image/png;base64,iVBORw0KGgo=">'
                '</head><body><h1>x</h1></body></html>').encode()
        self.assertEqual(200, self._upload(fname='c.html', content=html).status_code)
        tool = NavTool.objects.get()
        self.assertEqual('我的计算器', tool.name)
        self.assertEqual('算报价用', tool.description)
        self.assertTrue(tool.favicon.startswith('data:image/png'))
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, 'src="data:image/png;base64,iVBORw0KGgo="')

    def test_upload_explicit_fields_win_and_relative_icon_dropped(self):
        from .models import NavTool
        html = (b'<!DOCTYPE html><html><head><title>auto</title>'
                b'<meta name="description" content="auto desc">'
                b'<link rel="icon" href="favicon.ico"></head><body>t</body></html>')
        self._upload(fname='d.html', content=html, name='手动名', description='手动简介')
        tool = NavTool.objects.get()
        self.assertEqual('手动名', tool.name)
        self.assertEqual('手动简介', tool.description)
        self.assertEqual('', tool.favicon)  # 相对路径图标对本地单文件无意义,丢弃

    def test_export_v2_contains_tools_and_import_restores(self):
        import base64
        from .models import NavTool
        self._upload(fname='rate.html', name='汇率小工具', category='换算')
        response = self.client.get(reverse('nav_export'))
        payload = json.loads(response.content)
        self.assertEqual(10, payload['version'])
        self.assertEqual(1, len(payload['tools']))
        self.assertEqual('汇率小工具', payload['tools'][0]['name'])
        self.assertEqual(self.HTML, base64.b64decode(payload['tools'][0]['html_b64']))
        # 删除后导入可还原
        tool = NavTool.objects.get()
        self._post_json('nav_tool_delete', {'id': tool.id})
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        response = self.client.post(reverse('nav_import'), {'nav_file': upload})
        data = json.loads(response.content)
        self.assertEqual(200, response.status_code, data)
        self.assertGreaterEqual(data['created'], 1)
        restored = NavTool.objects.get(name='汇率小工具')
        opened = self.client.get(reverse('nav_tool_open', args=[restored.pk]))
        self.assertEqual(200, opened.status_code)
        self.assertIn(b'<h1>1+1</h1>', opened.content)
        # 再导一次同名工具:更新而非新增
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        response = self.client.post(reverse('nav_import'), {'nav_file': upload})
        data2 = json.loads(response.content)
        self.assertEqual(0, data2['created'])
        self.assertEqual(1, data2['updated'])
        self.assertEqual(1, NavTool.objects.filter(name='汇率小工具').count())

    def test_import_gbk_tool_transcoded_to_utf8(self):
        # 上传校验接受 GBK,但服务端只按 UTF-8 解:入库时必须统一转码,否则打开必乱码
        import base64
        from .models import NavTool
        gbk_html = ('<!DOCTYPE html><html><head><title>中文工具</title></head>'
                    '<body><h1>中文内容</h1></body></html>').encode('gbk')
        payload = {'format': 'pinsflora-nav', 'version': 2, 'sites': [],
                   'tools': [{'name': '中文工具',
                              'html_b64': base64.b64encode(gbk_html).decode()}]}
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        response = self.client.post(reverse('nav_import'), {'nav_file': upload})
        self.assertEqual(200, response.status_code)
        tool = NavTool.objects.get(name='中文工具')
        opened = self.client.get(reverse('nav_tool_open', args=[tool.pk]))
        self.assertIn('中文内容'.encode('utf-8'), opened.content)

    def test_import_update_replaces_file_without_orphans(self):
        import base64
        import os
        from .models import NavTool
        def _import(body):
            payload = {'format': 'pinsflora-nav', 'version': 2, 'sites': [],
                       'tools': [{'name': '工具X',
                                  'html_b64': base64.b64encode(body).decode()}]}
            upload = SimpleUploadedFile('nav.json', json.dumps(payload).encode('utf-8'),
                                        content_type='application/json')
            return self.client.post(reverse('nav_import'), {'nav_file': upload})

        response = _import(b'<html><body>v1</body></html>')
        self.assertEqual(200, response.status_code)
        tool = NavTool.objects.get(name='工具X')
        first_path = tool.file.path
        response = _import(b'<html><body>v2</body></html>')
        self.assertEqual(200, response.status_code)
        tool.refresh_from_db()
        self.assertNotEqual(first_path, tool.file.path)
        self.assertFalse(os.path.exists(first_path))   # 旧文件已删,不再成孤儿
        self.assertTrue(os.path.exists(tool.file.path))

    def test_import_v1_without_tools_still_works(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        payload = {'format': 'pinsflora-nav', 'version': 1,
                   'sites': [{'name': 'Old', 'url': 'old.example'}]}
        upload = SimpleUploadedFile('nav.json', json.dumps(payload).encode('utf-8'),
                                    content_type='application/json')
        response = self.client.post(reverse('nav_import'), {'nav_file': upload})
        self.assertEqual(200, response.status_code)
        self.assertEqual(1, json.loads(response.content)['created'])

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')


class NavBaseTemplateTests(TestCase):
    """NAV_BASE_TEMPLATE 挂点:独立运行时用自带 nav/base.html(无宿主导航栏)。"""

    @override_settings(NAV_BASE_TEMPLATE='nav/base.html')
    def test_page_renders_with_standalone_base(self):
        response = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, response.status_code)
        # 独立 base 的容器 class 只在 nav/base.html 里出现
        self.assertContains(response, 'nav-container')
        self.assertNotContains(response, '_navbar')
        # PWA 壳只挂在独立 base 上,宿主模式(默认 NAV_BASE_TEMPLATE)不加载
        self.assertContains(response, 'rel="manifest"')
        self.assertContains(response, 'navigator.serviceWorker.register')

    @override_settings(NAV_BASE_TEMPLATE='nav/base.html')
    def test_mobile_platform_baseline_is_present(self):
        """手机平台层不能只靠口头约定:viewport / 安全区 / 触屏输入 / dvh 都要在产物里。"""
        response = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, response.status_code)
        page = response.content.decode('utf-8')
        css = static_text('css/nav-sites.css')
        self.assertIn('viewport-fit=cover', page)
        self.assertIn('interactive-widget=resizes-content', page)
        self.assertIn('apple-mobile-web-app-capable', page)
        self.assertIn('id="navThemeColorMeta"', page)
        self.assertIn('-webkit-tap-highlight-color: transparent', css)
        self.assertIn('env(safe-area-inset-top', css)
        self.assertIn('100dvh', css)
        self.assertIn('minmax(160px, 1fr)', css)


class NavPwaTests(TestCase):
    """PWA 壳:manifest / SVG 图标 / service worker 三个纯只读端点。"""

    def test_manifest_shape(self):
        response = self.client.get(reverse('nav_manifest'))
        self.assertEqual(200, response.status_code)
        self.assertEqual('application/manifest+json', response['Content-Type'])
        payload = json.loads(response.content)
        start = reverse('nav_sites')
        self.assertEqual(start, payload['start_url'])
        self.assertEqual(start if start.endswith('/') else start.rsplit('/', 1)[0] + '/',
                         payload['scope'])
        self.assertEqual('standalone', payload['display'])
        self.assertEqual(reverse('nav_pwa_icon'), payload['icons'][0]['src'])

    def test_icon_is_svg(self):
        response = self.client.get(reverse('nav_pwa_icon'))
        self.assertEqual(200, response.status_code)
        self.assertEqual('image/svg+xml', response['Content-Type'])
        self.assertIn(b'<svg', response.content)

    def test_service_worker_js(self):
        response = self.client.get(reverse('nav_sw'))
        self.assertEqual(200, response.status_code)
        self.assertEqual('application/javascript', response['Content-Type'])
        body = response.content.decode()
        self.assertIn("addEventListener('fetch'", body)
        self.assertIn('skipWaiting', body)
        # API 与 admin 不缓存,避免污染写接口
        self.assertIn("'/api/'", body)


class NavBrandTests(TestCase):
    """品牌(2026-11-14 改名「寻花集」):名字与标识只能有一份,标题 / 顶栏 / PWA 三处必须一致。

    之前顶栏是 fa-compass + sfloraNav、PWA 图标是紫底指南针、manifest 叫"网址导航",
    三处三个说法。现在统一取自 nav.brand。
    """

    def test_title_topbar_and_pwa_share_one_brand(self):
        from nav.brand import BRAND_NAME

        page = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('<title>%s · ' % BRAND_NAME, page)
        self.assertIn('nav-brand__name">%s<' % BRAND_NAME, page)
        self.assertIn('class="nav-brand__mark"', page)
        # 顶栏标识是内联 SVG(跟着字号缩放),不是 <i class="fas ...">
        self.assertIn('aria-label="%s"' % BRAND_NAME, page)
        self.assertNotIn('fa-compass', page)

        payload = json.loads(self.client.get(reverse('nav_manifest')).content)
        self.assertEqual(BRAND_NAME, payload['name'])
        self.assertEqual(BRAND_NAME, payload['short_name'])

    def test_pwa_icon_is_the_same_mark(self):
        """图标端点必须原样返回 nav.brand 里那份 —— 别两边各画一个。"""
        from nav.brand import BRAND_MARK_SVG

        response = self.client.get(reverse('nav_pwa_icon'))
        self.assertEqual('image/svg+xml', response['Content-Type'])
        self.assertEqual(str(BRAND_MARK_SVG), response.content.decode('utf-8'))
        # 印面是镂空(mask),不是白底方块 —— 换深色主题不会冒白块
        self.assertIn('mask id="xhjSeal"', response.content.decode('utf-8'))


class NavToolEditTests(TestCase):
    """工具编辑:只改名称/大类/简介,文件与 pk 不动(托管地址不变,工具自己的本机数据保留)。"""

    HTML = b'<!DOCTYPE html><html><head><title>calc</title></head><body><h1>1+1</h1></body></html>'

    def setUp(self):
        import shutil
        import tempfile
        from .models import NavTool
        from django.core.files.base import ContentFile
        self.tmp = tempfile.mkdtemp(prefix='nav_tool_edit_')
        self._override = override_settings(MEDIA_ROOT=self.tmp)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.addCleanup(shutil.rmtree, self.tmp, True)
        NavTool.objects.all().delete()
        self.tool = NavTool.objects.create(name='报价器', category='报价计算', description='旧简介')
        self.tool.file.save('calc.html', ContentFile(self.HTML), save=True)

    def test_edit_keeps_pk_file_and_updates_text_fields(self):
        pk, path = self.tool.pk, self.tool.file.path
        resp = self.client.post(reverse('nav_tool_edit'),
                                json.dumps({'id': pk, 'name': '新报价器', 'category': '工具',
                                            'description': '新简介'}),
                                content_type='application/json')
        self.assertEqual(200, resp.status_code)
        self.tool.refresh_from_db()
        self.assertEqual(pk, self.tool.pk)
        self.assertEqual(('新报价器', '工具', '新简介'),
                         (self.tool.name, self.tool.category, self.tool.description))
        self.assertEqual(path, self.tool.file.path)
        self.assertIn(b'<h1>1+1</h1>',
                      self.client.get(reverse('nav_tool_open', args=[pk])).content)

    def test_edit_rejects_empty_duplicate_and_missing(self):
        from .models import NavTool
        NavTool.objects.create(name='别的工具')
        url = reverse('nav_tool_edit')
        self.assertEqual(400, self.client.post(url, json.dumps({'id': self.tool.pk, 'name': '  '}),
                                               content_type='application/json').status_code)
        self.assertEqual(400, self.client.post(url, json.dumps({'id': self.tool.pk, 'name': '别的工具'}),
                                               content_type='application/json').status_code)
        self.assertEqual(404, self.client.post(url, json.dumps({'id': 999999, 'name': 'X'}),
                                               content_type='application/json').status_code)
        self.assertEqual(400, self.client.post(url, 'null', content_type='application/json').status_code)

    def test_page_has_tool_edit_button_and_endpoint(self):
        """契约:工具卡片真的挂了编辑入口(断言渲染产物,不是只测接口)。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn('/api/nav/tools/edit/', html)
        self.assertIn('toolEditModal', html)
        self.assertIn('class="tool-edit"', html)


class NavUiModeTests(TestCase):
    """设置面板收敛:界面预设只保留浏览/专注;卡片操作按钮合并为一个常显开关。"""

    SWITCHES = ('setShowClock', 'setShowSearch', 'setShowRecent',
                'setShowUrl', 'setCardActions', 'setShowActions')

    def test_mode_row_and_all_switches_rendered(self):
        """契约:模式行 + 各开关各只渲染一份。2026-11-09 起模式行有两个入口
        (齿轮快捷下拉与全部设置抽屉),所以每档按钮恰好 2 次;开关仍只有抽屉里那一份。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        for mode in ('browse', 'zen'):
            self.assertEqual(2, html.count('data-ui-mode="%s"' % mode), mode)
        # 原「编辑」模式档已撤销,不应再渲染
        self.assertEqual(0, html.count('data-ui-mode="edit"'))
        self.assertEqual(1, html.count('id="setFineTune"'))
        for sid in self.SWITCHES:
            self.assertEqual(1, html.count('id="%s"' % sid), sid)

    def test_card_actions_unified_pref_and_css(self):
        """契约:编辑/删除合并为 navShowActions;默认悬停出,.show-actions 常驻;旧键一次性迁移。

        2026-11-19 追加总开关:navShowCardActions=0 → .hide-actions,悬停/常显/触屏都不出。
        """
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        js = static_text('js/nav-sites.js')
        css = static_text('css/nav-sites.css')
        self.assertIn('id="setShowActions"', html)
        self.assertIn('navShowActions', js)
        # 总开关(2026-11-19 用户要求「常驻的这两个按钮支持关闭」)
        self.assertIn('id="setCardActions"', html)
        self.assertIn('navShowCardActions', js)
        self.assertIn(".nav-hub.hide-actions .site-card-box .site-edit", css)
        # 迁移:旧 edit/delete 键任一为 1 → 新键 1,旧键清掉
        self.assertIn("localStorage.getItem('navShowEdit')", js)
        self.assertIn("localStorage.removeItem('navShowEdit')", js)
        self.assertIn("localStorage.removeItem('navShowDelete')", js)
        # CSS:悬停露出 + 常显常驻两条规则都在
        self.assertIn('.site-card-box:hover .site-edit', css)
        self.assertIn('.nav-hub.show-actions .site-card-box .site-edit', css)
        # 旧 hub 类不再被样式引用
        self.assertNotIn('show-edit', css)
        self.assertNotIn('show-delete', css)

    def test_quick_menu_sections_and_theme_merged(self):
        """契约:快捷设置按 外观/排列/显隐 分区;皮肤并入外观;顶栏不再有独立调色板入口。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        css = static_text('css/nav-sites.css')
        theme_js = static_text('js/theme.js')
        # 三个分区标题都在同一个下拉里
        for label in ('外观', '排列', '显隐'):
            self.assertIn(label, html)
        # 皮肤按钮在快捷设置内(不再有独立下拉)
        quick = html.split('id="navQuickSettingsMenu"', 1)[1].split('id="navOpenAllSettings"', 1)[0]
        self.assertIn('id="navThemeMenu"', quick)
        self.assertIn('data-nav-theme="aurora"', quick)
        self.assertIn('id="navFxToggle"', quick)
        self.assertNotIn('id="navThemeToggle"', html)
        # 皮肤按钮是 .btn 网格,不再是 dropdown-item / .show 规则
        self.assertIn('.nav-quick-theme-grid {', css)
        self.assertIn('grid-template-columns: repeat(3, minmax(0, 1fr))', css)
        self.assertNotIn('#navThemeMenu.show', css)
        # theme.js 按 [data-nav-theme] 选中,不再依赖 .dropdown-item
        self.assertIn("$('#navThemeMenu').on('click', '[data-nav-theme]'", theme_js)
        self.assertIn("$('#navThemeMenu [data-nav-theme]')", theme_js)

    def test_wallpaper_mode_locks_ineffective_appearance_controls(self):
        """契约:图片壁纸盖住主题底色/特效层时,明暗/皮肤/特效要禁用并压灰,清壁纸后解锁。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        theme_js = static_text('js/theme.js')
        css = static_text('css/nav-sites.css')
        for ident in ('navWallLockHintQuick', 'navWallLockHintFull'):
            self.assertIn(f'id="{ident}"', html)
        self.assertIn('function navApplyWallLocks()', theme_js)
        self.assertIn("document.body.dataset.navWall === '1'", theme_js)
        self.assertIn("$('#navColorModeGroup, #navThemeMenu, #navThemeGroup')", theme_js)
        self.assertIn("prop('disabled', locked)", theme_js)
        self.assertIn('navApplyWallLocks();', theme_js)
        self.assertIn('.nav-wall-locked', css)
        # 「清除壁纸」抽成 navClearWallpaper(对外 window.navClearWallpaper),
        # 必须连 Bing/随机图源一起清(removeItem navBgSource),否则壁纸和置灰锁退不出去;
        # 清完走 navApplyTheme 重跑 navApplyWallLocks:解除 body[data-nav-wall] 锁,
        # 明暗/皮肤/特效控件恢复可用(locked=false 分支恢复 disabled/aria-disabled)。
        self.assertIn('function navClearWallpaper()', theme_js)
        clear_fn = theme_js.split('function navClearWallpaper()', 1)[1].split('window.navClearWallpaper', 1)[0]
        self.assertIn("removeItem('navBgSource')", clear_fn)
        self.assertIn('navApplyTheme(', clear_fn)
        self.assertIn('delete document.body.dataset.navWall', theme_js)
        self.assertIn("navApplyWallLocks();", theme_js)
        self.assertIn(".attr('aria-disabled', locked ? 'true' : 'false')", theme_js)

    def test_toc_settings_owns_visibility(self):
        """契约:目录显隐主开关在目录齿轮里,快捷设置留一个同步入口;抽屉里不再重复一份。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        js = static_text('js/nav-sites.js')
        toc_menu = html.split('id="tocSettingsMenu"', 1)[1].split('id="tocStyleGroup"', 1)[0]
        self.assertIn('id="setShowToc"', toc_menu)
        self.assertIn('id="navQuickShowToc"', html)
        # 抽屉的逐项微调里没有第三个开关
        drawer = html.split('id="setFineTune"', 1)[1].split('id="setShowHealth"', 1)[0]
        self.assertNotIn('id="setShowToc"', drawer)
        # 两个入口同键同步
        self.assertIn("#setShowToc, #navQuickShowToc", js)
        self.assertIn("$('#setShowToc, #navQuickShowToc').prop('checked'", js)

    def test_quick_menu_and_drawer_split(self):
        """契约:齿轮只留高频三组(明暗/布局/界面模式)加「全部设置」入口,
        完整面板——主题皮肤/壁纸/分类排序/内置站点维护——收进右侧 offcanvas 抽屉。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        # 快捷下拉
        self.assertIn('id="navQuickSettingsMenu"', html)
        # 2026-11-24:明暗三档(自动/浅/深)压成一档「跟随系统」——深色需求交给「极光」皮肤
        # (aurora 是唯一常驻深色;ink 是宣纸米白,study 只在 dark 下才转深)。
        # 老值 dark/light 迁移到对应皮肤再记 auto(迁移脚本必须早于首帧 apply)。
        self.assertIn('id="setColorModeAuto"', html)
        self.assertIn('跟随系统明暗', html)
        self.assertNotIn('data-nav-color-mode="light"', html)
        self.assertNotIn('data-nav-color-mode="dark"', html)
        self.assertIn("localStorage.setItem('navTheme', 'aurora')", html)
        self.assertIn("return v === 'manual' ? 'manual' : 'auto'", html)
        self.assertIn('id="navQuickLayoutGroup"', html)
        self.assertIn('id="navQuickUiModeGroup"', html)
        # 全部设置入口 -> 抽屉
        self.assertIn('id="navOpenAllSettings"', html)
        self.assertIn('offcanvas offcanvas-end" tabindex="-1" id="navSettingsMenu"', html)
        # 2026-11-14:抽屉从 2 个 tab 拆成 4 个(外观 / 效果 / 内容 / 分类),按"改什么"分组
        self.assertEqual(4, html.count('data-bs-target="#setTab'))
        self.assertIn('id="setTabFx"', html)
        self.assertIn('id="setTabContent"', html)
        self.assertNotIn('id="setTabBuiltin"', html)
        self.assertIn('id="setTabSort"', html)
        self.assertIn('id="navResetBtn"', html)
        self.assertNotIn('id="setTabWall"', html)  # 壁纸并入「外观」页签(2026-11-18)
        # 2026-11-18 重组契约:壁纸/卡片布局/图标本地化 各归其 tab
        view_seg = html.split('id="setTabView"', 1)[1].split('id="setTabFx"', 1)[0]
        self.assertIn('nav-set-h">壁纸', view_seg)
        self.assertIn('nav-set-h">主题皮肤', view_seg)
        self.assertNotIn('id="navLayoutGroup"', view_seg)          # 卡片布局迁去「布局」
        content_seg = html.split('id="setTabContent"', 1)[1].split('id="setTabSort"', 1)[0]
        self.assertIn('id="navLayoutGroup"', content_seg)
        self.assertNotIn('nav-set-h">壁纸', content_seg)          # 壁纸不再在布局页
        sort_seg = html.split('id="setTabSort"', 1)[1]
        self.assertIn('id="navFavLocalBtn"', sort_seg)             # 图标本地化归「维护」
        self.assertIn('nav-set-h">图标资产', sort_seg)
        self.assertIn('id="navWallMaskR"', html)
        self.assertIn('id="catOrderList"', html)
        # 抽屉靠 .offcanvas-body 自己滚,原来内层的 58vh 双滚动已去掉
        self.assertNotIn('58vh', html)

    def test_wall_tab_is_restored(self):
        """契约:上次所在 tab 的白名单含 4 个真实页签(曾漏 wall,壁纸页永不恢复)。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn("'view', 'content', 'fx', 'sort'", html)

    def test_shim_fires_shown_bs_tab_the_page_listens_for(self):
        """契约:独立壳的垫片必须发 shown.bs.tab——页面记「上次所在 tab」只听这个事件。

        2026-10-12 实测不合格:Tab 只派发 click、从不发事件,navSetTab 永远 null。
        两边分开断言,任何一侧被改回去都会红。
        """
        here = os.path.dirname(os.path.abspath(__file__))
        shim = open(os.path.join(here, 'static', 'bootstrap-shim.js'), encoding='utf-8').read()
        # 2026-11-07 脚本外置:监听代码在 static/js/nav-sites.js 里
        tpl = open(os.path.join(here, 'static', 'js', 'nav-sites.js'), encoding='utf-8').read()
        self.assertIn("uiFire(toggle, 'shown.bs.tab')", shim)
        self.assertIn("on('shown.bs.tab'", tpl)


class NavLayoutDepSettingsTests(TestCase):
    """只对特定布局生效的设置项,在不适用的布局下直接隐藏(2026-10-25 用户拍板:
    选了没反应像坏了,不如藏掉)——布局细节四下拉仅大图标;详细网址开关极简布局无效。"""

    def test_icon_extras_block_and_sync_function_rendered(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertEqual(1, html.count('id="setIconBlock"'))
        self.assertIn('navSyncLayoutDeps', html)
        # 同步逻辑确实挂在布局切换上(applyNavLayout 调用)
        self.assertIn('navSyncLayoutDeps(v);', html)

    def test_url_switch_hidden_in_min_layout_only(self):
        """极简布局 CSS 写死隐藏 site-url,开关无效 → 极简时藏;其他布局仍显示。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn("layout === 'min'", html)


class NavTopbarHelpTests(TestCase):
    """搜索框旁的 `?`:曾并排挂着两个几乎重复的快捷键说明(文字还不同步)。

    2026-11-13 起只剩页面中央一个超级搜索框,那一个 `?` 搬到了框内右侧,
    顶栏不再有第二个搜索框,也就不会再有第二份说明。
    """

    def test_search_box_keeps_symmetric_without_help_icon(self):
        """2026-11-14:胶囊里那个 ? 已删除(左右不对称,且挤压输入宽度)。

        快捷键不再写在页面上,改由占位符 + 键盘实现承担,这里反过来钉住"别再塞回去"。
        """
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        start = html.index('id="navWebSearch"')
        box = html[start:start + 4000]
        box = box[:box.index('</form>')]
        self.assertEqual(0, box.count('nav-help'), '搜索胶囊里不该再有 ? 图标')
        self.assertIn('Enter', box)           # 占位符仍写明 Enter 走全网搜索
        # 快捷键仍然可用,只是不写在框里(Ctrl+K 的实现在 stars-filter.js)
        self.assertIn("e.ctrlKey || e.metaKey", static_text('js/stars-filter.js'))
        self.assertIn('ArrowDown', static_text('js/nav-search.js'))

    def test_topbar_has_no_second_search_box(self):
        """顶栏那个过滤框已并入中央搜索框,只留一个 hidden 取值节点。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        head = html[html.index('class="nav-topbar"'):html.index('id="navQuickRow"')]
        self.assertIn('id="navSearch"', head)     # 过滤管道的取值落点还在
        self.assertIn('type="hidden"', head)
        self.assertNotIn('nav-find', head)        # 但不再是可见输入框
        self.assertNotIn('nav-find', static_text('css/nav-sites.css'))

    def test_superseded_second_wording_is_gone(self):
        """被合并掉的那半句措辞(「聚焦全网搜索框」)不该再出现在页面上。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertNotIn('聚焦全网搜索框', html)


class NavClockWidgetTests(TestCase):
    """日历 + 自定义倒计时小组件:挂「显示时钟问候」开关,纯前端,服务端只渲染挂载点与管理入口。"""

    def _page(self):
        return (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))

    def test_page_renders_clock_extra_and_manager(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        for frag in ('id="navClockExtra"', 'id="navCalBox"', 'id="navCdBox"',
                     'id="navCdManager"', 'id="navCdList"', 'id="navCdTitle"',
                     'id="navCdDate"', 'id="navCdAdd"'):
            self.assertIn(frag, html)

    def test_clock_switch_controls_extra_row(self):
        """时钟开关显隐必须同时管住附加行(日历/倒计时),否则关了时钟它们还挂在那。

        开关本身在主脚本(UI 模式 apply),逐项开关处理器在 theme.js(2026-10-25 第六刀)——两处都要管。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        theme_js = _theme_js()
        self.assertIn("$('#navClockExtra').toggleClass('d-none', !on)", html)
        self.assertIn("$('#navClockExtra').toggleClass('d-none', !this.checked)", theme_js)
        self.assertIn("$('#navClockExtra').toggleClass('d-none', !showClockOn)", theme_js)
        self.assertIn('if (window.navTickClock) navTickClock()', html)   # 主脚本经 window 调 theme.js

    def test_calendar_uses_local_date_not_utc(self):
        """日历必须用本地时间(AGENTS.md UTC 坑):navRenderCal 里不许出现 toISOString。"""
        theme_js = _theme_js()
        cal = theme_js[theme_js.index('function navRenderCal'):]
        cal = cal[:cal.index('const navCdKey')]
        self.assertNotIn('toISOString', cal)
        self.assertIn('getFullYear', cal)
        self.assertIn('今年第', cal)

    def test_countdown_storage_key_and_labels(self):
        theme_js = _theme_js()
        self.assertIn("'navCountdowns'", theme_js)
        self.assertIn('就是今天', theme_js)
        self.assertIn('已到期', theme_js)


class NavModalUxTests(TestCase):
    """弹窗体验轮(2026-10-25,ui-polish):可拖拽/缩放/动画;JSON 导入先预览;
    书签预览可勾选;上传工具回填;测活只看打不开;AI 找网站不再内嵌接口设置。"""

    def test_template_marks(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        # A/B:JSON 导入预览 + 勾选(JS 在 import-export.js,弹窗壳在页面)
        ie_js = _ie_js()
        self.assertIn('navJsonPreview', ie_js)
        self.assertIn('bmExcluded', ie_js)
        self.assertIn('id="bmModalTitle"', html)
        # C:上传工具回填
        self.assertIn("$('#toolFile').on('change'", html)
        # D:只看打不开(开关在页面,行标记逻辑在 linktest.js)
        self.assertIn('id="ltFailOnly"', html)
        self.assertIn('data-lt-ok', _lt_js())
        # E:AI 找网站内嵌接口设置已删(输入框/保存函数都不该再有)
        self.assertNotIn('id="navAiBase"', html)
        self.assertNotIn('navAiSaveConfig', html)
        # 2026-10-29:接口配置只留顶栏「AI 接口」一处,AI 找网站弹窗里连状态/入口也不再重复
        self.assertIn('data-on-click="petAiOpen"', html)      # 顶栏全局入口仍在(改为委托)
        self.assertNotIn('id="navAiStatus"', html)
        self.assertNotIn('去配置', html)
        island = re.search(r'<script id="navAiUrls" type="application/json">(.*?)</script>',
                           html, re.S)
        self.assertIsNotNone(island)
        self.assertNotIn('/api/nav/ai/config/', island.group(1))   # 找网站不再读配置
        self.assertNotIn('config', _json.loads(island.group(1)))

    def test_shim_movable_and_animation(self):
        import os as _os
        shim = open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                  'static', 'bootstrap-shim.js'), encoding='utf-8').read()
        self.assertIn('uiMakeMovable', shim)      # 拖拽 + 缩放
        self.assertIn('uiModalIn', shim)          # 入场动画
        self.assertIn('prefers-reduced-motion', shim)   # 减少动态退化

    def test_modal_width_is_not_blown_up(self):
        """2026-10-29 用户实测「AI 接口弹窗铺满整屏」:
        兼容层里 .modal-dialog 是 w-auto,宽度只由 max-width 约束;垫片必须先量出上限
        落成显式宽度、再放开 max-width,否则 width:auto 会铺满。modal-sm 也补回 300px。"""
        import os as _os
        shim = open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                  'static', 'bootstrap-shim.js'), encoding='utf-8').read()
        self.assertLess(shim.index('getComputedStyle(dialog).maxWidth'),
                        shim.index("dialog.style.maxWidth = 'none'"))
        self.assertIn('_uiBaseWidth', shim)              # 双击复位要能回到原尺寸
        self.assertIn('calc(100vw - 2rem)', shim)        # 窄屏随视口收窄
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn('.modal-dialog.modal-sm', _css('css/tailwind.gen.css'))    # 小弹窗(图标选择等)回到 Bootstrap 口径


class NavMaintenanceTests(TestCase):
    """保养页(2026-10-30 由「健康总览」升级):体检 + 使用两轴,纯前端零后端。
    分档逻辑是 health.js 里的纯函数 navMaintenanceBuckets,已用 Node 探针单独验过
    (坏站只进 broken、不重复出现在使用/体检档,空输入与缺字段不炸);这里锁页面与脚本契约。"""

    def test_page_marks(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn('id="navHealthTabBtn"', html)
        self.assertIn('🩺 保养', html)
        self.assertNotIn('🩺 健康总览', html)
        for frag in ('data-created=', 'data-cat=', '.mp-row', '.mp-name', '.mp-ops'):
            self.assertIn(frag, html, frag)
        # 卡片真的带秒级收录时间(不是空属性)
        self.assertRegex(html, r'data-created="\d+"')
        # 抽屉仍只有三个页签:保养是升级健康总览,不是另开第四页
        self.assertEqual(html.count('id="navBasketTabBtn"') + html.count('id="navHealthTabBtn"') +
                         html.count('id="navHygieneTabBtn"'), 3)

    def test_health_js_maintenance_contract(self):
        js = _health_js()
        for frag in ('navMaintenanceBuckets', 'window.navMaintenanceBuckets',
                     'SLEEP_DAYS = 90', 'NEW_DAYS = 30', 'CHECK_STALE_DAYS',
                     "window.navLsGet ? window.navLsGet('navRecent')",
                     '从没记录到点击', '判断不了', '点「修」',
                     'mpEntries', 'mpSection', 'mpOpen', 'mpStarBtn', 'mpFix',
                     "this.getAttribute('data-created')", "this.getAttribute('data-cat')",
                     "this.getAttribute('data-clicks')", '.site-check-bad',
                     'basketUrls[it.url] = 1', 'window.navTouchRecent(en.url)',
                     "const $cardStar = $(en.el).find('.site-star')",
                     "$cardStar.trigger('click')"):
            self.assertIn(frag, js, frag)
        # 旧的"只按体检分三档、超出 10 条略过"实现已经不在
        self.assertNotIn("section('💤 从未体检'", js)
        self.assertNotIn('…其余 ', js)


class NavThemePolishTests(TestCase):
    """主题美化轮(2026-10-26):纸质 2.0 / 极光海洋 accent 贯通 / 全局微交互 / 新增书房。"""

    def test_theme_marks(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        # A:纸质 2.0(印章褐 accent + 纸边硬阴影)。2026-11-10 设计系统轮:纸边硬影保留,
        #   叠加一层极淡环境影把卡片从底色里浮起来,取 0.16 那版
        self.assertIn('--nav-accent: #a06a3c', html)
        self.assertIn('1px 2px 0 rgba(140, 120, 80, .16)', html)
        # B:极光青 accent 贯通(海洋已退役,2026-11-18)
        self.assertIn('--nav-accent: #14b8a6', html)
        self.assertIn('rgba(45, 255, 196, .55)', html)
        # C:全局悬停浮起 + 减少动态豁免 + 标题色条(墨/杂志/书房豁免)
        self.assertIn('body[data-nav-theme] .site-card:hover { transform: translateY(-1px); }', html)
        self.assertIn('body[data-nav-theme] .site-card:hover { transform: none; }', html)
        self.assertIn('body:not([data-nav-theme="ink"]):not([data-nav-theme="study"]) .nav-hub .nav-cat-title', html)
        # D:书房主题 + 两个菜单入口(快捷设置「外观」并入皮肤后是两处按钮)
        self.assertIn('data-nav-theme="study"', html)
        self.assertIn('墨绿书房', html)
        self.assertEqual(2, html.count('data-nav-theme="study" title='))   # 快捷设置 + 设置面板


class NavStaticVersionTests(TestCase):
    """静态引用必须带 `?v={{ static_version }}`(2026-11-10 补的守卫)。

    铁律是「改完 JS/CSS 普通刷新即生效」,靠的就是这个后缀;漏掉的文件会一直吃旧缓存,
    表现为「改了没反应」。2026-11-10 体检时 nav 模板里有 9 处漏了 —— 其中 `js/theme.js`
    恰好是当天刚改过的那个,最该刷新的反而没刷新;顺手全项目扫了一遍,宿主 `searchapp`
    的外壳(themes/app-shell/css 与 themes/prompt_handoff/reveal_feedback/ui_feedback)
    和三个线索页共用的 `lead-pages.css` 同样漏了,一并补齐,守卫也一起覆盖这两个目录。

    vendor(字体图标 / jQuery)属「装进来就不改」的第三方件:
    它们不参与版本号,否则改一行自家 CSS 就会让 350KB 的 vendor 文件跟着失效重下。
    (浏览器版 Tailwind 运行时 2026-11-12 已删除,换成预编译的 `css/tailwind.gen.css`,
     它算自家产物、照常带版本号,所以豁免表里不再留它。)
    """

    EXEMPT = ('vendor/',)
    TEMPLATES = os.path.join(os.path.dirname(__file__), 'templates', 'nav')
    # 同一套规矩也适用于宿主的 searchapp 模板(2026-11-10 一起补的;外壳 css/js 也漏过)
    TEMPLATE_DIRS = (TEMPLATES, os.path.join(os.path.dirname(os.path.dirname(__file__)),
                                             'searchapp', 'templates', 'searchapp'))

    def _template_files(self):
        found = []
        for base in self.TEMPLATE_DIRS:
            for root, _dirs, files in os.walk(base):
                for name in files:
                    if name.endswith('.html'):
                        found.append(os.path.join(root, name))
        self.assertTrue(found, '没找到模板,路径常量是不是又漂了')
        return found

    def test_every_editable_static_ref_carries_version(self):
        pattern = re.compile(r"\{%\s*static\s+'([^']+)'\s*%\}(?P<suffix>\?v=\{\{\s*static_version\s*\}\})?")
        missing = []
        for path in self._template_files():
            with open(path, encoding='utf-8') as fh:
                text = fh.read()
            for m in pattern.finditer(text):
                ref = m.group(1)
                if not ref.endswith(('.js', '.css')):
                    continue                       # 图片/字体/地图 JSON 走的是别处的构建产物
                if ref.startswith(self.EXEMPT) or ref in self.EXEMPT:
                    continue
                if not m.group('suffix'):
                    missing.append('%s -> %s' % (os.path.relpath(path, os.path.dirname(os.path.dirname(__file__))), ref))
        self.assertEqual([], missing, '这些静态引用漏了 ?v=,浏览器会一直吃旧缓存:\n' + '\n'.join(missing))

    def test_static_version_is_used_on_the_three_entry_scripts(self):
        """最容易忘的四个入口显式点名:漏了它们,整页交互全用旧代码。"""
        # 注意:断言字符串里有 `{%` / `%}`,不能用 `%` 或 `.format()` 拼接(会把 `%}` 当格式符)
        with open(os.path.join(self.TEMPLATES, 'nav_sites.html'), encoding='utf-8') as fh:
            text = fh.read()
        for ref in ('css/nav-sites.css', 'js/nav-sites.js', 'js/stars-filter.js', 'js/pet.js'):
            self.assertIn("{% static '" + ref + "' %}?v={{ static_version }}", text, ref)


import pathlib
from django.conf import settings


def _css(rel):
    """读静态 CSS(预编译后,样式断言不能再从页面 HTML 里找)。"""
    return (pathlib.Path(settings.BASE_DIR) / 'nav' / 'static' / rel).read_text(encoding='utf-8')
