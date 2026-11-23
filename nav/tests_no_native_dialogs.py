"""护栏:nav 前端不许再有浏览器原生弹窗(2026-10-30 全站下线 alert/confirm/prompt)。

为什么单独一个文件:`nav/tests.py` 是这个 app 的主契约测试,别的会话会同时改它;
这道闸只管一件事——"用户可见的反馈必须留在页面里",所以放新文件,免得两边撞车。

三条规矩(改任何 nav 前端都要守住):
1. nav 的模板与 `static/js/*.js` 里不许出现原生 `alert(...)` / `confirm(...)` / `prompt(...)`
   调用(`$('.alert').alert('close')` 这种 Bootstrap 插件调用不算,正则已排除前导点号;
   注释里写"替代 confirm()"是给人看的说明,也不算调用);
2. 提示走 `window.navToast`,破坏性且**不可恢复**的动作走 `window.navConfirm`——
   这层自制遮罩 + 卡片,不借 Bootstrap Modal(垫片的事件面有限),文案一律走 textContent;
3. **能撤销的动作不许问**:删站点(单条与批量)都直接执行,做完给一条带「撤销」的提示。
"""
import re
from pathlib import Path
from django.test import SimpleTestCase

NAV_DIR = Path(__file__).resolve().parent
TEMPLATE_FILES = [NAV_DIR / 'templates' / 'nav' / 'nav_sites.html',
                  NAV_DIR / 'templates' / 'nav' / 'base.html']
JS_FILES = [NAV_DIR / 'static' / 'bootstrap-shim.js'] + sorted((NAV_DIR / 'static' / 'js').glob('*.js'))

# 两种写法都要抓到:裸 `alert(` / `confirm(` / `prompt(`(前面不能是点号或字母数字,否则
# `$('.alert').alert('close')` 这种 Bootstrap 插件调用与 `navConfirm(` 会误伤),
# 以及显式限定名 `window.alert(` / `window.confirm(` / `window.prompt(`。
NATIVE_DIALOG = re.compile(
    r'(?:(?<![.\w])(?:alert|confirm|prompt)\b|\b(?:window|self|top|parent|globalThis)\s*\.\s*(?:alert|confirm|prompt)\b)\s*\(')
# 注释里的"confirm()"是说明文字不是调用,判之前先摘掉(`//` 前是 `:` 的多半是 http:// 协议串)。
LINE_COMMENT = re.compile(r'(?<!:)//[^\n]*')
HTML_COMMENT = re.compile(r'<!--.*?-->')


def _code_lines(text):
    """[(行号, 摘掉注释后的该行)],给扫描器用——注释不参与判定。"""
    out = []
    for lineno, line in enumerate(text.splitlines(), 1):
        body = HTML_COMMENT.sub('', LINE_COMMENT.sub('', line)).strip()
        if body:
            out.append((lineno, body))
    return out


def _read(path):
    assert path.exists(), '护栏要盯的文件不见了:' + path.name
    return path.read_text(encoding='utf-8')


def _page():
    """nav_sites.html 源文件(不是渲染产物):这道闸查的是"代码里有没有写原生弹窗",
    渲染产物里会混进站点名/简介等用户数据,拿它做正则容易假阳/假阴。"""
    # 2026-11-07 样式外置:检查目标 = 模板源码 + 它引用的 CSS(别让 assertIn 漏掉样式)
    return (_read(NAV_DIR / 'templates' / 'nav' / 'nav_sites.html')
            + _read(NAV_DIR / 'static' / 'css' / 'nav-sites.css')
            + _read(NAV_DIR / 'static' / 'js' / 'nav-sites.js'))


def _slice(text, start_marker, end_marker):
    """按锚点取一段处理器源码(本项目的教训:定位靠字符串锚点,别信行号)。"""
    i = text.index(start_marker)
    j = text.index(end_marker, i)
    return text[i:j]


class NavNoNativeDialogsTests(SimpleTestCase):
    def test_no_native_dialog_calls_left(self):
        """全站扫描:模板 + 垫片 + 每一个拆分出去的 js 文件(注释不参与判定)。"""
        offenders = []
        for path in TEMPLATE_FILES + JS_FILES:
            for lineno, body in _code_lines(_read(path)):
                if NATIVE_DIALOG.search(body):
                    offenders.append('%s:%d %s' % (path.name, lineno, body[:80]))
        self.assertEqual([], offenders, 'nav 里又出现原生弹窗调用:\n' + '\n'.join(offenders))

    def test_detector_itself_works(self):
        """探测器自测:防止以后有人把上面那条正则改钝,让第 1 条测试空转永远绿。"""
        for should_hit in ("alert('x')", "if (!confirm('a')) return;", "window.alert('x')",
                           "window.confirm('a')", "var s = prompt('怎么改?')",
                           "window.prompt('x')"):
            self.assertTrue(NATIVE_DIALOG.search(should_hit), '漏抓原生弹窗:' + should_hit)
        for should_miss in ("$('.alert').alert('close')", "navConfirm({title: 'x'})",
                            "navPrompt({title: 'x'})", "showToast('a')",
                            "className='alert alert-danger'",
                            "// 原生 alert 已全站下线"):
            self.assertFalse(NATIVE_DIALOG.search(should_miss), '误伤:' + should_miss)
        # 注释整行不参与判定:以后谁在注释里写"替代 confirm()"不该把闸跑红
        self.assertEqual([], [x for x in _code_lines('// 替代 confirm() 的写法')
                              if NATIVE_DIALOG.search(x[1])])

    def test_scan_actually_covers_the_split_modules(self):
        """防"文件改名导致扫描空转":被拆出去的 js 必须真在扫描清单里。"""
        names = {p.name for p in JS_FILES}
        for expected in ('find-ai.js', 'theme.js', 'batch.js', 'pet.js', 'bootstrap-shim.js'):
            self.assertIn(expected, names)
        self.assertGreaterEqual(len(JS_FILES), 8)

    def test_nav_confirm_layer_defined_and_public(self):
        """页内确认层:自制 fixed 遮罩(压过弹窗 1055 与 toast 1090)、默认焦点在「取消」、
        Esc 与点遮罩都算取消、文案走 textContent、减少动效下不做动画。"""
        page = _page()
        for marker in ('function navConfirm(',
                       "window.navConfirm = navConfirm;",          # 拆分模块经 window 取用
                       "card.setAttribute('role', 'alertdialog')",
                       'title.textContent = opts.title',
                       'p.textContent = String(opts.body)',
                       'cancel.textContent = opts.cancelLabel',
                       'cancel.focus();',                          # 回车不许顺手确认破坏性动作
                       "if (event.key !== 'Escape') return;",
                       'if (event.target === back) finish(false)',  # 点遮罩 = 取消
                       'previous.focus();',                         # 关闭后焦点还给触发它的按钮
                       'nav-confirm-back',
                       'z-index: 1100',
                       'prefers-reduced-motion'):
            self.assertIn(marker, page, 'navConfirm 层少了这一块:' + marker)
        self.assertNotIn('innerHTML', _slice(page, 'function navConfirm(', 'window.navConfirm = navConfirm;'))

    def test_site_delete_does_not_ask_but_offers_undo(self):
        """单条删站点:不问,直接删;撤销必须真接上 nav_restore(不是只剩一句提示)。"""
        page = _page()
        block = _slice(page, "on('click', '.site-del'", "on('click', '.tool-edit'")
        self.assertNotIn('navConfirm(', block, '能撤销的动作不该再问用户')
        for marker in ("label: '撤销'", 'ms: 8000', "NAV_SITE_URLS.restore", 'data: JSON.stringify({site: row})'):
            self.assertIn(marker, block, '删站点的撤销链路断了:' + marker)

    def test_tool_delete_asks_through_the_in_page_layer(self):
        """工具删除没有恢复通道(文件一起从库里移除),这道确认必须留着——但走页内层。"""
        page = _page()
        block = _slice(page, "on('click', '.tool-del'", 'let catUrls')
        self.assertIn('navConfirm({', block)
        self.assertIn('danger: true', block)
        self.assertIn('不能恢复', block)
        # 确认之后的请求与刷新时机一个字都不许改
        self.assertIn("NAV_SITE_URLS.toolDelete", block)
        self.assertIn('data: JSON.stringify({id: $btn.data(\'id\')})', block)

    def test_batch_delete_asks_nobody_and_keeps_its_undo(self):
        """批量删除同样是可撤销动作:不问,直接跑;撤销逐条 POST /api/nav/restore/ 整行建回。
        (页面刷新时机维持原样,本轮没动。CSRF 头经 window 现取——缺头会 403,撤销就成空话。)"""
        js = _read(NAV_DIR / 'static' / 'js' / 'batch.js')
        click = _slice(js, "querySelector('#navMsGoDel')", "querySelector('#navMsCancel')")
        self.assertIn("runBatch({action: 'delete'", click)
        undo = _slice(js, "label: '全部撤销'", '// 多选模式下点卡片')
        for marker in ("'/restore/'", 'JSON.stringify({site: row})', 'typeof window.navCsrf'):
            self.assertIn(marker, undo, '批量删除的撤销链路断了:' + marker)

    def test_split_modules_reach_the_toast_through_window_with_a_guard(self):
        """拆分模块的边界铁律:主闭包里的 showToast 是加载期快照,判存必须走 window,
        裸引用闭包局部名会恒 false 静默失效(本项目反复踩过)。"""
        for name in ('find-ai.js', 'theme.js'):
            js = _read(NAV_DIR / 'static' / 'js' / name)
            self.assertIn('if (window.navToast)', js, name + ' 的提示没有走带守卫的 window.navToast')
            self.assertIn("console.warn", js, name + ' 缺兜底落点')


class NavNoNativeDialogsTextTests(SimpleTestCase):
    """提示文案一个字都不许因为换通道而被改写空话。"""

    def test_replaced_messages_kept_their_actionable_wording(self):
        ai = _read(NAV_DIR / 'static' / 'js' / 'find-ai.js')
        for msg in ('请先粘贴 AI 的回复', '未勾选任何候选', '导入请求失败'):
            self.assertIn(msg, ai)
        theme = _read(NAV_DIR / 'static' / 'js' / 'theme.js')
        for msg in ('图片请小于 3MB(只存本机浏览器)', '图片太大,本机存不下,请换小图'):
            self.assertIn(msg, theme)
