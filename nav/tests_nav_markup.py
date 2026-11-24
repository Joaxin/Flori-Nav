# nav/tests_nav_markup.py
"""前端结构回归(2026-11-12):卡片标签嵌套、子页 href、搜索框圆角、目录默认收起。

这些断言盯的都是"HTML 结构/默认值"本身,不依赖浏览器渲染:
结构一旦被改回去,Tab 顺序、Ctrl+点击、边框圆角会静默坏掉。
"""

import json
import pathlib
import re

from django.conf import settings
from django.test import TestCase
from django.urls import reverse

from .models import NavSite


def static_text(rel):
    return (pathlib.Path(settings.BASE_DIR) / 'nav' / 'static' / rel).read_text(encoding='utf-8')


def tpl_text(rel):
    return (pathlib.Path(settings.BASE_DIR) / 'nav' / 'templates' / rel).read_text(encoding='utf-8')


class NavCardMarkupTests(TestCase):
    def setUp(self):
        NavSite.objects.create(name='主站', url='https://main.example', category='测试',
                               subcat='', description='主站',
                               children=[{'name': '子页', 'url': 'https://sub.example'}])
        NavSite.objects.create(name='普通站', url='https://plain.example', category='测试',
                               subcat='', description='普通')

    def test_buttons_live_outside_the_link(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('site-card-box', html)
        # 找到第一张卡片,确认三个按钮出现在 </a> 之后
        start = html.find('site-card-box')
        chunk = html[start:start + 2600]
        close = chunk.find('</a>')
        self.assertGreater(close, 0)
        for cls in ('site-star', 'site-edit', 'site-del'):
            self.assertGreater(chunk.find(cls), close, cls + ' 应该排在 </a> 之后')

    def test_child_card_uses_real_href(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('data-has-sub="1"', html)
        self.assertIn('href="https://main.example"', html)
        self.assertNotIn('href="#"', html)

    def test_modifier_click_guard_exists(self):
        js = static_text('js/nav-sites.js')
        self.assertIn('ctrlKey', js)
        self.assertIn('metaKey', js)
        self.assertIn("addEventListener('click'", js)

    def test_third_level_toc_collapsed_by_default(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('hide-sub3', html)          # aside 首帧即带收起类
        js = static_text('js/nav-sites.js')
        # 2026-11-24:齿轮菜单也放了同一个开关,绑定改成 id 数组
        self.assertIn("bindTocSwitch(['#tocShowSub3', '#tocGearShowSub3'], 'navTocSub3', 'hide-sub3', false)", js)

    def test_toc_has_six_style_options(self):
        """2026-11-19:「卡片」删掉后,再新增「柔光 / 缎带」两种,目录共 6 档。"""
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for style in ('default', 'seeseed', 'timeline', 'pill', 'soft', 'ribbon'):
            self.assertIn('data-toc-style="%s"' % style, html)
        self.assertNotIn('data-toc-style="cards"', html)
        js = static_text('js/nav-sites.js')
        for cls in ('toc-style-timeline', 'toc-style-pill',
                    'toc-style-soft', 'toc-style-ribbon'):
            self.assertIn(cls, js)
        self.assertNotIn('toc-style-cards', js)
        css = static_text('css/nav-sites.css')
        self.assertNotIn('toc-style-cards', css)
        self.assertIn('.nav-toc.toc-style-soft .toc-item', css)
        self.assertIn('.nav-toc.toc-style-ribbon .toc-scroll > a::before', css)
        # 老浏览器里存过 'cards' 的要回落到默认,不留「哪个按钮都没选中」的状态
        self.assertIn("if (tocStyleSaved === 'cards')", js)


class SearchBoxMarkupTests(TestCase):
    """超级搜索框(2026-11-13):站内过滤与全网搜索合成一个入口。

    旧结构是 Bootstrap input-group 四段拼接(引擎 select | 输入 | 紫方块 | 尾巴的「+」),
    四个零件四种边角;现在是一整块 .nav-search,引擎选择退成文字按钮,
    「+ 添加搜索引擎」搬进下拉最后一行 —— 结构回退会让那些毛病一起回来。
    """

    def test_hidden_engine_input_stays_inside_the_form(self):
        tpl = tpl_text('nav/nav_sites.html')
        form = tpl.find('id="navWebSearch"')
        hidden = tpl.find('id="navEngineSel"')
        suggest = tpl.find('id="navSuggest"')
        self.assertGreater(form, 0)
        self.assertGreater(hidden, form)          # 取值落点仍在表单内
        self.assertGreater(suggest, form)         # 匹配面板挂在表单外层 wrap 里
        self.assertNotIn('input-group input-group-lg', tpl)

    def test_add_engine_button_lives_in_the_dropdown_not_the_tail(self):
        """「+」不再是框尾的独立方块:它在引擎下拉里,框尾只留一个内嵌箭头按钮。"""
        tpl = tpl_text('nav/nav_sites.html')
        menu = tpl.find('id="navEngineMenu"')
        add = tpl.find('id="navEngineAdd"')
        go = tpl.find('class="nav-search__go"')
        self.assertGreater(menu, 0)
        self.assertGreater(add, menu)             # 在菜单内部
        self.assertLess(go, menu)                 # 箭头按钮在菜单之前
        self.assertIn('nav-search__go', tpl)

    def test_placeholder_no_longer_teaches_the_other_box(self):
        """两个搜索框并用时,占位符只能靠长句教用户去看顶栏 —— 短到能读完才算合并完成。"""
        tpl = tpl_text('nav/nav_sites.html')
        # 2026-11-14 标点统一为全角,占位符随之变化
        self.assertIn('搜索站内书签，Enter 全网搜索', tpl)
        self.assertNotIn('站内过滤请用顶栏', tpl)

    def test_bootstrap_number_utilities_are_defined(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('.top-50', css)
        self.assertIn('.start-50', css)
        self.assertIn('.translate-middle', css)
        self.assertIn('top: 50% !important', css)
        self.assertIn('translate(-50%, -50%) !important', css)

    def test_dropdown_menu_radius_restored(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('.input-group > .dropdown-menu', css)


class SeedTagTests(TestCase):
    def test_every_builtin_site_has_tags(self):
        from .nav_data import DEFAULT_SITES
        for site in DEFAULT_SITES:
            self.assertTrue(site.get('tags'), site['name'] + ' 缺标签')
            self.assertLessEqual(len(site['tags']), 8)
        # 种子入库后标签应出现在页面上
        from .views_nav_base import _seed_nav_sites
        _seed_nav_sites()
        row = NavSite.objects.filter(url='https://chatgpt.com').first()
        self.assertTrue(row and row.tags)


class ExportNestingTests(TestCase):
    def test_third_level_becomes_nested_folders(self):
        NavSite.objects.create(name='三级站', url='https://nest.example', category='导出测试',
                               subcat='视频 / 图生视频')
        html = self.client.get(reverse('api_nav_export_bookmark')).content.decode('utf-8')
        a = html.index('<DT><H3>视频</H3>')
        b = html.index('<DT><H3>图生视频</H3>')
        c = html.index('https://nest.example')
        self.assertLess(a, b)
        self.assertLess(b, c)
        self.assertNotIn('<DT><H3>视频 / 图生视频</H3>', html)


class AddSiteKeepOpenTests(TestCase):
    def test_keep_open_control_exists(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="addSiteKeepOpen"', html)
        self.assertIn('保存后继续添加', html)
        self.assertIn('addSiteKeepOpen', static_text('js/nav-sites.js'))

class CardVirtualizationTests(TestCase):
    def test_offscreen_cards_skip_rendering(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('content-visibility: auto', css)
        self.assertIn('contain-intrinsic-size: auto 92px', css)
        # 大布局各自给回填高度,避免切布局后滚动条乱跳
        self.assertIn('.nav-hub.lyr-list .site-card-box', css)

class NoLeakedTemplateSyntaxTests(TestCase):
    def test_page_has_no_raw_template_markers(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertNotIn('{#', html)
        self.assertNotIn('{%', html)
        self.assertNotIn('{{', html)

class ScrollLockShiftTests(TestCase):
    def test_scrollbar_gutter_reserved(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('scrollbar-gutter: stable', css)

    def test_scroll_lock_compensates_padding(self):
        shim = (pathlib.Path(settings.BASE_DIR) / 'nav' / 'static' / 'bootstrap-shim.js').read_text(encoding='utf-8')
        self.assertIn('function lockScroll', shim)
        self.assertIn('function unlockScroll', shim)
        self.assertIn('navScrollPad', shim)

class CardMenuTests(TestCase):
    def test_right_click_menu_replaces_drag(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        js = static_text('js/card-menu.js')
        self.assertIn('js/card-menu.js', html)
        self.assertIn('navCardMenu', js)
        for act in ('pin-top', 'pin-bottom', 'up', 'down', 'edit', 'del', 'copy'):
            self.assertIn('data-act="%s"' % act, js)
        self.assertIn('/api/nav/site-order/pin/', js)
        self.assertIn('/api/nav/site-order/swap/', js)
        # 拖拽开关已移除
        self.assertNotIn('id="setDragSort"', html)

    def test_card_drag_is_disabled(self):
        js = static_text('js/stars-filter.js')
        self.assertIn('setNavDrag(false);', js)

class UrlDisplayAndImportDescTests(TestCase):
    def test_long_url_is_clipped_by_default(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('text-overflow: ellipsis', css)
        self.assertIn('.nav-hub.url-wrap .site-card .site-url', css)
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="setUrlMode"', html)
        self.assertIn('完整换行', html)

    def test_url_mode_setting_bound(self):
        js = static_text('js/nav-sites.js')
        self.assertIn('navUrlMode', js)
        self.assertIn("toggleClass('url-wrap'", js)

    def test_bookmark_import_reads_dd_description(self):
        js = static_text('js/import-export.js')
        self.assertIn("holder.textContent", js)
        self.assertIn('description: desc', js)
        self.assertIn("description: it.description || ''", js)

class BookmarkFallbackDescTests(TestCase):
    def test_chrome_export_gets_folder_fallback(self):
        js = static_text('js/import-export.js')
        self.assertIn("书签分类:", js)   # Chrome 导出没有 <DD>,用分类路径兜底
        self.assertIn("holder.textContent", js)

class FetchDescriptionTests(TestCase):
    def test_edit_form_has_fetch_description_button(self):
        js = static_text('js/nav-sites.js')
        self.assertIn('f-fetch-desc', js)
        self.assertIn('/api/nav/fetch-meta/', js)
        self.assertIn('res.description', js)


class ImportMetaToggleTests(TestCase):
    """导入时抓 meta description 是可选开关(2026-11-12):默认关,勾了才抓。"""

    def test_switch_lives_in_bookmark_preview(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="bmMetaWrap"', html)
        self.assertIn('id="bmFetchMeta"', html)
        self.assertIn('抓取网站简介', html)
        self.assertIn('fetchMeta', html)   # 抓取接口随 navIeUrls 配置下发

    def test_switch_defaults_off_and_is_remembered(self):
        js = static_text('js/import-export.js')
        # 没存过 → 不勾(默认不动网络);勾过的选择记在本机
        self.assertIn("localStorage.getItem('navBmFetchMeta') === '1'", js)
        self.assertIn("localStorage.setItem('navBmFetchMeta'", js)
        self.assertIn("$('#bmMetaWrap').toggleClass('d-none'", js)
        self.assertIn('bmMetaCount', js)   # 开关下面写明本次会抓多少条

    def test_fetch_runs_before_upload_and_feeds_payload(self):
        js = static_text('js/import-export.js')
        self.assertIn('bmFetchMetaAll', js)
        self.assertIn('IE_URLS.fetchMeta', js)
        self.assertIn('BM_META_CONCURRENCY', js)
        self.assertIn('BM_META_BUDGET_MS', js)          # 有总预算,不会无限期挂着
        self.assertIn("description: s.description || ''", js)   # 抓到的简介必须进 payload
        # 不勾开关就不抓:分支先判开关再决定是否进抓取流程
        self.assertIn("if (!$('#bmFetchMeta').prop('checked'))", js)


class ImportMergeAndProgressTests(TestCase):
    """导入预览:同域名合并询问、简介列、方框勾选、两段式进度、取消提示。"""

    def test_merge_prompt_exists(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for el in ('bmMergeWrap', 'bmMergeText', 'bmMergeGroup'):
            self.assertIn('id="%s"' % el, html)
        self.assertIn('合并为一个站点', html)
        self.assertIn('分类以第一次出现的那条为准', html)

    def test_merge_groups_by_registrable_domain(self):
        js = static_text('js/import-export.js')
        self.assertIn('bmHostKey', js)
        self.assertIn('BM_MULTI_SUFFIX', js)       # com.cn / co.uk 这类双段后缀
        self.assertIn('合并子页', js)
        self.assertIn('去掉重复', js)               # 文件内完全重复的网址只留第一条

    def test_preview_checkbox_is_square_and_has_desc_column(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('.bm-check {', css)
        self.assertIn('content: none !important', css)   # 干掉全局开关的白钮
        js = static_text('js/import-export.js')
        self.assertIn('bm-check', js)
        self.assertIn('bm-desc', js)
        self.assertIn('bmPaintDesc', js)

    def test_two_phase_progress_and_concurrency(self):
        js = static_text('js/import-export.js')
        self.assertIn('BM_META_CONCURRENCY = 2', js)          # 同步 WSGI 下别把 worker 占满
        self.assertIn('done * 50 / targets.length', js)        # 抓取占 0~50
        self.assertIn('bmBar(50 + done * 50 / total)', js)     # 入库占 50~100

    def test_cancel_and_budget_are_visible(self):
        js = static_text('js/import-export.js')
        self.assertIn("close('budget')", js)
        self.assertIn("showToast('已取消,未导入任何站点')", js)
        self.assertIn('还有 ', js)                              # 预算到点说明剩多少条没抓
        self.assertIn('bmAbortAll', js)


class UsedClassCoverageTests(TestCase):
    """模板里用到的类名,必须能在编译产物里找到规则。

    背景(2026-11-12):本站的 Bootstrap 样式是用 Tailwind `@apply` 自己实现的「兼容层」,
    不是官方 bootstrap.css。缺一个类不会报错 —— 只是那条样式静默不生效:
    `.text-truncate` 就这么漏了很久,直到长网址把导入预览的列顶歪才发现;
    补这道守卫时又扫出 8 个(progress / col-lg-3 / font-monospace ...),一并补齐了。

    规则:
      - 只扫 `class="..."` 的静态串;含 {{ }} / {% %} 的动态类名不在此列;
      - Font Awesome 图标类(`fa-*` / `fas` / `far` / `fab`)由 vendor 提供,跳过;
      - Tailwind 产物会把 `.` `/` `:` 等转义(`py-1.5` → `.py-1\\.5`),两种写法都认;
      - 改完 `assets/tailwind.css` 必须重新 `pnpm build:css`,否则这里会红 —— 这正是它的用处。
    """
    ICON = ('fa-', 'fas', 'far', 'fab')
    ESCAPED_CHARS = '.:/[]%#(),!'
    # 纯行为钩子:JS 用来取数/找节点,或者本身是 d-none 的数据容器,样式来自同元素上的
    # btn / basket-row 等类,不需要自己再有一条规则。
    HOOKS = {
        'cat-toggle', 'cat-move-top', 'cat-move-up', 'cat-move-down', 'cat-move-bottom',
        'site-subs', 'site-sub', 'site-alts', 'site-alt',
        'arch-row', 'arch-wake', 'nav-container',
    }

    @classmethod
    def _escaped(cls, tok):
        return ''.join(('\\' + ch) if ch in cls.ESCAPED_CHARS else ch for ch in tok)

    def test_every_used_class_has_a_rule(self):
        base = pathlib.Path(__file__).resolve().parent
        css = '\n'.join((base / 'static' / 'css' / name).read_text(encoding='utf-8')
                        for name in ('tailwind.gen.css', 'nav-sites.css'))
        missing = {}
        for path in (base / 'templates' / 'nav').rglob('*.html'):
            text = path.read_text(encoding='utf-8')
            # 游客页是自包含单页：样式写在页内 <style>，不依赖主站 CSS。
            # 对这类模板把自身的内联样式一起算进规则来源，否则会误报“未定义”。
            inline_css = '\n'.join(re.findall(r'(?s)<style[^>]*>(.*?)</style>', text))
            page_css = css + '\n' + inline_css
            for attr in re.finditer(r'class="([^"]*)"', text):
                raw = attr.group(1)
                if '{' in raw or '}' in raw:
                    continue                      # 动态类名:JS 里另有约定
                line = text[:attr.start()].count('\n') + 1
                for tok in raw.split():
                    if tok.startswith(self.ICON) or tok in self.HOOKS:
                        continue
                    if re.search(r'\.' + re.escape(tok) + r'(?![A-Za-z0-9_-])', page_css):
                        continue
                    if re.search(r'\.' + re.escape(self._escaped(tok)) + r'(?![A-Za-z0-9_-])', page_css):
                        continue
                    missing.setdefault(tok, []).append('%s:%d' % (path.name, line))
        self.assertFalse(
            missing,
            '这些类名在编译产物里没有规则(缺了不报错,只是样式不生效):\n'
            + '\n'.join('  .%s  ← %s' % (k, '、'.join(v[:3])) for k, v in sorted(missing.items())))


class NoBrowserTailwindTests(TestCase):
    """浏览器版 Tailwind 运行时(275 KB,页面内实时编译)已于 2026-11-12 删除。

    换成了预编译的 `css/tailwind.gen.css`(80 KB)。这条守卫防的是"哪天又把它挂回去":
    一旦回去,页面会重新变成运行时编译,首屏多 275 KB 且 FOUC 风险回来。
    """

    def test_file_gone_and_no_template_references_it(self):
        base = pathlib.Path(__file__).resolve().parent
        self.assertFalse((base / 'static' / 'tailwind.browser.js').exists(),
                         'tailwind.browser.js 已删除,不要在 static 里恢复')
        for path in (base / 'templates').rglob('*.html'):
            self.assertNotIn('tailwind.browser', path.read_text(encoding='utf-8'),
                             '%s 又引用了浏览器版 Tailwind' % path.name)

    def test_precompiled_css_is_the_one_loaded(self):
        base = pathlib.Path(__file__).resolve().parent
        self.assertIn('css/tailwind.gen.css',
                      (base / 'templates' / 'nav' / 'base.html').read_text(encoding='utf-8'))


class ToolbarDataMenuTests(TestCase):
    """导出 / 导入 / 导出书签 收进「数据」下拉(2026-11-12)。

    顶栏按钮太多,≤1280 时会折成三行(实测 139px)。三个动作收一个下拉省出约 200px,
    但按钮 id 保持不变 —— import-export.js 的绑定一行没动。
    """

    def test_three_actions_live_in_one_dropdown(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="navDataMenu"', html)
        for bid in ('navExportBtn', 'navImportBtn', 'navExportBookmarkBtn'):
            self.assertEqual(1, html.count('id="%s"' % bid))
            self.assertRegex(html, r'class="dropdown-item[^"]*" id="%s"' % bid)
        # 老的独立按钮样式不该再出现
        self.assertNotIn('btn-outline-secondary btn-sm text-nowrap" id="navExportBtn"', html)


class SettingsFormFactorTests(TestCase):
    """全部设置:抽屉 / 居中弹窗两态(2026-11-12)。

    刻意不新建一个 modal 实例 —— 设置面板里几十个控件、tab 记忆、委托绑定全挂在
    这个 offcanvas 上,换定位样式比换组件安全得多。
    """

    def test_toggle_group_lives_in_header(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="navSetFormGroup"', html)
        self.assertIn('data-set-form="drawer"', html)
        self.assertIn('data-set-form="center"', html)

    def test_center_mode_is_position_only(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('#navSettingsMenu.nav-set-center {', css)
        # 2026-11-14:translate 居中在有 filter/transform 的祖先里会算错包含块,
        # 面板会整块偏出屏幕左边;改成 inset:0 + margin:auto。
        self.assertIn('margin: auto', css)
        self.assertIn('width: min(980px, calc(100vw - 32px))', css)
        self.assertIn('#navSettingsMenu.nav-set-center .tab-content { max-width: 100%; }', css)
        js = static_text('js/nav-sites.js')
        self.assertIn("const key = 'navSetForm'", js)    # 选择存本机
        self.assertIn("nav-set-center", js)
        self.assertIn("data('set-form')", js)            # 按钮上的形态标记


class AiClassifyUiTests(TestCase):
    """AI 分类 + 标签的前端契约:只列建议调整的条目、每行一个采纳开关、没配接口走提示词。"""

    def test_toolbar_and_modal_exist(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        # 内联 onclick 已改为 data-on-click 委托(2026-11-14)
        self.assertIn('data-on-click="navAiClassifyOpen"', html)
        for el in ('navAiClassifyModal', 'nacScope', 'nacGo', 'nacManual', 'nacPaste', 'nacResult'):
            self.assertIn('id="%s"' % el, html)
        self.assertIn('js/ai-classify.js', html)
        self.assertIn('"apply":', html)      # 配置岛里五个接口都要在

    def test_js_only_lists_changes_with_adopt_toggle(self):
        js = static_text('js/ai-classify.js')
        self.assertIn('isChanged', js)            # 分类/小分类/标签任一不同才算变化
        self.assertIn('nac-adopt', js)            # 每行右边的采纳开关
        self.assertIn("'已采纳'", js)
        self.assertIn("'已忽略'", js)
        self.assertIn("'已忽略'", js)
        self.assertIn('已隐藏', js)               # 本来就对的不展示
        self.assertIn('ai_not_configured', js)    # 没配接口自动展开提示词模式
        self.assertIn('splitTags', js)            # 标签可手改,逗号/顿号都认

    def test_partial_results_survive_a_failed_batch(self):
        js = static_text('js/ai-classify.js')
        self.assertIn('批失败:', js)              # 标明是哪一批断的
        self.assertIn('前面的 ', js)              # 已跑完的批次照样列出来
        self.assertIn('applyRows(acc,', js)


class SiteMapDescriptionFlagTests(TestCase):
    def test_flag_marks_only_real_descriptions(self):
        """site_map 的 d 标记:只有真简介才算,兜底文案不算 —— 再次导入据此跳过抓取。"""
        NavSite.objects.create(name='真简介', url='https://real.example', category='测试',
                               description='真正的 meta 简介')
        NavSite.objects.create(name='兜底', url='https://fallback.example', category='测试',
                               description='书签分类:测试')
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        start = html.index('<script id="navSiteMap"')
        blob = html[start:html.index('</script>', start)]
        data = json.loads(blob[blob.index('>') + 1:])
        self.assertEqual(1, data['https://real.example'].get('d'))
        self.assertNotIn('d', data['https://fallback.example'])


class RadiusTokenTests(TestCase):
    """圆角只能来自 --nav-r-* 四档(2026-11-13)。

    改之前全站散着 11 个圆角值,同一张卡片在四种布局里是 12/10/14/14 —— 单看都不丑,
    摆在一起就是"不齐"。这条守卫盯两件事:变量还在、裸数值没回来。
    """

    def test_tokens_are_defined(self):
        css = static_text('css/nav-sites.css')
        for tok in ('--nav-r-xs: 4px', '--nav-r-sm: 8px', '--nav-r-md: 12px',
                    '--nav-r-lg: 16px', '--nav-r-pill: 999px'):
            self.assertIn(tok, css)

    def test_no_raw_pixel_radius_left(self):
        css = static_text('css/nav-sites.css')
        # 0 / 50% 不是档位;var(--bs-border-radius-lg, .5rem) 是 Bootstrap 自带的回退值
        bad = []
        for m in re.finditer(r'border(?:-[a-z]+)*-radius\s*:\s*([^;]+);', css):
            val = m.group(1).strip()
            if 'var(' in val or val in ('0', '50%'):
                continue
            if re.search(r'\d+(?:\.\d+)?(?:px|rem)', val):
                bad.append('%d: %s' % (css.count('\n', 0, m.start()) + 1, val))
        self.assertFalse(bad, '这些圆角还是裸数值,请换成 --nav-r-*:\n' + '\n'.join(bad))

    def test_same_object_shares_one_radius(self):
        """六档布局(2026-11-23 回迁):card/icon/list/mag/min/cols 圆角档位都在。"""
        css = static_text('css/nav-sites.css')
        js = static_text('js/nav-sites.js')
        self.assertIn('.site-card { border: 1px solid var(--bs-border-color); border-radius: var(--nav-r-md)', css)
        self.assertIn('.nav-hub.lyr-icon .site-card { border-color: transparent; background: transparent; text-align: center; padding: 14px 10px 12px; border-radius: var(--nav-r-lg)', css)
        self.assertIn('.nav-hub.lyr-list .site-card {', css)
        # 回迁的三档也使用同一套圆角 token(不再写裸数值)
        for restored in ('lyr-mag', 'lyr-min', 'lyr-cols'):
            self.assertIn(restored, css)
        self.assertIn('.nav-hub.lyr-mag .site-card { padding: 16px 18px; border-radius: var(--nav-r-lg)', css)
        self.assertIn('NAV_LAYOUT_SURVIVORS', js)
        self.assertIn("['card', 'icon', 'list', 'mag', 'min', 'cols']", js)

    def test_icon_layout_puts_icon_above_name(self):
        """2026-11-19 修「大图标:白方块大小不一、站名跑到块外」:
        favicon 外面包着 .site-favwrap 且整个塞在 .site-name 里 —— 只把 .site-fav
        改 block 没用,包装盒仍是行内盒,图标和站名挤在同一行、长名被卡片宽度裁掉。
        这里锁住「包装盒块级居中 + 站名自己起一行 + 站名单独裁两行」。
        """
        css = static_text('css/nav-sites.css')
        for frag in ('.nav-hub.lyr-icon .site-card .site-favwrap { display: block;',
                     '.nav-hub.lyr-icon .site-card .site-name { display: block;',
                     '.nav-hub.lyr-icon .site-card .site-title {'):
            self.assertIn(frag, css)
        title = css.split('.nav-hub.lyr-icon .site-card .site-title {', 1)[1].split('}', 1)[0]
        self.assertIn('-webkit-line-clamp: 2;', title)
        # 皮肤(纸质/极光/夜间)用 !important 刷 .site-card 实底,大图标得有一条后置覆盖压回去;
        # 夜间皮肤选择器带 html[data-bs-theme] + body[data-nav-theme],覆盖也必须带同样前缀才压得住。
        self.assertIn('html[data-bs-theme] body .nav-hub.lyr-icon .site-card,', css)
        self.assertIn('html[data-bs-theme] body[data-nav-theme] .nav-hub.lyr-icon .site-card {', css)
        self.assertIn('background: transparent !important;', css)

    def test_card_rests_without_shadow(self):
        """分层靠边框:默认态不再挂阴影(89 张卡片叠起来会糊成一片灰)。"""
        css = static_text('css/nav-sites.css')
        self.assertIn('.nav-hub .site-card { box-shadow: none; }', css)


class AccentColorContractTests(TestCase):
    """强调色只能走 --accent / --nav-accent 变量体系(2026-11-18)。

    起因:用户标签 chips 硬编码 rgba(88,80,236,*) 靛蓝,日落等未定义
    --nav-accent 的主题上整排蓝紫胶囊 —— 「换肤换一半」。这条守卫盯两件事:
    chips 徽章规则必须走 color-mix(var(--accent)),以及那批硬编码不再回来。
    """

    def test_chip_rules_follow_accent(self):
        css = static_text('css/nav-sites.css')
        chip = css.split('.site-tagchip {', 1)[1].split('}', 1)[0]
        self.assertIn('color-mix(in srgb, var(--accent)', chip)
        self.assertNotIn('rgba(88, 80, 236', chip)
        badge = css.split('.nav-hub .site-tag {', 1)[1].split('}', 1)[0]
        self.assertIn('color-mix(in srgb, var(--accent)', badge)

    def test_no_legacy_indigo_left(self):
        css = static_text('css/nav-sites.css')
        self.assertNotIn('rgba(88, 80, 236', css)
        self.assertNotIn('rgba(88,80,236', css)

    def test_modal_panels_are_opaque_in_translucent_themes(self):
        """弹层实底契约(2026-11-18):半透明 body-bg 的主题(日落/水墨/极光)必须给
        modal/dropdown 实底、给 --bs-offcanvas-bg —— 否则页面卡片透进弹窗。"""
        css = static_text('css/nav-sites.css')
        for theme, panel in (('sunset', 'background: #fff8f2'), ('ink', 'background: #fbf7ee'),
                             ('aurora', 'background: #111a2d')):
            seg = css.split('body[data-nav-theme="%s"] .modal-content' % theme, 1)[1].split('}', 1)[0]
            self.assertIn(panel, seg, theme)
            self.assertIn('--bs-offcanvas-bg:', css.split('body[data-nav-theme="%s"] {' % theme, 1)[1].split('}', 1)[0], theme)

    def test_light_skins_have_night_variants(self):
        """2026-11-19 用户报「明暗没用」:浅色皮肤在 body 上覆盖 token 并刷浅色纸面,
        把深色档压掉了。浅色皮肤各要给一套夜间表面;极光本身是暗色皮肤,不参与。"""
        css = static_text('css/nav-sites.css')
        for theme in ('paper', 'sunset', 'ink', 'plain', 'study'):
            sel = 'html[data-bs-theme="dark"] body[data-nav-theme="%s"] {' % theme
            self.assertIn(sel, css, theme)
            seg = css.split(sel, 1)[1].split('}', 1)[0]
            self.assertIn('--bs-body-bg:', seg, theme)
            self.assertNotIn('#fff', seg.lower(), theme)
        self.assertNotIn('html[data-bs-theme="dark"] body[data-nav-theme="aurora"] {', css)


class MediaRowLayoutTests(TestCase):
    """列表布局 = 媒体行:左 40px 封面 + 右两行(站名 / 简介或域名)。"""

    def test_card_has_title_and_meta_spans(self):
        NavSite.objects.create(name='豆包', url='https://www.doubao.com', category='测试',
                               description='字节的 AI 助手')
        NavSite.objects.create(name='无简介', url='https://www.kimi.com', category='测试')
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('<span class="site-text"><span class="site-title">豆包</span>', html)
        self.assertIn('<span class="site-meta">字节的 AI 助手</span>', html)
        # 没简介时副标题落回主机名,而且要去掉 www.(副标题位置窄, www. 是纯占位)
        self.assertIn('<span class="site-title">无简介</span><span class="site-meta">kimi.com</span>', html)

    def test_host_property_strips_www(self):
        self.assertEqual('doubao.com', NavSite(url='https://www.doubao.com/a/b').host)
        self.assertEqual('', NavSite(url='').host)

    def test_meta_is_hidden_outside_list_layout(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('.site-card .site-meta { display: none; }', css)     # 其他布局不多一行
        self.assertIn('.nav-hub.lyr-list .site-card .site-meta { display: block;', css)

    def test_list_row_is_a_media_row(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('.nav-hub.lyr-list .site-card .site-fav { flex: 0 0 40px; width: 40px; height: 40px;', css)
        self.assertIn('.nav-hub.lyr-list .site-card .site-name { display: flex; align-items: center; gap: 10px;', css)
        self.assertIn('minmax(320px, 1fr)', css)          # 左边多了封面,列宽跟着抬
        self.assertIn('contain-intrinsic-size: auto 60px', css)



class NavTooltipDropdownTests(TestCase):
    """统一 Tooltip 与下拉菜单的共存契约(2026-11-13)。

    气泡是 fixed + z-index 2200,菜单就落在按钮正下方 —— 两者不打招呼就会叠在一起
    ("tooltip 和下拉列表打架")。这里把四条规矩钉住:
      1. 下拉展开/收起/弹窗关闭时,气泡先收;
      2. 自己的菜单开着时,触发器不再弹气泡;
      3. 菜单条目自带 data-tip 的改放左右两侧,不压菜单行;
      4. 右键(卡片菜单)先让位;鼠标点出来的焦点不弹气泡。
    """

    def test_tooltip_yields_to_dropdown_events(self):
        js = static_text('js/nav-tip.js')
        self.assertIn("'show.bs.dropdown'", js)
        self.assertIn("'hide.bs.dropdown'", js)
        self.assertIn("'hide.bs.modal'", js)
        self.assertIn("'contextmenu'", js)

    def test_tooltip_suppressed_while_own_menu_open(self):
        js = static_text('js/nav-tip.js')
        self.assertIn('menuOpenFor', js)
        self.assertIn('.dropdown-menu', js)
        self.assertIn('suppressed', js)

    def test_menu_items_get_side_placement(self):
        js = static_text('js/nav-tip.js')
        self.assertIn('inMenu', js)
        self.assertIn("'is-right'", js)
        self.assertIn("'is-left'", js)
        self.assertIn('--tip-arrow-y', js)
        css = static_text('css/nav-sites.css')
        self.assertIn('.nav-tip.is-right::after', css)
        self.assertIn('.nav-tip.is-left::after', css)

    def test_mouse_focus_does_not_pop_tooltip(self):
        js = static_text('js/nav-tip.js')
        self.assertIn('lastPointerAt', js)
        self.assertIn("addEventListener('pointerdown'", js)

    def test_switching_anchor_does_not_refade(self):
        """沿工具栏换目标时直接搬位置,不重新淡入(否则一划满屏闪)。"""
        js = static_text('js/nav-tip.js')
        self.assertIn('switching', js)


class BackgroundFxVisibilityTests(TestCase):
    """背景特效层必须"真看得见"(2026-11-14 回归)。

    历史问题:杂志主题的 --fx-a 被写成 none、--fx-b 只剩 alpha .10,而且圆心写在
    纵向 6% —— 伪元素 inset:-18%,圆心按伪元素算,已经跑到屏幕上方,屏幕上只剩渐变尾巴。
    结果:开关一直显示"开",但开关一开一关页面像素差 <8/255,用户理解为"背景特效没用"。
    这里把"看得见"写成可断言的契约,防止下次换肤又把它调成空气。
    """

    # 2026-11-18 主题收敛 11→7(退役 glass/ocean/candy/editorial),在役 5 套带皮肤变量
    THEMES = ['aurora', 'paper', 'sunset', 'ink', 'study']

    def _fx_css(self):
        """只取「背景特效层」那一节:同样的 body[data-nav-theme=x] 选择器在文件前半段
        还有一份(配色的),那里面没有 --fx-*。"""
        css = static_text('css/nav-sites.css')
        self.assertIn('背景特效层', css)
        return css.split('背景特效层', 1)[1].split('卡片右键菜单样式见', 1)[0]

    def _block(self, theme):
        css = self._fx_css()
        sel = 'body[data-nav-theme="%s"] {' % theme
        self.assertIn(sel, css, theme)
        return css.split(sel, 1)[1].split('}', 1)[0]

    def _alpha(self, seg, var):
        """取某一层的 alpha;纹理类(repeating-linear-gradient)本来就是极淡底纹,
        不参与"光斑浓度"这条线,返回 None 由调用方跳过。"""
        decl = re.search(var + r':([^;]*)', seg)
        self.assertIsNotNone(decl, '%s 缺失: %s' % (var, seg))
        value = decl.group(1)
        if 'radial-gradient' not in value:
            return None
        m = re.search(r'rgba\([^)]*?,\s*([\d.]+)\s*\)', value)
        self.assertIsNotNone(m, '%s alpha 解析失败: %s' % (var, value))
        return float(m.group(1))

    def test_every_theme_keeps_two_fx_layers(self):
        for theme in self.THEMES:
            seg = self._block(theme)
            self.assertIn('--fx-a:', seg, theme)
            self.assertIn('--fx-b:', seg, theme)
            self.assertNotIn('--fx-a: none', seg, theme)

    def test_layer_opacity_is_not_air(self):
        """两层 alpha 都不低于 0.12(深色墨晕靠色相拉对比,故不按同一档卡);
        (杂志的 0.18 专档随主题退役删除,2026-11-18。)"""
        for theme in self.THEMES:
            seg = self._block(theme)
            for var in ('--fx-a', '--fx-b'):
                alpha = self._alpha(seg, var)
                if alpha is None:
                    continue
                self.assertGreaterEqual(alpha, 0.12, '%s/%s' % (theme, var))

    def test_fx_center_stays_on_screen(self):
        """圆心纵向 ≥ 10%:伪元素 inset 是 -18%,圆心按伪元素算,写 6% 已在视口上方。
        (纹理类配方没有圆心,跳过。)"""
        for theme in self.THEMES:
            seg = self._block(theme)
            for var in ('--fx-a', '--fx-b'):
                m = re.search(var + r':[^;]*at\s+([\d.]+)%\s+(-?[\d.]+)%', seg)
                if m is None:
                    continue
                x, y = float(m.group(1)), float(m.group(2))
                self.assertGreaterEqual(y, 10, '%s/%s 圆心在屏幕外' % (theme, var))
                self.assertGreaterEqual(x, 5, '%s/%s 圆心在屏幕外' % (theme, var))

    def test_drift_amplitude_is_perceptible(self):
        """关键帧总位移 ≥ 5%:旧版 ±2%/52s,一秒挪不到 1px,体感就是静止。"""
        css = static_text('css/nav-sites.css')
        block = css.split('@keyframes navFxDrift', 1)[1][:400]
        nums = [float(n) for n in re.findall(r'translate3d\(\s*(-?[\d.]+)%', block)]
        self.assertGreaterEqual(len(nums), 2)
        self.assertGreaterEqual(max(nums) - min(nums), 5)


class DGroupStructureTests(TestCase):
    """D 组结构层回归(2026-11-21):模板结构 / 最小结构 CSS / 条件渲染。
    只盯 HTML 与 CSS 静态文本,不依赖浏览器渲染;脚本流负责的行为不在此断言。"""

    def setUp(self):
        NavSite.objects.create(name='主站', url='https://main.example', category='测试', description='主站')

    # ---- D1 添加站点弹窗:标签区无纵向滚动,简介 / 三级分类独占整行 ----
    def test_tag_cloud_has_no_inline_scroll(self):
        html = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        m = re.search(r'<div id="navTagCloudList"[^>]*>', html)
        self.assertIsNotNone(m, '标签云容器缺失')
        self.assertNotIn('overflow', m.group(0))
        self.assertNotIn('max-height', m.group(0))

    def test_desc_and_subcat2_break_to_full_row(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('.col-2:has(.f-subcat2)', css)
        self.assertIn('.col-4:has(.f-desc)', css)

    # ---- D2 权限边界:访客态隐藏维护 Tab 与管理员开关;文案分区 ----
    def test_guest_hides_maintenance_tab_and_admin_switches(self):
        guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertNotIn('id="tabBtn-sort"', guest)
        self.assertNotIn('id="navFavLocalBtn"', guest)
        self.assertNotIn('id="navResetBtn"', guest)
        self.assertNotIn('id="navGuestScope"', guest)

    def test_owner_keeps_maintenance_admin(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="tabBtn-sort"', owner)
        self.assertIn('id="navFavLocalBtn"', owner)
        self.assertIn('id="navResetBtn"', owner)

    def test_mode_copy_boundary_labels(self):
        guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.assertIn('访客模式（本机暂存）', guest)
        self.assertIn('严格只读', guest)
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('管理员系统维护', owner)

    # ---- D3 入口瘦身:排列只留三档;导入导出归一个菜单 ----
    def test_layout_group_keeps_six_presets(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        for preset in ('card', 'icon', 'list', 'mag', 'min', 'cols'):
            self.assertIn('data-layout="%s"' % preset, owner)

    def test_import_export_one_menu(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="navDataMenu"', owner)

    # ---- D4 壁纸死胡同:清除按钮 + 图源 / 上传区单组 ----
    def test_wallpaper_clear_and_source_block(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="navBgClear"', owner)
        self.assertIn('class="nav-wall-source"', owner)
        theme_js = static_text('js/theme.js')
        self.assertIn('window.navClearWallpaper', theme_js)

    # ---- D5 设置布局:展开折叠收进目录齿轮;目录子项 data 钩子;拖拽手柄;无源码黑话 ----
    def test_expand_collapse_in_toc_gear(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('id="navExpandAll"', owner)
        self.assertIn('id="navCollapseAll"', owner)
        # 2026-11-23:用户嫌内容区顶部那排按钮碍眼,整组搬进目录齿轮;主区不再有 bar
        self.assertNotIn('nav-groups-bar', owner)
        gear_seg = owner.split('id="tocGearMenu"', 1)[1].split('id="tocGearMore"', 1)[0]
        self.assertIn('id="navExpandAll"', gear_seg)
        self.assertIn('id="navCollapseAll"', gear_seg)
        # 不在「布局」设置页内
        content_seg = owner.split('id="setTabContent"', 1)[1].split('id="setTabSort"', 1)[0]
        self.assertNotIn('id="navExpandAll"', content_seg)
        self.assertNotIn('id="navCollapseAll"', content_seg)

    def test_toc_child_hooks_present(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('data-toc-child', owner)

    def test_order_row_has_drag_handle(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('cat-order-handle', owner)

    def test_no_source_path_jargon(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertNotIn('nav/nav_data.py', owner)
        self.assertNotIn('DEFAULT_SITES', owner)

    # ---- D6 主区栅格容器类 ----
    def test_grid_container_classes(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('class="nav-cols" id="navGroups"', owner)

    # ---- D7 多选:复选框定位 + 操作簇让位 CSS ----
    def test_bulk_checkbox_and_action_cluster_css(self):
        css = static_text('css/nav-sites.css')
        self.assertIn('body.bulk-mode .site-bulk-check', css)
        self.assertIn('body.bulk-mode .site-card-box .site-edit', css)

    # ---- D8 表单:识别标题/图标 与 简介抓取 职责边界说明 ----
    def test_form_fetch_boundary_note(self):
        owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.assertIn('「识别标题/图标」只回填名称与图标', owner)


class NavCatDragOrderTests(TestCase):
    """#13 分类拖拽排序:≥2 个可见分类;接口换位 → 刷新保持;手柄与 #7 箭头兜底静态断言。

    浏览器拖拽由 initCatOrderDrag(nav-sites.js)走 HTML5 draggable 委托;本测试用测试客户端
    直连现有排序接口模拟「拖完松手落库 → 重新读取页面」的链路,不碰真实库数据。
    """

    def setUp(self):
        from .views import _seed_nav_sites
        from .models import NavSite
        _seed_nav_sites()
        NavSite.objects.create(name='我的收藏', url='https://mine.example', category='我的收藏')

    def _post_order(self, payload):
        return self.client.post(reverse('nav_category_order'), data=json.dumps(payload),
                                content_type='application/json')

    def _categories(self):
        page = self.client.get(reverse('nav_sites'))
        self.assertEqual(200, page.status_code)
        return [g['category'] for g in page.context['groups']]

    def test_drag_swap_persists_after_refresh(self):
        cats = self._categories()
        self.assertGreaterEqual(len(cats), 2)
        swapped = [cats[1], cats[0]] + cats[2:]
        self.assertEqual(200, self._post_order({'order': swapped}).status_code)
        refreshed = self._categories()
        self.assertEqual(swapped, refreshed)

    def test_template_keeps_drag_handle_and_arrows(self):
        tpl = tpl_text('nav/nav_sites.html')
        # 主人端排序行 + 访客本机排序行各一个手柄
        self.assertGreaterEqual(tpl.count('cat-order-handle'), 2)
        # #7 箭头兜底保留,不许删
        for cls in ('cat-move-top', 'cat-move-up', 'cat-move-down', 'cat-move-bottom'):
            self.assertIn(cls, tpl)
        js = static_text('js/nav-sites.js')
        self.assertIn('initCatOrderDrag', js)
        self.assertIn('navCatOrder', js)
