# nav/tests_nav_pet.py
"""桌宠 / 宠物 AI 与地理 / 进化商店 / 键盘氛围(2026-11-07 从 nav/tests.py 按域拆出)。

只跑本域:`python manage.py test nav.tests_nav_pet`;公共底座见 `tests_nav_common.py`。
"""
from django.test import SimpleTestCase

from datetime import datetime

from .models import NavSite
from .tests_nav_common import (
    TestCase,
    _pet_js,
    _stars_js,
    json,
    mock,
    os,
    reverse,
    static_text,
)


def _today_stamp(hm):
    """生成「今天 HH:MM」的气象更新时间,避免固定日期变成时间炸弹。"""
    return datetime.now().strftime('%Y/%m/%d ') + hm


class NavPetQuickTests(TestCase):
    """聊天窗口的站点快捷操作(随机 / 统计 / 搜索),不依赖 AI 接口。"""

    def _post(self, payload):
        return self.client.post(reverse('api_nav_pet_quick'), data=json.dumps(payload),
                                content_type='application/json')

    def test_random_stats_and_search(self):
        NavSite.objects.create(name='QuickTestSite', url='https://quicktest.example/',
                               category='测试类', subcat='子类', description='专门给桌宠搜索用')
        for action in ('random', 'stats'):
            resp = self._post({'action': action})
            self.assertEqual(200, resp.status_code)
            self.assertEqual('ok', resp.json()['status'])
        data = self._post({'action': 'search', 'query': 'QuickTest'}).json()
        self.assertEqual('ok', data['status'])
        self.assertIn('QuickTestSite', [x['name'] for x in data['links']])

    def test_bad_action_and_empty_query(self):
        self.assertEqual(400, self._post({'action': 'nope'}).status_code)
        self.assertEqual(400, self._post({'action': 'search', 'query': '  '}).status_code)


class NavPetTests(TestCase):
    """桌宠右键菜单与台词边界:台词只聊导航功能。"""

    def test_pet_menu_and_nav_quotes_rendered(self):
        html = self.client.get('/nav/').content.decode('utf-8')
        pet_js = _pet_js()
        # 菜单由 pet.js 构建(拆分前在页面内联);构建代码(菜单容器/各动作/点播属性/公共 API)必须在其源码里
        for marker in ('navPetMenu', "petMenuItem('actions'", "petMenuItem('walk'",
                       "petMenuItem('sleep'", "petMenuItem('meme'", "petMenuItem('suggest'",
                       "petMenuItem('weather'", "petMenuItem('settings'", "petMenuItem('off'",
                       'data-pet-play', 'navPetActionsModal', 'navPetSettingsModal',
                       'navPetSizeR', 'navPetOpacityR', 'navPetWhisperSel',
                       'navPetSoundCk', 'navPetVolR', 'navPetGreetCk', 'navPetBubbleR',
                       'navPetCityIn', 'max="448"', 'nav-pet-bubble-card', 'petBeep',
                       'navPetChatWin', 'navPetChatQuick', 'navPetChatSetPop',
                       'petChatWindowOpen', 'petAiQuickOpen', 'nav-pet-resize-grip',
                       'PET_MEMES', 'navPetMeme', 'navPetState', 'navPetSay',
                       'navTouchRecent', 'open-meteo', '原地小憩沉眠', '工作状态-垂头叹气冒汗',
                       "petMenuItem('feed'", "petMenuItem('status'", 'navPetVitals',
                       'PET_FESTIVALS', 'navPetSpeedR', 'navPetToneSel', 'navPetCalmCk', 'navPetUiScaleSel',
                       'navPetWalkSel', 'navPetIdleSel', 'navPetIpIdle'):
            self.assertIn(marker, pet_js)
        # 台词是导航专属语录
        self.assertIn('链接测活帮你扫死链', pet_js)


class NavPetGeoTests(TestCase):
    """桌宠天气城市解析:open-meteo 中文搜索很弱(实测「朝阳」首位是重庆一个 1.3 万人的乡,
    辽宁朝阳市不在结果里),服务器端打分消歧 + Nominatim 回落;结果缓存 6h。"""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()   # 测试进程共享 locmem 缓存

    def test_score_prefers_exact_and_populous(self):
        from . import views as v
        hits = [
            {'name': '朝阳', 'population': 13524, 'latitude': 29.5, 'longitude': 106.5},   # 重庆乡级
            {'name': '朝阳', 'population': 410005, 'latitude': 41.5, 'longitude': 120.4},  # 辽宁市
        ]
        self.assertEqual(120.4, v._pet_geo_pick(hits, '朝阳')['longitude'])
        # 去行政后缀匹配:输入「朝阳市」也能命中「朝阳」
        self.assertEqual(120.4, v._pet_geo_pick(hits, '朝阳市')['longitude'])
        # 名字不匹配时人口大的胜出
        other = [{'name': '甲', 'population': 100, 'latitude': 1, 'longitude': 1},
                 {'name': '乙', 'population': 999999, 'latitude': 2, 'longitude': 2}]
        self.assertEqual(2, v._pet_geo_pick(other, '朝阳')['longitude'])
        self.assertIsNone(v._pet_geo_pick([], '朝阳'))
        self.assertIsNone(v._pet_geo_pick([{'name': 'x'}], '朝阳'))   # 缺经纬度的坏条目

    def _om_resp(self, results):
        m = mock.Mock()
        m.json.return_value = {'results': results}
        return m

    def test_confident_openmeteo_hit_skips_nominatim(self):
        from django.core.cache import cache
        om = self._om_resp([{'name': '广州', 'population': 16096724,
                             'latitude': 23.12, 'longitude': 113.25, 'admin1': '广东'}])
        with mock.patch('nav.views.requests.get', return_value=om) as get:
            resp = self.client.get(reverse('api_nav_pet_geo'), {'name': '广州'})
        data = resp.json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('open-meteo', data['place']['source'])
        self.assertEqual('广东', data['place']['region'])
        self.assertEqual(1, get.call_count)   # 自信命中:不触发 Nominatim
        # 缓存生效:第二次不再打上游
        with mock.patch('nav.views.requests.get', return_value=om) as get2:
            resp2 = self.client.get(reverse('api_nav_pet_geo'), {'name': '广州'})
        self.assertEqual('ok', resp2.json()['status'])
        self.assertEqual(0, get2.call_count)
        cache.clear()

    def test_weak_hit_falls_back_to_nominatim(self):
        om = self._om_resp([{'name': '朝阳', 'population': 13524,
                             'latitude': 106.5, 'longitude': 29.5, 'admin1': '重庆市'}])
        nom = mock.Mock()
        nom.json.return_value = [
            {'name': '朝阳区', 'type': 'administrative', 'lat': '39.92', 'lon': '116.44',
             'display_name': '朝阳区, 北京市, 中国'},
            {'name': '随机镇', 'type': 'village', 'lat': '1', 'lon': '2', 'display_name': 'x'},
        ]
        with mock.patch('nav.views.requests.get', side_effect=[om, nom]) as get:
            data = self.client.get(reverse('api_nav_pet_geo'), {'name': '朝阳'}).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('nominatim', data['place']['source'])
        self.assertEqual('朝阳区', data['place']['name'])
        self.assertEqual('北京市', data['place']['region'])
        self.assertEqual(2, get.call_count)

    def test_both_fail_uses_openmeteo_best_then_404(self):
        om = self._om_resp([{'name': '朝阳', 'population': 13524,
                             'latitude': 106.5, 'longitude': 29.5, 'admin1': '重庆市'}])
        nom = mock.Mock()
        nom.json.return_value = []   # Nominatim 无结果
        with mock.patch('nav.views.requests.get', side_effect=[om, nom]):
            data = self.client.get(reverse('api_nav_pet_geo'), {'name': '朝阳'}).json()
        self.assertEqual('open-meteo', data['place']['source'])   # 两路都拿不到才用 om 最高分兜底
        with mock.patch('nav.views.requests.get', side_effect=Exception('网络断开')):
            resp = self.client.get(reverse('api_nav_pet_geo'), {'name': '某某'})
        self.assertEqual(404, resp.status_code)

    def test_missing_name_400(self):
        self.assertEqual(400, self.client.get(reverse('api_nav_pet_geo')).status_code)

    def test_page_uses_geo_endpoint_and_land_cell(self):
        """契约:前端天气全部走本服务端(2026-11-18 换源后不再直连 open-meteo)。

        换源前这条断言盯的是 pet.js 里的 `cell_selection=land`;实况改由
        nav/pet_weather.py 在服务端取数后,规则跟着挪到那边,前端只剩一个代理 URL。
        """
        from .views import _seed_nav_sites
        _seed_nav_sites()
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8') + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        pet_js = _pet_js()
        self.assertIn('pet-geo', html)                    # URL 在模板渲染的配置岛里
        self.assertIn('pet-weather', html)                # 实况也走本服务端(2026-11-18)
        self.assertNotIn('https://api.open-meteo.com/v1/forecast', pet_js)   # 浏览器不许再直连境外源
        self.assertIn('petWindBeaufort', pet_js)
        self.assertNotIn('count=1&language=zh', html)   # 旧的单结果直连不许回来
        wx_py = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  'pet_weather.py'), encoding='utf-8').read()
        self.assertIn("'cell_selection': 'land'", wx_py)  # 沿海取陆地格点搬到服务端
        self.assertIn('weather.cma.cn', wx_py)           # 主源是中国气象局


class NavPetIpGeoTests(SimpleTestCase):
    """出口 IP 定位兜底(2026-11-20 P0):没选过城市时,天气不该默认写成广州。

    服务端主路是中国气象局 /api/now 的 data.location(按出口 IP 返回当地站点),
    次路 ip-api;两路都失败返回 404,前端再退默认城市。这里全 mock 上游,不打网络。
    """

    def setUp(self):
        from django.core.cache import cache
        cache.clear()

    def test_endpoint_ok_and_cached(self):
        from django.core.cache import cache
        place = {'name': '嘉兴', 'region': '浙江', 'lat': 30.73, 'lon': 120.76, 'source': 'cma-ip'}
        with mock.patch('nav.pet_weather.ip_location', return_value=place) as ip:
            data = self.client.get(reverse('api_nav_pet_ip_geo')).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('嘉兴', data['place']['name'])
        self.assertEqual('浙江', data['place']['region'])
        self.assertEqual(1, ip.call_count)
        with mock.patch('nav.pet_weather.ip_location', return_value=place) as ip2:
            data2 = self.client.get(reverse('api_nav_pet_ip_geo')).json()
        self.assertEqual('ok', data2['status'])
        self.assertEqual(1, ip.call_count)   # 缓存命中:第二次不再打上游
        self.assertEqual(0, ip2.call_count)
        cache.clear()

    def test_endpoint_failure_is_404_not_500(self):
        with mock.patch('nav.pet_weather.ip_location', return_value=None):
            resp = self.client.get(reverse('api_nav_pet_ip_geo'))
        self.assertEqual(404, resp.status_code)
        self.assertEqual('error', resp.json()['status'])

    def test_ip_location_parses_cma_location(self):
        from . import pet_weather
        payload = {'location': {'id': '58452', 'name': '嘉兴', 'path': '中国, 浙江, 嘉兴',
                                'latitude': 30.73, 'longitude': 120.76}}
        with mock.patch.object(pet_weather, '_cma_data', return_value=payload):
            place = pet_weather.ip_location()
        self.assertEqual('嘉兴', place['name'])
        self.assertEqual('浙江', place['region'])
        self.assertAlmostEqual(30.73, place['lat'])
        self.assertEqual('cma-ip', place['source'])

    def test_ip_location_rejects_zero_and_falls_back(self):
        from . import pet_weather
        # (0,0) 是大西洋:绝不能被当成"定位成功"
        with mock.patch.object(pet_weather, '_cma_data',
                               return_value={'location': {'name': 'Null Island',
                                                          'latitude': 0, 'longitude': 0}}), \
                mock.patch.object(pet_weather, '_ipapi_location',
                                  return_value={'name': '上海', 'region': '上海', 'lat': 31.23, 'lon': 121.47,
                                                'source': 'ip-api'}):
            place = pet_weather.ip_location()
        self.assertEqual('上海', place['name'])
        self.assertEqual('ip-api', place['source'])
        # 两路都死 → None(由视图转 404,前端退默认城市)
        with mock.patch.object(pet_weather, '_cma_data', return_value=None), \
                mock.patch.object(pet_weather, '_ipapi_location', return_value=None):
            self.assertIsNone(pet_weather.ip_location())

    def test_front_end_has_validation_and_ip_fallback(self):
        pet_js = _pet_js()
        self.assertIn('petGeoValid', pet_js)
        self.assertIn('petGeoNum', pet_js)
        self.assertIn('petLocateByIp', pet_js)
        self.assertIn('ipGeo', pet_js)
        self.assertIn('navPetCitySrc', pet_js)
        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertIn('/api/nav/pet-ip-geo/', html)   # 访客闸门白名单
        self.assertIn('pet-ip-geo', html)              # 配置岛里的 URL


class NavPetAiTests(TestCase):
    """桌宠 AI(移植 dsh-pet):配置端点 / 对话(记忆+表情包协议) / AI 碎碎念 / 余额。
    未配置接口时聊天/碎碎念一律 400 带 configured=False,前端静默回落本地语录。"""

    def setUp(self):
        from .models import NavAiConfig as C
        C.objects.all().delete()

    def _cfg(self):
        from .models import NavAiConfig as C
        return C.objects.create(base_url='https://api.test', api_key='k', model='m')

    def test_config_get_and_post(self):
        r = self.client.get(reverse('api_nav_pet_ai_config')).json()
        self.assertFalse(r['configured'])
        resp = self.client.post(reverse('api_nav_pet_ai_config'),
                                data=json.dumps({'base_url': 'https://api.deepseek.com',
                                                 'api_key': 'sk-9', 'model': 'deepseek-chat',
                                                 'persona': '毒舌鲸鱼', 'memory_rounds': 8}),
                                content_type='application/json')
        data = resp.json()
        self.assertTrue(data['configured'])
        self.assertEqual(data['persona'], '毒舌鲸鱼')
        self.assertEqual(data['memory_rounds'], 8)

    def test_config_post_keeps_key_when_blank(self):
        self._cfg()
        self.client.post(reverse('api_nav_pet_ai_config'),
                         data=json.dumps({'base_url': 'https://api.test', 'api_key': '',
                                          'model': 'm2'}), content_type='application/json')
        from .models import NavAiConfig as C
        self.assertEqual(C.get_solo().api_key, 'k')
        self.assertEqual(C.get_solo().model, 'm2')

    def test_config_post_persona_only_keeps_interface(self):
        """2026-11-19:人设搬到宠物设置后,保存只提交 persona/memory_rounds。

        老写法无条件写 base_url/model —— 只发人设就会把接口地址和模型清空。
        这里锁住「字段缺省不覆盖」。
        """
        self._cfg()
        resp = self.client.post(reverse('api_nav_pet_ai_config'),
                                data=json.dumps({'persona': '毒舌鲸鱼', 'memory_rounds': 10,
                                                 'model_pet': 'pet-model-x'}),
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        from .models import NavAiConfig as C
        cfg = C.get_solo()
        self.assertEqual('https://api.test', cfg.base_url)
        self.assertEqual('m', cfg.model)
        self.assertEqual('k', cfg.api_key)
        self.assertEqual('毒舌鲸鱼', cfg.pet_persona)
        self.assertEqual(10, cfg.pet_memory_rounds)
        self.assertEqual('pet-model-x', cfg.model_pet)
        # 只发接口字段时,人设也不该被顺手清掉
        self.client.post(reverse('api_nav_pet_ai_config'),
                         data=json.dumps({'base_url': 'https://api.test', 'model': 'm3'}),
                         content_type='application/json')
        self.assertEqual('毒舌鲸鱼', C.get_solo().pet_persona)

    def test_chat_unconfigured_and_sources_dead_returns_400_with_flag(self):
        # 2026-11-10 起:没配 Key 会先试免密钥兜底源;只有兜底也全挂才回 400
        with mock.patch('nav.pet_sources.fallback_chat', return_value=(None, None)):
            resp = self.client.post(reverse('api_nav_pet_chat'),
                                    data=json.dumps({'text': '在吗'}),
                                    content_type='application/json')
        self.assertEqual(400, resp.status_code)
        self.assertFalse(resp.json()['configured'])

    def test_chat_unconfigured_degrades_to_free_source(self):
        with mock.patch('nav.pet_sources.fallback_chat',
                        return_value=('在的在的,你说', 'qingyunke')):
            resp = self.client.post(reverse('api_nav_pet_chat'),
                                    data=json.dumps({'text': '在吗'}),
                                    content_type='application/json')
        self.assertEqual(200, resp.status_code)
        data = resp.json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('在的在的,你说', data['reply'])
        self.assertEqual('qingyunke', data['source'])
        self.assertTrue(data['degraded'])

    def test_chat_empty_text_rejected(self):
        self._cfg()
        resp = self.client.post(reverse('api_nav_pet_chat'),
                                data=json.dumps({'text': '  '}),
                                content_type='application/json')
        self.assertEqual(400, resp.status_code)

    def test_chat_appends_memory_and_strips_meme(self):
        cfg = self._cfg()
        with mock.patch('nav.ai.chat_with_meta', return_value={
                'content': '你好呀主人\n[图:可爱]', 'reasoning': '我先梳理了人设。',
                'model': 'm-test', 'elapsed_ms': 123}):
            resp = self.client.post(reverse('api_nav_pet_chat'),
                                    data=json.dumps({'text': '打个招呼'}),
                                    content_type='application/json').json()
        self.assertEqual('你好呀主人', resp['reply'])
        self.assertEqual('可爱', resp['meme'])
        self.assertEqual('我先梳理了人设。', resp['reasoning'])
        self.assertEqual('m-test', resp['model'])
        self.assertEqual(123, resp['elapsed_ms'])
        mem = cfg.__class__.get_solo().pet_memory
        self.assertEqual(['user', 'assistant'], [m['role'] for m in mem])
        self.assertNotIn('[图:', mem[-1]['content'])

    def test_chat_meme_name_not_in_pool_is_dropped(self):
        self._cfg()
        with mock.patch('nav.ai.chat_with_meta', return_value={
                'content': '嗯嗯\n[图:不存在的图]', 'reasoning': ''}):
            resp = self.client.post(reverse('api_nav_pet_chat'),
                                    data=json.dumps({'text': 'x'}),
                                    content_type='application/json').json()
        self.assertEqual('嗯嗯\n[图:不存在的图]', resp['reply'])
        self.assertEqual('', resp['meme'])
        self.assertEqual('', resp['reasoning'])

    def test_chat_memory_rounds_truncate(self):
        cfg = self._cfg()
        cfg.pet_memory_rounds = 2
        cfg.save(update_fields=['pet_memory_rounds'])
        history = []
        for i in range(4):
            history.append({'role': 'user', 'content': 'u%d' % i})
            history.append({'role': 'assistant', 'content': 'a%d' % i})
        cfg.pet_memory = history
        cfg.save(update_fields=['pet_memory'])
        with mock.patch('nav.ai.chat_with_meta', return_value={'content': '好', 'reasoning': ''}):
            self.client.post(reverse('api_nav_pet_chat'),
                             data=json.dumps({'text': '最新一句'}),
                             content_type='application/json').json()
        mem = cfg.__class__.get_solo().pet_memory
        self.assertEqual(4, len(mem))   # 2 轮 = 4 条(含本轮)
        self.assertEqual('u3', mem[0]['content'])
        self.assertEqual('最新一句', mem[2]['content'])

    def test_whisper_unconfigured_and_no_quip_returns_400(self):
        with mock.patch('nav.pet_sources.sweet_nothing', return_value=None):
            resp = self.client.post(reverse('api_nav_pet_whisper'), data='{}',
                                    content_type='application/json')
        self.assertEqual(400, resp.status_code)
        self.assertFalse(resp.json()['configured'])

    def test_whisper_unconfigured_uses_quip_source(self):
        with mock.patch('nav.pet_sources.sweet_nothing', return_value='你今天有点怪,怪好看的'):
            data = self.client.post(reverse('api_nav_pet_whisper'), data='{}',
                                    content_type='application/json').json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('你今天有点怪,怪好看的', data['text'])
        self.assertEqual('quip', data['source'])
        self.assertTrue(data['degraded'])

    def test_whisper_returns_text_and_meme(self):
        self._cfg()
        with mock.patch('nav.ai.chat', return_value='今天也要加油哦\n[图:厉害了我的鲸]'):
            resp = self.client.post(reverse('api_nav_pet_whisper'), data='{}',
                                    content_type='application/json').json()
        self.assertEqual('ok', resp['status'])
        self.assertEqual('今天也要加油哦', resp['text'])
        self.assertEqual('厉害了我的鲸', resp['meme'])

    def test_balance_unconfigured_returns_400(self):
        resp = self.client.get(reverse('api_nav_pet_balance'))
        self.assertEqual(400, resp.status_code)
        self.assertFalse(resp.json()['configured'])

    def test_balance_queries_deepseek_and_caches(self):
        self._cfg()
        from django.core.cache import cache
        cache.delete('nav_pet_balance')
        fake = mock.Mock(status_code=200)
        fake.json.return_value = {'is_available': True,
                                  'balance_infos': [{'currency': 'CNY', 'total_balance': '42.50'}]}
        with mock.patch('nav.ai.requests.get', return_value=fake) as mocked:
            data = self.client.get(reverse('api_nav_pet_balance')).json()
            self.assertEqual('ok', data['status'])
            self.assertEqual('42.50', data['total_balance'])
            # 第二次命中缓存,不再打外部接口
            self.client.get(reverse('api_nav_pet_balance'))
            self.assertEqual(1, mocked.call_count)
        cache.delete('nav_pet_balance')

    def test_template_renders_pet_ai_ui(self):
        self._cfg()
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8') + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        pet_js = _pet_js()
        self.assertIn('id="petAiModal"', html)            # 弹窗壳仍在模板
        self.assertIn('data-on-click="petAiOpen"', html)   # 顶栏入口:data-on-click 委托
        self.assertIn('navPetAiUrls', html)               # URL 配置岛在模板
        self.assertIn('petAiChatOpen', pet_js)
        self.assertIn('navPetAiWhisper', pet_js)
        self.assertIn('查看余额(AI)', pet_js)
        self.assertIn('快捷问答…', pet_js)
        self.assertIn('聊天窗口…', pet_js)


class NavPetAiUnitTests(TestCase):
    """ai.py 桌宠函数的纯单元行为:人设拼装 / 记忆截断 / 时间上下文。"""

    def test_pet_memory_append_keeps_n_rounds(self):
        from .ai import pet_memory_append
        mem = pet_memory_append([], 'hi', 'yo', rounds=1)
        self.assertEqual(2, len(mem))
        mem = pet_memory_append(mem, 'hi2', 'yo2', rounds=1)
        self.assertEqual(2, len(mem))
        self.assertEqual('hi2', mem[-2]['content'])

    def test_build_pet_messages_defaults_and_history(self):
        from .ai import build_pet_messages, PET_DEFAULT_PERSONA
        msgs = build_pet_messages('在吗', memory=[{'role': 'user', 'content': '早'}])
        self.assertEqual('system', msgs[0]['role'])
        self.assertIn(PET_DEFAULT_PERSONA[:6], msgs[0]['content'])
        self.assertEqual([('user', '早'), ('user', '在吗')],
                         [(m['role'], m['content']) for m in msgs[1:]])

    def test_pet_time_context_has_date_and_weekday(self):
        from .ai import pet_time_context
        ctx = pet_time_context()
        self.assertIn('星期', ctx)
        self.assertIn('年', ctx)


class PetChatThinkTests(SimpleTestCase):
    """AI 思考过程:后端透传 reasoning,前端默认折叠、点击后独立展开。"""

    def test_chat_meta_extracts_content_and_reasoning(self):
        from . import ai as nav_ai
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {'choices': [{'message': {
            'content': '回答正文', 'reasoning_content': '先判断用户意图，再组织答复。'}}]}
        with mock.patch('nav.ai.get_config', return_value={
                'base_url': 'http://x/v1', 'api_key': 'k', 'model': 'm'}), \
                mock.patch('nav.ai.requests.post', return_value=resp):
            meta = nav_ai.chat_with_meta([])
        self.assertEqual('回答正文', meta['content'])
        self.assertEqual('先判断用户意图，再组织答复。', meta['reasoning'])
        self.assertEqual('m', meta['model'])
        self.assertIsInstance(meta['elapsed_ms'], int)
        self.assertGreaterEqual(meta['elapsed_ms'], 0)

    def test_chat_compat_returns_content_only(self):
        from . import ai as nav_ai
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {'choices': [{'message': {
            'content': '正文', 'reasoning': '内部推理'}}]}
        with mock.patch('nav.ai.get_config', return_value={
                'base_url': 'http://x/v1', 'api_key': 'k', 'model': 'm'}), \
                mock.patch('nav.ai.requests.post', return_value=resp):
            self.assertEqual('正文', nav_ai.chat([]))

    def test_pet_js_collapse_contract(self):
        js = _pet_js()
        css = static_text('css/nav-sites.css')
        for frag in ('function petChatThinkBlock', 'nav-pet-think-toggle',
                      'reasoning', 'detail.hidden'):
            self.assertIn(frag, js)
        self.assertIn('.nav-pet-think-detail', css)

    def test_chat_render_switches_and_modal_return(self):
        """2026-11-19 用户三条:思考详情可在设置里隐藏、复制按钮默认不显示、
        点其他设置返回后聊天窗不能被永久关掉(只让位、关完还原)。"""
        js = _pet_js()
        for frag in (
                '#petPaneChat', '💬 聊天',
                'id="navPetChatReasoningCk"', 'id="navPetChatCopyCk"',
                "localStorage.getItem('navPetChatReasoning') !== '0'",
                "localStorage.getItem('navPetChatCopy') === '1'",
                'const showReasoning', 'const showCopy',
                "localStorage.setItem('navPetChatReasoning'",
                "localStorage.setItem('navPetChatCopy'",
                'if (m.role === \'pet\' && showCopy)',
                'if (m.reasoning && showReasoning)',
                'petChatSuspendForModal()', 'let petChatSuspended',
                "addEventListener('hidden.bs.modal'",
                'if (!petChatSuspended) return;',
                'petChatWindowOpen(true)'):
            self.assertIn(frag, js)
        # 2026-11-19 第二轮:宠物设置也不再豁免(两窗叠着会互相压住),统一让位返场
        self.assertNotIn("id === 'navPetSettingsModal') return", js)
        self.assertIn("document.getElementById('navPetChatSetPop').classList.remove('show');", js)
        self.assertIn("dialog.style.overflow = 'hidden'", js)   # 弹窗自身不再多出一条系统白滚动条
        css = static_text('css/nav-sites.css')
        self.assertIn('#navPetSettingsModal .modal-body::-webkit-scrollbar', css)
        self.assertIn('scrollbar-width: thin', css)
        self.assertIn('flex-wrap: wrap', css)
        # 旧写法(任何弹窗都永久 close)不能回潮
        self.assertNotIn("if (ev.target && ev.target.id === 'navPetSettingsModal') return;\n        petChatWindowClose();", js)

    def test_persona_memory_moved_into_pet_settings(self):
        """2026-11-19 用户要求:桌宠人设/记忆轮数/碎碎念走 AI 从 AI 接口弹窗搬到宠物设置。

        三项都跟桌宠自己有关,和「接口地址 / 模型」不是一回事;搬家后 AI 弹窗只能剩接口设置。
        """
        js = _pet_js()
        for frag in ('id="petAiPersona"', 'id="petAiRounds"', 'id="petAiModelPet"',
                     'id="petAiModelPetBtn"', 'id="petAiModelPetMenu"',
                     'id="petAiWhisperOn"',
                     'id="navPetPersonaSave"', 'id="navPetPersonaHint"',
                     'function petPersonaSave', 'function petPersonaLoad',
                     'petAiPost(PET_AI_URLS.config, {', 'model_pet: mp ?', 'petPersonaLoad()',
                     'petAiPrefetchModels', 'petAiRenderTaskModelMenus'):
            self.assertIn(frag, js)
        tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                'templates', 'nav', 'nav_sites.html'), encoding='utf-8').read()
        self.assertNotIn('id="petAiPersona"', tpl)
        self.assertNotIn('id="petAiRounds"', tpl)
        self.assertNotIn('id="petAiModelPet"', tpl)   # 桌宠模型也在宠物设置里改
        self.assertNotIn('id="petAiWhisperOn"', tpl)
        self.assertIn('宠物设置 → 💬 聊天', tpl)

    def test_clear_chat_history_in_pet_settings(self):
        """2026-11-19 用户要求:宠物设置里也要能清空聊天记录。

        记录只在本机 localStorage(`navPetChatHistoryV1`),删了没有服务端副本,
        所以先弹 navConfirm 再清;聊天窗开着时顺手重绘成空态。
        """
        js = _pet_js()
        for frag in ('id="navPetChatClearInSet"', 'id="navPetChatClearHint"',
                     'function petChatClearAll', 'petChatHistory = []',
                     'petChatSaveHistory();', "title: '清空聊天记录？'",
                     'window.navConfirm({'):
            self.assertIn(frag, js)


class NavPetEvolutionShopFishTests(TestCase):
    """形态进化 / 积分商店 / 钓鱼(2026-10-25 brainstorm 落地):纯本机零 AI,契约读 pet.js。"""

    def test_pet_js_contract(self):
        js = _pet_js()
        for frag in ('PET_TIERS', 'function petTierIdx()', 'function petIdleUnlocked()',
                     'PET_QUOTES_TEEN', 'PET_QUOTES_MATURE', 'PET_QUOTES_LEGEND',
                     '进化!我现在是', 'petTier().size',
                     'PET_SHOP_ITEMS', 'function petShopBuy', 'function petShopEquip',
                     'petApplyShopLook', 'navPetShop', "navPetHat",
                     'PET_RARE', "petModalGroup('✨ 稀有(已解锁)', PET_RARE)",
                     'function petFish', 'deadFound' if False else '钓到一条肥鱼'):
            self.assertIn(frag, js, frag)
        # 台词分档真的接进了 petSay
        self.assertIn('const quotes = petTier().quotes || PET_QUOTES;', js)
        # 闲置轮换按解锁过滤(点播不受限)
        self.assertIn("keys.filter(function(k) { return unlocked.indexOf(k) !== -1; })", js)
        # 恢复默认还原商店外观
        self.assertIn("'navPetChime', 'navPetNotify', 'navPetSpeak', 'navPetHat', 'navPetShop'", js)
        # 页面带帽子样式
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8') + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn('.nav-pet-hat', html)


class NavPetAmbienceKbdTests(TestCase):
    """氛围三件套(白噪音/开合音效/气泡脸色)+ 节日全家桶 + 键盘流(2026-10-25,全零 AI)。"""

    def test_pet_ambience_contract(self):
        js = _pet_js()
        for frag in ('function petNoiseStart', 'function petNoiseStop', "PET_FESTIVALS_LUNAR",
                     'function petLanternApply', 'lantern', 'function petMoodColor',
                     'window.petUiSound', "navPetUiSound", "程序员节(1024)", '吃腊八粥',
                     'navPetUiSoundCk', "navPetChime', 'navPetNotify', 'navPetSpeak', 'navPetHat', 'navPetShop', 'navPetUiSound'"):
            self.assertIn(frag, js, frag)
        # 农历节日是实时换算(calendar 库),不再按年硬编码
        self.assertIn('function petLunarFest', js)
        self.assertIn('calendar.solar2lunar', js)
        self.assertIn("'1-1':", js)
        self.assertNotIn('2026-03-03', js)   # 旧的按年硬编码表不许回来
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8') + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn('js/calendar-converter.js', html)   # 库先于 pet.js 加载

    def test_shim_ui_sound_hooks(self):
        shim = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 'static', 'bootstrap-shim.js'), encoding='utf-8').read()
        for frag in ("uiSound('open')", "uiSound('close')", 'show.bs.modal', 'show.bs.offcanvas',
                     'show.bs.dropdown'):
            self.assertIn(frag, shim, frag)

    def test_kbd_flow_contract(self):
        sf = _stars_js()
        for frag in ('kbdCatIdx', 'kbdClearCand', '数字切大类', "querySelectorAll('#navToc .toc-item')"):
            self.assertIn(frag, sf, frag)


class NavPetCityListTests(TestCase):
    """桌宠天气中国城市列表(2026-10-26 点单):省市两连选,选中直连经纬度。"""

    def test_marks(self):
        html = (self.client.get(reverse('nav_sites')).content.decode('utf-8') + static_text('css/nav-sites.css') + static_text('js/nav-sites.js'))
        self.assertIn('js/china-cities.js', html)
        # 省市两个下拉在 pet.js 动态搭的设置弹窗里(服务端 HTML 里没有),
        # id 契约由下面的 test_pet_js_and_data_contract 盯
        self.assertIn('js/pet.js', html)

    def test_pet_js_and_data_contract(self):
        import os as _os
        js = open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                'static', 'js', 'pet.js'), encoding='utf-8').read()
        for frag in ('navPetProvSel', 'navPetCitySel', 'navPetCityLat', 'navPetCityLon',
                     'window.PET_CN_CITIES', 'petCitySelSync'):
            self.assertIn(frag, js, frag)
        # 数据:覆盖 34 省级区划,坐标合理范围
        data = open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                  'static', 'js', 'china-cities.js'), encoding='utf-8').read()
        for frag in ('广州', '乌鲁木齐', '拉萨', '台北', '哈尔滨'):
            self.assertIn(frag, data, frag)
        self.assertEqual(31 + 1, data.count("': [["), '省级键数量(30 省/区 + 港澳台合并 + 直辖市)')


class PetMenuConsolidationTests(SimpleTestCase):
    """桌宠右键菜单 2026-11-07 收口:24 项平铺(高度 800px+,超一屏)→ 4 高频 + 4 分组。

    断言的是**结构**,不是像素:顶层直挂 4 项、4 个分组子菜单、24 个动作一个不少、
    子菜单样式在位。像素高度由真浏览器验收(1440×900)。
    """

    def _js(self):
        return static_text('js/pet.js')

    def _css(self):
        return static_text('css/nav-sites.css')

    def test_four_frequent_actions_sit_on_top(self):
        body = self._js().split('petMenu.innerHTML =', 1)[1].split("document.body.appendChild(petMenu)", 1)[0]
        # 顶层 = 不缩进在 petSub(...) 参数里的那些:行首 8 空格 + petMenuItem(
        # 2026-11-24:用户要求「设置」不再走二级 —— 顶层多了 设置 / 再见(=4 常用 + 2)
        direct = [ln for ln in body.splitlines() if ln.startswith('        petMenuItem(')]
        self.assertEqual(6, len(direct), direct)
        self.assertIn("petMenuItem('settings'", body)
        self.assertIn("petMenuItem('off'", body)

    def test_four_submenus_with_expected_labels(self):
        js = self._js()
        # 2026-11-24:「设置」提成一级直达,子菜单剩三组
        self.assertEqual(3, js.count("petSub('"))
        for label in ('演出与声音', '互动与聊天', '导航帮手'):
            self.assertIn(label, js)

    def test_no_action_was_lost(self):
        js = self._js()
        actions = ('random', 'actions', 'meme', 'noise-wave', 'noise-rain', 'walk', 'sleep',
                   'say', 'aichat', 'feed', 'fish', 'status', 'suggest', 'openstar', 'blindbox',
                   'basket', 'shop', 'weather', 'balance', 'stats', 'home', 'settings',
                   'whisper', 'off')
        for action in actions:
            with self.subTest(action=action):
                self.assertIn("petMenuItem('%s'" % action, js)

    def test_submenu_styles_and_hover_hook_exist(self):
        css = self._css()
        for rule in ('#navPetMenu .pet-sub-list', '#navPetMenu .pet-sub.open > .pet-sub-list',
                     '#navPetMenu .pet-sub.flip > .pet-sub-list'):
            self.assertIn(rule, css)
        js = self._js()
        # 悬停展开 + 越界向左翻,两个都在
        self.assertIn("petMenu.addEventListener('mouseover'", js)
        self.assertIn("classList.add('flip')", js)


class NavPetFallbackSourceTests(TestCase):
    """零密钥兜底源解析(2026-11-10):三个公共接口的坑都在这里钉死。

    原则:解析失败一律返回 None,由调用方静默回落 —— 第三方返回什么脏数据都不该冒到气泡上。
    测试全程 mock 掉网络,不打真实请求。
    """

    def _src(self):
        from . import pet_sources
        return pet_sources

    def test_qingyunke_parses_and_strips_placeholders(self):
        src = self._src()
        with mock.patch('nav.pet_sources._get_json',
                        return_value={'result': 0, 'content': '你好{br}呀{face:9}'}) as g:
            self.assertEqual('你好 呀', src.qingyunke_chat('在吗'))
        params = g.call_args[0][1]
        self.assertEqual('free', params['key'])
        self.assertEqual(0, params['appid'])

    def test_qingyunke_ad_reply_is_dropped(self):
        """免费语料库会夹推广句,桌宠嘴里不能出现店铺/加群,命中就换下一个源。"""
        src = self._src()
        for bad in ('去奥龙霸斯淘宝店睇睇啦～', '加群 123456 私聊', 'www.abc.com 有优惠'):
            with self.subTest(bad=bad):
                with mock.patch('nav.pet_sources._get_json',
                                return_value={'result': 0, 'content': bad}):
                    self.assertIsNone(src.qingyunke_chat('在吗'))

    def test_qingyunke_error_result_is_none(self):
        src = self._src()
        with mock.patch('nav.pet_sources._get_json', return_value={'result': 1, 'content': 'x'}):
            self.assertIsNone(src.qingyunke_chat('在吗'))
        with mock.patch('nav.pet_sources._get_json', return_value=None):
            self.assertIsNone(src.qingyunke_chat('在吗'))
        # 空文本不浪费一次请求
        self.assertIsNone(src.qingyunke_chat('   '))

    def test_ownthink_never_sends_blank_appid(self):
        """空 appid 会被判 appid为空,所以「有值才加参数」。"""
        src = self._src()
        payload = {'data': {'type': 'text', 'info': {'text': '在的'}}}
        with mock.patch('nav.pet_sources._get_json', return_value=payload) as g:
            self.assertEqual('在的', src.ownthink_chat('在吗'))
        self.assertNotIn('appid', g.call_args[0][1])
        with mock.patch('nav.pet_sources._get_json', return_value=payload) as g2:
            src.ownthink_chat('在吗', appid='abc')
        self.assertEqual('abc', g2.call_args[0][1]['appid'])

    def test_ownthink_accepts_legacy_numeric_type(self):
        """老版 data.type 是数字 5000,新版是字符串 'text',两个都要认。"""
        src = self._src()
        for t in ('text', 5000):
            with self.subTest(type=t):
                payload = {'data': {'type': t, 'info': {'text': '都算文本'}}}
                with mock.patch('nav.pet_sources._get_json', return_value=payload):
                    self.assertEqual('都算文本', src.ownthink_chat('在吗'))

    def test_ownthink_non_text_type_is_none(self):
        src = self._src()
        payload = {'data': {'type': 'image', 'info': {'text': '图'}}}
        with mock.patch('nav.pet_sources._get_json', return_value=payload):
            self.assertIsNone(src.ownthink_chat('在吗'))

    def test_fallback_chat_order_and_both_dead(self):
        src = self._src()
        with mock.patch('nav.pet_sources.qingyunke_chat', return_value=None), \
                mock.patch('nav.pet_sources.ownthink_chat', return_value='思知在'):
            self.assertEqual(('思知在', 'ownthink'), src.fallback_chat('在吗'))
        with mock.patch('nav.pet_sources.qingyunke_chat', return_value='青云客在'):
            self.assertEqual(('青云客在', 'qingyunke'), src.fallback_chat('在吗'))
        with mock.patch('nav.pet_sources.qingyunke_chat', return_value=None), \
                mock.patch('nav.pet_sources.ownthink_chat', return_value=None):
            self.assertEqual((None, None), src.fallback_chat('在吗'))

    def test_sweet_nothing_takes_first_non_empty_line(self):
        src = self._src()
        with mock.patch('nav.pet_sources._get_text', return_value='\n\n  你是我的小确幸  \n第二行'):
            self.assertEqual('你是我的小确幸', src.sweet_nothing())
        with mock.patch('nav.pet_sources._get_text', return_value=''):
            self.assertIsNone(src.sweet_nothing())

    def test_timeout_is_short_and_cleaning_caps_length(self):
        """兜底源永远不该让人等:超时上限钉在 5 秒内,回复限长 300。"""
        src = self._src()
        self.assertLessEqual(src._PET_SRC_TIMEOUT, 5)
        self.assertGreater(src._PET_WX_TIMEOUT, src._PET_SRC_TIMEOUT)   # 天气富数据放宽,聊天源不放宽
        self.assertEqual(300, len(src._clean('鲸' * 900)))


class NavPetBriefTests(TestCase):
    """天气第二行(空气 + 明日)与每日英语(2026-11-10 P1/P2)。

    两条硬要求:解析错就返回 None(不猜、不显示脏数据);视图两边都空才报错,
    单边可用时仍要给出半份信息 —— 附加信息不该拖累天气主气泡。
    """

    def _src(self):
        from . import pet_sources
        return pet_sources

    def test_aqi_label_maps_cn_standard_bands(self):
        src = self._src()
        for value, label in ((0, '优'), (50, '优'), (51, '良'), (120, '轻度'),
                             (180, '中度'), (260, '重度'), (400, '严重')):
            with self.subTest(value=value):
                self.assertEqual(label, src.aqi_label(value))
        self.assertEqual('', src.aqi_label(None))

    def test_air_quality_parses_current_values(self):
        src = self._src()
        payload = {'current': {'european_aqi': 42.4, 'pm2_5': 12.34}}
        with mock.patch('nav.pet_sources._get_json', return_value=payload) as g:
            got = src.air_quality(23.1, 113.3)
        self.assertEqual({'value': 42, 'label': '优', 'pm25': 12.3}, got)
        params = g.call_args[0][1]
        self.assertEqual(23.1, params['latitude'])
        self.assertIn('european_aqi', params['current'])

    def test_air_quality_none_when_missing(self):
        src = self._src()
        with mock.patch('nav.pet_sources._get_json', return_value={'current': {}}):
            self.assertIsNone(src.air_quality(1, 2))
        with mock.patch('nav.pet_sources._get_json', return_value=None):
            self.assertIsNone(src.air_quality(1, 2))

    def test_daily_forecast_uses_tomorrow_index(self):
        src = self._src()
        payload = {'daily': {'time': ['2026-11-10', '2026-11-11'],
                             'weather_code': [0, 3],
                             'temperature_2m_max': [12.9, 11.1],
                             'temperature_2m_min': [0.2, 0.5],
                             'precipitation_probability_max': [0, 20],
                             'uv_index_max': [3.2, 3.0]}}
        with mock.patch('nav.pet_sources._get_json', return_value=payload):
            got = src.daily_forecast(39.9, 116.4)
        self.assertEqual('2026-11-11', got['date'])
        self.assertEqual((11, 1, 20), (got['tmax'], got['tmin'], got['rain']))
        self.assertEqual(3.0, got['uv'])  # round(3.15,1) 会被浮点表示坑,测试用整值

    def test_daily_forecast_truncated_payload_is_none(self):
        src = self._src()
        with mock.patch('nav.pet_sources._get_json', return_value={'daily': {'time': ['x']}}):
            self.assertIsNone(src.daily_forecast(1, 2))

    def test_daily_english_parses_and_requires_english(self):
        src = self._src()
        payload = {'content': 'Frost paints the land.', 'note': '霜给大地刷上银色。'}
        with mock.patch('nav.pet_sources._get_json', return_value=payload):
            self.assertEqual({'en': 'Frost paints the land.', 'zh': '霜给大地刷上银色。'},
                             src.daily_english())
        with mock.patch('nav.pet_sources._get_json', return_value={'note': '只有译文'}):
            self.assertIsNone(src.daily_english())

    def test_brief_view_returns_partial_payload(self):
        from django.core.cache import cache
        cache.clear()
        with mock.patch('nav.pet_sources.air_quality', return_value={'value': 58, 'label': '良'}), \
                mock.patch('nav.pet_weather.weather_cached', return_value=None), \
                mock.patch('nav.pet_sources.daily_forecast', return_value=None):
            data = self.client.get(reverse('api_nav_pet_brief'), {'lat': 23.1, 'lon': 113.3}).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('良', data['aqi']['label'])
        self.assertIsNone(data['tomorrow'])

    def test_brief_view_rejects_bad_coords_and_all_dead(self):
        from django.core.cache import cache
        cache.clear()
        self.assertEqual(400, self.client.get(reverse('api_nav_pet_brief')).status_code)
        self.assertEqual(400, self.client.get(reverse('api_nav_pet_brief'),
                                              {'lat': 999, 'lon': 0}).status_code)
        with mock.patch('nav.pet_sources.air_quality', return_value=None), \
                mock.patch('nav.pet_weather.weather_cached', return_value=None), \
                mock.patch('nav.pet_sources.daily_forecast', return_value=None):
            self.assertEqual(502, self.client.get(reverse('api_nav_pet_brief'),
                                                  {'lat': 23.1, 'lon': 113.3}).status_code)

    def test_daily_en_view_ok_and_dead(self):
        from django.core.cache import cache
        cache.clear()
        with mock.patch('nav.pet_sources.daily_english',
                        return_value={'en': 'Hello there.', 'zh': '你好。'}):
            data = self.client.get(reverse('api_nav_pet_daily_en')).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual('Hello there.', data['en'])
        cache.clear()
        with mock.patch('nav.pet_sources.daily_english', return_value=None):
            self.assertEqual(502, self.client.get(reverse('api_nav_pet_daily_en')).status_code)

    def test_menu_and_js_hooks_present(self):
        js = _pet_js()
        for marker in ("petMenuItem('dailyen'", "action === 'dailyen'",
                       'function petWeatherBrief(', 'function petDailyEn(',
                       'PET_AI_URLS.brief', 'PET_AI_URLS.dailyEn'):
            self.assertIn(marker, js)


class NavPetWeatherSourceTests(SimpleTestCase):
    """天气换源(2026-11-18):中国气象局优先,Open-Meteo 兜底 —— 只测纯逻辑,不联网。

    换源依据见 nav/pet_weather.py 文件头:国内 open-meteo 首包 8.38s 超时,气象局
    /api/now 0.18s;而气象局的 ?name=/?lat=&lon= 参数不生效(恒按出口 IP 回当地站点),
    所以选站必须本地做,这里把选站规则钉死,免得以后有人「顺手」改成传参。
    """

    def _wx(self):
        from . import pet_weather
        return pet_weather

    def test_station_pick_by_distance_and_name(self):
        wx = self._wx()
        rows = [
            {'id': '58452', 'name': '嘉兴', 'lat': 30.73, 'lon': 120.76,
             'level': 2, 'location': '浙江,嘉兴'},
            {'id': '54511', 'name': '北京', 'lat': 39.81, 'lon': 116.47,
             'level': 0, 'location': '北京,北京'},
            {'id': '54324', 'name': '朝阳', 'lat': 41.55, 'lon': 120.43,
             'level': 2, 'location': '辽宁,朝阳'},
            {'id': '54433', 'name': '朝阳', 'lat': 39.95, 'lon': 116.50,
             'level': 3, 'location': '北京,朝阳'},
            # 上海没有同名站,市气象站叫「徐家汇」—— 城市表里一大票这种
            {'id': '58362', 'name': '徐家汇', 'lat': 31.20, 'lon': 121.44,
             'level': 1, 'location': '上海,上海'},
        ]
        self.assertEqual('54511', wx.pick_station(39.80, 116.45, '', rows)['id'])
        self.assertEqual('58452', wx.pick_station(30.7, 120.8, '嘉兴', rows)['id'])
        # 同名:有坐标按距离(北京朝阳区),没坐标按 level(辽宁朝阳市,地级市优先)
        self.assertEqual('54433', wx.pick_station(39.9, 116.4, '朝阳', rows)['id'])
        self.assertEqual('54324', wx.pick_station(None, None, '朝阳', rows)['id'])
        self.assertIsNone(wx.pick_station(None, None, '', rows))    # 无坐标又没名字:不乱猜
        self.assertIsNone(wx.pick_station(30, 120, '查无此地', rows))   # 100km,超出兜底半径
        # 没有同名站时,60km 内退到最近站(上海→徐家汇);再远就不硬套
        self.assertEqual('58362', wx.pick_station(31.23, 121.47, '上海', rows)['id'])
        self.assertIsNone(wx.pick_station(50, 90, '查无此地', rows))

    def test_in_china_bbox(self):
        wx = self._wx()
        for lat, lon in ((30.75, 120.75), (22.3, 114.17), (43.8, 87.6)):
            self.assertTrue(wx.in_china(lat, lon))
        for lat, lon in ((51.5, -0.12), (1.35, 103.8), (None, None)):
            self.assertFalse(wx.in_china(lat, lon))

    def test_weather_prefers_cma_and_falls_back(self):
        wx = self._wx()
        with mock.patch.object(wx, 'cma_weather', return_value={'source': 'cma'}), \
                mock.patch.object(wx, 'open_meteo_weather') as om:
            self.assertEqual('cma', wx.weather(30.75, 120.75)['source'])
            om.assert_not_called()
        with mock.patch.object(wx, 'cma_weather', return_value=None), \
                mock.patch.object(wx, 'open_meteo_weather', return_value={'source': 'open-meteo'}):
            self.assertEqual('open-meteo', wx.weather(30.75, 120.75)['source'])
        # 海外直接走 Open-Meteo:别拿国内最近站点硬套伦敦
        with mock.patch.object(wx, 'cma_weather', side_effect=AssertionError('海外不该查国内站点')), \
                mock.patch.object(wx, 'open_meteo_weather', return_value={'source': 'open-meteo'}):
            self.assertEqual('open-meteo', wx.weather(51.5, -0.12)['source'])

    def test_cma_weather_parses_now_and_tomorrow(self):
        wx = self._wx()
        station = {'id': '58452', 'name': '嘉兴', 'lat': 30.73, 'lon': 120.76,
                   'level': 2, 'location': '浙江,嘉兴'}
        now = {'location': {'name': '嘉兴'},
               'now': {'temperature': 13.2, 'feelst': 11.0, 'humidity': 62,
                       'windSpeed': 3.5, 'windScale': '3级'}}
        view = {'lastUpdate': _today_stamp('15:45'), 'daily': [
            {'date': '2026/11/18', 'high': 15, 'low': 6, 'dayText': '晴', 'nightText': '晴'},
            {'date': '2026/11/19', 'high': 11, 'low': 5, 'dayText': '多云'}]}
        with mock.patch.object(wx, 'pick_station', return_value=station), \
                mock.patch.object(wx, '_cma_data', side_effect=[now, view]):
            out = wx.cma_weather(30.75, 120.75)
        self.assertEqual(13, out['temp'])        # 13.2 → 13:四舍五入,不用银行家舍入
        self.assertEqual(11, out['feels'])
        self.assertEqual('晴', out['text'])
        self.assertEqual('15:45', out['obs'])
        self.assertEqual(13, out['windKmh'])     # 3.5 m/s → 12.6 → 13 km/h
        self.assertEqual(11, out['tomorrow']['tmax'])
        self.assertEqual('多云', out['tomorrow']['text'])

    def test_cma_weather_keeps_user_city_name(self):
        """选了「上海」就该显示上海,不能因为气象站叫徐家汇就把气泡改叫徐家汇。"""
        wx = self._wx()
        station = {'id': '58362', 'name': '徐家汇', 'lat': 31.20, 'lon': 121.44,
                   'level': 1, 'location': '上海,上海'}
        now = {'now': {'temperature': 18, 'feelst': 18, 'humidity': 60,
                       'windSpeed': 2.0, 'windScale': '2级'}}
        view = {'lastUpdate': _today_stamp('15:45'),
                'daily': [{'date': '2026/11/18', 'high': 20, 'low': 12, 'dayText': '多云'}]}
        with mock.patch.object(wx, 'pick_station', return_value=station), \
                mock.patch.object(wx, '_cma_data', side_effect=[now, view]):
            out = wx.cma_weather(31.23, 121.47, '上海')
        self.assertEqual('上海', out['place'])
        self.assertEqual('上海', out['region'])

    def test_in_china_covers_sansha(self):
        wx = self._wx()
        self.assertTrue(wx.in_china(16.83, 112.33))     # 三沙:原先 17.5 的下界把它挡在外面
        self.assertFalse(wx.in_china(10.0, 110.0))

    def test_now_ok_rejects_missing_and_stale(self):
        wx = self._wx()
        self.assertTrue(wx._now_ok({'now': {'temperature': 12.6}, 'lastUpdate': _today_stamp('16:05')}))
        self.assertFalse(wx._now_ok({'now': {'temperature': 9999.0}}))          # 缺测
        self.assertFalse(wx._now_ok({'now': {'temperature': 12.0},
                                     'lastUpdate': '2025/04/23 21:17'}))  # 停更
        self.assertFalse(wx._now_ok(None))

    def test_cma_weather_skips_dead_station(self):
        """湖州只有 K5454,常年在 9999/停更:必须顺延到长兴,不能把 9999 传给前端。"""
        wx = self._wx()
        dead = {'id': 'K5454', 'name': '湖州', 'lat': 30.86, 'lon': 120.05,
                'level': 3, 'location': '浙江,湖州'}
        live = {'id': '58443', 'name': '长兴', 'lat': 30.91, 'lon': 119.91,
                'level': 3, 'location': '浙江,长兴'}
        bad = {'now': {'temperature': 9999.0}, 'lastUpdate': '2025/04/23 21:17'}
        good = {'now': {'temperature': 12.6, 'feelst': 12.0, 'humidity': 55,
                        'windSpeed': 2.5, 'windScale': '2级'},
                'lastUpdate': _today_stamp('16:05')}
        view = {'lastUpdate': _today_stamp('16:05'),
                'daily': [{'date': '2026/11/18', 'high': 15, 'low': 6, 'dayText': '晴'}]}
        with mock.patch.object(wx, 'pick_station', return_value=dead), \
                mock.patch.object(wx, 'station_alternatives', return_value=[live]), \
                mock.patch.object(wx, '_cma_data', side_effect=[bad, good, view]):
            out = wx.cma_weather(30.87, 120.10, '湖州')
        self.assertEqual('58443', out['station'])
        self.assertEqual('湖州', out['place'])
        self.assertEqual(13, out['temp'])

    def test_cma_weather_returns_none_on_dead_source(self):
        wx = self._wx()
        with mock.patch.object(wx, 'pick_station', return_value=None):
            self.assertIsNone(wx.cma_weather(30.75, 120.75))
        with mock.patch.object(wx, 'pick_station', return_value={'id': 'x'}), \
                mock.patch.object(wx, '_cma_data', return_value=None):
            self.assertIsNone(wx.cma_weather(30.75, 120.75))

    def test_weather_view_ok_bad_coords_and_down(self):
        from django.core.cache import cache
        cache.clear()
        with mock.patch('nav.pet_weather.weather_cached',
                        return_value={'temp': 13, 'text': '晴', 'source': 'cma'}):
            data = self.client.get(reverse('api_nav_pet_weather'),
                                   {'lat': 30.75, 'lon': 120.75, 'name': '嘉兴'}).json()
        self.assertEqual('ok', data['status'])
        self.assertEqual(13, data['weather']['temp'])
        self.assertEqual(400, self.client.get(reverse('api_nav_pet_weather')).status_code)
        self.assertEqual(400, self.client.get(reverse('api_nav_pet_weather'),
                                              {'lat': 'x', 'lon': 0}).status_code)
        with mock.patch('nav.pet_weather.weather_cached', return_value=None):
            self.assertEqual(502, self.client.get(reverse('api_nav_pet_weather'),
                                                  {'lat': 30.75, 'lon': 120.75}).status_code)
