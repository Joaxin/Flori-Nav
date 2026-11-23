# nav/tests_nav_sites.py
"""站点增删改 / 层级 / 排序 / 归档恢复 / 标签与筛选(2026-11-07 从 nav/tests.py 按域拆出)。

只跑本域:`python manage.py test nav.tests_nav_sites`;公共底座见 `tests_nav_common.py`。
"""
from .tests_nav_common import (
    NavCategory,
    NavSite,
    SimpleUploadedFile,
    TestCase,
    _batch_js,
    _health_js,
    _json,
    _stars_js,
    json,
    mock,
    os,
    re,
    reverse,
    static_text,
)


class NavSiteTests(TestCase):
    """网址导航(通用模块):种子、增删、JSON 导入导出。"""

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def test_backdrop_click_closes_overlay(self):
        """遮罩必须能点掉浮层:否则抽屉留在页面上、透明遮罩吃掉所有点击。"""
        shim = (__import__('pathlib').Path(__file__).resolve().parent
                / 'static' / 'bootstrap-shim.js').read_text(encoding='utf-8')
        self.assertIn("backdropEl.addEventListener('click'", shim)
        self.assertIn("document.querySelector('.offcanvas.showing", shim)

    def test_columns_layout_controls(self):
        """2026-11-23:六档布局回迁,分栏控件与 mag/min/cols 规则回归;
        card/icon/list 三档规则仍在。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        js = static_text('js/nav-sites.js')
        css = static_text('css/nav-sites.css')
        # 分栏从属控件重新渲染
        for back_id in ('setColsCount', 'setCardsCols', 'setColsBlock'):
            self.assertIn('id="%s"' % back_id, html)
        # 六档选择器 / 数据属性 / 从属变量在模板与 CSS 双侧都在
        for restored in ('lyr-mag', 'lyr-min', 'lyr-cols', 'data-cards-cols',
                         '--cols-count', 'cols-even'):
            self.assertIn(restored, css, 'CSS 缺回迁布局规则: ' + restored)
        for restored in ('mag', 'min', 'cols'):
            self.assertIn(restored, html, '模板缺回迁布局标记: ' + restored)
        self.assertIn('data-cards-cols', js, 'JS 缺每栏条目数据属性')
        # 保留档规则仍在:默认卡片 280px 栅格 + 大图标 + 媒体行
        self.assertIn('minmax(280px, 1fr)', css)
        self.assertIn('.nav-hub.lyr-icon .site-card', css)
        self.assertIn('.nav-hub.lyr-list .site-card', css)
        # 白名单恢复六值
        self.assertIn("['card', 'icon', 'list', 'mag', 'min', 'cols']", js)
        self.assertIn('NAV_LAYOUT_SURVIVORS', js)

    def test_settings_view_tab_is_grouped(self):
        """全部设置按 tab 分段:
        外观=语言/配色/主题皮肤/壁纸,布局=卡片布局/卡片密度/卡片排序/显示内容/目录与页面/设置按钮/交互,
        效果=页面效果,维护=图标资产/内置站点 —— 共 15 段。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for label in ('语言', '配色', '主题皮肤', '壁纸', '卡片布局', '卡片密度', '卡片排序', '显示内容', '目录与页面',
                      '设置按钮', '交互', '页面效果', '图标资产', '内置站点'):
            self.assertIn('class="nav-set-h">' + label, html)
        self.assertEqual(15, html.count('class="nav-set-h"'))

    def test_pinyin_initial_is_server_rendered_with_toggle(self):
        """首字母不再依赖手动刷新静态表:服务端随卡片渲染写 data-initial;前端可开关且 ≥3 个字母才参与。"""
        from .pinyin import name_initial
        self.assertEqual('db', name_initial('豆包'))
        self.assertEqual('abc123', name_initial('abc123'))

        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        stars = _stars_js()
        suggest = static_text('js/nav-search.js')
        self.assertIn('id="setPinyinSearch"', html)
        self.assertIn('data-initial="', html)
        self.assertNotIn('pinyin-init.js', html)
        self.assertIn('navPinyinSearch', stars)
        self.assertIn('PINYIN_MIN_LEN = 3', stars)
        self.assertIn('q.length >= PINYIN_MIN_LEN', stars)
        self.assertIn('data-initial', stars)
        self.assertIn('it.initial', suggest)

    def test_drawer_push_is_recomputed(self):
        """常驻↔抽屉切换必须重算推开量,否则抽屉盖住卡片。"""
        js = static_text('js/nav-sites.js')
        self.assertGreaterEqual(js.count('tocSyncPush()'), 4)
        self.assertIn("main.style.marginLeft = '0px';", js)

    def test_toc_drawer_card_look(self):
        """目录抽屉对齐 Nav Hub:卡片化(14px 圆角/阴影)、行圆角、卡片 12px 圆角。
        2026-11-18:卡片内边距 9/11 → 12/14(呼吸感微调,三刀手术之一)。"""
        css = static_text('css/nav-sites.css')
        self.assertIn('border-radius: var(--nav-r-lg); background: var(--bs-body-bg);', css)
        self.assertIn('width: 208px', css)
        self.assertIn('border-radius: var(--nav-r-md); line-height: 1.35;', css)
        self.assertIn('border-radius: var(--nav-r-md); padding: 12px 14px;', css)

    def test_toc_scrollspy_backtop_and_new_dot(self):
        """参考 Nav Hub 的三处体验:目录跟随高亮、回到顶部、新站红点。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        ux = static_text('js/nav-ux.js')
        css = static_text('css/nav-sites.css')
        self.assertIn('id="navBackTop"', html)
        self.assertIn('js/nav-ux.js', html)
        self.assertIn('updateSpy', ux)
        self.assertIn('site-new-dot', ux)
        self.assertIn('#navBackTop.show', css)
        self.assertIn('.nav-toc .toc-scroll a.active', css)

    def test_local_network_recheck_button(self):
        """服务端测活之外,前端要有「本机复测」:no-cors 探测 + 差异标记。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        js = static_text('js/linktest.js')
        css = static_text('css/nav-sites.css')
        self.assertIn('id="ltLocalRun"', html)
        self.assertIn('本机复测', html)
        self.assertIn("mode: 'no-cors'", js)
        self.assertIn('ltLocalProbe', js)
        self.assertIn('site-local-bad', js)
        self.assertIn('.site-card.site-local-bad', css)

    def test_font_scale_control_and_responsive_modals(self):
        """字号档位按钮 + 宽屏自动放大 + 弹窗按 vw 自适应。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        js = static_text('js/nav-sites.js')
        css = static_text('css/nav-sites.css')
        self.assertIn('id="navFontScaleGroup"', html)
        self.assertIn('data-nav-fs="lg"', html)
        self.assertIn('navFontScale', js)
        self.assertIn('--nav-fs', css)
        self.assertIn('calc(.9rem * var(--nav-fs))', css)
        # 弹窗宽度必须跟视口走,不能退回写死的 max-w-lg
        self.assertRegex(_css('css/tailwind.gen.css'), r'width:\s*min\(92vw,?\s*560px\)')
        self.assertRegex(_css('css/tailwind.gen.css'), r'width:\s*min\(94vw,?\s*980px\)')

    def test_toc_drawer_settings_menu_is_not_clipped(self):
        """抽屉模式:目录容器放开 overflow,设置菜单右对齐,否则菜单被 280px 边框裁掉。"""
        css = static_text('css/nav-sites.css')
        drawer_block = css.split('.nav-hub.toc-drawer .nav-toc {', 1)[1][:1600]
        self.assertIn('overflow: visible', drawer_block)
        self.assertIn('.nav-hub.toc-drawer .nav-toc .dropdown-menu', css)
        self.assertIn('right: 0', css)

    def test_toc_drawer_opaque_and_rail_only_in_drawer(self):
        """抽屉遮挡修复(2026-11-19):抽屉实底不再吃壁纸的半透明规则;常驻模式不出把手;
        推开量按目录真实宽度算(页面宽度档位会 zoom)。"""
        css = static_text('css/nav-sites.css')
        drawer_block = css.split('.nav-hub.toc-drawer .nav-toc {', 1)[1][:1600]
        self.assertIn('var(--bs-offcanvas-bg, var(--bs-body-bg)) !important', drawer_block)
        self.assertIn('backdrop-filter: none', drawer_block)
        # 把手只在抽屉形态露出:常驻侧栏不需要"折叠成抽屉"的小舌头
        self.assertNotRegex(css, r'(?m)^\s*\.nav-toc-rail \{ display: flex; \}$')
        self.assertIn('.nav-hub.toc-drawer .nav-toc-rail { display: flex; }', css)
        self.assertIn('left: var(--toc-w,', css)
        js = static_text('js/nav-sites.js')
        self.assertIn("tocEl.getBoundingClientRect().width", js)
        self.assertIn("setProperty('--toc-w'", js)
        # #5:多选钮收进「···」菜单的「视图」分组,顶栏不再单列 32px 图标位;id 与绑定钩子保留。
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="navBulkToggle"', html)
        self.assertIn('class="dropdown-item"', html)
        self.assertNotIn('id="navBulkToggle" class="nav-chip nav-chip--icon"', html)

    def test_tools_section_has_visibility_toggle(self):
        """设置里能关掉「我的 HTML 工具」:开关 + 首选项键 + 隐藏规则三件套都要在。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        js = static_text('js/nav-sites.js')
        css = static_text('css/nav-sites.css')
        self.assertIn('id="setShowTools"', html)
        self.assertIn('navShowTools', js)
        # 必须有真正的点击绑定(不是只写进 NAV_UI_PREFS 列表),否则开关是摆设
        self.assertIn("bindPrefSwitch('#setShowTools', 'show-tools', 'navShowTools', true)", js)
        self.assertIn('show-tools', js)
        self.assertIn('nav-hub show-tools', html)      # 默认开,避免首帧闪一下
        self.assertIn('nav-hub:not(.show-tools) #toolsSection', css)

    def test_page_seeds_builtin_on_empty_db(self):
        NavSite.objects.all().delete()
        response = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, response.status_code)
        self.assertContains(response, '内置网站')
        self.assertContains(response, 'ChatGPT')

    def test_page_renders_toc_and_sort_buttons(self):
        # 内置站点现在平铺(无二级分类),目录里的 toc-sub 需要一个带小分类的站点
        NavSite.objects.create(name='测试', url='https://toc.example', category='测试分类', subcat='子类')
        response = self.client.get(reverse('nav_sites'))
        page = response.content.decode('utf-8') + static_text('js/nav-sites.js')
        # 左侧目录:每个分类一个锚点 + 与分组 id 对应
        self.assertContains(response, 'id="navToc"')
        self.assertContains(response, 'href="#navCat1"')
        self.assertContains(response, 'id="navCat1"')
        self.assertIn('setShowToc', page)
        # 排序面板含最上/最下两端按钮
        self.assertContains(response, 'cat-move-top')
        self.assertContains(response, 'cat-move-bottom')
        # 显示 tab:全部展开/折叠、网址与编辑开关;链接测活弹窗 + 卡片编辑按钮
        self.assertIn('navExpandAll', page)
        self.assertIn('navCollapseAll', page)
        self.assertIn('setShowUrl', page)
        self.assertIn('setShowActions', page)
        # 外观:卡片布局切换 + 主题色色板(均存本机)
        self.assertIn('navLayoutGroup', page)
        self.assertContains(response, 'id="navAccentRow"')
        self.assertIn('navAccentCustom', page)
        self.assertIn('linkTestModal', page)
        self.assertContains(response, 'site-edit')
        self.assertContains(response, 'id="navCatUrls"')
        # 顶部搜索引擎框(引擎列表来自 nav_data.NAV_SEARCH_ENGINES)+ 显隐开关
        self.assertContains(response, 'id="navWebSearch"')
        self.assertContains(response, 'id="navEngineSel"')
        self.assertContains(response, 'id="navEngineQ"')
        self.assertContains(response, 'id="setShowSearch"')
        # 自定义搜索引擎弹窗(本机 localStorage,不进服务端)
        self.assertContains(response, 'id="engineModal"')
        self.assertContains(response, 'id="navEngineAdd"')
        self.assertContains(response, 'id="engAddBtn"')
        # 配色统一:--nav-accent token、明暗双档色板、badge 跟色 class
        self.assertIn('--nav-accent', _css('css/nav-sites.css'))
        self.assertContains(response, 'data-accent-dark')
        self.assertContains(response, 'site-tag')
        # 星标置顶 + 最近使用 chips(本机 localStorage)+ 卡片星标按钮
        self.assertContains(response, 'id="navStarSec"')
        self.assertContains(response, 'id="navRecentSec"')
        self.assertContains(response, 'site-star')
        self.assertContains(response, 'id="setShowRecent"')
        # 卡片拖拽已退役:设置里不再有开关,改为右键菜单
        self.assertNotContains(response, 'id="setDragSort"')
        self.assertContains(response, 'js/card-menu.js')
        # 浮动保存条是死 UI(只有 addClass('d-none')),2026-11-14 删除;排序改为松手即存
        self.assertNotContains(response, 'id="navSiteOrderBar"')
        self.assertContains(response, 'data-site-item data-id=')
        # 布局美化 A+B+C:目录 scroll-spy 高亮(JS 在 stars-filter.js)/ 首字母图标兜底 / 搜索空状态
        self.assertIn('navTocSpy', _stars_js())
        # 样式已外置到 css/nav-sites.css(2026-11-07):断言目标改为静态文件
        self.assertIn('.nav-toc a.active', static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))   # 样式已外置到 static/css
        self.assertIn('navFavFail', page)
        self.assertIn('fav-letter', page)
        self.assertContains(response, 'id="navNoResult"')
        # 顶部两行合并:搜索引擎框与星标/最近 chips 同行 + 折叠箭头悬停弱化
        self.assertContains(response, 'id="navQuickRow"')
        self.assertIn('.cheve, .toc-cheve { opacity: 0;', static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        # 三种布局的 URL 显隐全部受"显示详细网址"开关控制(紧凑列表曾常显,是回归)
        self.assertIn('.nav-hub.lyr-list .site-card .site-url { display: none; }',
                      static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn('.nav-hub.lyr-list.show-url .site-card .site-url',
                      static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        # 添加站点弹窗:多 tab 完整表单 + 小分类按大类联动数据
        self.assertIn('sfAddTab', page)
        self.assertIn('siteFormPanes', page)
        self.assertContains(response, 'id="navCatSubs"')
        # 目录二级分类:toc-sub 链接 + 与页面 navSub 锚点、折叠按钮、目录右上角设置入口
        self.assertContains(response, 'class="toc-sub"')
        self.assertContains(response, 'href="#navSub')
        self.assertContains(response, 'id="navSub')
        self.assertContains(response, 'toc-cheve')
        # #5:目录齿轮从标题旁移除;目录显隐/形态/样式/层级显隐并入主设置抽屉「布局 → 目录」,
        # 控件 id(#tocSettingsMenu 容器及各开关)保留,绑定不受影响。
        self.assertNotContains(response, 'id="tocSettingsBtn"')
        self.assertIn('navTocCollapsed', page)
        self.assertContains(response, 'id="tocSettingsMenu"')
        self.assertIn('tocExpandSubs', page)
        self.assertIn('tocCollapseSubs', page)
        self.assertIn('tocShowNums', page)
        self.assertIn('tocShowSubs', page)
        self.assertNotContains(response, 'tocOpenSettings')

    def test_toc_sub_links_match_page_anchors(self):
        """目录里的每个 navSub 锚点都必须在页面里有对应的小分类块。"""
        import re
        NavSite.objects.create(name='测试', url='https://toc2.example', category='测试分类', subcat='子类')
        content = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        toc_ids = set(re.findall(r'href="#(navSub[\d_]+)"', content))
        anchors = set(re.findall(r'id="(navSub[\d_]+)"', content))
        self.assertTrue(toc_ids)
        self.assertEqual(set(), toc_ids - anchors)

    def test_add_normalizes_url_and_rejects_duplicate(self):
        response = self._post_json('nav_add', {'name': 'DHL', 'url': 'dhl.com',
                                               'category': '物流', 'description': '国际快递'})
        self.assertEqual(200, response.status_code)
        self.assertTrue(NavSite.objects.filter(url='https://dhl.com').exists())
        response = self._post_json('nav_add', {'name': 'DHL2', 'url': 'https://dhl.com'})
        self.assertEqual(400, response.status_code)
        response = self._post_json('nav_add', {'name': '', 'url': 'x.com'})
        self.assertEqual(400, response.status_code)

    def test_delete(self):
        site = NavSite.objects.create(name='Tmp', url='https://tmp.example', category='自定义')
        response = self._post_json('nav_delete', {'id': site.id})
        self.assertEqual(200, response.status_code)
        self.assertFalse(NavSite.objects.filter(id=site.id).exists())
        response = self._post_json('nav_delete', {'id': site.id})
        self.assertEqual(404, response.status_code)

    def test_export_format(self):
        NavSite.objects.create(name='My Site', url='https://mysite.example', category='自定义')
        response = self.client.get(reverse('nav_export'))
        self.assertEqual(200, response.status_code)
        payload = json.loads(response.content)
        self.assertEqual('pinsflora-nav', payload['format'])
        urls = {s['url'] for s in payload['sites']}
        self.assertIn('https://mysite.example', urls)
        # 内置站点由 nav_data.py 种子提供,导出不计入
        self.assertNotIn('https://www.importyeti.com', urls)

    def test_import_upsert_is_idempotent(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        payload = {'format': 'pinsflora-nav', 'version': 1, 'sites': [
            {'name': 'Imported', 'url': 'imported.example', 'category': '自定义', 'description': '测试'},
            {'name': 'Bad'},
        ]}
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        response = self.client.post(reverse('nav_import'), {'nav_file': upload})
        data = json.loads(response.content)
        self.assertEqual(200, response.status_code)
        self.assertEqual(1, data['created'])
        self.assertTrue(NavSite.objects.filter(url='https://imported.example').exists())
        # 再导一次同文件:不新增
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        response = self.client.post(reverse('nav_import'), {'nav_file': upload})
        data = json.loads(response.content)
        self.assertEqual(0, data['created'])
        self.assertEqual(1, data['updated'])

    def test_import_rejects_bad_json(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile('nav.json', b'{not json', content_type='application/json')
        response = self.client.post(reverse('nav_import'), {'nav_file': upload})
        self.assertEqual(400, response.status_code)

    def test_reset_restores_deleted_builtin(self):
        NavSite.objects.filter(url='https://chatgpt.com').delete()
        response = self._post_json('nav_reset', {})
        self.assertEqual(200, response.status_code)
        self.assertTrue(NavSite.objects.filter(url='https://chatgpt.com').exists())

    def test_reset_unhides_builtin_category(self):
        """「恢复内置站点」必须让它们重新可见:分类若被隐藏,只补数据等于没恢复。"""
        NavCategory.objects.create(name='内置网站', order=0, hidden=True)
        response = self._post_json('nav_reset', {})
        self.assertEqual(200, response.status_code)
        self.assertFalse(NavCategory.objects.get(name='内置网站').hidden)


class NavCategoryOrderTests(TestCase):
    """分类排序:NavCategory 存档顺序优先,空表回落内置顺序;API + JSON v3 导入导出。"""

    def setUp(self):
        from .views import _seed_nav_sites
        from .models import NavSite
        _seed_nav_sites()
        # 内置现在只占一个分类;排序/隐藏测试再需要一个"自己的"分类才有得挪
        NavSite.objects.create(name='我的收藏', url='https://mine.example', category='我的收藏')

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def _categories(self):
        page = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, page.status_code)
        return [g['category'] for g in page.context['groups']]

    def test_default_builtin_order(self):
        self.assertEqual('内置网站', self._categories()[0])

    def test_order_api_moves_category_to_front(self):
        cats = self._categories()
        moved = [cats[-1]] + cats[:-1]
        self.assertEqual(200, self._post_json('nav_category_order', {'order': moved}).status_code)
        self.assertEqual(moved, self._categories())

    def test_order_dedup_and_invalid_input(self):
        from .models import NavCategory
        self.assertEqual(200, self._post_json('nav_category_order',
                                              {'order': ['我的收藏', '', '我的收藏', 123]}).status_code)
        self.assertEqual(['我的收藏'], list(NavCategory.objects.values_list('name', flat=True)))
        cats = self._categories()
        self.assertEqual('我的收藏', cats[0])
        self.assertEqual(400, self._post_json('nav_category_order', {'order': '我的收藏'}).status_code)

    def test_export_import_roundtrip_category_order(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .models import NavCategory
        self._post_json('nav_category_order', {'order': ['我的收藏', '内置网站']})
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        self.assertEqual(10, payload['version'])
        self.assertEqual([{'name': '我的收藏', 'hidden': False}, {'name': '内置网站', 'hidden': False}],
                         payload['category_order'])
        NavCategory.objects.all().delete()
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.client.post(reverse('nav_import'), {'nav_file': upload})
        self.assertEqual(['我的收藏', '内置网站'], self._categories()[:2])

    def test_hidden_category_excluded_from_page(self):
        cats = self._categories()
        order = [{'name': c, 'hidden': c == '内置网站'} for c in cats]
        self.assertEqual(200, self._post_json('nav_category_order', {'order': order}).status_code)
        page = self.client.get(reverse('nav_sites'))
        groups = [g['category'] for g in page.context['groups']]
        self.assertNotIn('内置网站', groups)
        self.assertEqual(cats[1], groups[0])
        # 设置面板里仍可见(带隐藏标记),可以恢复
        self.assertIn(('内置网站', True), page.context['cat_items'])
        # 取消隐藏后恢复显示
        self._post_json('nav_category_order',
                        {'order': [{'name': c, 'hidden': False} for c in cats]})
        self.assertEqual(cats, self._categories())

    def test_all_hidden_empty_state_explains_and_offers_unhide(self):
        """所有有站点的分类都被隐藏时:空态说明"站还在",并给一键恢复,而不是误报"还没有站点"。"""
        cats = self._categories()
        self.assertEqual(200, self._post_json('nav_category_order',
                                              {'order': [{'name': c, 'hidden': True} for c in cats]}).status_code)
        page = self.client.get(reverse('nav_sites'))
        self.assertEqual([], page.context['groups'])
        self.assertEqual(11, page.context['hidden_site_count'])   # 10 内置 + 1 我的收藏
        self.assertContains(page, '个站点还在，但所在的分类被设为隐藏')
        self.assertContains(page, 'navEmptyUnhide')
        self.assertContains(page, 'navHiddenCats')
        # 不再误报"还没有站点"
        self.assertNotContains(page, '还没有站点，点右上角')
        # 一键恢复只翻 hidden 一列
        resp = self._post_json('api_nav_category_unhide', {'names': cats})
        self.assertEqual(200, resp.status_code)
        self.assertEqual(len(cats), resp.json()['updated'])
        self.assertEqual(cats, self._categories())

    def test_unhide_api_rejects_empty_names(self):
        self.assertEqual(400, self._post_json('api_nav_category_unhide', {'names': []}).status_code)
        self.assertEqual(400, self._post_json('api_nav_category_unhide', {}).status_code)
        resp = self._post_json('api_nav_category_unhide', {'names': ['不存在的分类']})
        self.assertEqual(200, resp.status_code)
        self.assertEqual(0, resp.json()['updated'])


class NavSiteOrderTests(TestCase):
    """卡片拖拽排序:nav_site_order API 整表提交 order=1..N,未列入的清空排最后;JSON v6 携带 order。"""

    def setUp(self):
        self.sites = [NavSite.objects.create(name=f'S{i}', url=f'https://s{i}.example', category='自定义')
                      for i in range(1, 4)]

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def _page_order(self):
        page = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, page.status_code)
        group = next(g for g in page.context['groups'] if g['category'] == '自定义')
        return [s.name for _, sites in group['items'] for s in sites]

    def test_order_api_assigns_positions_and_page_follows(self):
        a, b, c = self.sites
        self.assertEqual(200, self._post_json('nav_site_order', {'order': [c.id, a.id, b.id]}).status_code)
        c.refresh_from_db(); a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual([1, 2, 3], [c.order, a.order, b.order])
        self.assertEqual(['S3', 'S1', 'S2'], self._page_order())

    def test_unlisted_sites_reset_to_null_and_sort_last(self):
        a, b, c = self.sites
        self._post_json('nav_site_order', {'order': [b.id, c.id]})  # a 未列入
        a.refresh_from_db()
        self.assertIsNone(a.order)
        self.assertEqual(['S2', 'S3', 'S1'], self._page_order())

    def test_invalid_input_400(self):
        for bad in ({'order': 'x'}, {'order': []}, {'order': ['a', None]}, {}):
            self.assertEqual(400, self._post_json('nav_site_order', bad).status_code)

    def test_hidden_category_sites_keep_order(self):
        """隐藏分类的站点不在页面 DOM、天然"未列入",保存排序不能清掉它们的 order
        (2026-10-06 前 exclude(pk__in=DOM) 会把隐藏分类里已保存的顺序清空)。"""
        a, b, c = self.sites
        NavCategory.objects.create(name='隐藏类', order=99, hidden=True)
        hid = NavSite.objects.create(name='H', url='https://h.example', category='隐藏类', order=2)
        self._post_json('nav_site_order', {'order': [c.id, a.id, b.id]})
        hid.refresh_from_db(); a.refresh_from_db()
        self.assertEqual(2, hid.order)
        self.assertEqual(2, a.order)   # order=[c,a,b] → c=1、a=2

    def test_export_import_roundtrip_order(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        a, b, c = self.sites
        self._post_json('nav_site_order', {'order': [c.id, b.id, a.id]})
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        self.assertEqual(10, payload['version'])
        orders = {s['url']: s.get('order') for s in payload['sites']}
        self.assertEqual([1, 2, 3], [orders['https://s3.example'], orders['https://s2.example'],
                                     orders['https://s1.example']])
        NavSite.objects.update(order=None)
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.assertEqual(200, self.client.post(reverse('nav_import'), {'nav_file': upload}).status_code)
        self.assertEqual(['S3', 'S2', 'S1'], self._page_order())


class NavChildrenTests(TestCase):
    """站点子网页收录:添加时清洗、页面渲染、JSON v3 导入导出。"""

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def test_nav_add_cleans_children(self):
        response = self._post_json('nav_add', {
            'name': 'Acme', 'url': 'acme.example', 'category': '自定义',
            'children': [
                {'name': '联系页', 'url': 'acme.example/contact'},
                {'name': '无网址'},
                {'url': 'https://dup.example'},
                {'url': 'https://dup.example'},
                '不是字典',
            ]})
        self.assertEqual(200, response.status_code)
        site = NavSite.objects.get(url='https://acme.example')
        self.assertEqual([{'name': '联系页', 'url': 'https://acme.example/contact'},
                          {'name': 'dup.example', 'url': 'https://dup.example'}], site.children)

    def test_children_capped_at_max(self):
        response = self._post_json('nav_add', {
            'name': 'Many', 'url': 'many.example', 'category': '自定义',
            'children': [{'name': f'p{i}', 'url': f'many.example/p{i}'} for i in range(40)]})
        self.assertEqual(200, response.status_code)
        site = NavSite.objects.get(url='https://many.example')
        self.assertEqual(30, len(site.children))

    def test_page_renders_subpage_picker(self):
        NavSite.objects.create(name='Acme', url='https://acme.example', category='自定义',
                               children=[{'name': '联系页', 'url': 'https://acme.example/contact'}])
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, 'data-has-sub="1"')
        self.assertContains(page, 'https://acme.example/contact')
        self.assertContains(page, '子页 1')
        self.assertContains(page, 'subModal')

    def test_link_check_fill_data_separates_main_and_children(self):
        # 测活默认只填主站,勾"含子网页"才用子页数据
        NavSite.objects.create(name='Acme', url='https://acme.example', category='自定义',
                               children=[{'name': '联系页', 'url': 'https://acme.example/contact'}])
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, 'ltIncludeSub')
        self.assertEqual(['https://acme.example'], json.loads(page.context['nav_cat_json'])['自定义'])
        self.assertEqual(['https://acme.example/contact'],
                         json.loads(page.context['nav_cat_child_json'])['自定义'])

    def test_export_import_roundtrip_children(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        NavSite.objects.create(name='Sub', url='https://sub.example', category='自定义',
                               children=[{'name': '博客', 'url': 'https://blog.sub.example'}])
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        item = next(s for s in payload['sites'] if s['url'] == 'https://sub.example')
        self.assertEqual([{'name': '博客', 'url': 'https://blog.sub.example'}], item['children'])
        NavSite.objects.filter(url='https://sub.example').delete()
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.client.post(reverse('nav_import'), {'nav_file': upload})
        site = NavSite.objects.get(url='https://sub.example')
        self.assertEqual('https://blog.sub.example', site.children[0]['url'])


class NavSubcategoryTests(TestCase):
    """小分类:大类下的二级分组(subcat),空 subcat 站点直属大类展示。"""

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def test_nav_add_stores_subcat(self):
        response = self._post_json('nav_add', {'name': 'Sub', 'url': 'sub.example',
                                               'category': '自定义', 'subcat': ' 欧洲 '})
        self.assertEqual(200, response.status_code)
        self.assertEqual('欧洲', NavSite.objects.get(url='https://sub.example').subcat)

    def test_page_renders_subcat_group(self):
        NavSite.objects.create(name='Plain', url='https://plain.example', category='自定义')
        NavSite.objects.create(name='De', url='https://de.example', category='自定义', subcat='欧洲')
        NavSite.objects.create(name='Fr', url='https://fr.example', category='自定义', subcat='欧洲')
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, 'nav-sub-title')
        self.assertContains(page, '自定义/欧洲')
        group = next(g for g in page.context['groups'] if g['category'] == '自定义')
        self.assertEqual([('', 1), ('欧洲', 2)],
                         [(sub, len(sites)) for sub, sites in group['items']])
        self.assertEqual(3, group['count'])

    def test_export_import_roundtrip_subcat(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        NavSite.objects.create(name='Sub', url='https://sub2.example', category='自定义', subcat='北美')
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        item = next(s for s in payload['sites'] if s['url'] == 'https://sub2.example')
        self.assertEqual('北美', item['subcat'])
        NavSite.objects.filter(url='https://sub2.example').delete()
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.client.post(reverse('nav_import'), {'nav_file': upload})
        self.assertEqual('北美', NavSite.objects.get(url='https://sub2.example').subcat)

    def test_seed_applies_subcat_and_children(self):
        from unittest import mock
        from . import views as v
        NavSite.objects.all().delete()
        fake = [{'name': 'S1', 'url': 'https://s1.example', 'category': '测试类',
                 'subcat': '子A', 'description': 'd',
                 'children': [{'name': 'c1', 'url': 's1.example/p1'}]}]
        with mock.patch('nav.views_nav_base.DEFAULT_SITES', fake):
            v._seed_nav_sites()
            v._seed_nav_sites()  # 幂等
        self.assertEqual(1, NavSite.objects.count())
        site = NavSite.objects.get(url='https://s1.example')
        self.assertEqual('子A', site.subcat)
        self.assertEqual([{'name': 'c1', 'url': 'https://s1.example/p1'}], site.children)


class NavThreeLevelGroupTests(TestCase):
    """展示层三级分组:小分类名含「 / 」或「 > 」时渲染成 大类→父级→子级;不改模型、存量零影响。

    约定(2026-10-16,用户确认两种分隔符都支持):
    - 只拆第一层:「A / B / C」→ 父级 A、子级「B / C」
    - 父级或子级为空(如 " / x"、"x / ")时不拆,整串当普通小分类
    - 不含分隔符的大类完全不进三级分支(tree=None),行为与历史一致
    """

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _group(self, page, name='自定义'):
        return next(g for g in page.context['groups'] if g['category'] == name)

    def test_split_helper(self):
        from .views import _nav_split_subcat
        self.assertEqual(('设计素材', '配色'), _nav_split_subcat('设计素材 / 配色'))
        self.assertEqual(('设计素材', '配色'), _nav_split_subcat('设计素材 > 配色'))
        self.assertEqual(('设计素材', '配色'), _nav_split_subcat(' 设计素材 / 配色 '))
        self.assertEqual(('A', 'B / C'), _nav_split_subcat('A / B / C'))   # 只拆第一层
        self.assertEqual(('设计素材', ''), _nav_split_subcat('设计素材'))
        self.assertEqual(('', ''), _nav_split_subcat(''))
        self.assertEqual(('', ''), _nav_split_subcat(None))
        self.assertEqual(('/ x', ''), _nav_split_subcat(' / x'))          # 父级空 → 不拆(前导空格先 strip)
        self.assertEqual(('x /', ''), _nav_split_subcat('x / '))          # 子级空 → 不拆(尾空格先 strip)

    def test_slash_creates_three_levels(self):
        NavSite.objects.create(name='P', url='https://p.example', category='自定义',
                               subcat='设计素材 / 配色')
        page = self.client.get(reverse('nav_sites'))
        g = self._group(page)
        tree = g['tree']
        self.assertIsNotNone(tree)
        self.assertEqual([], g['items'])                     # 三级模式不再渲染平铺 items
        self.assertEqual('设计素材', tree[0]['parent'])
        self.assertEqual('配色', tree[0]['leaves'][0]['leaf'])
        self.assertRegex(tree[0]['anchor'], r'^navSub\d+_1$')
        self.assertRegex(tree[0]['leaves'][0]['anchor'], r'^navSub2\d+_1_1$')
        # 折叠状态键用完整 subcat 串(与站点数据一致)
        self.assertEqual('设计素材 / 配色', tree[0]['leaves'][0]['full'])
        html = page.content.decode('utf-8')
        # 断言渲染产物(模板里的 nav-sub2 块),别用裸 'nav-sub2'——CSS 定义与 JS 选择器里也有这几个字
        self.assertIn('class="nav-sub2 mb-2"', html)
        self.assertIn(f'id="{tree[0]["anchor"]}"', html)
        self.assertIn(f'id="{tree[0]["leaves"][0]["anchor"]}"', html)
        self.assertIn('data-collapse-id="自定义/设计素材 / 配色"', html)

    def test_gt_creates_three_levels(self):
        NavSite.objects.create(name='P2', url='https://p2.example', category='自定义',
                               subcat='物流 > 海运')
        g = self._group(self.client.get(reverse('nav_sites')))
        self.assertEqual('物流', g['tree'][0]['parent'])
        self.assertEqual('海运', g['tree'][0]['leaves'][0]['leaf'])

    def test_two_level_untouched(self):
        """不含分隔符的大类必须完全不进三级分支(向后兼容)。"""
        NavSite.objects.create(name='A', url='https://a.example', category='自定义', subcat='欧洲')
        NavSite.objects.create(name='B', url='https://b.example', category='自定义')
        g = self._group(self.client.get(reverse('nav_sites')))
        self.assertIsNone(g['tree'])
        self.assertEqual([('', 1), ('欧洲', 1)],
                         [(sub, len(sites)) for sub, sites in g['items']])
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertNotIn('class="nav-sub2 mb-2"', html)   # 没有 leaf 块(裸 'nav-sub2' 会被 CSS/JS 命中)

    def test_parent_without_leaf_is_direct_group(self):
        """同一大类下「A / B」与无分隔符的「C」混用:C 成为父级,其站直属显示。"""
        NavSite.objects.create(name='S1', url='https://s1.example', category='自定义',
                               subcat='设计素材 / 配色')
        NavSite.objects.create(name='S2', url='https://s2.example', category='自定义', subcat='物流')
        NavSite.objects.create(name='S3', url='https://s3.example', category='自定义', subcat='物流')
        tree = self._group(self.client.get(reverse('nav_sites')))['tree']
        by_parent = {n['parent']: n for n in tree}
        self.assertEqual({'设计素材', '物流'}, set(by_parent))
        self.assertEqual(1, by_parent['设计素材']['count'])
        self.assertEqual(2, by_parent['物流']['count'])
        self.assertEqual('', by_parent['物流']['leaves'][0]['leaf'])      # 直属子级
        self.assertEqual(2, len(by_parent['物流']['leaves'][0]['sites']))

    def test_untagged_sites_stay_direct_in_three_level_category(self):
        """三级大类下的「无小分类」站点仍直属大类(tree 首项 parent 为空)。"""
        NavSite.objects.create(name='D', url='https://d.example', category='自定义')
        NavSite.objects.create(name='S', url='https://s.example', category='自定义',
                               subcat='设计素材 / 配色')
        tree = self._group(self.client.get(reverse('nav_sites')))['tree']
        self.assertEqual('', tree[0]['parent'])
        self.assertEqual(1, tree[0]['count'])
        self.assertEqual('设计素材', tree[1]['parent'])

    def test_only_first_level_split(self):
        NavSite.objects.create(name='D3', url='https://d3.example', category='自定义',
                               subcat='A / B / C')
        tree = self._group(self.client.get(reverse('nav_sites')))['tree']
        self.assertEqual('A', tree[0]['parent'])
        self.assertEqual('B / C', tree[0]['leaves'][0]['leaf'])

    def test_toc_lists_parents_only(self):
        """三级模式下 TOC 只列父级(锚点指向父块),避免条目爆炸。"""
        NavSite.objects.create(name='T1', url='https://t1.example', category='自定义',
                               subcat='设计素材 / 配色')
        NavSite.objects.create(name='T2', url='https://t2.example', category='自定义',
                               subcat='设计素材 / 图标')
        NavSite.objects.create(name='T3', url='https://t3.example', category='自定义',
                               subcat='物流 > 海运')
        g = self._group(self.client.get(reverse('nav_sites')))
        names = [n for _, n, _ in g['sub_links']]
        self.assertEqual(['物流', '设计素材'], names)
        # 父级计数含其下所有子级
        counts = {n: c for _, n, c in g['sub_links']}
        self.assertEqual(2, counts['设计素材'])
        # sub_links 的 idx 必须与 tree 中该父块的锚点尾号一致(模板靠它拼 #navSub{cat}_{idx})
        for i, name, _ in g['sub_links']:
            node = next(n for n in g['tree'] if n['parent'] == name)
            self.assertTrue(node['anchor'].endswith('_%d' % i), node['anchor'])
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn(f'id="{g["tree"][0]["anchor"]}"', html)
        self.assertIn(f'href="#{g["tree"][0]["anchor"]}"', html)

    def test_leaf_blocks_carry_full_subcat_for_collapse_state(self):
        NavSite.objects.create(name='L1', url='https://l1.example', category='自定义',
                               subcat='物流 > 空运')
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('data-collapse-id="自定义/物流"', html)
        self.assertIn('data-collapse-id="自定义/物流 / 空运"', html)


class NavEditTests(TestCase):
    """编辑站点:可改名称/网址/大类/小分类/简介/子网页。"""

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def test_edit_updates_all_fields(self):
        site = NavSite.objects.create(name='Old', url='https://old.example', category='A')
        response = self._post_json('nav_edit', {
            'id': site.id, 'name': 'New', 'url': 'new.example', 'category': 'B',
            'subcat': '欧洲', 'description': '新简介',
            'children': [{'name': '联系', 'url': 'https://new.example/contact'}]})
        self.assertEqual(200, response.status_code)
        site.refresh_from_db()
        self.assertEqual(('New', 'https://new.example', 'B', '欧洲', '新简介'),
                         (site.name, site.url, site.category, site.subcat, site.description))
        self.assertEqual([{'name': '联系', 'url': 'https://new.example/contact'}], site.children)

    def test_edit_url_conflict_and_keep_self(self):
        a = NavSite.objects.create(name='A', url='https://a.example')
        b = NavSite.objects.create(name='B', url='https://b.example')
        self.assertEqual(400, self._post_json('nav_edit', {'id': a.id, 'name': 'A', 'url': 'https://b.example'}).status_code)
        self.assertEqual(200, self._post_json('nav_edit', {'id': a.id, 'name': 'A2', 'url': 'https://a.example'}).status_code)
        a.refresh_from_db()
        self.assertEqual('A2', a.name)

    def test_edit_validation(self):
        site = NavSite.objects.create(name='V', url='https://v.example')
        self.assertEqual(400, self._post_json('nav_edit', {'id': site.id, 'name': '', 'url': 'https://v.example'}).status_code)
        self.assertEqual(400, self._post_json('nav_edit', {'id': 'x', 'name': 'N', 'url': 'https://v.example'}).status_code)
        self.assertEqual(404, self._post_json('nav_edit', {'id': 999999, 'name': 'N', 'url': 'https://v.example'}).status_code)


class NavMoveTests(TestCase):
    """拖拽卡片到目录换分类:独立接口只改大类/小分类,其余字段不动。"""

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name),
                                data=_json.dumps(payload), content_type='application/json')

    def setUp(self):
        NavSite.objects.create(name='站点A', url='https://a.example',
                               category='设计资源', subcat='入门', description='简介A')

    def test_move_to_category_clears_subcat(self):
        resp = self._post_json('api_nav_move', {'id': NavSite.objects.get().id, 'category': '国内大模型'})
        self.assertEqual('success', resp.json()['status'])
        obj = NavSite.objects.get()
        self.assertEqual('国内大模型', obj.category)
        self.assertEqual('', obj.subcat)

    def test_move_to_subcat_keeps_other_fields(self):
        resp = self.client.post(reverse('api_nav_move'),
                                data=_json.dumps({'id': NavSite.objects.get().id,
                                                   'category': '国内大模型', 'subcat': '配色'}),
                                content_type='application/json')
        self.assertEqual('success', resp.json()['status'])
        obj = NavSite.objects.get()
        self.assertEqual('国内大模型', obj.category)
        self.assertEqual('配色', obj.subcat)
        self.assertEqual('站点A', obj.name)          # 只动分类两个字段
        self.assertEqual('简介A', obj.description)

    def test_move_validates(self):
        site_id = NavSite.objects.get().id
        self.assertEqual(400, self._post_json('api_nav_move', {'id': site_id}).status_code)
        self.assertEqual(404, self._post_json('api_nav_move', {'id': 99999, 'category': 'x'}).status_code)
        self.assertEqual(400, self._post_json('api_nav_move', {'id': 'x', 'category': 'x'}).status_code)


class NavRestoreTests(TestCase):
    """删除可撤销:nav_delete 把删掉的整行返回,提示条上的"撤销"用它调 nav_restore 原样入库。"""

    def setUp(self):
        NavSite.objects.all().delete()

    def _delete(self, site):
        return self.client.post(reverse('nav_delete'), json.dumps({'id': site.pk}),
                                content_type='application/json').json()['site']

    def test_delete_returns_full_row(self):
        site = NavSite.objects.create(name='待删', url='https://gone.example/', category='AI',
                                      subcat='对话', description='简介', icon_text='GD', icon_size=30,
                                      click_count=5, order=3,
                                      children=[{'name': '子页', 'url': 'https://gone.example/sub'}],
                                      alternates=[{'name': '备用', 'url': 'https://gone.example/alt'}])
        row = self._delete(site)
        self.assertEqual(0, NavSite.objects.count())
        self.assertEqual('待删', row['name'])
        self.assertEqual('对话', row['subcat'])
        self.assertEqual(1, len(row['children']))
        self.assertEqual(1, len(row['alternates']))
        self.assertEqual((30, 5, 3), (row['icon_size'], row['click_count'], row['order']))

    def test_restore_recreates_everything(self):
        site = NavSite.objects.create(name='待删', url='https://gone.example/', category='AI',
                                      subcat='对话', icon_text='GD', icon_color='#123456', icon_size=30,
                                      click_count=5, order=3,
                                      children=[{'name': '子页', 'url': 'https://gone.example/sub'}])
        row = self._delete(site)
        resp = self.client.post(reverse('nav_restore'), json.dumps({'site': row}),
                                content_type='application/json')
        self.assertEqual(200, resp.status_code)
        back = NavSite.objects.get(url='https://gone.example/')
        self.assertEqual(('待删', 'AI', '对话', 'GD', '#123456', 30, 5, 3),
                         (back.name, back.category, back.subcat, back.icon_text,
                          back.icon_color, back.icon_size, back.click_count, back.order))
        self.assertEqual(1, len(back.children))

    def test_restore_keeps_builtin_flag(self):
        site = NavSite.objects.create(name='内置味', url='https://bi.example/',
                                      category='AI', is_builtin=True)
        self.client.post(reverse('nav_restore'), json.dumps({'site': self._delete(site)}),
                         content_type='application/json')
        self.assertTrue(NavSite.objects.get(url='https://bi.example/').is_builtin)

    def test_restore_conflict_and_bad_payload_report_not_500(self):
        site = NavSite.objects.create(name='A', url='https://a.example/')
        row = self._delete(site)
        NavSite.objects.create(name='又加了一遍', url='https://a.example/')
        resp = self.client.post(reverse('nav_restore'), json.dumps({'site': row}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)
        self.assertIn('已重新添加', resp.json()['message'])
        self.assertEqual(400, self.client.post(reverse('nav_restore'), json.dumps({}),
                                               content_type='application/json').status_code)
        self.assertEqual(400, self.client.post(reverse('nav_restore'),
                                               json.dumps({'site': {'name': '缺网址'}}),
                                               content_type='application/json').status_code)

    def test_page_wires_undo_action(self):
        """契约:删除回调真的引用撤销端点,提示条带动作按钮(不是只删不给回)。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('/api/nav/restore/', html)
        self.assertIn('nav-toast-act', html)


class NavTagsTests(TestCase):
    """标签:v9 新增 NavSite.tags(JSONField 字符串数组);增改接口清洗、导出带走、旧文件缺键不清零。"""

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def test_add_accepts_and_cleans_tags(self):
        resp = self._post_json('nav_add', {'name': 'T', 'url': 'https://t.example',
                                           'tags': ['设计素材', ' 免费 ', '设计素材', 'x' * 20]})
        self.assertEqual(200, resp.status_code)
        site = NavSite.objects.get(url='https://t.example')
        self.assertEqual(['设计素材', '免费', 'x' * 10], site.tags)

    def test_add_truncates_to_max_tags(self):
        self._post_json('nav_add', {'name': 'T2', 'url': 'https://t2.example',
                                    'tags': [f't{i}' for i in range(20)]})
        self.assertEqual(8, len(NavSite.objects.get(url='https://t2.example').tags))

    def test_add_ignores_non_list_tags(self):
        self._post_json('nav_add', {'name': 'T3', 'url': 'https://t3.example', 'tags': 'a,b'})
        self.assertEqual([], NavSite.objects.get(url='https://t3.example').tags)

    def test_edit_replaces_tags_including_clear(self):
        site = NavSite.objects.create(name='E', url='https://e.example', category='自定义',
                                      tags=['旧'])
        self._post_json('nav_edit', {'id': site.id, 'name': 'E', 'url': 'https://e.example',
                                     'tags': ['新', '常用']})
        site.refresh_from_db()
        self.assertEqual(['新', '常用'], site.tags)
        # 显式清空:传空数组要把标签删掉(不是"缺键不清零"那条路)
        self._post_json('nav_edit', {'id': site.id, 'name': 'E', 'url': 'https://e.example',
                                     'tags': []})
        site.refresh_from_db()
        self.assertEqual([], site.tags)

    def test_export_and_import_roundtrip_tags(self):
        NavSite.objects.create(name='R', url='https://r.example', category='自定义',
                               tags=['设计素材', '免费'])
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        item = next(s for s in payload['sites'] if s['url'] == 'https://r.example')
        self.assertEqual(['设计素材', '免费'], item['tags'])
        self.assertEqual(10, payload['version'])
        NavSite.objects.filter(url='https://r.example').delete()
        upload = SimpleUploadedFile('nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.assertEqual(200, self.client.post(reverse('nav_import'), {'nav_file': upload}).status_code)
        self.assertEqual(['设计素材', '免费'], NavSite.objects.get(url='https://r.example').tags)

    def test_legacy_file_without_tags_keeps_local(self):
        """v8 及更早文件没有 tags 键:导入不许把本机已设的标签抹掉(与 icon_*/click_count 同款承诺)。"""
        site = NavSite.objects.create(name='L', url='https://l.example', category='自定义',
                                      tags=['本机标签'])
        legacy = {'format': 'pinsflora-nav', 'version': 8, 'sites': [
            {'name': 'L改名', 'url': 'https://l.example', 'category': '自定义'}]}
        upload = SimpleUploadedFile('nav.json', json.dumps(legacy, ensure_ascii=False).encode('utf-8'),
                                    content_type='application/json')
        self.assertEqual(200, self.client.post(reverse('nav_import'), {'nav_file': upload}).status_code)
        site.refresh_from_db()
        self.assertEqual('L改名', site.name)
        self.assertEqual(['本机标签'], site.tags)

    def test_card_renders_tags_for_search_and_chips(self):
        NavSite.objects.create(name='C', url='https://c.example', category='自定义',
                               description='desc', tags=['设计素材'])
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        # data-tags 用 JSON 数组(2026-10-16 起):空格分隔无法表示含空格标签("设计 素材"),
        # 单引号包属性 + Django 自动转义,前端 JSON.parse
        self.assertIn("""data-tags='["设计素材"]'""", html)
        self.assertIn('#设计素材', html)          # data-search 带 #标签:顶栏搜索框即可按标签过滤
        self.assertIn('site-tagchip', html)
        self.assertIn('data-tag="设计素材"', html)


class NavTagCloudTests(TestCase):
    """标签云面板(2000 站主导航形态):多选 AND 过滤 + 搜索框拆词 AND 组合;data-tags JSON 化。

    行为契约(2026-10-16 标签升主导航改造时锁定,防回归):
    - 卡片 data-tags 是 JSON 数组(空格分隔无法表示含空格标签)
    - 过滤条件 = 搜索词(逐词 AND) + 已选标签(数组成员精确匹配,相互 AND),两者再 AND
    - 标签用独立状态 navSelectedTags,不再"填进搜索框"(旧 navTagFill 通道已废弃)
    - 面板打开时按存活标签自洁,剪掉随卡片删除而绝迹的选中标签
    """

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _page(self):
        # 标签云/过滤/星标 JS 已拆到 stars-filter.js(第五刀):断言目标改为"浏览器实际加载的全部内容"
        return (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())

    def test_card_data_tags_is_json_array(self):
        """含空格标签必须原样保住(旧空格分隔会把它拆成两个标签)。"""
        NavSite.objects.create(name='C', url='https://c.example', category='自定义',
                               tags=['设计 素材', '免费'])
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn("""data-tags='["设计 素材","免费"]'""", html)

    def test_page_renders_tag_cloud_panel(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        for frag in ('id="navTagCloudList"', 'id="navTagSelCount"', 'id="navTagClearBtn"',
                     'id="navTagFilterMenu"', 'id="navTagFilterBtn"',
                     'data-bs-auto-close="outside"'):
            self.assertIn(frag, html)
        self.assertIn('多选 = 同时满足', html)

    def test_cloud_functions_and_state_exist(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        for frag in ('const navSelectedTags = new Set();', 'function navTagToggle(t)',
                     'function navTagClear()', 'function navTagCloudData()',
                     'function navTagCloudRender()', 'function navTagCloudSync()'):
            self.assertIn(frag, html)

    def test_filter_combines_search_words_and_selected_tags(self):
        """组合过滤核心:搜索词 AND 已选标签,任一非空即进入过滤态。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('const filtering = words.length > 0 || sel.length > 0;', html)
        self.assertIn("$('.nav-hub').toggleClass('searching', filtering);", html)
        self.assertIn('navFilterHits(idx.items, words[w]', html)
        self.assertIn('if (!hits) hits = new Array(idx.items.length).fill(true);', html)
        self.assertIn('if (hits[i] && idx.items[i].tags.indexOf(tag) < 0) hits[i] = false;', html)
        self.assertIn('const noHit = filtering && visible === 0;', html)
        self.assertIn("$('#navNoResult').toggleClass('d-none', !noHit);", html)

    def test_search_words_are_split_with_and(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('const words = q ? q.split(/\\s+/).filter(Boolean) : [];', html)

    def test_index_parses_tags_json(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn("tags = JSON.parse(this.getAttribute('data-tags') || '[]');", html)

    def test_legacy_fill_channel_removed(self):
        """旧通道(navTagFill 填搜索框 / navRenderTagMenu 下拉)必须彻底移除,别留两套。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertNotIn('navTagFill', html)
        self.assertNotIn('navRenderTagMenu', html)

    def test_tag_cloud_self_cleans_stale_selection(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('navSelectedTags.forEach(function(t) { if (!alive.has(t)) { navSelectedTags.delete(t); pruned = true; } });', html)
        self.assertIn('if (pruned) navApplyFilter();', html)

    def test_tag_cloud_css_and_toggle_binding(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('.tagcloud-item.on { background: var(--nav-accent, #5850ec);', html)
        self.assertIn("$('#navTagFilterMenu').on('show.bs.dropdown', navTagCloudRender);", html)
        self.assertIn("$('#navTagClearBtn').on('click', function(e) { e.stopPropagation(); navTagClear(); });", html)
        # 顶栏按钮有选中时亮起:关掉面板也看得见过滤生效中
        self.assertIn("$('#navTagFilterBtn').toggleClass('btn-primary', !!n).toggleClass('btn-outline-secondary', !n);", html)

    def test_dropdown_shim_fires_show_event(self):
        """标签云面板靠 'show.bs.dropdown' 懒渲染 → shim 的 dropdown 必须派发该事件。

        2026-10-16 真实浏览器实测踩到:shim 的 toggleDropdown 只切 .show class、不派发任何事件,
        面板永远空白(而所有字符串契约断言照样全绿)。Modal/Offcanvas 本来就派发,dropdown 是漏的。
        """
        import os
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(base, 'nav', 'static', 'bootstrap-shim.js'), encoding='utf-8') as f:
            src = f.read()
        seg = src[src.index('function toggleDropdown'):]
        seg = seg[:seg.index('/* ---------- Offcanvas')]
        self.assertIn("uiFire(menu, 'show.bs.dropdown')", seg)
        self.assertIn("uiFire(menu, 'shown.bs.dropdown')", seg)
        # 必须"打开前"派发(在加 .show 之前),否则懒渲染拿到的还是旧状态
        self.assertLess(seg.index("uiFire(menu, 'show.bs.dropdown')"),
                        seg.index('menu.classList.toggle'))


class NavFilterIndexTests(TestCase):
    """站内过滤索引化(2000 站性能地基):内存索引 + 纯命中函数 + 差异写 DOM。

    行为契约(2026-10-16 索引化改造时锁定,防回归):
    - 过滤前拍内联样式快照,清空原样还原(2026-10-04 清空全白 bug 的防护不许丢)
    - 索引失效 = 数量 + 元素身份双重校验(只比数量会漏"删1增1/编辑换节点")
    - navFilterHits 是纯函数,不碰 DOM
    """

    def _page(self):
        # 标签云/过滤/星标 JS 已拆到 stars-filter.js(第五刀):断言目标改为"浏览器实际加载的全部内容"
        return (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())

    def test_index_functions_exist(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        for frag in ('function navFilterQuery()', 'function navFilterHits(items, q, opts)',
                     'function navBuildIndex()', 'function navFilterIndex()',
                     'function navApplyFilter()', 'let navIdx = null;'):
            self.assertIn(frag, html)

    def test_search_filter_is_frame_coalesced(self):
        """连续按键按帧合并过滤;正则只编译一次;单卡高亮重置不再扫全页。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        for frag in ('function navScheduleFilter()', 'function navFlushFilter()',
                     'navFilterRaf', 'requestAnimationFrame',
                     'const pinyinOn = navPinyinEnabled();', 'const wordsRe =',
                     'navHighlightCard(it.el, wordsRe)', 'navScheduleFilter();',
                     "root.matches('[data-site-item]')"):
            self.assertIn(frag, html)

    def test_search_highlight_and_empty_recs_contract(self):
        """搜索命中高亮 + 空态推荐(2026-11-19 复核确认早已实现,补断言锁住,防改样式顺手删掉)。

        高亮在 stars-filter.js(nav-search.js 的 highlight 是下拉选中态,不是关键词标记);
        空态推荐同样在 stars-filter.js,挂到模板 #navNoResultRecs。
        """
        html = self._page()
        for frag in ("mark.className = 'nav-search-mark'",
                     "document.createElement('mark')",
                     'function navHighlightCard(card, re)',
                     "'.site-title', '.site-meta', '.site-desc', '.site-url', '.site-tagchip'",
                     'function navEmptyRecs()', 'function navRenderEmptyRecs(show)',
                     'navRenderEmptyRecs(noHit)',
                     'id="navNoResultRecs"', '.nav-search-mark', '.nav-empty-rec'):
            self.assertIn(frag, html)

    def test_snapshot_restore_contract(self):
        """快照还原契约:Map 按元素记录、清空 forEach 还原后释放,不许改回 :visible 判断。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('navApplyFilter.snap = new Map();', html)
        self.assertIn('navApplyFilter.snap.set(this, this.style.display', html)
        self.assertIn('navApplyFilter.snap.forEach(function(val, el) { el.style.display = val; });', html)
        self.assertIn('navApplyFilter.snap = null;', html)
        # 2026-10-04 bug 防护注释必须保留(提醒后来者别用 :visible 做恢复判断)
        self.assertIn('2026-10-04', html)
        self.assertIn('清空恢复不能靠 :visible 判断', html)

    def test_index_invalidation_checks_node_identity(self):
        """失效校验必须身份比对:数量不变但节点被替换(删1增1/编辑换节点)时也要重建。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('const cur = document.querySelectorAll', html)
        self.assertIn('navIdx.nodes[i] !== cur[i]', html)
        self.assertIn('nodes: nodes}', html)  # 建索引时存身份指纹

    def test_diff_write_and_group_visibility(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('if (it.el.style.display !== want) it.el.style.display = want;', html)
        self.assertIn('function applyGroup(list)', html)
        self.assertIn('applyGroup(idx.subs);', html)
        self.assertIn('applyGroup(idx.cats);', html)

    def test_searching_flag_and_no_result(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        # 2026-10-16 标签云升级后:过滤态 = 有搜索词 或 有已选标签,不再是 !!q
        self.assertIn("$('.nav-hub').toggleClass('searching', filtering)", html)
        self.assertIn("const noHit = filtering && visible === 0;", html)
        self.assertIn("$('#navNoResult').toggleClass('d-none', !noHit);", html)

    def test_hits_is_pure_function(self):
        """navFilterHits 函数体不许碰 DOM(document/$ 只允许出现在它之外的函数里)。"""
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        seg = html[html.index('function navFilterHits(items, q, opts)'):]
        seg = seg[:seg.index('function navBuildIndex()')]
        body = seg[seg.index('{'):]
        self.assertNotIn('document.', body)
        self.assertNotIn('$(', body)
        self.assertIn('hay.indexOf(q)', body)


class NavArchiveTests(TestCase):
    """休眠(2026-10-30 点单):"删之前先收起来"。状态只是 NavSite.archived_at 一个字段,
    切它不许动任何其他数据;休眠站退出分类与一切派生数据(测活候选/站点映射),
    但仍在库里、仍计入顶栏「共 N 个站点」,并随导出 JSON v10 一起走(否则换机即复活)。"""

    def setUp(self):
        NavSite.objects.all().delete()
        self.keep = NavSite.objects.create(name='常逛站', url='https://keep.example', category='AI')
        self.slow = NavSite.objects.create(
            name='沉睡站', url='https://sleep.example', category='AI', subcat='工具',
            description='很久没点了', click_count=9, order=3, tags=['素材'],
            children=[{'name': '文档', 'url': 'https://sleep.example/doc'}],
            alternates=[{'name': '备用', 'url': 'https://sleep.example/bak'}])

    def _post(self, payload, name='api_nav_archive'):
        return self.client.post(reverse(name), data=json.dumps(payload),
                                content_type='application/json')

    def _island(self, html, el_id):
        m = re.search(r'<script id="%s" type="application/json">(.*?)</script>' % el_id, html, re.S)
        return json.loads(m.group(1)) if m else {}

    def test_archive_hides_the_card_and_every_derived_list(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('data-url="https://sleep.example"', html)      # 改前:卡片在分类里
        self.assertEqual(200, self._post({'id': self.slow.id, 'on': True}).status_code)
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        # 归档清单段自身按新面板契约渲染 data-id/data-url/data-name/data-cat;
        # 主列表隐藏断言剔除该段,只查分类主区(派生数据仍由下方两个 island 断言兜底)
        arch_start = html.find('<div id="navArchiveList">')
        html_main = html[:arch_start] if arch_start >= 0 else html
        self.assertNotIn('data-url="https://sleep.example"', html_main)   # 主列表不再渲染这张卡
        # 派生数据一并拿不到它:测活"填入该大类网址"与"加入备用"的候选里都没有
        self.assertNotIn('sleep.example', json.dumps(self._island(html, 'navCatUrls'), ensure_ascii=False))
        self.assertNotIn('sleep.example', json.dumps(self._island(html, 'navSiteMap'), ensure_ascii=False))
        # 但站还在,顶栏计数仍算它(用户拍板:含休眠,括号里注明)
        self.assertIn('休眠中(1)', html)   # 2026-11-14:emoji 换成线框图标
        self.assertIn('含休眠 1', html)
        self.assertIn('id="navArchiveList"', html)
        self.assertIn('data-arch-search', html)
        self.assertEqual(2, NavSite.objects.count())

    def test_archive_only_touches_the_archive_field(self):
        from django.utils import timezone
        fields = ('name', 'url', 'category', 'subcat', 'description', 'site_title', 'favicon',
                  'icon_text', 'icon_color', 'icon_size', 'children', 'alternates', 'tags',
                  'order', 'is_builtin', 'click_count', 'last_check_at', 'last_check_ok',
                  'last_check_note', 'created_at')
        NavSite.objects.filter(pk=self.slow.pk).update(
            last_check_at=timezone.now(), last_check_ok=False, last_check_note='HTTP 404')
        before = {f: getattr(NavSite.objects.get(pk=self.slow.pk), f) for f in fields}
        self._post({'id': self.slow.id, 'on': True})
        after = {f: getattr(NavSite.objects.get(pk=self.slow.pk), f) for f in fields}
        self.assertEqual(before, after, '休眠只该改 archived_at,别的字段一个不许动')
        self.assertIsNotNone(NavSite.objects.get(pk=self.slow.pk).archived_at)

    def test_wake_puts_it_back_in_the_same_category(self):
        self._post({'id': self.slow.id, 'on': True})
        self._post({'id': self.slow.id, 'on': False})
        obj = NavSite.objects.get(pk=self.slow.pk)
        self.assertIsNone(obj.archived_at)
        self.assertFalse(obj.is_archived)
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        self.assertIn('data-url="https://sleep.example"', html)
        self.assertNotIn('休眠中(1)', html)

    def test_api_guards(self):
        self.assertEqual(400, self._post({'id': 'abc'}).status_code)
        self.assertEqual(404, self._post({'id': 999999}).status_code)
        self.assertEqual(405, self.client.get(reverse('api_nav_archive')).status_code)
        # on 缺省 = 休眠(前端只有唤醒才显式发 on:false)
        self._post({'id': self.slow.id})
        self.assertTrue(NavSite.objects.get(pk=self.slow.pk).is_archived)

    def test_export_carries_archive_state_and_legacy_file_keeps_it(self):
        self._post({'id': self.slow.id, 'on': True})
        payload = json.loads(self.client.get(reverse('nav_export')).content)
        item = next(s for s in payload['sites'] if s['url'] == 'https://sleep.example')
        self.assertTrue(item['archived'], '导出的休眠站必须带上休眠时间')
        # 换机:文件回来时休眠态一起回来
        NavSite.objects.filter(url='https://sleep.example').update(archived_at=None)
        self.client.post(reverse('nav_import'), {'nav_file': SimpleUploadedFile(
            'nav.json', json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            content_type='application/json')})
        self.assertTrue(NavSite.objects.get(url='https://sleep.example').is_archived)
        # v9 及更早的文件没有 archived 键:不许把本机休眠状态洗成"没休眠"
        legacy = {'format': 'pinsflora-nav', 'version': 9, 'sites': [
            {'name': '沉睡站改名', 'url': 'https://sleep.example', 'category': 'AI'}]}
        self.client.post(reverse('nav_import'), {'nav_file': SimpleUploadedFile(
            'old.json', json.dumps(legacy, ensure_ascii=False).encode('utf-8'),
            content_type='application/json')})
        obj = NavSite.objects.get(url='https://sleep.example')
        self.assertEqual('沉睡站改名', obj.name)          # 文件里有的键照常更新
        self.assertTrue(obj.is_archived, '旧文件缺 archived 键不得唤醒本机已休眠的站')

    def test_delete_undo_keeps_archive_state(self):
        self._post({'id': self.slow.id, 'on': True})
        site = json.loads(self._post({'id': self.slow.id}, name='nav_delete').content)['site']
        self.assertTrue(site['archived'])
        self.assertEqual(200, self._post({'site': site}, name='nav_restore').status_code)
        self.assertTrue(NavSite.objects.get(url='https://sleep.example').is_archived)

    def test_saved_site_order_does_not_wipe_archived_order(self):
        """保存排序只提交页面 DOM 里的卡片:休眠站不在 DOM,不许被顺手清掉 order。"""
        self._post({'id': self.slow.id, 'on': True})
        self._post({'order': [self.keep.id]}, name='nav_site_order')
        self.assertEqual(3, NavSite.objects.get(pk=self.slow.pk).order)

    def test_batch_archive_and_unarchive(self):
        r = json.loads(self._post({'action': 'archive', 'ids': [self.slow.id, self.keep.id]},
                                  name='api_nav_batch').content)
        self.assertEqual({'status': 'ok', 'updated': 2, 'archived': True}, r)
        self.assertEqual(2, NavSite.objects.filter(archived_at__isnull=False).count())
        r = json.loads(self._post({'action': 'unarchive', 'ids': [self.keep.id]},
                                  name='api_nav_batch').content)
        self.assertTrue(r['status'] == 'ok' and not NavSite.objects.get(pk=self.keep.pk).is_archived)
        self.assertTrue(NavSite.objects.get(pk=self.slow.pk).is_archived)

    def test_frontend_contract(self):
        # 先休眠一条:休眠行是 {% for %} 渲染的,库里没有休眠站时页面只有 {% empty %} 提示
        self._post({'id': self.slow.id, 'on': True})
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js') + _stars_js())
        m = re.search(r'<script id="navHealthUrls" type="application/json">(.*?)</script>', html, re.S)
        self.assertIn('"archive": "%s"' % reverse('api_nav_archive'), m.group(1))
        for frag in ('id="navArchiveWrap"', 'id="navArchiveQ"', 'arch-wake', 'navArchiveTitle',
                     '沉睡站', '唤醒'):
            self.assertIn(frag, html, frag)
        js = _health_js()
        for frag in ('HEALTH_URLS.archive', 'function mpArchive', 'function archiveReq',
                     'function archiveAddRow', 'function archiveCountPaint',
                     'function archiveFilterApply', 'data: JSON.stringify({id: id, on: on})',
                     "mp-arch", "label: '撤销'", "#navArchiveWrap", '已休眠', '不是删除'):
            self.assertIn(frag, js, frag)
        bjs = _batch_js()
        for frag in ("action: 'archive'", 'navMsGoArch', '已休眠 '):
            self.assertIn(frag, bjs, frag)


class NavCategoryRenameTests(TestCase):
    """分类改名(2026-11-10):分类在库里是"站点字符串 + 排序表一行",改名必须两处同步。

    只改 NavSite 会留下指向旧名的空排序记录,只改 NavCategory 会让站点漂成新分类。
    """

    def setUp(self):
        from .views import _seed_nav_sites
        from .models import NavSite
        _seed_nav_sites()
        # 改名/重名判定需要两个分类:内置 + 用户自建
        NavSite.objects.create(name='我的收藏', url='https://mine.example', category='我的收藏')

    def _post_json(self, url_name, payload):
        return self.client.post(reverse(url_name), data=json.dumps(payload),
                                content_type='application/json')

    def _categories(self):
        page = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, page.status_code)
        return [g['category'] for g in page.context['groups']]

    def test_rename_moves_sites_and_order_row(self):
        from .models import NavCategory, NavSite
        before = NavSite.objects.filter(category='内置网站').count()
        self.assertGreater(before, 0)
        resp = self._post_json('nav_category_rename', {'old': '内置网站', 'new': '内置网站X'})
        self.assertEqual(200, resp.status_code)
        self.assertEqual(before, NavSite.objects.filter(category='内置网站X').count())
        self.assertEqual(0, NavSite.objects.filter(category='内置网站').count())
        self.assertFalse(NavCategory.objects.filter(name='内置网站').exists())
        self.assertIn('内置网站X', self._categories())
        self.assertNotIn('内置网站', self._categories())

    def test_rename_keeps_order_and_hidden(self):
        from .models import NavCategory
        self._post_json('nav_category_order', {'order': [{'name': '内置网站', 'hidden': True},
                                                        {'name': '我的收藏', 'hidden': False}]})
        self._post_json('nav_category_rename', {'old': '内置网站', 'new': '内置网站X'})
        row = NavCategory.objects.get(name='内置网站X')
        self.assertTrue(row.hidden)
        self.assertEqual(0, row.order)

    def test_rename_rejects_duplicate_and_empty(self):
        self.assertEqual(409, self._post_json('nav_category_rename',
                                              {'old': '我的收藏', 'new': '内置网站'}).status_code)
        self.assertEqual(400, self._post_json('nav_category_rename',
                                             {'old': '我的收藏', 'new': '  '}).status_code)
        self.assertEqual(400, self._post_json('nav_category_rename', {'new': '甲'}).status_code)

    def test_rename_to_same_name_is_noop(self):
        from .models import NavSite
        before = NavSite.objects.filter(category='我的收藏').count()
        self.assertEqual(200, self._post_json('nav_category_rename',
                                              {'old': '我的收藏', 'new': '我的收藏'}).status_code)
        self.assertEqual(before, NavSite.objects.filter(category='我的收藏').count())


class NavContextMenuContractTests(TestCase):
    """卡片右键菜单(2026-11-10 起;2026-11-13 收口成唯一一套 card-menu.js)。

    约定:动作复用现有 .site-edit / .site-del 的 click 处理器,不另写一套编辑/删除逻辑;
    不允许用原生 confirm/alert(全站已下线),删除确认仍走既有 navConfirm。
    ⚠️ 不许第二套右键菜单:nav-sites.js 的 .nav-ctx 曾和 card-menu.js 同时绑 contextmenu,
    右键会在同一位置叠两层菜单(2026-11-13 实测),所以这里反过来断言它不存在。
    """

    def test_js_binds_contextmenu_on_cards(self):
        js = static_text('js/card-menu.js')
        self.assertIn("'contextmenu'", js)
        self.assertIn("'[data-site-item]'", js)

    def test_only_one_context_menu_implementation(self):
        js = static_text('js/nav-sites.js')
        self.assertNotIn('navCtxOpen', js)
        self.assertNotIn("$('.nav-hub').on('contextmenu'", js)
        css = static_text('css/nav-sites.css')
        self.assertNotIn('.nav-ctx {', css)

    def test_menu_items_reuse_existing_buttons(self):
        js = static_text('js/card-menu.js')
        self.assertIn(".site-edit", js)
        self.assertIn(".site-del", js)
        self.assertIn('navigator.clipboard', js)
        self.assertIn("data-act=\"open\"", js)   # 打开链接:旧菜单有,新菜单不能漏

    def test_menu_is_keyboard_operable(self):
        js = static_text('js/card-menu.js')
        self.assertIn("e.key === 'ArrowDown'", js)
        self.assertIn("e.key === 'ArrowUp'", js)
        self.assertIn("e.key === 'Escape'", js)

    def test_touch_long_press_does_not_open_the_card(self):
        """长按弹菜单后松手会补发一次 click,不拦就会顺手打开站点。"""
        js = static_text('js/card-menu.js')
        self.assertIn('swallowClick', js)
        self.assertIn('stopPropagation', js)

    def test_no_native_dialog_in_menu(self):
        js = static_text('js/card-menu.js')
        self.assertNotIn("confirm('", js)
        self.assertNotIn('alert(', js)

    def test_css_defines_menu_layer(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('.card-menu {', css)
        self.assertIn('.card-menu.show', css)
        self.assertIn('max-height: calc(100vh - 16px)', css)


class NavSearchBangContractTests(TestCase):
    """搜索前缀(2026-11-10):/g 关键词、!bd 关键词直接换引擎,不改用户已选引擎。"""

    def test_js_parses_bang_prefix(self):
        js = static_text('js/nav-sites.js')
        self.assertIn('NAV_BANG_ALIAS', js)
        self.assertIn('navBangParse', js)
        self.assertIn('navBangResolve', js)

    def test_unknown_alias_falls_back_to_plain_query(self):
        js = static_text('js/nav-sites.js')
        self.assertIn('return hit ? { url: hit.url, q: m[2].trim() } : null', js)

    def test_bang_does_not_overwrite_selected_engine(self):
        js = static_text('js/nav-sites.js')
        # 提交时才解析,且 localStorage 存的仍是下拉里的引擎
        self.assertIn("localStorage.setItem('navSearchEngine', $engineSel.val())", js)
        self.assertIn('const bang = navBangParse(typed)', js)

    def test_slash_focus_and_escape_clear(self):
        js = static_text('js/nav-sites.js')
        self.assertIn("e.key !== '/'", js)
        self.assertIn("e.key === 'Escape'", js)


class NavStatusDotTests(TestCase):
    """站点状态点(2026-11-10):只有体检过的站点才出现圆点,没测过不渲染灰点。"""

    def setUp(self):
        from .views import _seed_nav_sites
        _seed_nav_sites()

    def _html(self):
        resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, resp.status_code)
        return resp.content.decode('utf-8')

    def test_dot_hidden_when_never_checked(self):
        from .models import NavSite
        NavSite.objects.update(last_check_at=None, last_check_ok=None, last_check_note='',
                               last_check_code=None, last_check_ms=None)
        self.assertNotIn('site-dot', self._html())

    def test_dot_ok_after_check(self):
        from django.utils import timezone
        from .models import NavSite
        site = NavSite.objects.filter(category='搜索引擎').first() or NavSite.objects.first()
        site.last_check_at = timezone.now()
        site.last_check_ok = True
        site.last_check_code = 200
        site.last_check_ms = 320
        site.save(update_fields=['last_check_at', 'last_check_ok', 'last_check_code', 'last_check_ms'])
        html = self._html()
        self.assertIn('site-dot dot-ok', html)
        self.assertIn('HTTP 200', html)

    def test_dot_warn_for_slow_and_fail_for_broken(self):
        from django.utils import timezone
        from .models import NavSite
        slow = NavSite.objects.first()
        slow.last_check_at = timezone.now()
        slow.last_check_ok = True
        slow.last_check_ms = 4200
        slow.save(update_fields=['last_check_at', 'last_check_ok', 'last_check_ms'])
        self.assertIn('site-dot dot-warn', self._html())

        broken = NavSite.objects.exclude(pk=slow.pk).first()
        broken.last_check_at = timezone.now()
        broken.last_check_ok = False
        broken.last_check_note = 'HTTP 502'
        broken.save(update_fields=['last_check_at', 'last_check_ok', 'last_check_note'])
        # 2026-11-14:打不开的卡片不再画状态点 —— 右侧已经有「打不开」胶囊,
        # 红点+黄点同时出现会挤在标题上(用户截图反馈)。
        self.assertNotIn('site-dot dot-fail', self._html())
        self.assertIn('site-check-bad', self._html())


class NavDragAutoSaveContractTests(TestCase):
    """拖拽即存(2026-11-10):松手后自动保存,失败按拖前快照回滚。"""

    def test_js_debounces_and_autosaves(self):
        js = static_text('js/stars-filter.js')
        self.assertIn('navOrderTimer', js)
        self.assertIn('navSaveSiteOrder({ snapshot: navOrderSnapshot })', js)

    def test_manual_savebar_is_gone(self):
        """手动保存条已删:拖拽松手即存,页面里不该再有第二套保存入口。"""
        js = static_text('js/stars-filter.js')
        self.assertNotIn("$('#navSiteOrderSave')", js)
        self.assertNotIn('navSiteOrderBar', js)

    def test_js_rolls_back_on_failure(self):
        js = static_text('js/stars-filter.js')
        self.assertIn('navApplyOrderIds(opts.snapshot)', js)
        self.assertIn('顺序已恢复', js)



import pathlib
from django.conf import settings


def _css(rel):
    """读静态 CSS(预编译后,样式断言不能再从页面 HTML 里找)。"""
    return (pathlib.Path(settings.BASE_DIR) / 'nav' / 'static' / rel).read_text(encoding='utf-8')
