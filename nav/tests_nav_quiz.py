# nav/tests_nav_quiz.py
"""访客准入答题(2026-11-25)的行为测试。

中间件读的是公开快照里的 gate 小节(不查库),所以测试直接 patch `public_gate()`;
答案校验走数据库,用 NavPublicConfig 建真配置。
"""

import os
from contextlib import ExitStack
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from config import middleware
from .management.commands.export_nav_public import quiz_gate_key
from .models import NavPublicConfig


CONFIG = {
    'gate_enabled': True,
    'quiz_question': '本站标题里的第二个字是什么？',
    'quiz_answers': '花\n寻',
    'quiz_hint': '两个字，跟导航有关',
}

# 与真实环境一致:快照里的 key 必须等于 quiz_gate_key(题目, 答案),
# 否则"视图种 cookie / 中间件校验 cookie"两边对不上。
GATE = {
    'enabled': True,
    'question': CONFIG['quiz_question'],
    'hint': CONFIG['quiz_hint'],
    'key': quiz_gate_key(CONFIG['quiz_question'], CONFIG['quiz_answers']),
}


class QuizGateTests(TestCase):
    def setUp(self):
        middleware.reset_quiz_rate_limit()
        self.env = patch.dict(os.environ, {'NAV_WRITE_TOKEN': 'owner-secret'}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        NavPublicConfig.objects.update_or_create(pk=1, defaults=CONFIG)

    def _gate(self, **extra):
        """两处一起 patch:中间件与答题页视图各自 import 了一份 public_gate。"""
        gate = dict(GATE)
        gate.update(extra)
        stack = ExitStack()
        stack.enter_context(patch('config.middleware.public_gate', return_value=gate))
        stack.enter_context(patch('nav.views_nav_quiz.public_gate', return_value=gate))
        return stack

    # ---------- 门本身 ----------

    def _gate_off(self):
        stack = ExitStack()
        off = {'enabled': False}
        stack.enter_context(patch('config.middleware.public_gate', return_value=off))
        stack.enter_context(patch('nav.views_nav_quiz.public_gate', return_value=off))
        return stack

    def test_disabled_lets_everyone_in(self):
        with self._gate_off():
            self.assertEqual(self.client.get(reverse('nav_guest')).status_code, 200)

    def test_no_owner_token_means_no_gate(self):
        """没配 NAV_WRITE_TOKEN = 单机自用,谁都是主人,不能被题挡在外面。"""
        with patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}, clear=False):
            with self._gate():
                self.assertEqual(self.client.get(reverse('nav_guest')).status_code, 200)

    def test_guest_page_redirects_to_quiz(self):
        with self._gate():
            resp = self.client.get(reverse('nav_guest'))
            self.assertEqual(resp.status_code, 302)
            self.assertIn('/nav/quiz/', resp['Location'])

    def test_guest_api_blocked(self):
        with self._gate():
            resp = self.client.get('/api/nav/bing-bg/')
            self.assertEqual(resp.status_code, 403)
            self.assertIn('答对', resp.json()['message'])

    def test_owner_bypasses_gate(self):
        with self._gate():
            resp = self.client.get(reverse('nav_guest'), HTTP_X_NAV_WRITE_TOKEN='owner-secret')
            self.assertEqual(resp.status_code, 200)

    # ---------- 答题页 ----------

    def test_quiz_page_shows_question(self):
        with self._gate():
            resp = self.client.get('/nav/quiz/')
            self.assertEqual(resp.status_code, 200)
            self.assertContains(resp, '本站标题里的第二个字是什么')
            self.assertContains(resp, '两个字，跟导航有关')

    def test_quiz_page_redirects_when_disabled(self):
        with self._gate_off():
            resp = self.client.get('/nav/quiz/')
            self.assertEqual(resp.status_code, 302)

    def test_correct_answer_gets_pass_cookie(self):
        with self._gate():
            with patch('nav.views_nav_quiz.public_gate', return_value=GATE):
                resp = self.client.post('/nav/quiz/', {'answer': '花', 'next': '/nav/'})
            self.assertEqual(resp.status_code, 302)
            self.assertEqual(resp['Location'], '/nav/')
            cookie = resp.cookies.get(middleware.NAV_QUIZ_COOKIE)
            self.assertIsNotNone(cookie)
            self.assertEqual(cookie.value, middleware.quiz_pass_token(GATE['key']))
            self.assertEqual(self.client.get(reverse('nav_guest')).status_code, 200)

    def test_answer_is_case_insensitive_and_trimmed(self):
        NavPublicConfig.objects.filter(pk=1).update(quiz_answers='Alpha')
        with self._gate():
            with patch('nav.views_nav_quiz.public_gate', return_value=GATE):
                resp = self.client.post('/nav/quiz/', {'answer': '  alpha  '})
            self.assertEqual(resp.status_code, 302)

    def test_wrong_answer_shows_error_without_cookie(self):
        with self._gate():
            with patch('nav.views_nav_quiz.public_gate', return_value=GATE):
                resp = self.client.post('/nav/quiz/', {'answer': '错的'})
            self.assertEqual(resp.status_code, 200)
            self.assertNotIn(middleware.NAV_QUIZ_COOKIE, resp.cookies)
            self.assertContains(resp, '不对')

    def test_rate_limited_after_eight_failures(self):
        with self._gate():
            with patch('nav.views_nav_quiz.public_gate', return_value=GATE):
                for _ in range(middleware.NAV_QUIZ_FAIL_MAX):
                    self.client.post('/nav/quiz/', {'answer': '错的'})
                resp = self.client.post('/nav/quiz/', {'answer': '花'})
            self.assertEqual(resp.status_code, 429)

    def test_changing_question_kicks_old_pass(self):
        """换题/改答案 → key 变 → 老 cookie 立刻失效。"""
        with self._gate():
            with patch('nav.views_nav_quiz.public_gate', return_value=GATE):
                self.client.post('/nav/quiz/', {'answer': '花'})
            self.assertEqual(self.client.get(reverse('nav_guest')).status_code, 200)
        with self._gate(key='k-test-002'):
            self.assertEqual(self.client.get(reverse('nav_guest')).status_code, 302)

    def test_forged_pass_cookie_rejected(self):
        with self._gate():
            self.client.cookies[middleware.NAV_QUIZ_COOKIE] = 'deadbeefdeadbeefdeadbeef'
            self.assertEqual(self.client.get(reverse('nav_guest')).status_code, 302)

    def test_next_is_restricted_to_local_paths(self):
        with self._gate():
            with patch('nav.views_nav_quiz.public_gate', return_value=GATE):
                resp = self.client.post('/nav/quiz/', {'answer': '花', 'next': '//evil.example/'})
            self.assertEqual(resp['Location'], '/nav/')

    # ---------- 后台配置 ----------

    def test_config_api_get_returns_answers_for_owner(self):
        with patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}, clear=False):
            resp = self.client.get(reverse('api_nav_quiz_config'))
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()['config']['answers'], '花\n寻')

    def test_config_api_denies_guest(self):
        resp = self.client.post(reverse('api_nav_quiz_config'),
                                data='{"enabled": false}', content_type='application/json')
        self.assertEqual(resp.status_code, 403)

    def test_config_api_saves_and_refreshes_snapshot(self):
        with patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}, clear=False):
            with patch('nav.views_nav_quiz.write_public_snapshot') as snap:
                resp = self.client.post(reverse('api_nav_quiz_config'),
                                        data='{"enabled": true, "question": "1+1=?", '
                                             '"answers": "2\\n二", "hint": "很简单"}',
                                        content_type='application/json')
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(resp.json()['enabled'])
            snap.assert_called_once_with(force=True)
            # 保存后必须清掉准入缓存,否则要等 2 分钟才生效
            middleware.reset_gate_cache()
        cfg = NavPublicConfig.current()
        self.assertEqual(cfg.quiz_question, '1+1=?')
        self.assertTrue(cfg.accepts('二'))

    def test_config_api_rejects_enable_without_question(self):
        with patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}, clear=False):
            resp = self.client.post(reverse('api_nav_quiz_config'),
                                    data='{"enabled": true, "question": "", "answers": ""}',
                                    content_type='application/json')
            self.assertEqual(resp.status_code, 400)
            self.assertIn('题目', resp.json()['message'])

    def test_config_api_disables(self):
        with patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}, clear=False):
            with patch('nav.views_nav_quiz.write_public_snapshot'):
                resp = self.client.post(reverse('api_nav_quiz_config'),
                                        data='{"enabled": false, "question": "", "answers": ""}',
                                        content_type='application/json')
            self.assertEqual(resp.status_code, 200)
            self.assertFalse(resp.json()['enabled'])

    # ---------- 迁移没跑时的降级 ----------

    def test_owner_page_survives_missing_migration(self):
        """线上少跑一次迁移(缺 gate_enabled 列)时,主人页不能整站 500。

        2026-11-25 用户实测:填主人口令后 500 —— 就是这条。页面走 safe_current 回退。
        """
        from django.db import OperationalError
        err = OperationalError('no such column: navpublicconfig.gate_enabled')
        with patch('nav.models.NavPublicConfig.current', side_effect=err):
            with patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}, clear=False):
                resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'navQuizSave', resp.content)      # 设置段照常渲染,只是默认关闭

    def test_config_api_explains_missing_migration(self):
        from django.db import OperationalError
        err = OperationalError('no such column: navpublicconfig.gate_enabled')
        with patch('nav.models.NavPublicConfig.current', side_effect=err):
            with patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''}, clear=False):
                resp = self.client.post(reverse('api_nav_quiz_config'),
                                        data='{"enabled": true}', content_type='application/json')
        self.assertEqual(resp.status_code, 500)
        self.assertIn('migrate', resp.json()['message'])
