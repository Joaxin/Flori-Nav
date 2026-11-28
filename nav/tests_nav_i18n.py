"""多语言(中/英)回归测试 —— 2026-11-23。

守住三件事：
1. 默认中文，html lang 与 data-nav-lang 正确；
2. cookie nav_lang=en 时整页 lang 切英文，且后端与前端共用同一个 cookie 名；
3. 前端词条表文件存在，且核心界面词条一条不少（防止哪天改文案把英文弄丢）。
"""
from pathlib import Path

from django.conf import settings
from django.test import TestCase
from django.urls import reverse

NAV_DIR = Path(__file__).resolve().parent


class NavI18nTests(TestCase):

    def test_default_language_is_chinese(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('<html lang="zh-CN"', html)
        self.assertIn('data-nav-lang="zh"', html)

    def test_cookie_switches_page_language(self):
        self.client.cookies['nav_lang'] = 'en'
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('<html lang="en"', html)
        self.assertIn('data-nav-lang="en"', html)

    def test_language_switch_ui_present(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="navLangGroup"', html)
        self.assertIn('data-nav-lang="zh"', html)
        self.assertIn('data-nav-lang="en"', html)
        self.assertIn('class="nav-set-h">语言', html)

    def test_query_param_previews_english(self):
        html = self.client.get(reverse('nav_sites') + '?lang=en').content.decode('utf-8')
        self.assertIn('<html lang="en"', html)
        self.assertIn('data-nav-lang="en"', html)

    def test_i18n_infrastructure_is_wired(self):
        codes = [code for code, _name in settings.LANGUAGES]
        self.assertIn('zh-hans', codes)
        self.assertIn('en', codes)
        self.assertEqual('nav_lang', settings.LANGUAGE_COOKIE_NAME)
        self.assertTrue(settings.LOCALE_PATHS)
        self.assertIn('django.middleware.locale.LocaleMiddleware', settings.MIDDLEWARE)

    def test_dictionary_covers_core_ui(self):
        text = (NAV_DIR / 'static' / 'js' / 'nav-i18n.js').read_text(encoding='utf-8')
        for key in ('全部设置', '卡片布局', '卡片密度', '目录与页面', '设置按钮',
                    '语言', '杂志', '极简', '分栏', '常驻侧栏', '抽屉', '展开全部'):
            self.assertIn(key, text, 'nav-i18n.js 缺少核心词条: ' + key)

    def test_language_script_is_included(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('js/nav-i18n.js', html)

    def test_guest_bulk_dynamic_copy_uses_dictionary(self):
        """访客批量条(本机导入区 + 动态弹层)不许再硬编码中文:词条在表里,按钮走 T()。"""
        dict_text = (NAV_DIR / 'static' / 'js' / 'nav-i18n.js').read_text(encoding='utf-8')
        batch_js = (NAV_DIR / 'static' / 'js' / 'nav-guest-batch.js').read_text(encoding='utf-8')
        for key in ('隐藏分组', '恢复默认分组顺序', '已批量删除', '{n} 个书签',
                    '已复制 {n} 条链接', '已移动到 {cat}', '已选 {n} 项'):
            self.assertIn("'" + key + "'", dict_text, '词条缺失: ' + key)
            self.assertIn(key, batch_js, '访客批量模块未使用该文案: ' + key)
        self.assertIn('window.NavI18n.t', batch_js)
        self.assertIn('data-bulk-act="open"', batch_js, '多选判态必须走结构标记,不能依赖中文文案')

        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        # 2026-11-27:条内文案改由 nav-guest-batch.js 画(与主人 #navMsBar 同形),
        # 模板侧只剩进多选的入口与容器。
        for key in ('退出多选', '打开', '已选 {n} 项'):
            self.assertIn("'" + key + "'", dict_text, '词条缺失: ' + key)
        for token in ('多选', 'data-ngb-enter', 'navBulkBar'):
            self.assertIn(token, html, '访客批量入口缺失: ' + token)
