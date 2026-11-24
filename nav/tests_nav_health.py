# nav/tests_nav_health.py
"""测活 / 批量队列 / 健康篮 / 点击统计 / 批量卫生(2026-11-07 从 nav/tests.py 按域拆出)。

只跑本域:`python manage.py test nav.tests_nav_health`;公共底座见 `tests_nav_common.py`。
"""
from .tests_nav_common import (
    NavSite,
    SimpleUploadedFile,
    TestCase,
    _find_ai_js,
    _health_js,
    _json,
    _lt_js,
    _pet_js,
    _stars_js,
    json,
    mock,
    reverse,
    static_text,
)


class NavLinkCheckTests(TestCase):
    """链接测活 API(离线,mock requests.get)。"""

    def _post_json(self, payload):
        return self.client.post(reverse('nav_link_check'), data=json.dumps(payload),
                                content_type='application/json')

    def test_mixed_results(self):
        import requests as rq
        ok = mock.Mock(status_code=200, url='https://good.example')
        ok.close = mock.Mock()
        dead = mock.Mock(status_code=404, url='https://gone.example')
        dead.close = mock.Mock()

        def fake_get(url, **kwargs):
            if 'gone' in url:
                return dead
            if 'fail' in url:
                raise rq.exceptions.ConnectionError('boom')
            return ok

        with mock.patch('nav.views.requests.get', side_effect=fake_get):
            data = json.loads(self._post_json({'urls': ['https://good.example', 'https://gone.example',
                                                        'https://fail.example']}).content)
        results = {r['url']: r for r in data['results']}
        self.assertTrue(results['https://good.example']['ok'])
        self.assertEqual(200, results['https://good.example']['status'])
        self.assertFalse(results['https://gone.example']['ok'])
        self.assertEqual('HTTP 404', results['https://gone.example']['error'])
        self.assertFalse(results['https://fail.example']['ok'])
        self.assertEqual('ConnectionError', results['https://fail.example']['error'])

    def test_dedup_normalize_and_validation(self):
        with mock.patch('nav.views.requests.get') as get:
            get.return_value = mock.Mock(status_code=200, url='https://x.example', close=mock.Mock())
            data = json.loads(self._post_json({'urls': ['x.example', 'https://x.example', '  ']}).content)
            self.assertEqual(1, len(data['results']))  # 去重后只测一条
        self.assertEqual(400, self._post_json({'urls': []}).status_code)
        self.assertEqual(400, self._post_json({'urls': 'not-a-list'}).status_code)

    def test_proxy_passed_and_normalized(self):
        with mock.patch('nav.views.requests.get') as get:
            get.return_value = mock.Mock(status_code=200, url='https://p.example', close=mock.Mock())
            self._post_json({'urls': ['https://p.example'], 'proxy': '127.0.0.1:7890'})
            kwargs = get.call_args.kwargs
        self.assertEqual({'http': 'http://127.0.0.1:7890', 'https': 'http://127.0.0.1:7890'}, kwargs['proxies'])


class NavCheckRecordTests(TestCase):
    """体检结果落库(仅记录,不改链接):卡片上的「打不开」角标只在跑过链接测活之后出现。"""

    def setUp(self):
        self.good = NavSite.objects.create(name='Good', url='https://good.example', category='AI')
        self.dead = NavSite.objects.create(name='Gone', url='https://gone.example', category='AI')
        self.never = NavSite.objects.create(name='Never', url='https://never.example', category='AI')

    def _run_check(self, urls):
        ok_resp = mock.Mock(status_code=200, url='https://ok', close=mock.Mock())
        dead_resp = mock.Mock(status_code=404, url='https://dead', close=mock.Mock())

        def fake_get(url, **kwargs):
            return dead_resp if 'gone' in url else ok_resp

        with mock.patch('nav.views.requests.get', side_effect=fake_get):
            return json.loads(self.client.post(
                reverse('nav_link_check'), data=json.dumps({'urls': urls}),
                content_type='application/json').content)

    def test_results_recorded_per_site(self):
        self._run_check(['https://good.example', 'https://gone.example'])
        self.good.refresh_from_db(); self.dead.refresh_from_db()
        self.assertTrue(self.good.last_check_ok)
        self.assertEqual('', self.good.last_check_note)
        self.assertIsNotNone(self.good.last_check_at)
        self.assertFalse(self.dead.last_check_ok)
        self.assertEqual('HTTP 404', self.dead.last_check_note)

    def test_unchecked_site_stays_empty(self):
        self._run_check(['https://good.example', 'https://gone.example'])
        self.never.refresh_from_db()
        self.assertIsNone(self.never.last_check_at)
        self.assertIsNone(self.never.last_check_ok)

    def test_recording_does_not_touch_the_link(self):
        """用户明确要求:体检只是说明,不许动他的网址/备用/子页。"""
        self.dead.alternates = [{'name': 'MIRROR', 'url': 'https://gone.example/mirror'}]
        self.dead.children = [{'name': 'blog', 'url': 'https://blog.example'}]
        self.dead.save()
        self._run_check(['https://gone.example'])
        self.dead.refresh_from_db()
        self.assertEqual('https://gone.example', self.dead.url)
        self.assertEqual(1, len(self.dead.alternates))
        self.assertEqual('MIRROR', self.dead.alternates[0]['name'])
        self.assertEqual(1, len(self.dead.children))
        self.assertEqual('HTTP 404', self.dead.last_check_note)

    def test_recheck_overwrites_previous_result(self):
        self._run_check(['https://gone.example'])
        self.dead.refresh_from_db()
        first = self.dead.last_check_at
        self._run_check(['https://good.example'])   # gone 这轮没测,保持旧记录
        self.dead.refresh_from_db()
        self.assertEqual(first, self.dead.last_check_at)
        self._run_check(['https://gone.example'])
        self.dead.refresh_from_db()
        self.assertGreaterEqual(self.dead.last_check_at, first)

    def test_badge_rendered_only_after_a_check(self):
        badge = 'badge site-tag site-check-bad'
        page = self.client.get(reverse('nav_sites'))
        self.assertNotContains(page, badge)                   # 没体检过 = 一个标记都不露
        self._run_check(['https://good.example', 'https://gone.example'])
        page = self.client.get(reverse('nav_sites'))
        self.assertContains(page, badge)
        self.assertContains(page, '打不开')
        html = page.content.decode()
        self.assertEqual(1, html.count(badge), '只有 gone 该带角标')
        self.assertIn('HTTP 404', html)

    def test_check_data_not_exported(self):
        """体检结果是本机事实,不进移植契约(导出 JSON 键不变,老文件照常导入)。"""
        self._run_check(['https://gone.example'])
        payload = json.loads(self.client.get(reverse('nav_export')).content.decode())
        row = next(s for s in payload['sites'] if s['url'] == 'https://gone.example')
        self.assertNotIn('last_check_ok', row)
        self.assertNotIn('last_check_at', row)

    def test_import_does_not_clear_check_record(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self._run_check(['https://gone.example'])
        upload = SimpleUploadedFile(
            'nav.json',
            json.dumps({'version': 8, 'sites': [{'name': 'Gone Renamed', 'url': 'https://gone.example',
                                                 'category': 'AI'}]}, ensure_ascii=False).encode('utf-8'),
            content_type='application/json')
        self.client.post(reverse('nav_import'), {'nav_file': upload})
        self.dead.refresh_from_db()
        self.assertEqual('Gone Renamed', self.dead.name)
        self.assertEqual('HTTP 404', self.dead.last_check_note)   # 导入不抹掉本机体检记录

    def test_restore_keeps_check_record_off(self):
        """删除时返回的整行不含体检字段,恢复出来的站点应视为从未体检。"""
        self._run_check(['https://gone.example'])
        deleted = json.loads(self.client.post(reverse('nav_delete'),
                             data=json.dumps({'id': self.dead.pk}),
                             content_type='application/json').content)
        self.assertNotIn('last_check_ok', deleted['site'])
        self.client.post(reverse('nav_restore'), data=json.dumps(deleted),
                         content_type='application/json')
        revived = NavSite.objects.get(url='https://gone.example')
        self.assertIsNone(revived.last_check_ok)


class NavLinkCheckStatusTests(TestCase):
    """测活状态判定:最终响应 3xx(allow_redirects 下仍 3xx = 跳转无目标)不算存活。"""

    def _check(self, status):
        from unittest import mock
        resp = mock.Mock()
        resp.status_code = status
        resp.text = ''
        resp.content = b''
        resp.url = 'https://x.example/'
        with mock.patch('nav.views.requests.get', return_value=resp):
            from .views import _nav_check_link
            return _nav_check_link('https://x.example/', '')

    def test_3xx_without_location_is_dead(self):
        for status in (301, 302, 304, 308):
            with self.subTest(status=status):
                entry = self._check(status)
                self.assertFalse(entry['ok'])
                self.assertIn('重定向无目标', entry['error'])

    def test_2xx_alive_and_4xx_dead(self):
        self.assertTrue(self._check(200)['ok'])
        self.assertFalse(self._check(404)['ok'])


class NavClickStatTests(TestCase):
    """点击埋点:click_count 累加;非法输入报错。"""

    def test_click_increments(self):
        site = NavSite.objects.create(name='S', url='https://s.com', category='设计资源')
        for _ in range(2):
            resp = self.client.post(reverse('api_nav_click'),
                                    data=_json.dumps({'id': site.id}),
                                    content_type='application/json')
        self.assertEqual('ok', resp.json()['status'])
        site.refresh_from_db()
        self.assertEqual(2, site.click_count)

    def test_click_bad_id(self):
        resp = self.client.post(reverse('api_nav_click'),
                                data=_json.dumps({'id': 99999}),
                                content_type='application/json')
        self.assertEqual(404, resp.status_code)

    def test_tracking_delegate_matches_card_dom(self):
        """埋点契约(回归):2026-10-06 前委托找 [data-site-id],卡片包装上却是
        data-site-item + data-id → 选择器全页零匹配,端点从未被前端调用,click_count 恒 0,
        「按常用度排序」空转;测试直接 POST 端点所以一直全绿。两边属性名必须一致。"""
        NavSite.objects.create(name='S', url='https://s.com', category='设计资源')
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('js/nav-sites.js'))
        ai_js = _find_ai_js()
        self.assertRegex(html, r'data-site-item data-id="\d+"')       # 卡片包装侧(模板)
        self.assertIn("closest('[data-site-item]')", ai_js)           # 委托侧(已拆到 find-ai.js)
        self.assertNotIn('[data-site-id]', html)                      # 旧选择器不许回来
        self.assertNotIn('[data-site-id]', ai_js)
        # 常用度排序同样要覆盖三种行标记(漏大类直属行的旧坑)
        self.assertIn(".nav-cat > .row.g-2", ai_js)
        # 拆分挂载契约:页面要引 find-ai.js + JSON 配置岛(静态文件里禁模板标签)
        self.assertIn("js/find-ai.js", html)
        self.assertIn('id="navAiUrls"', html)
        self.assertNotIn('{%', ai_js)
        self.assertNotIn('{{', ai_js)


class NavLinkCheckParamTests(TestCase):
    """测活参数配置化:timeout/total_timeout 可选、区间校验(400 不是 500)、缺省行为不变。"""

    def _post_json(self, payload):
        return self.client.post(reverse('nav_link_check'), data=json.dumps(payload),
                                content_type='application/json')

    def _ok_resp(self):
        r = mock.Mock(status_code=200, url='https://x.example')
        r.close = mock.Mock()
        return r

    def test_accepts_valid_params_and_passes_timeout(self):
        with mock.patch('nav.views.requests.get', return_value=self._ok_resp()) as get:
            resp = self._post_json({'urls': ['https://x.example'], 'timeout': 5, 'total_timeout': 20})
        self.assertEqual(200, resp.status_code)
        self.assertEqual(5, get.call_args.kwargs['timeout'])

    def test_numeric_string_params_accepted(self):
        """前端 input 的值永远是字符串:'5' 必须当 5 用,不能 400。"""
        with mock.patch('nav.views.requests.get', return_value=self._ok_resp()) as get:
            resp = self._post_json({'urls': ['https://x.example'], 'timeout': '7'})
        self.assertEqual(200, resp.status_code)
        self.assertEqual(7, get.call_args.kwargs['timeout'])

    def test_empty_and_absent_params_use_defaults(self):
        from .views import NAV_LINK_TIMEOUT
        for payload in ({'urls': ['https://x.example']},
                        {'urls': ['https://x.example'], 'timeout': '', 'total_timeout': ''}):
            with mock.patch('nav.views.requests.get', return_value=self._ok_resp()) as get:
                resp = self._post_json(payload)
            self.assertEqual(200, resp.status_code)
            self.assertEqual(NAV_LINK_TIMEOUT, get.call_args.kwargs['timeout'])

    def test_rejects_out_of_range_and_non_int(self):
        for bad in (2, 31, 'abc', 3.5, True):
            resp = self._post_json({'urls': ['https://x.example'], 'timeout': bad})
            self.assertEqual(400, resp.status_code, f'timeout={bad!r} 应被拒绝')
            self.assertEqual('error', json.loads(resp.content)['status'])
        for bad in (5, 301, 'x'):
            resp = self._post_json({'urls': ['https://x.example'], 'total_timeout': bad})
            self.assertEqual(400, resp.status_code, f'total_timeout={bad!r} 应被拒绝')


class NavLinkBatchQueueTests(TestCase):
    """测活分批队列 + 断点续测(2000 站量级):32 条一批顺序跑、逐批落库、可停可续。

    行为契约(2026-10-16 锁定,防回归):
    - 预算耗尽没跑到的条目带 skipped=True:"未检测"≠"打不开",一律不写体检记录(否则误报角标)
    - 前端超过 300 条不再截断,改分批(旧行为是丢掉 300 条之外的)
    - 续测靠卡片 data-check-at + localStorage 的体检开始时间,跳过 1 小时内已测过的
    """

    def setUp(self):
        self.good = NavSite.objects.create(name='Good', url='https://good.example', category='AI')
        self.slow = NavSite.objects.create(name='Slow', url='https://slow.example', category='AI')

    def test_budget_exhausted_entries_marked_skipped(self):
        """预算不够时没跑到的条目必须标 skipped,与"真超时"区分开。

        慢站用 Event 卡住而不是 sleep:Windows 上建 8 个线程要 0.3~0.4 秒,
        sleep 的慢站会在预算计时开始前就跑完一半(同一台机器观测到 10~14 条不等),
        让这条断言随机飘;卡住则"预算内一条都没跑完"是确定的。"""
        import threading
        from . import views

        gate = threading.Event()

        def fake_check(url, proxy, timeout=None):
            if 'slow' in url:
                gate.wait(5)        # 预算耗尽后才由 finally 放行
            return {'url': url, 'ok': True, 'status': 200, 'error': ''}

        urls = ['https://fast1.example', 'https://fast2.example'] + [f'https://slow{i}.example' for i in range(14)]
        try:
            with mock.patch('nav.views_nav_check._nav_check_link', side_effect=fake_check):
                entries = views._nav_check_links(urls, '', 0.1)
        finally:
            gate.set()              # 放掉卡住的线程,别让它们拖到解释器退出
        self.assertEqual(len(urls), len(entries))
        self.assertFalse(entries['https://fast1.example'].get('skipped'))
        skipped = [u for u in urls if entries[u].get('skipped')]
        self.assertGreaterEqual(len(skipped), 12)      # 14 条慢站几乎必然超预算
        for u in skipped:
            self.assertEqual('Timeout', entries[u]['error'])

    def test_record_skips_truncated_entries(self):
        """skipped 条目不许落库:没有结论就不该留"打不开"记录。"""
        from . import views
        views._record_link_checks([
            {'url': 'https://good.example', 'ok': True, 'status': 200, 'error': ''},
            {'url': 'https://slow.example', 'ok': False, 'status': None,
             'error': 'Timeout', 'skipped': True},
        ])
        self.good.refresh_from_db()
        self.slow.refresh_from_db()
        self.assertIsNotNone(self.good.last_check_at)
        self.assertTrue(self.good.last_check_ok)
        self.assertIsNone(self.slow.last_check_at)      # 未检测:一个字段都不写
        self.assertIsNone(self.slow.last_check_ok)

    def test_endpoint_returns_skipped_flag(self):
        from . import views
        def fake_check(url, proxy, timeout=None):
            return {'url': url, 'ok': False, 'status': None, 'error': 'Timeout', 'skipped': True}
        with mock.patch('nav.views_nav_check._nav_check_links',
                        side_effect=lambda urls, proxy, budget, timeout=None: {u: fake_check(u, proxy) for u in urls}):
            data = json.loads(self.client.post(
                reverse('nav_link_check'), data=json.dumps({'urls': ['https://slow.example']}),
                content_type='application/json').content)
        self.assertTrue(data['results'][0].get('skipped'))
        self.slow.refresh_from_db()
        self.assertIsNone(self.slow.last_check_at)      # 端点这层也没落库

    def _page(self):
        return (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))

    def test_card_exposes_check_timestamp(self):
        """卡片要带 data-check-at 且是 Unix 秒(续测靠它判断"这条已测过");没测过的输出空串
        (前端 Number('')===0,小于任何体检开始时间 → 会被续测纳入,语义正确)。"""
        from django.utils import timezone
        NavSite.objects.filter(pk=self.good.pk).update(last_check_at=timezone.now())
        html = self._page()
        self.assertRegex(html, r'data-check-at="\d{9,}"')
        self.assertIn('data-check-at=""', html)     # 从未体检过的站(种子站)为空

    def test_page_renders_batch_queue_scaffold(self):
        html = self._page()
        for frag in ('id="ltProgressWrap"', 'id="ltProgressBar"', 'id="ltStop"',
                     'id="ltResume"', 'id="ltResumeHint"'):
            self.assertIn(frag, html)

    def test_frontend_batch_queue_contract(self):
        lt_js = _lt_js()   # 分批队列 JS 已拆到 linktest.js(2026-10-25),契约读 js 源
        for frag in ('const LT_BATCH = 32;', "const LT_RESUME_KEY = 'navLinkCheckStartedAt';",
                     'function ltRunQueued(urls)', 'function ltCollectedUrls(onlyFresh)',
                     'function ltRefreshResume()', 'function ltSetRunning(on)',
                     'let ltRunToken = 0;'):
            self.assertIn(frag, lt_js)
        # 分批:chunk 容器 + 进度写回
        self.assertIn("$res.find('.lt-chunk[data-chunk=\"' + k + '\"]').html(h);", lt_js)
        self.assertIn("$('#ltProgressBar').css('width', pct + '%')", lt_js)
        # 停止 = token 作废,已测的都已落库
        self.assertIn('ltRunToken++;', lt_js)
        # 续测:只留"上次体检开始后没测过的"
        self.assertIn("* 1000 >= startedAt) return;", lt_js)

    def test_legacy_300_truncation_removed(self):
        """旧行为把 300 条之外的直接丢掉;分批后不许再截断。"""
        html = self._page()
        self.assertNotIn('urls.slice(0, 300)', html)

    def test_frontend_renders_skipped_as_not_tested(self):
        lt_js = _lt_js()
        self.assertIn('if (r.skipped) { skipped++;', lt_js)
        self.assertIn("'未测', 'text-bg-warning'", lt_js)
        self.assertIn('预算不足,这轮没跑到', lt_js)


class NavHealthBasketTests(TestCase):
    """体检篮(叼走死链)+ 健康总览 + 点击热力 + Alt+1~9 直达 + 桌宠朗读:契约双源断言。"""

    def test_page_marks(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('js/nav-sites.js'))
        # 抽屉与顶栏入口
        for frag in ('id="navBasketDrawer"', 'id="navBasketBtn"', 'id="navBasketCount"',
                     'id="navBasketList"', 'id="navHealthList"',
                     'id="navBasketTabBtn"', 'id="navHealthTabBtn"',
                     'id="navHealthUrls"', 'js/health.js'):
            self.assertIn(frag, html, frag)

    def test_health_js_contract(self):
        js = _health_js()
        for frag in ('navDeadBasket', 'window.navBasketFromResults', 'window.navBasketOpen',
                     'window.navApplyClickHeat', 'color-mix(in srgb, var(--accent)',
                     'data-check-at', 'window.siteMap', 'HEALTH_URLS.delete', 'site: deletedRow'):
            self.assertIn(frag, js, frag)
        # linktest.js 在体检结束时把死链叼进篮子
        lt_js = _lt_js()
        self.assertIn('deadFound.push({url: r.url, error: r.error', lt_js)
        self.assertIn('window.navBasketFromResults(deadFound.splice(0))', lt_js)
        # 点击统计成功后点亮热力
        self.assertIn('if (window.navApplyClickHeat) navApplyClickHeat()', _find_ai_js())
        # 大图标布局不铺热力底色,否则外层栅格列会变成大小不一的深色块
        self.assertIn("const iconLayout = $('.nav-hub').hasClass('lyr-icon')", js)
        # 切换布局后重新计算热力,保证大图标底色即时退场
        self.assertIn('window.navApplyClickHeat()', static_text('js/nav-sites.js'))

    def test_pet_speech_and_basket_menu(self):
        pet_js = _pet_js()
        for frag in ("'navPetSpeak'", 'speechSynthesis', 'navPetSpeakCk', 'navPetBasketItem',
                     "window.navBasketOpen('basket')"):
            self.assertIn(frag, pet_js, frag)
        # 恢复默认清单带上朗读键
        self.assertIn("'navPetChime', 'navPetNotify', 'navPetSpeak'", pet_js)
        # 快捷键直达(stars-filter.js)
        sf = _stars_js()
        self.assertIn('快捷键直达', sf)
        self.assertIn("navLsGet('navRecent').filter(Boolean)", sf)


class NavBatchHygieneOldestTests(TestCase):
    """多选批量 / URL 卫生 / 增量体检 / 一键三开(2026-10-26 点单 1236)。"""

    def setUp(self):
        NavSite.objects.create(name='脏站', url='https://Shop.example.com/?utm_source=x&id=2&fbclid=abc', category='测试')
        NavSite.objects.create(name='净站', url='https://clean.example.com/', category='测试')
        NavSite.objects.create(name='冲突站', url='https://shop.example.com/?id=2', category='测试')

    def _ids(self, url_part):
        return [s.id for s in NavSite.objects.filter(url__contains=url_part)]

    def test_batch_category_and_tags(self):
        ids = self._ids('Shop.example.com/?utm')
        r = self.client.post(reverse('api_nav_batch'),
                             data=json.dumps({'action': 'category', 'ids': ids, 'category': '搬家目标', 'subcat': '子一'}),
                             content_type='application/json').json()
        self.assertEqual(1, r['updated'])
        s = NavSite.objects.get(id=ids[0])
        self.assertEqual('搬家目标', s.category)
        self.assertEqual('子一', s.subcat)
        r = self.client.post(reverse('api_nav_batch'),
                             data=json.dumps({'action': 'tags', 'ids': ids, 'tags': ['素材', ' 免费 ']}),
                             content_type='application/json').json()
        self.assertEqual(1, r['updated'])
        self.assertEqual(['免费', '素材'], NavSite.objects.get(id=ids[0]).tags)

    def test_batch_delete_returns_rows(self):
        ids = self._ids('utm_source')   # 精确圈定脏站(SQLite contains 大小写不敏感,别用域名圈)
        r = self.client.post(reverse('api_nav_batch'),
                             data=json.dumps({'action': 'delete', 'ids': ids}),
                             content_type='application/json').json()
        self.assertEqual(1, r['deleted'])
        self.assertEqual('脏站', r['rows'][0]['name'])
        self.assertFalse(NavSite.objects.filter(id=ids[0]).exists())

    def test_batch_validation(self):
        for payload in ({'action': 'category', 'ids': [], 'category': 'X'},
                        {'action': 'category', 'ids': [1], 'category': ''},
                        {'action': 'tags', 'ids': [1], 'tags': 'not-a-list'},
                        {'action': 'whatever', 'ids': [1]}):
            resp = self.client.post(reverse('api_nav_batch'),
                                    data=json.dumps(payload), content_type='application/json')
            self.assertEqual(400, resp.status_code, payload)

    def test_hygiene_scan_and_apply(self):
        r = self.client.get(reverse('api_nav_hygiene')).json()
        item = next(i for i in r['items'] if i['name'] == '脏站')
        # 剥跟踪参数(utm_*/fbclid)+host 小写;id=2 不是跟踪参数,保留
        self.assertEqual('https://shop.example.com/?id=2', item['new'])
        self.assertNotIn('utm_source', item['new'])
        self.assertTrue(item['conflict'])   # 清理后与「冲突站」重复 → 冲突标记打在该条目上(去重是另一件事,不自动合并)
        # 应用(带 race 保护:from 不符则跳过)
        r2 = self.client.post(reverse('api_nav_hygiene'),
                              data=json.dumps({'items': [{'id': item['id'], 'from': item['old']}]}),
                              content_type='application/json').json()
        # 该条是冲突条(清理后与冲突站重复)→ 应用端也跳过,绝不 500
        self.assertEqual(0, r2['applied'])
        self.assertTrue(NavSite.objects.filter(url=item['old']).exists())

    def test_hygiene_ignores_non_http(self):
        NavSite.objects.create(name='特殊', url='chrome://settings', category='测试')
        r = self.client.get(reverse('api_nav_hygiene')).json()
        self.assertFalse([i for i in r['items'] if i['name'] == '特殊'])

    def test_marks(self):
        import os as _os
        js = open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                'static', 'js', 'batch.js'), encoding='utf-8').read()
        for frag in ('navMsBar', 'navMsGoCat', 'navMsGoTags', 'navMsGoDel', 'BATCH_URLS',
                      'navBulkToggle', 'site-bulk-check', 'navMsGoOpen', 'navMsGoStar',
                      'navMsGoCopy', 'navMsGoAll', 'navMsMoreBtn', 'navMsMore', 'ms-more-panel'):
            self.assertIn(frag, js, frag)
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8')
                + static_text('js/nav-sites.js'))
        for frag in ('id="navBatchUrls"', 'js/batch.js', 'id="ltOldest"', '最旧 50 条', 'id="navHygieneTabBtn"', 'id="navHygieneList"', 'id="navBulkToggle"'):
            self.assertIn(frag, html, frag)
        lt = _lt_js()
        for frag in ('ltOldest', "data-check-at"):
            self.assertIn(frag, lt, frag)
        self.assertIn('shiftKey', html)   # 一键三开在主脚本


class NavLinkAiPanelTests(TestCase):
    """主人版「链接检测 / AI 提示词 / 粘贴导入」面板(2026-11-20):静态契约断言。

    服务端测活/写库契约由 tests_nav_link_fix 覆盖;本类只盯前端面板的挂载点、
    提示词锚点、解析/预览/回滚/复制令牌与红线,不碰既有健康篮与体检逻辑。
    """

    def _link_ai_js(self):
        import os as _os
        return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                  'static', 'js', 'link-ai.js'), encoding='utf-8').read()

    def _template(self):
        from pathlib import Path
        root = Path(__file__).resolve().parent / 'templates' / 'nav'
        main = (root / 'nav_sites.html').read_text(encoding='utf-8')
        # 2026-11-24:模板拆了 partials,静态断言要连拆出去的弹层一起看
        parts = sorted((root / 'partials').glob('*.html')) if (root / 'partials').is_dir() else []
        return main + '\n' + '\n'.join(p.read_text(encoding='utf-8') for p in parts)

    def test_template_mounts_modal_island_script_and_entries(self):
        tpl = self._template()
        for frag in ('id="navAiLinkModal"', 'id="navLinkFixUrls"', 'id="nailRows"',
                     'id="nailPromptInput"', 'id="nailImportInput"', 'id="nailImportRows"',
                     'id="nailResult"', 'id="nailTabCheck"', 'id="nailTabPrompt"',
                     'id="nailTabImport"'):
            self.assertIn(frag, tpl, frag)
        # 脚本标签挂在 linktest.js 之后,带 static_version 缓存戳
        self.assertIn("js/link-ai.js' %}?v={{ static_version }}", tpl)
        self.assertIn("{% url 'nav_link_check' %}", tpl)
        self.assertIn("{% url 'api_nav_link_fix' %}", tpl)
        # 菜单入口指向新弹窗
        self.assertIn('data-bs-target="#navAiLinkModal"', tpl)
        self.assertIn('链接检测 / AI 提示词', tpl)
        # 休眠行补 data-* 供面板并入检测范围
        self.assertIn('data-id="{{ s.pk }}" data-url="{{ s.url }}" data-name="{{ s.name }}" data-cat="{{ s.category }}"', tpl)
        # 仅补空 / 覆盖 两个选项,默认仅补空
        self.assertIn('id="nailFillModeFill" checked', tpl)
        self.assertIn('id="nailFillModeOverwrite"', tpl)
        self.assertIn('仅补空字段', tpl)
        self.assertIn('覆盖已有', tpl)

    def test_page_renders_new_panel(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for frag in ('id="navAiLinkModal"', 'id="navLinkFixUrls"', 'id="nailPromptInput"',
                     'id="nailImportInput"', 'js/link-ai.js'):
            self.assertIn(frag, html, frag)

    def test_link_ai_js_prompt_anchors_and_vocab(self):
        js = self._link_ai_js()
        for frag in ('只输出 JSON 数组', '不要编造不存在的网址', '无法确定就留空',
                     'new_url', 'fixed_url', 'description', 'category', 'subcat',
                     '优先使用给定词表,不要自造分类', 'tagVocab()', 'categories()'):
            self.assertIn(frag, js, frag)

    def test_link_ai_js_check_flow(self):
        js = self._link_ai_js()
        for frag in ('function runLinkCheck', 'const NAIL_BATCH = 4', 'linkFilter',
                     'nailSelected', 'data-nail-filter', "'archived'"):
            self.assertIn(frag, js, frag)
        for state in ("'all'", "'dead'", "'untested'", "'ok'"):
            self.assertIn(state, js, state)

    def test_link_ai_js_parse_and_preview(self):
        js = self._link_ai_js()
        self.assertIn('function parseAiReply', js)
        self.assertIn('```(?:json)?', js)
        self.assertIn("indexOf('[')", js)
        self.assertIn("lastIndexOf(']')", js)
        self.assertIn('->|=>|→', js)
        # 冲突行置灰 + 勾选框禁用
        self.assertIn('is-conflict', js)
        self.assertIn('冲突,跳过', js)
        self.assertIn("prop('disabled'", js)

    def test_link_ai_js_apply_rollback_copy(self):
        js = self._link_ai_js()
        for frag in ('function applyLinkFix', 'function postFix', 'function rollbackApplied',
                     'overwrite: true', 'new_url: snap.url', '部分回滚未完成',
                     'navigator.clipboard.writeText', "execCommand('copy')",
                     'location.reload()', 'const FIX_BATCH = 50'):
            self.assertIn(frag, js, frag)
        # 默认仅补空:覆盖单选默认未勾,overwrite 取该框 checked
        self.assertIn("$('#nailFillModeOverwrite')", js)

    def test_link_ai_js_red_lines(self):
        js = self._link_ai_js()
        for banned in ('window.confirm', 'confirm(', 'alert(', 'prompt(', 'fetch(',
                       '/api/nav/', 'statusCode', 'status ='):
            self.assertNotIn(banned, js, banned)

    def test_health_entry_button_appended(self):
        self.assertIn('navHealthLinkEntry', _health_js())

