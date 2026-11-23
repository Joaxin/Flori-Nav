# nav/tests_nav_guest.py
"""游客只读页 / 公开快照（2026-11-19，2026-11-21 改为复用主人页模板）。

只跑本域：`python manage.py test nav.tests_nav_guest`。
契约重点：游客页与主人页同一套模板（设置抽屉、桌宠、卡片全复用），区别只有
`NAV_GUEST_MODE` + 前端请求闸门；游客页 GET 0 查询，站点来自公开快照，
数据库里的内容一条都不能漏出去。
"""

import json
import os
import re
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import NavCategory, NavPublicConfig, NavSite


class GuestPageTests(TestCase):
    def setUp(self):
        NavSite.objects.all().delete()
        NavCategory.objects.all().delete()

    def test_guest_page_is_readonly_and_zero_queries(self):
        # 库里有站,访客页却只能拿公开快照:这条站名/网址绝不能出现在 HTML 里
        NavSite.objects.create(name='库内私密站', url='https://db-only.example.com/',
                               category='工具', description='不该被访客看到')
        with self.assertNumQueries(0):
            resp = self.client.get(reverse('nav_guest'))
        self.assertEqual(resp.status_code, 200)
        html = resp.content.decode('utf-8')
        # 复用主人页:同一套模板、设置抽屉与桌宠配置岛都在
        self.assertIn('NAV_GUEST_MODE', html)
        self.assertIn('navGuestLoginBtn', html)
        self.assertIn('navSettingsMenu', html)
        self.assertIn('navPetAiUrls', html)
        self.assertIn('setTabFx', html)
        self.assertIn('setTabContent', html)
        # 访客导入书签:只存本机,入口与键名都要在
        self.assertIn('navGuestImportBtn', html)
        self.assertIn('navGuestBookmarksV1', html)
        # 只读:数据库内容不外泄,所有 API 由前端闸门拦掉
        self.assertNotIn('库内私密站', html)
        self.assertNotIn('https://db-only.example.com/', html)
        self.assertIn("url.indexOf('api/nav/')", html)
        self.assertNotIn('window.confirm', html)

    def test_guest_local_features_kept_and_ai_gated(self):
        # 本机可持久化的项访客态放开(星标/桌宠外观/商店/签到);只依赖主人 AI 或写库的项收起。
        resp = self.client.get(reverse('nav_guest'))
        html = resp.content.decode('utf-8')
        # 2026-11-20:对话/人设/维护排序都改走本机配置,不再被访客 CSS 收起。
        style = self._guest_style(html)
        self.assertNotIn('#petPaneChat', style)
        self.assertNotIn('#tabBtn-sort', style)
        for sel in ('data-pet-action="aichat"', 'data-pet-action="chatwin"',
                    'data-pet-action="basket"', 'data-pet-action="balance"'):
            self.assertNotIn(sel, style)
        # 只读 GET 代理白名单进访客闸门:必应壁纸 / 天气 / 地理 / 空气预报 / 每日英语
        for token in ('GUEST_PUBLIC_GET', '/api/nav/bing-bg/', '/api/nav/pet-geo/',
                      '/api/nav/pet-ip-geo/', '/api/nav/pet-weather/', '/api/nav/pet-brief/',
                      '/api/nav/pet-daily-en/'):
            self.assertIn(token, html)
        # 天气 / 每日英语 / 必应壁纸不再被访客 CSS 收起
        self.assertNotIn('data-pet-action="weather"', self._guest_style(html))
        self.assertNotIn('data-pet-action="dailyen"', self._guest_style(html))
        self.assertNotIn('#navBgBing', self._guest_style(html))
        # 本地星标不再被隐藏:隐藏选择器清单里不应再出现 .site-star
        self.assertNotIn('.site-star,', html)
        # pet.js 在访客态对 AI 聊天窗 / 碎碎念 / 人设读写都有本地回落守卫
        pet_js = (Path(__file__).resolve().parent / 'static' / 'js' / 'pet.js').read_text(encoding='utf-8')
        self.assertEqual(pet_js.count('window.NAV_GUEST_MODE') >= 5, True)
        self.assertIn('petAiChatOpen', pet_js)
        self.assertIn('navGuestAi.savePetConfig', pet_js)
        # 每日英语本机静态语料兜底
        self.assertIn('PET_DAILY_EN_LOCAL', pet_js)

    def test_guest_cards_keep_icon_fallback_chain(self):
        # 快照只带 favicon 原值,而库里 favicon 大多为空:访客行必须在服务端补
        # favicon.im / Google s2 两级兜底,否则卡片有站名没有图标。
        from .nav_access import _guest_site_row
        row = _guest_site_row({'name': '示例', 'url': 'https://example.com/a', 'favicon': ''}, 1)
        self.assertEqual(row['fav_url'], 'https://favicon.im/example.com')
        self.assertIn('s2/favicons', row['fav_url_alt'])
        row2 = _guest_site_row({'name': '自带图标', 'url': 'https://example.com/',
                                'favicon': 'https://example.com/f.ico'}, 2)
        self.assertEqual(row2['fav_url'], 'https://example.com/f.ico')

    @staticmethod
    def _guest_style(html):
        import re
        m = re.search(r'(?s)<style[^>]*>(.*?)</style>', html)
        return m.group(1) if m else ''

    def test_idb_store_layer_loaded_and_guest_can_use(self):
        # IndexedDB 薄封装:主客同一套模板都加载;访客态同样可写,不经服务端。
        guest = self.client.get(reverse('nav_guest'))
        self.assertContains(guest, 'js/nav-store.js')
        owner = self.client.get(reverse('nav_sites'))
        self.assertContains(owner, 'js/nav-store.js')
        store_js = (Path(__file__).resolve().parent / 'static' / 'js' / 'nav-store.js').read_text(encoding='utf-8')
        self.assertIn('window.navStore', store_js)
        self.assertIn('pinsflora-nav', store_js)
        self.assertIn("'kv'", store_js)
        # 大对象(自定义背景图)改走封装;小偏好仍留 localStorage
        theme_js = (Path(__file__).resolve().parent / 'static' / 'js' / 'theme.js').read_text(encoding='utf-8')
        self.assertIn('navStore.set', theme_js)
        self.assertIn('navStore.get', theme_js)
        self.assertIn('navStore.remove', theme_js)

    def test_owner_page_links_to_guest_page(self):
        # 未配置访问令牌 = 本地自用,`/nav/` 才是主人页(配了令牌后没 cookie 会降级为访客页)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('NAV_WRITE_TOKEN', None)
            resp = self.client.get(reverse('nav_sites'))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, reverse('nav_guest'))


class GuestParityTests(TestCase):
    """2026-11-19 主客对齐:登录入口快捷键化、必应死路收口、导入书签本地分层与层级。"""

    def test_login_button_visible_shortcut_kept(self):
        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        # C3:顶栏登录按钮在访客态可见(去掉 d-none 与 display:none !important 双隐);
        # 菜单内「主人登录」项已按拍板删除,菜单内不再出现 data-guest-login。
        self.assertIn('navGuestLoginBtn', html)
        self.assertNotIn('#navGuestLoginBtn { display: none', html)
        self.assertNotIn('d-none" type="button" id="navGuestLoginBtn"', html)
        self.assertNotIn('data-guest-login', html)
        self.assertIn('openLogin', html)
        self.assertIn('e.shiftKey', html)
        self.assertIn("e.key === 'l' || e.key === 'L'", html)
        # C8:快捷键在顶栏按钮 tooltip 写明,弹窗正文也保留一句可见提示
        self.assertIn('Ctrl/Cmd+Shift+L', html)
        self.assertIn('nav-login-shortcut-hint', html)

    def test_bing_wallpaper_open_to_guest(self):
        # 必应壁纸是只读 GET 代理:访客 CSS 不再收起按钮,theme.js 也不再有访客守卫兜底
        guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertIn('navBgBing', guest)
        theme_js = (Path(__file__).resolve().parent / 'static' / 'js' / 'theme.js').read_text(encoding='utf-8')
        self.assertNotIn('NAV_GUEST_MODE', theme_js)
        self.assertNotIn('访客态不可用必应壁纸', theme_js)

    def test_import_uses_idb_store_and_keeps_hierarchy_and_star(self):
        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        # 导入书签走 navStore(IDB 优先,localStorage 兜底),不再硬挤 localStorage 配额
        self.assertIn('navStore.get', html)
        self.assertIn('navStore.set', html)
        self.assertIn('navStore.remove', html)
        # 层级:大类 / 二级 / 三级 渲染节点都在
        self.assertIn('nav-sub2', html)
        self.assertIn('splitSub', html)
        # 导入卡片补星标按钮,复用 .site-star 委托
        self.assertIn("className = 'site-star'", html)

    def test_guest_bookmark_can_export_json_and_html(self):
        # 本机导入的书签可导出 JSON / Netscape 书签 HTML,不落服务器
        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertIn('navGuestExportHtml', html)
        self.assertIn('pinsflora-nav-guest', html)
        self.assertIn('NETSCAPE-Bookmark-file-1', html)
        self.assertIn('bookmarkHtml', html)
        self.assertIn('guardExport', html)
        # 旧的整包 JSON 导出按钮 id 已随菜单合并删除,不得复活
        self.assertNotIn('navGuestExportJson', html)

    def test_settings_tab_falls_back_when_hidden(self):
        # 记住的页签在访客态被隐藏时,JS 要回落外观页,而不是四个 pane 全空
        js = (Path(__file__).resolve().parent / 'static' / 'js' / 'nav-sites.js').read_text(encoding='utf-8')
        self.assertIn("SET_TABS = ['view', 'content', 'fx', 'sort']", js)
        self.assertIn("getComputedStyle(lastBtn).display === 'none'", js)

    def test_guest_local_bookmark_actions_and_tools(self):
        # A 类本机能力:批量打开/复制、单条删除/编辑/置顶、分组改名/排序、点击常用排序、本机 HTML 工具
        html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        for token in ['ng-check', 'bulkOpen', 'bulkCopy', '打开选中', '复制链接']:
            self.assertIn(token, html)
        for token in ['ng-pin', 'ng-edit', 'ng-del', 'togglePin', 'editSite', 'deleteSite']:
            self.assertIn(token, html)
        for token in ['navGuestAddBtn', 'addSite']:
            self.assertIn(token, html)
        for token in ['navGuestCardMenu', 'archiveSite', 'restoreSite', 'moveInGroup', 'archived', '已归档']:
            self.assertIn(token, html)
        for token in ['renameCat', 'moveCat', 'navGuestCatOrderV1', 'bumpClick', 'clicks']:
            self.assertIn(token, html)
        for token in ['navGuestToolBtn', 'navGuestToolFile', 'navGuestToolsV1', 'openTool', 'deleteTool', 'ng-tool-card']:
            self.assertIn(token, html)


class GuestLocalToolingTests(TestCase):
    """2026-11-20 本机工具四件:命令面板 / 足迹热力图 / 整包备份恢复 / 外观增量。

    共同前提:只读写本机(navStore / localStorage),不新增任何服务端写接口;
    访客态与主人态共用同一套模块。
    """

    def setUp(self):
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.scripts = {n: (base / n).read_text(encoding='utf-8')
                        for n in ('nav-cmd.js', 'footprint.js', 'nav-backup.js',
                                  'nav-store.js', 'theme.js', 'pet.js')}

    def test_modules_loaded_in_both_modes(self):
        for html in (self.guest, self.owner):
            for name in ('js/nav-cmd.js', 'js/footprint.js', 'js/nav-backup.js'):
                self.assertIn(name, html)
        # 顺序契约:命令面板要拿到搜索索引,必须在 stars-filter 之后
        self.assertLess(self.guest.index('js/stars-filter.js'), self.guest.index('js/nav-cmd.js'))

    def test_command_palette_reuses_search_pipeline(self):
        js = self.scripts['nav-cmd.js']
        self.assertIn('navCmdPal', js)            # 浮层由 JS 建,不占模板
        self.assertIn('navCmdInput', js)
        self.assertIn('#navSearch', js)           # 输入镜像进既有过滤管道
        self.assertIn('navFilterIndex', js)       # 命中来自既有索引
        self.assertIn('pinyinEligible', js)       # 首字母规则同一套
        self.assertIn("e.key === 'k' || e.key === 'K'", js)
        self.assertIn('isComposing', js)          # 输入法组合期不抢键
        self.assertIn('a.site-card', js)          # 打开走真实卡片 click

    def test_footprint_heatmap_is_local_only(self):
        js = self.scripts['footprint.js']
        self.assertIn('navFootprintsV1', js)
        self.assertIn('navStore', js)
        self.assertIn('navFootPanel', js)
        self.assertIn('data-nav-foot', self.guest)
        self.assertIn('data-nav-foot', self.owner)
        # 纯本机:不得出现任何 /api/nav/ 写端点
        self.assertNotIn('/api/nav/', js)

    def test_full_pack_backup_and_restore(self):
        js = self.scripts['nav-backup.js']
        self.assertIn('pinsflora-nav-local', js)
        self.assertIn('data-nav-backup', self.guest)
        self.assertIn('data-nav-restore', self.guest)
        self.assertIn('data-nav-backup', self.owner)
        # 整包产物不再带 sites 精简数组:模板里不得残留兼容旁路
        self.assertNotIn('pack.sites', self.guest)
        self.assertNotIn('exportSites', self.guest)
        self.assertNotIn('navGuestExportJson', self.guest)
        # 恢复必须确认(覆盖式),且大对象走 IDB
        self.assertIn('navConfirm', js)
        self.assertIn("BIG_KEYS = {'navCustomBg': 1}", js)
        # 存储层提供枚举
        self.assertIn('function keys()', self.scripts['nav-store.js'])
        # B3 回归:AI 配置先合并本机 Key,再走统一写记录;不能只合并不落盘。
        self.assertRegex(
            self.scripts['nav-backup.js'],
            r"(?s)if \(k === AI_CFG_KEY\).*?return writeRecord\(k, rec\);",
            "AI 配置分支必须合并 Key 后写回",
        )

    def test_single_backup_entry_per_menu(self):
        # 访客菜单与主人菜单各只有一个「整包备份」入口;旧的两条文案与按钮 id 都已删除。
        for html in (self.guest, self.owner):
            self.assertEqual(html.count('整包备份</button>'), 1)
            self.assertEqual(html.count('data-nav-backup'), 1)
        for gone in ('整包备份(JSON)', '整包备份(本机)', 'navGuestExportJson', '整包备份 JSON'):
            self.assertNotIn(gone, self.guest)
            self.assertNotIn(gone, self.owner)
        # 恢复入口仍各保留一条,位置未动
        self.assertEqual(self.guest.count('data-nav-restore'), 1)
        self.assertEqual(self.owner.count('data-nav-restore'), 1)

    def test_pack_product_strips_plaintext_ai_key(self):
        js = self.scripts['nav-backup.js']
        # 采集端必须走擦除路径:敏感字段名被显式 delete,非敏感配置保留
        self.assertIn('SENSITIVE_FIELDS', js)
        self.assertIn("['apiKey', 'key', 'token']", js)
        self.assertIn('delete parsed[f]', js)
        self.assertIn('delete copy[f]', js)
        # 源码里不得存在把 AI 配置原始 value 直塞 entries 的旁路
        self.assertNotIn('entries[AI_CFG_KEY] = raw', js)
        # 恢复端:入站缺 Key 时保本机当前 Key 的决策必须落码
        self.assertIn('keepLocalAiKey', js)
        self.assertIn('inbound.apiKey = local.apiKey', js)

    def test_local_pack_rejected_by_import_accepted_by_restore(self):
        # 一个备份文件只对应一个结果:整包 format 能过恢复端校验,
        # 同时被导入端以「请用整包恢复」明确拒绝,不能被当站点树静默读走。
        js = self.scripts['nav-backup.js']
        self.assertIn('pack.format !== FORMAT', js)
        self.assertIn('pinsflora-nav-local', js)
        template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')
        # 拒绝分支在解析层 + 两个调用点(importGuestJson、文件 change)都要落地
        self.assertIn("data.format === LOCAL_PACK_FORMAT", template)
        self.assertIn('这是本机整包，请用整包恢复', template)
        self.assertEqual(template.count('这是本机整包，请用整包恢复'), 2)

    def test_appearance_strength_and_ripple(self):
        html = self.guest
        self.assertIn('navFxStrengthR', html)
        self.assertIn('navFxStrengthV', html)
        self.assertIn('setNavRipple', html)
        theme = self.scripts['theme.js']
        self.assertIn('--nav-fx-strength', theme)
        self.assertIn('navRipple', theme)
        self.assertIn('nav-ripple', self.scripts['theme.js'])
        self.assertIn('window.navAppearance', theme)
        css = (Path(__file__).resolve().parent / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')
        self.assertIn('.nav-ripple', css)
        self.assertIn('--nav-fx-strength', css)


class GuestLocalAiTests(TestCase):
    """2026-11-20 访客本机 AI / 管理套件:
    找站、分类、对话、快捷问答、碎碎念、余额、标签、体检篮、统计全部只走
    访客自带 Key 与本机存储,不调用服务端 AI,也不新增任何服务端写接口。
    """

    def setUp(self):
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.ai_js = (base / 'nav-guest-ai.js').read_text(encoding='utf-8')
        self.mg_js = (base / 'nav-guest-manage.js').read_text(encoding='utf-8')
        self.template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')
        self.pet_js = (base / 'pet.js').read_text(encoding='utf-8')
        self.ai_py = (Path(__file__).resolve().parent / 'ai.py').read_text(encoding='utf-8')
        self.css = (Path(__file__).resolve().parent / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')

    def test_modules_only_in_guest_and_local_api_exposed(self):
        for name in ('js/nav-guest-ai.js', 'js/nav-guest-manage.js'):
            self.assertIn(name, self.guest)
            self.assertNotIn(name, self.owner)   # 主人页仍用服务端 AI 管线
        for token in ('window.navGuestLocal', 'addSites', 'patch:', 'remove:', 'tagVocab',
                      'cleanTags', 'data-tags'):
            self.assertIn(token, self.template)
        for token in ('window.navGuestEdit', 'window.navGuestBasket', 'window.navGuestStatsOpen'):
            self.assertIn(token, self.mg_js)
        # 本机数据模型加标签;卡片可被搜索/筛到
        self.assertIn('data-tags', self.template)
        self.assertIn('cleanTags', self.template)

    def test_ai_suite_is_browser_direct_and_prompt_parity(self):
        for token in ('navGuestAiCfgV1', 'navGuestAiHistoryV1', '/chat/completions',
                      'window.navGuestAi', 'window.openGuestLocalAiPanel', 'navGuestProbeUrl',
                      'Authorization', 'Bearer', 'CORS'):
            self.assertIn(token, self.ai_js)
        # 纯浏览器直连:本模块不得引用本站 AI 接口或写接口
        for bad in ('/api/nav/pet-chat', '/api/nav/pet-quick', '/api/nav/pet-whisper',
                    '/api/nav/ai-generate', '/api/nav/ai-classify', '/api/nav/pet-balance'):
            self.assertNotIn(bad, self.ai_js)
        # 提示词与 nav/ai.py 同文:两条路径(接口/手动粘贴)约束一致
        self.assertIn('只推荐你非常确定真实存在的网站', self.ai_js)
        self.assertIn('只推荐你非常确定真实存在的网站', self.ai_py)
        self.assertIn('同类服务必须归到同一个分类', self.ai_js)
        self.assertIn('同类服务必须归到同一个分类', self.ai_py)
        self.assertIn('标签只能从用户给出的标签词表里选', self.ai_js)
        self.assertIn('标签只能从用户给出的标签词表里选', self.ai_py)
        # 手动模式与接口模式共用 parse / 修复重试
        for token in ('parseSiteDrafts', 'parseClassify', 'chatJson', 'extractJsonArray'):
            self.assertIn(token, self.ai_js)
        # 入口挂在访客 AI 下拉,不调服务端 data-on-click
        for act in ('find', 'classify', 'config'):
            self.assertIn('data-guest-ai="%s"' % act, self.guest)

    def test_guest_ai_diagnostics_logs_model_override_and_probe(self):
        # 2026-11-20 D 线:桌宠模型覆盖 / 环形调用日志 / 本机开关复用 / 模型列表直连探测
        ai = self.ai_js
        # 桌宠模型覆盖:cfg 清洗保留 modelPet,旧配置缺失时回落空串;modelFor 桌宠任务优先它
        self.assertIn('modelPet', ai)
        self.assertIn('modelPet: String(raw.modelPet', ai)
        self.assertIn("task === 'pet' || task === 'whisper'", ai)
        # 环形调用日志:键名、上限、对外快照与清空 API
        self.assertIn('navGuestAiLogV1', ai)
        self.assertIn('LOG_MAX = 100', ai)
        self.assertIn('logs: readLogs', ai)
        self.assertIn('clearLogs: clearLogsStore', ai)
        for token in ("task: 'chat'", "task: 'whisper'", "task: 'quick'",
                      "task: 'balance'", "task: 'find'", "task: 'classify'", "task: 'repair'"):
            self.assertIn(token, ai)
        for token in ('elapsed_ms', 'ok: !!entry.ok', 'at: Date.now()'):
            self.assertIn(token, ai)
        # 模型列表与最小探测:浏览器直连 OpenAI 兼容 /models 与 /chat/completions
        self.assertIn("baseUrl + '/models'", ai)
        self.assertIn('fetchModels', ai)
        self.assertIn('testModel', ai)
        self.assertIn('testAllModels', ai)
        # 面板开关直接读写既有 localStorage 键,不造第二份同义键
        for token in ('navPetWhisper', 'navPetChatReasoning', 'navPetChatCopy'):
            self.assertIn(token, ai)
        # 跨域限制文案必须如实标注;日志不写 Key 明文
        self.assertIn('CORS', ai)
        self.assertIn('no-cors', ai)
        self.assertNotIn('apiKey = entry', ai)

    def test_local_management_basket_stats_and_tags(self):
        for token in ('navGuestEditModal', 'ngeName', 'ngeTags', 'ngeSave',
                      'navGuestBasketV1', 'ngbScan', 'navGuestStatsModal',
                      'ngs-grid', 'navGuestStatsOpen', 'data-nav-basket', 'data-nav-stats'):
            self.assertIn(token, self.template) if token.startswith('data-nav-') else self.assertIn(token, self.mg_js)
        # C4:菜单里的「体检篮(本机)」整行删除;顶栏 🧺 入口保留为 data-nav-basket="nav"
        self.assertNotIn('data-nav-basket="menu"', self.template)
        self.assertIn('data-nav-basket="nav"', self.template)
        self.assertNotIn('>体检篮(本机)</button>', self.template)
        # 体检篮只做浏览器探测,不请求本站写接口
        self.assertIn('no-cors', self.ai_js)
        self.assertIn('window.navGuestProbeUrl', self.mg_js)
        self.assertNotIn('/api/nav/', self.mg_js)
        # 标签快筛与编辑:标签进入卡片搜索串
        self.assertIn('applyTagFilter', self.mg_js)
        self.assertIn('nav-guest-tagbar', self.mg_js)
        for token in ('.ngb-row', '.ngs-grid', '.nav-guest-tagbar'):
            self.assertIn(token, self.css)

    def test_pet_guest_branches_use_local_modules(self):
        # 聊天/快捷问答/碎碎念/余额/死链篮/统计都有访客本机分支
        for token in ('window.navGuestAi.quick', 'window.navGuestAi.chat',
                      'window.navGuestAi.whisper', 'window.navGuestAi.balance',
                      'navGuestBasket.open', 'navGuestStatsOpen'):
            self.assertIn(token, self.pet_js)
        # 访客 AI 配置探测改走本机事件,不再打服务端 config
        self.assertIn("addEventListener('nav-guest-ai-config'", self.pet_js)
        # 桌宠快捷气泡 / 聊天窗发送都走本机 AI,不再有"主人专属"拦截
        self.assertNotIn('AI 聊天仅本机主人可用', self.pet_js)
        self.assertIn('quickChatReq', self.pet_js)
        self.assertIn('const chatReq = (window.NAV_GUEST_MODE', self.pet_js)
        # 原生 alert/confirm/prompt 禁用:入口一律 navToast/navConfirm
        for js in (self.ai_js, self.mg_js):
            self.assertNotIn('window.confirm(', js)
            self.assertNotIn('window.alert(', js)
            self.assertNotIn('window.prompt(', js)

    def test_server_ai_endpoints_stay_out_of_guest_whitelist(self):
        # 访客 GET 白名单只放只读代理;AI / 写接口一个都不放
        self.assertIn('GUEST_PUBLIC_GET', self.guest)
        for name in ('pet-chat', 'pet-quick', 'pet-whisper', 'pet-balance',
                     'ai-generate', 'ai-classify'):
            self.assertNotIn("'/api/nav/%s/" % name, self.guest)
        # 服务端原有的 AI 路由仍存在,只是访客闸门不放行
        urls_py = (Path(__file__).resolve().parent / 'urls.py').read_text(encoding='utf-8')
        for name in ('api_nav_pet_chat', 'api_nav_pet_quick', 'api_nav_pet_whisper',
                     'api_nav_ai_generate', 'api_nav_ai_classify_batch', 'api_nav_pet_balance'):
            self.assertIn(name, urls_py)


class GuestSchemaV2Tests(TestCase):
    """2026-11-20 基础线:书签/工具 schema v2、分组显隐、专用 JSON 往返、冻结 API 底座。

    这些是后续批量 / 保养 / AI 诊断 / 元数据线只依赖的字段与接口,静态断言锁住不回退。
    """

    def setUp(self):
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.batch_js = (base / 'nav-guest-batch.js').read_text(encoding='utf-8')
        self.care_js = (base / 'nav-guest-care.js').read_text(encoding='utf-8')

    def test_schema_v2_fields_normalized_and_snapshotted(self):
        # 书签 v2 全字段都在清洗入口与快照里;工具补图标/更新时间
        for token in ('siteTitle', 'favicon', 'iconText', 'iconColor', 'iconSize',
                      'children', 'alternates', 'createdAt', 'updatedAt', 'archivedAt',
                      'lastCheck', 'cleanChild', 'cleanAlt', 'cleanCheck'):
            self.assertIn(token, self.template)
        for token in ('iconText', 'iconColor', 'updatedAt'):
            self.assertIn(token, self.template)
        # lastCheck.code 不可靠:cleanCheck / recordCheck 都不得伪造状态码
        self.assertIn("typeof x.code === 'number'", self.template)
        self.assertIn("typeof res.code === 'number'", self.template)

    def test_group_order_migrates_legacy_array_and_writes_object(self):
        # 旧字符串数组读取迁移为 {order, hidden};写回新对象
        self.assertIn('normalizeOrder', self.template)
        self.assertIn('Array.isArray(raw)', self.template)
        self.assertIn('{ order: [], hidden: [] }', self.template)
        self.assertIn('catOrder.order', self.template)
        self.assertIn('catOrder.hidden', self.template)

    def test_frozen_local_api_extensions_present(self):
        # 批量 / 分组 / 站点排序 / 体检回写 / 工具元数据接口都挂在 navGuestLocal
        for token in ('patchMany', 'bulkSetPinned', 'bulkArchive', 'bulkMove',
                      'bulkAddTags', 'bulkRemoveTags', 'bulkDelete',
                      'groupOrder', 'setCatHidden', 'moveCatTo', 'resetCatOrder',
                      'moveSiteTo', 'setSiteCategory', 'recordCheck', 'clearCheck',
                      'toolMeta', 'updateToolMeta'):
            self.assertIn(token, self.template)
        # 批量返回形状: {ok, updated, skipped};保存失败回滚内存
        self.assertIn('{ ok: true, updated:', self.template)
        self.assertIn('{ ok: false, updated: 0,', self.template)

    def test_dedicated_guest_json_v2_roundtrip_supported(self):
        self.assertIn("GUEST_FORMAT = 'pinsflora-nav-guest'", self.template)
        self.assertIn('GUEST_VERSION = 2', self.template)
        for token in ('parseGuestFile', 'importParsed', 'importGuestJson', 'buildGuestPayload',
                      'applyIncoming', 'settings', 'groups'):
            self.assertIn(token, self.template)
        # 导入三策略:跳过 / 覆盖 / 合并;合并保留本机 clicks/pinned/lastCheck/createdAt
        for token in ("'overwrite'", "'merge'", "'skip'", 'keep.clicks', 'keep.pinned',
                      'keep.lastCheck', 'keep.createdAt'):
            self.assertIn(token, self.template)
        # AI Key 默认不导出明文:排除或脱敏留后 4 位
        self.assertIn('navGuestAiCfgV1', self.template)
        self.assertIn("keyMode === 'mask'", self.template)
        self.assertIn("'••••' + key.slice(-4)", self.template)

    def test_placeholder_modules_loaded_after_manage_and_local_only(self):
        # 顺序:ai → manage → batch → care;占位模块只在访客页加载
        for name in ('js/nav-guest-batch.js', 'js/nav-guest-care.js'):
            self.assertIn(name, self.guest)
            self.assertNotIn(name, self.owner)
        self.assertLess(self.guest.index('js/nav-guest-ai.js'), self.guest.index('js/nav-guest-manage.js'))
        self.assertLess(self.guest.index('js/nav-guest-manage.js'), self.guest.index('js/nav-guest-batch.js'))
        self.assertLess(self.guest.index('js/nav-guest-batch.js'), self.guest.index('js/nav-guest-care.js'))

    def test_placeholder_modules_are_empty_strict_iife(self):
        # batch 线已填充,但必须 strict、无原生弹窗、不碰服务端;care 线已落地,断言见 GuestCareLineTests
        self.assertIn("'use strict'", self.batch_js)
        self.assertNotIn('window.confirm(', self.batch_js)
        self.assertNotIn('window.alert(', self.batch_js)
        self.assertNotIn('window.prompt(', self.batch_js)
        self.assertNotIn('/api/nav/', self.batch_js)

    def test_batch_module_wires_frozen_apis_and_local_ui(self):
        # 线 B:批量 / 分组显隐排序 / 站点换分类只调冻结 API,控件令牌齐全
        for token in ('bulkSetPinned', 'bulkArchive', 'bulkMove', 'bulkAddTags',
                      'bulkRemoveTags', 'bulkDelete', 'setCatHidden', 'moveCatTo',
                      'resetCatOrder', 'moveSiteTo', 'setSiteCategory', 'groupOrder',
                      'tagVocab', 'categories', 'onRender', 'navGuestBatch'):
            self.assertIn(token, self.batch_js)
        # 弹层与入口令牌
        for token in ('ngbMoveModal', 'ngbTagModal', 'ngbHiddenModal', 'data-ngb-restore',
                      '隐藏分组', '恢复默认分组顺序', '批量删除本机书签', '本机存储空间不足'):
            self.assertIn(token, self.batch_js)
        # 全选 / 取消全选:纳入全部本机书签(含归档),状态随 selected 表回填勾选框
        for token in ('全选', '取消全选', 'allSelected', 'allBookmarkUrls', 'L.list()'):
            self.assertIn(token, self.batch_js)
        # 模板右键菜单补项:置顶/置底/换分类分支委托给 batch 模块
        for token in ('置顶到分组顶', '置底分组末', '换分类', 'window.navGuestBatch'):
            self.assertIn(token, self.template)
        # 新样式类落在访客区段 CSS
        css = (Path(__file__).resolve().parent / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')
        for token in ('.ng-batch-row', '.ng-batch-name', '.ng-batch-count'):
            self.assertIn(token, css)

    def test_minimal_css_helper_added(self):
        css = (Path(__file__).resolve().parent / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')
        self.assertIn('.ng-cat-hidden', css)


class GuestCareLineTests(TestCase):
    """2026-11-20 线 C:保养分组视图 / 体检记录回写 / URL 卫生扫描 / 本机统计增强。

    边界同基础线:只读写本机快照与 navStore,不调服务端写接口;探测 no-cors,
    不伪造 HTTP 状态码;交互一律 navConfirm/navToast,禁用原生弹窗。
    """

    def setUp(self):
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.care_js = (base / 'nav-guest-care.js').read_text(encoding='utf-8')
        self.mg_js = (base / 'nav-guest-manage.js').read_text(encoding='utf-8')
        self.template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')
        self.css = (Path(__file__).resolve().parent / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')

    def test_care_module_loaded_guest_only_and_ordered(self):
        for name in ('js/nav-guest-care.js',):
            self.assertIn(name, self.guest)
            self.assertNotIn(name, self.owner)
        self.assertLess(self.guest.index('js/nav-guest-batch.js'), self.guest.index('js/nav-guest-care.js'))

    def test_care_wires_frozen_local_api(self):
        js = self.care_js
        # 分组 / 动作只走冻结 API 与既有本机弹窗编辑入口
        for token in ('recordCheck', 'clearCheck', 'L.list()', 'L.find(', 'L.patch(',
                      'bulkArchive', 'navGuestEdit', 'window.navGuestCare',
                      'navGuestAi.probe', 'navGuestProbeUrl'):
            self.assertIn(token, js)
        # 回写只传 ok/note/ms,不传 code:no-cors 拿不到可靠状态码,不得伪造
        self.assertNotIn('code:', js)

    def test_care_groups_and_hygiene_tokens_present(self):
        js = self.care_js
        # 保养分组标题
        for token in ('体检失败', '尚未体检', '从未点击', '久未访问', '归档 / 休眠'):
            self.assertIn(token, js)
        # URL 卫生规则与预览 / 冲突口径
        for token in ('utm_source', 'fbclid', 'gclid', 'spm', '跟踪参数', '尾斜杠',
                      '域名大写', '重复斜杠', '建议升级 https', '冲突', '预览'):
            self.assertIn(token, js)

    def test_care_entry_in_template(self):
        self.assertIn('data-nav-care', self.template)
        self.assertIn('data-nav-care', self.guest)

    def test_care_and_manage_are_local_only_no_native_popup(self):
        for js in (self.care_js, self.mg_js):
            self.assertNotIn('/api/nav/', js)
            self.assertNotIn('window.confirm(', js)
            self.assertNotIn('window.alert(', js)
            self.assertNotIn('window.prompt(', js)
        # 体检篮扫描 / 重测 / 单条重测都回写 lastCheck;统计弹窗补保养口径指标
        for token in ('writeCheck', 'recordCheck'):
            self.assertIn(token, self.mg_js)
        for token in ('坏链', '未测', '未点击', '久未访问'):
            self.assertIn(token, self.mg_js)

    def test_care_css_classes_appended(self):
        for token in ('.ngc-row', '.ngc-group', '.ngc-group-count', '.ngc-hyg-row',
                      '.ngc-hyg-rule', '.ngc-hyg-conflict'):
            self.assertIn(token, self.css)


class GuestMetadataLineTests(TestCase):
    """2026-11-20 线 E:子网页 / 备用网址 / 自定义图标 / 工具元数据与分组展示。

    边界同基础线:只读写本机快照与 navStore;书签编辑走 patch/addSites,
    工具元数据走 updateToolMeta;不调服务端写接口;禁用原生弹窗。
    """

    def setUp(self):
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.mg_js = (base / 'nav-guest-manage.js').read_text(encoding='utf-8')
        self.template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')
        self.css = (Path(__file__).resolve().parent / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')

    def test_edit_modal_carries_child_alt_and_icon_fields(self):
        # 编辑弹窗:子网页 / 备用网址多行增删 + 图标四件套,字段名与 schema v2 一致
        for token in ('ngeChildren', 'ngeAlts', 'ngeAddChild', 'ngeAddAlt',
                      'ngeFavicon', 'ngeIconText', 'ngeIconColor', 'ngeIconSize',
                      'collectLinks', 'cleanFaviconInput'):
            self.assertIn(token, self.mg_js)
        # 页面标题:输入框回填 + 进保存 payload(编辑 patch / 新增 addSites 共用)
        self.assertIn('ngeSiteTitle', self.mg_js)
        self.assertIn("src.siteTitle", self.mg_js)
        self.assertIn('siteTitle: siteTitle', self.mg_js)
        # 保存时新字段随 payload 落盘(编辑 patch / 新增 addSites 共用)
        for token in ('children: children', 'alternates: alternates',
                      'favicon: fav.value', 'iconText: iconText',
                      'iconColor: iconColor', 'iconSize: iconSize'):
            self.assertIn(token, self.mg_js)

    def test_card_icon_fallback_and_meta_badges(self):
        # 卡片图标三级回退:favicon 图片(失败回退字母)→ 文字图标 → 默认首字母
        for token in ('letterFav', 'ng-meta-fav-img', 'favicon', 'iconText', 'iconColor', 'iconSize'):
            self.assertIn(token, self.template)
        # 子链接 / 备用网址数量角标
        for token in ('ng-meta-badge', 'ng-meta-badges', 'childN', 'altN'):
            self.assertIn(token, self.template)

    def test_card_menu_opens_child_and_alternate_link_panel(self):
        for token in ('children', 'alts', 'openLinkPanel', 'hideLinkPanel',
                      'ngMetaLinkPanel', '子网页', '备用网址'):
            self.assertIn(token, self.template)

    def test_tool_meta_edit_and_grouped_render(self):
        # 工具元数据编辑弹窗经 updateToolMeta 落盘;工具按分类分组渲染,空分类归「我的工具」
        for token in ('navGuestToolEdit', 'tgeName', 'tgeCat', 'tgeDesc',
                      'tgeIconText', 'tgeIconColor', 'updateToolMeta', 'toolMeta'):
            self.assertIn(token, self.mg_js)
        for token in ('ng-tool-group', 'ng-tool-group-title', 'ng-tool-group-count',
                      'byCat', '我的工具'):
            self.assertIn(token, self.template)

    def test_metadata_line_local_only_no_native_popup(self):
        self.assertNotIn('/api/nav/', self.mg_js)
        self.assertNotIn('window.confirm(', self.mg_js)
        self.assertNotIn('window.alert(', self.mg_js)
        self.assertNotIn('window.prompt(', self.mg_js)
        for token in ('.ng-meta-badge', '.ng-meta-links', '.ng-meta-link-row',
                      '.nge-link-row', '.ng-tool-group'):
            self.assertIn(token, self.css)


class GuestFavLocalizeTests(TestCase):
    """A 线:图标多源兜底链 + best-effort 本机缓存本地化(纯浏览器直连,不回写书签)。"""

    def setUp(self):
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.mg_js = (base / 'nav-guest-manage.js').read_text(encoding='utf-8')
        self.template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')

    @staticmethod
    def _body(src, name):
        start = src.index('function ' + name + '(')
        nxt = src.find('function ', start + 1)
        return src[start:nxt if nxt > 0 else len(src)]

    def test_fav_cache_preloaded_before_render_and_source_chain(self):
    # 缓存键在 loadAll 预载;兜底链四源齐全;渲染循环内不发 Promise
        self.assertIn('navGuestFavCacheV1', self.template)
        self.assertIn('FAV_CACHE_KEY', self.template)
        self.assertIn('storeGet(FAV_CACHE_KEY', self.template)
        for token in ('favicon.im', 's2/favicons', 'sz=32', 'api.xinac.net'):
            self.assertIn(token, self.template)
        render_fav = self._body(self.template, 'renderFav')
        self.assertNotIn('storeGet', render_fav)
        self.assertNotIn('navStore.get', render_fav)

    def test_localize_pipeline_limits_concurrency_and_cors(self):
        for token in ('localizeFavicons', 'clearFavCache', 'favCache',
                      'FAV_CONCURRENCY', 'FAV_MAX_BYTES', 'FAV_CACHE_MAX_BYTES',
                      'FAV_CACHE_MAX_ITEMS', "mode: 'cors'", 'FileReader',
                      'readAsDataURL', '超过 100KB', '5 * 1024 * 1024', '300'):
            self.assertIn(token, self.template)

    def test_localize_never_writes_favicon_and_no_owner_endpoint(self):
        body = self._body(self.template, 'localizeFavicons')
        self.assertNotIn('it.favicon =', body)
        self.assertNotIn('.favicon =', body)
        # 主人侧 faviconLocalize 端点键不得被访客本机段读取
        local_start = self.template.index('window.navGuestLocal = {')
        self.assertNotIn('faviconLocalize', self.template[local_start:])

    def test_localize_entries_in_manage_and_template(self):
        for token in ('尝试本地化图标', 'ngeLocalize', 'localizeCurrent', 'localizeAll'):
            self.assertIn(token, self.mg_js)
        for token in ('本地化全部图标', '不做任何服务端下载', '整包备份'):
            self.assertIn(token, self.template)


class GuestToolCatOrderTests(TestCase):
    """B 线:工具分组顺序两级推导 + 独立隐藏,与书签大类显隐完全隔离。"""

    def setUp(self):
        self.template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')

    @staticmethod
    def _body(src, name):
        start = src.index('function ' + name + '(')
        nxt = src.find('function ', start + 1)
        return src[start:nxt if nxt > 0 else len(src)]

    def test_tool_cat_keys_and_order_resolution(self):
        for token in ('navGuestToolCatOrderV1', 'navGuestToolCatHiddenV1'):
            self.assertIn(token, self.template)
        self.assertIn('toolCatList', self.template)
        self.assertIn('groupOrder()', self.template)
        # 排序推导只读 groupOrder().order,不联动书签大类 hidden
        body = self._body(self.template, 'toolCatList')
        self.assertNotIn('.hidden', body)

    def test_tool_cat_actions_api_and_hidden_panel(self):
        for token in ('moveToolCat', 'setToolCatHidden', 'toolCatOrder',
                      'toolCatHidden', 'resetToolCatOrder'):
            self.assertIn(token, self.template)
        move_body = self._body(self.template, 'moveToolCat')
        for action in ("'top'", "'bottom'", "'up'", "'down'"):
            self.assertIn(action, move_body)
        self.assertIn('已隐藏分组', self.template)
        # 旧键缺失时归一化回退空数组,不抛错
        self.assertIn('{ order: [] }', self.template)
        self.assertIn('{ hidden: [] }', self.template)


class GuestLinkCheckPromptTests(TestCase):
    """C 线:链接检测 / AI 提示词 / 粘贴导入(保养模块本机闭环)。"""

    def setUp(self):
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.care_js = (base / 'nav-guest-care.js').read_text(encoding='utf-8')

    def test_link_check_view_and_probe(self):
        js = self.care_js
        for token in ('ngcTabLink', '链接检测', "switchView('link')", 'runLinkCheck',
                      'concurrency = 4', 'PROBE_TIMEOUT = 7000', 'linkSelected', 'recordCheck'):
            self.assertIn(token, js)
        for state in ("'all'", "'dead'", "'untested'", "'ok'"):
            self.assertIn(state, js)
        # 探测走 AI probe 包装;care 模块自身不直接 fetch,不伪造状态码
        self.assertIn('navGuestAi.probe', js)
        self.assertNotIn('statusCode', js)
        self.assertNotIn('fetch(', js)

    def test_prompts_vocab_and_editable_inputs(self):
        js = self.care_js
        for token in ('只输出 JSON 数组', '不要编造不存在的网址', '无法确定就留空'):
            self.assertIn(token, js)
        for token in ('new_url', 'fixed_url', 'tags', 'tagVocab()', 'categories()'):
            self.assertIn(token, js)
        for token in ('ngcPromptInput', 'ngcImportInput'):
            self.assertIn(token, js)

    def test_reply_parse_json_and_text_branches(self):
        js = self.care_js
        self.assertIn('parseAiReply', js)
        # 围栏剥离 + JSON [..] 提取 + 纯文本 -> / => 双分支
        self.assertIn('```', js)
        self.assertIn("indexOf('['),", js)
        self.assertIn("lastIndexOf(']')", js)
        self.assertIn('->', js)
        self.assertIn('=>', js)

    def test_apply_conflict_rollback_and_copy_fallback(self):
        js = self.care_js
        for token in ('applyLinkFix', 'L.patch(', 'rollbackSnaps',
                      'ngcFillModeFill', 'ngcFillModeOverwrite', '仅补空字段', '覆盖已有'):
            self.assertIn(token, js)
        self.assertIn('navigator.clipboard', js)
        self.assertIn('execCommand', js)

    def test_care_red_lines_no_endpoint_no_native_popup(self):
        js = self.care_js
        self.assertNotIn('/api/nav/', js)
        self.assertNotIn('window.confirm(', js)
        self.assertNotIn('window.alert(', js)
        self.assertNotIn('window.prompt(', js)


class SnapshotSignalTests(TestCase):
    """写库后防抖刷新公开快照:信号已挂到 NavSite / NavCategory。"""

    def test_signals_connected_to_site_and_category(self):
        from django.db.models.signals import post_delete, post_save
        from .models import NavCategory, NavPublicConfig, NavSite  # noqa: F401
        import nav.signals as signals

        def uids(signal):
            return {entry[0][0] for entry in signal.receivers if entry[0][0]}

        self.assertIn('nav-site-snapshot-save', uids(post_save))
        self.assertIn('nav-site-snapshot-delete', uids(post_delete))
        self.assertIn('nav-cat-snapshot-save', uids(post_save))
        self.assertIn('nav-cat-snapshot-delete', uids(post_delete))
        # 快照纯函数与命令共用同一份白名单输出
        payload = signals.public_payload()
        self.assertEqual(payload['format'], 'nav-public')


class PublicSnapshotTests(TestCase):
    def setUp(self):
        NavSite.objects.all().delete()
        NavCategory.objects.all().delete()
        NavCategory.objects.create(name='工具', order=1)
        NavCategory.objects.create(name='私密', order=2, hidden=True)
        NavSite.objects.create(
            name='内置站', url='https://builtin.example.com/', category='工具',
            is_builtin=True, description='内置',
        )
        NavSite.objects.create(
            name='自定义站', url='https://custom.example.com/', category='工具',
            description='自定义', tags=['示例'], order=3,
        )
        NavSite.objects.create(
            name='隐藏分类站', url='https://hidden.example.com/', category='私密',
        )
        NavSite.objects.create(
            name='休眠站', url='https://sleep.example.com/', category='工具',
            archived_at=timezone.now(),
        )

    def test_command_writes_public_json_without_private_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'guest' / 'nav-public.json'
            call_command('export_nav_public', output=str(output), verbosity=0)
            self.assertTrue(output.exists())
            payload = json.loads(output.read_text(encoding='utf-8'))

        self.assertEqual(payload['format'], 'nav-public')
        self.assertEqual(payload['version'], 1)
        self.assertTrue(payload['brand']['name'])
        self.assertEqual(payload['categories'], ['工具'])
        names = {row['name'] for row in payload['sites']}
        self.assertEqual(names, {'内置站', '自定义站'})
        # 公开快照不携带主人侧使用统计 / 休眠状态
        self.assertNotIn('click_count', payload['sites'][0])
        self.assertNotIn('archived', payload['sites'][0])
        self.assertNotIn('is_builtin', payload['sites'][0])
        self.assertEqual(payload['sites'][1]['tags'], ['示例'])


class GuestSnapshotManageTests(TestCase):
    """访客也能用站点编辑/删除、分类菜单、新建站点、多选;但全部只写本机覆盖。"""

    def setUp(self):
        self.html = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        base = Path(__file__).resolve().parent
        self.tpl = (base / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')
        self.card_tpl = (base / 'templates' / 'nav' / 'components' / '_nav_site_card.html').read_text(encoding='utf-8')
        self.css = (base / 'static' / 'css' / 'nav-sites.css').read_text(encoding='utf-8')
        self.snap_js = (base / 'static' / 'js' / 'nav-guest-snapshot.js').read_text(encoding='utf-8')
        self.mg_js = (base / 'static' / 'js' / 'nav-guest-manage.js').read_text(encoding='utf-8')

    def test_site_and_category_controls_are_unlocked(self):
        # 真正写库的入口仍在;快照站点的编辑/删除/分类/新建/多选已改为本机覆盖,不再置灰
        style = self.html[self.html.find('<style>'):self.html.find('</style>')]
        for sel in ('.site-edit', '.site-del', '.nav-cat-menu', '.nav-cat-add', '#navBulkToggle'):
            self.assertNotIn(sel, style)
        # 工具编辑/删除与主人维护入口仍保留灰化
        self.assertIn('.tool-edit', style)
        self.assertIn('#navResetBtn', style)
        # #5:多选钮收进「··· → 视图」菜单;id 保留,按钮不带 disabled
        self.assertIn('id="navBulkToggle"', self.html)
        self.assertNotIn('id="navBulkToggle" class="nav-chip nav-chip--icon"', self.html)
        btn_tag = self.html.split('id="navBulkToggle"', 1)[1].split('>', 1)[0]
        self.assertNotIn('disabled', btn_tag)

    def test_snapshot_override_api_and_script_are_exposed(self):
        for token in ('navGuestSnapshotOverridesV1', 'snapshotCardData', 'updateSnapshot',
                      'deleteSnapshot', 'snapshotHiddenCount', 'restoreSnapshots',
                      'nav-guest-snapshot.js'):
            self.assertIn(token, self.html)
        for token in ('toggleBulk', 'editSite', 'hideSite', 'renderHiddenBar',
                      'ngSnapBulkBar', 'navGuestCatLabel', 'snapshotCardData', 'deleteSnapshot'):
            self.assertIn(token, self.snap_js)
        # 真正写本机覆盖的 updateSnapshot 在管理组件里,由快照编辑分支调用
        self.assertIn('updateSnapshot', self.mg_js)

    def test_snapshot_bulk_copy_and_large_select_guard(self):
        # D7 访客快照多选与主人侧同一口径:0 项文案、全选范围、>10 二次确认
        for token in ("'已选 0 项'", '全选当前可见', "'（' + n + ' 项）'", 'cards.length > 10',
                      '一次选中', 'confirmLabel'):
            self.assertIn(token, self.snap_js)

    def test_snapshot_cards_carry_stable_url_and_local_override_write(self):
        # 删除按钮带原始 URL:访客不会用 pk 去猜服务端数据
        self.assertIn('class="site-del" data-id="{{ site.pk }}" data-url="{{ site.url }}"', self.card_tpl)
        # 快照编辑走 updateSnapshot(写本机覆盖),不走主人 AJAX
        self.assertIn('updateSnapshot(editOldUrl', self.mg_js)
        self.assertIn('编辑访客视图（只存本机）', self.mg_js)
        # 快照卡片分类标题有独立 span,便于本机重命名而不改服务端
        self.assertIn('class="nav-cat-name"', self.tpl)
        self.assertIn('.nav-cat-name', self.css)



class GuestScopeTests(TestCase):
    """游客页公开范围：public（全部未隐藏站点）/ builtin（仅内置站点）。"""

    def setUp(self):
        NavSite.objects.all().delete()
        NavCategory.objects.all().delete()
        NavPublicConfig.objects.all().delete()
        NavCategory.objects.create(name='内置网站', order=1, hidden=True)
        NavCategory.objects.create(name='工具', order=2)
        NavCategory.objects.create(name='私密', order=3, hidden=True)
        NavSite.objects.create(
            name='内置站', url='https://builtin.example.com/', category='内置网站',
            is_builtin=True,
        )
        NavSite.objects.create(
            name='自定义站', url='https://custom.example.com/', category='工具',
            description='自定义',
        )
        NavSite.objects.create(
            name='隐藏分类站', url='https://hidden.example.com/', category='私密',
        )
        NavSite.objects.create(
            name='休眠内置站', url='https://sleep-builtin.example.com/', category='内置网站',
            is_builtin=True, archived_at=timezone.now(),
        )

    def test_public_scope_excludes_hidden_and_archived(self):
        from .management.commands.export_nav_public import public_payload
        payload = public_payload(scope=NavPublicConfig.SCOPE_PUBLIC)
        self.assertEqual(payload['scope'], 'public')
        names = {row['name'] for row in payload['sites']}
        self.assertEqual(names, {'自定义站'})

    def test_builtin_scope_keeps_builtin_even_if_category_hidden(self):
        from .management.commands.export_nav_public import public_payload
        payload = public_payload(scope=NavPublicConfig.SCOPE_BUILTIN)
        self.assertEqual(payload['scope'], 'builtin')
        names = {row['name'] for row in payload['sites']}
        self.assertEqual(names, {'内置站'})
        self.assertEqual(payload['categories'], ['内置网站'])

    def test_api_switches_scope_and_regenerates_snapshot(self):
        with mock.patch('nav.signals.write_public_snapshot', return_value=True) as write:
            resp = self.client.post(
                reverse('api_nav_guest_scope'),
                data=json.dumps({'scope': 'builtin'}),
                content_type='application/json',
            )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['scope'], 'builtin')
        self.assertEqual(data['sites'], 1)
        self.assertEqual(NavPublicConfig.current().scope, 'builtin')
        write.assert_called_once_with(force=True)

    def test_api_rejects_invalid_scope(self):
        resp = self.client.post(
            reverse('api_nav_guest_scope'),
            data=json.dumps({'scope': 'nope'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(NavPublicConfig.current().scope, 'public')


class S1MenuAndLoginContractTests(TestCase):
    """S1 菜单结构与登录入口(2026-11-21):C1/C2/C4/C5/C6/C7/B6 静态契约。"""

    def setUp(self):
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.template = (Path(__file__).resolve().parent / 'templates' / 'nav' / 'nav_sites.html').read_text(encoding='utf-8')

    def test_owner_data_menu_split_into_server_and_local(self):
        # C1:主人「数据」拆 服务端数据 / 本机数据 两组,入口 id 与行为不动
        for label in ('服务端数据', '本机数据'):
            self.assertIn('nav-menu-label">%s</li>' % label, self.owner)
        self.assertNotIn('nav-menu-label">数据</li>', self.owner)
        for bid in ('navExportBtn', 'navImportBtn', 'navExportBookmarkBtn'):
            self.assertEqual(1, self.owner.count('id="%s"' % bid))

    def test_guest_add_button_copy_says_local(self):
        # C2:访客「添加站点」可见文案改「添加本机站点」,id/aria-label/tooltip 保留
        self.assertIn('id="navGuestAddBtn"', self.guest)
        self.assertIn('aria-label="添加本机站点"', self.guest)
        self.assertIn('<span>添加本机站点</span>', self.guest)
        self.assertNotIn('<span>添加站点</span>', self.guest)

    def test_guest_menu_merged_two_rows(self):
        # C5:统计/足迹 一行,保养/图标 一行;四个属性与 tooltip 全部保留
        for attr in ('data-nav-stats', 'data-nav-foot', 'data-nav-care', 'data-nav-localize-all'):
            self.assertIn(attr, self.guest)
        self.assertEqual(self.guest.count('<li class="d-flex gap-1'), 2)
        first_row = self.guest[self.guest.index('data-nav-stats'):self.guest.index('data-nav-stats') + 220]
        self.assertIn('data-nav-foot', first_row)
        second_row = self.guest[self.guest.index('data-nav-care'):self.guest.index('data-nav-care') + 220]
        self.assertIn('data-nav-localize-all', second_row)

    def test_guest_bookmark_json_label_drops_version(self):
        # C6:版本号字样去掉,格式常量与文件名不受影响
        self.assertIn('访客书签 JSON</button>', self.guest)
        self.assertNotIn('访客书签 JSON(v2)', self.guest)
        self.assertNotIn('打包成 v2 JSON', self.guest)

    def test_upload_icons_and_new_tips(self):
        # C7:两处上传工具图标换 fa-upload;导出书签/统计/足迹补 tooltip,说清数据侧
        self.assertIn('<i class="fas fa-upload"></i>上传工具', self.guest)
        self.assertIn('<i class="fas fa-upload"></i>上传工具', self.owner)
        self.assertNotIn('<i class="fas fa-screwdriver-wrench"></i>上传工具', self.guest)
        self.assertNotIn('<i class="fas fa-screwdriver-wrench"></i>上传工具', self.owner)
        self.assertIn('id="navGuestExportHtml" data-tip="浏览器收藏夹格式 HTML', self.guest)
        self.assertIn('data-nav-stats data-tip="本机书签的使用与点击统计', self.guest)
        self.assertIn('data-nav-foot data-tip="本机足迹的点击热力图', self.guest)
        self.assertIn('data-nav-foot data-tip="本机足迹的点击热力图', self.owner)

    def test_cmd_palette_hint_says_local(self):
        # B6:命令面板整包备份/恢复 hint 不再写 JSON,统一为本机口径
        js = (Path(__file__).resolve().parent / 'static' / 'js' / 'nav-cmd.js').read_text(encoding='utf-8')
        self.assertIn("title: '整包备份', hint: '本机'", js)
        self.assertIn("title: '整包恢复(本机)', hint: '本机'", js)
        self.assertNotIn("hint: 'JSON'", js)
