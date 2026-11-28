/* 导航站点页脚本(2026-11-07 从 nav_sites.html 的内联 <script> 抽出,逻辑原样)。
 *
 * 唯一改动:9 处 {% url %} 改为从 #navSiteUrls 配置块读取(与页内 navCatUrls /
 * navThemeUrls 等同一套写法)。**不包 IIFE**:原脚本的函数是全局的,页内多处
 * onclick="..." 直接按名字调用,包起来会静默失效。
 */
const NAV_SITE_URLS = JSON.parse(document.getElementById('navSiteUrls').textContent);
// 整页空态时,服务端把「有站点但被隐藏的分类」名单放在这里;其它情况是空数组。
const NAV_HIDDEN_CATS = (() => {
    const el = document.getElementById('navHiddenCats');
    if (!el) return [];
    try { return JSON.parse(el.textContent) || []; } catch (e) { return []; }
})();


$(function() {
    function csrf() { return document.cookie.split('; ').find(row => row.startsWith('csrftoken='))?.split('=')[1]; }
    window.navCsrf = csrf;                     // 桌宠等拆分模块经 window 取用(pet.js 边界约定)
    let toastTimer = null;
    // showToast(msg) 纯文字;showToast(msg, {label, fn, ms}) 右侧多一个动作按钮(如删除后的"撤销")。
    // 按钮用 DOM 构建,不拼 innerHTML——文字可能是用户自己起的站点名。
    function showToast(msg, action) {
        clearTimeout(toastTimer);
        const $t = $('#navToast').stop(true, true).empty();
        $('<span>').text(msg).appendTo($t);
        if (action && action.label) {
            $('<button type="button" class="nav-toast-act ms-2"></button>').text(action.label)
                .on('click', function() { clearTimeout(toastTimer); $t.fadeOut(150); action.fn(); })
                .appendTo($t);
        }
        $t.fadeIn(120);
        toastTimer = setTimeout(() => $t.fadeOut(250), (action && action.ms) || 2200);
    }
    window.navToast = showToast;

    // 页内确认层:替代浏览器原生弹窗(2026-10-30 全站下线)。原生框锁整页、长文案没人读、
    // 按钮还是英文 OK/Cancel,中文站看着不像一个产品。
    // 只在"删了不能恢复"的地方问一次;能撤销的动作一律直接执行 + 带撤销按钮的 toast。
    // 用法 navConfirm({title, body, confirmLabel, cancelLabel, danger, onOk}) → Promise<boolean>。
    // 规矩:纯原生 DOM + textContent(标题里带的是用户自己起的站点名/工具名,绝不能拼 innerHTML);
    // 默认焦点落在「取消」——回车不许顺手确认破坏性动作;Esc 与点遮罩都算取消;关闭后焦点还给触发它的元素。
    // 自己做 fixed 遮罩 + 卡片,不借 Bootstrap Modal(本模块的垫片只发它自己实现的那几个事件)。
    function navConfirm(opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            const back = document.createElement('div');
            back.className = 'nav-confirm-back';
            const card = document.createElement('div');
            card.className = 'nav-confirm';
            card.setAttribute('role', 'alertdialog');
            card.setAttribute('aria-modal', 'true');

            const title = document.createElement('h3');
            title.textContent = opts.title || '确定要继续？';
            if (opts.danger) title.classList.add('nav-confirm-danger');
            card.appendChild(title);

            if (opts.body) {
                const p = document.createElement('p');
                p.textContent = String(opts.body);   // pre-line:文案里的换行照原样出
                card.appendChild(p);
            }

            const row = document.createElement('div');
            row.className = 'nav-confirm-row';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = opts.cancelLabel || '取消';
            const go = document.createElement('button');
            go.type = 'button';
            go.className = 'nav-confirm-go' + (opts.danger ? ' nav-confirm-danger' : '');
            go.textContent = opts.confirmLabel || '确定';
            row.appendChild(cancel);
            row.appendChild(go);
            card.appendChild(row);
            back.appendChild(card);

            const previous = document.activeElement;
            let settled = false;
            function finish(answer) {
                if (settled) return;                 // Esc / 遮罩 / 按钮只认第一次
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                back.remove();
                if (previous && typeof previous.focus === 'function') previous.focus();
                resolve(answer);
                if (answer && typeof opts.onOk === 'function') opts.onOk();
            }
            function onKey(event) {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();   // 层在最上面,Esc 只归它管:别让背后的抽屉/键盘流跟着动
                finish(false);
            }
            cancel.addEventListener('click', function () { finish(false); });
            go.addEventListener('click', function () { finish(true); });
            back.addEventListener('click', function (event) { if (event.target === back) finish(false); });
            document.addEventListener('keydown', onKey, true);

            document.body.appendChild(back);
            requestAnimationFrame(function () { back.classList.add('show'); });
            cancel.focus();
        });
    }
    window.navConfirm = navConfirm;   // 拆分模块(batch.js / health.js 等)一律经 window 取用

    // 页内输入层:替代 window.prompt(nav 前端禁用原生弹窗),同一套遮罩 + 卡片,
    // 文案与初值一律走 textContent / .value,不拼 innerHTML。
    // 用法 navPrompt({title, value, placeholder, confirmLabel}) → Promise<string|null>
    function navPrompt(opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            const back = document.createElement('div');
            back.className = 'nav-confirm-back';
            const card = document.createElement('div');
            card.className = 'nav-confirm';
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-modal', 'true');

            const title = document.createElement('h3');
            title.textContent = opts.title || '输入新名称';
            card.appendChild(title);

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'nav-confirm-input';
            input.maxLength = 50;
            input.value = String(opts.value || '');
            if (opts.placeholder) input.placeholder = String(opts.placeholder);
            card.appendChild(input);

            const row = document.createElement('div');
            row.className = 'nav-confirm-row';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = opts.cancelLabel || '取消';
            const go = document.createElement('button');
            go.type = 'button';
            go.className = 'nav-confirm-go';
            go.textContent = opts.confirmLabel || '确定';
            row.appendChild(cancel);
            row.appendChild(go);
            card.appendChild(row);
            back.appendChild(card);

            const previous = document.activeElement;
            let settled = false;
            function finish(answer) {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                back.remove();
                if (previous && typeof previous.focus === 'function') previous.focus();
                resolve(answer);
            }
            function onKey(event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(null);
                } else if (event.key === 'Enter' && document.activeElement === input) {
                    event.preventDefault();
                    finish(input.value.trim());
                }
            }
            cancel.addEventListener('click', function () { finish(null); });
            go.addEventListener('click', function () { finish(input.value.trim()); });
            back.addEventListener('click', function (event) { if (event.target === back) finish(null); });
            document.addEventListener('keydown', onKey, true);

            document.body.appendChild(back);
            requestAnimationFrame(function () { back.classList.add('show'); });
            input.focus();
            input.select();
        });
    }
    window.navPrompt = navPrompt;

    // 界面模式:把"只管露不露"的开关收成一次选择。模式只是这几个本机键的预设组合,
    // 逐项微调全部保留(展开后手动改过任一项就显示"自定义");两个入口共用 navPrefSet,不会漂。
    // 2026-11-19:原「编辑」档撤销——卡片编辑/删除不再是一种全局模式,默认悬停即出;
    // 只有「常显卡片操作按钮」一个偏好(navShowActions),给需要按钮常驻的人。
    const NAV_UI_MODES = {
        browse: {clock: 1, toc: 1, search: 1, recent: 1, tools: 1, url: 0, cardactions: 1, actions: 0},
        zen:    {clock: 0, toc: 0, search: 0, recent: 0, tools: 0, url: 0, cardactions: 1, actions: 0},
    };
    // 旧偏好一次性迁移:navShowEdit / navShowDelete 任一为 1 → 合并成 navShowActions=1,旧键清掉
    (function migrateActionsPref() {
        if (localStorage.getItem('navShowActions') !== null) return;
        const legacyOn = localStorage.getItem('navShowEdit') === '1'
            || localStorage.getItem('navShowDelete') === '1';
        if (legacyOn) localStorage.setItem('navShowActions', '1');
        localStorage.removeItem('navShowEdit');
        localStorage.removeItem('navShowDelete');
    })();
    const NAV_UI_PREFS = [
        {k: 'clock', key: 'navShowClock', def: true, input: '#setShowClock',
         apply: on => { $('#navClockLine').toggleClass('d-none', !on); $('#navClockExtra').toggleClass('d-none', !on); $('#navGreetHi').toggleClass('d-none', !on); if (window.navTickClock) navTickClock(); }},
        {k: 'toc', key: 'navShowToc', def: true, input: '#setShowToc',
         apply: on => applyShowToc(on)},
        {k: 'search', key: 'navShowSearch', def: true, input: '#setShowSearch',
         apply: on => $('#navWebSearch').toggle(on)},
        {k: 'recent', key: 'navShowRecent', def: true, input: '#setShowRecent',
         apply: () => window.renderNavRecent && window.renderNavRecent()},   // stars-filter.js(第五刀拆出)
        {k: 'tools', key: 'navShowTools', def: true, input: '#setShowTools',
         apply: on => $('.nav-hub').toggleClass('show-tools', on)},          // 整块 + 目录入口一起隐藏
        {k: 'url', key: 'navShowUrl', def: false, input: '#setShowUrl',
         apply: on => { $('.nav-hub').toggleClass('show-url', on); navSyncUrlModeRow(on); }},
        {k: 'cardactions', key: 'navShowCardActions', def: true, input: '#setCardActions',
         apply: on => $('.nav-hub').toggleClass('hide-actions', !on)},
        {k: 'actions', key: 'navShowActions', def: false, input: '#setShowActions',
         apply: on => $('.nav-hub').toggleClass('show-actions', on)},
        // R-10 简介行数档:枚举型偏好(1|2|3),不走勾选布尔语义,单独 enum 标记;
        // 注册进同一注册表,供 applyPresetNow 重刷与模式行计算统一收口。
        {k: 'descLines', key: 'navCardDescLines', def: '2', enum: true, values: ['1', '2', '3'],
         input: '#navDescLinesGroup', apply: v => paintNavDescLines(v)},
        // R-14 目录宽度档:枚举型偏好(auto|narrow|card),与六档 tocStyle 并存不互斥。
        {k: 'tocWidth', key: 'navTocWidth', def: 'auto', enum: true, values: ['auto', 'narrow', 'card'],
         input: '#tocWidthGroup', apply: v => paintTocWidth(v)},
    ];
    // localStorage 读写收口:禁用/隐私模式等异常静默回落,不抛错、不发请求(同 nav-presets.js 风格)
    function navSafeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function navSafeSet(key, v) { try { localStorage.setItem(key, String(v)); return true; } catch (e) { return false; } }
    // 枚举型偏好取值:非法值 / 缺失一律回落 def,不写盘纠正
    function navEnumVal(p) {
        const v = navSafeGet(p.key);
        return (p.values.indexOf(v) >= 0) ? v : p.def;
    }
    function navPrefVal(p) {
        if (p.enum) return navEnumVal(p);
        const v = navSafeGet(p.key);
        return v === null ? p.def : v === '1';
    }
    function navPrefSet(p, on) {
        navSafeSet(p.key, on ? '1' : '0');
        $(p.input).prop('checked', on);
        p.apply(on);
        navSyncFocusClass();
    }
    function navUiModeNow() {
        const cur = {};
        const boolPrefs = NAV_UI_PREFS.filter(p => !p.enum);
        boolPrefs.forEach(p => cur[p.k] = navPrefVal(p));
        return Object.keys(NAV_UI_MODES).find(
            m => boolPrefs.every(p => !!NAV_UI_MODES[m][p.k] === cur[p.k])) || 'custom';
    }
    function navPaintUiMode() {
        const now = navUiModeNow();
        $('#navUiModeGroup .btn, #navQuickUiModeGroup .btn').each(function() {
            $(this).toggleClass('btn-secondary', String($(this).data('ui-mode')) === now)
                   .toggleClass('btn-outline-secondary', String($(this).data('ui-mode')) !== now);
        });
        $('#navUiModeNow').text(now === 'custom' ? '当前:自定义(逐项微调过)' : '');
    }
    // 专注模式不只收偏好项:顶栏/独立回顶/整组工具条也要退场,右上角专用退出钮兜住。
    function navSyncFocusClass() {
        document.body.classList.toggle('nav-focus-mode', navUiModeNow() === 'zen');
    }
    // 2026-11-28:工具条要进出「专注」且能恢复用户原来的逐项偏好。
    // 只快照 NAV_UI_PREFS 里的布尔项;进入 zen 前存一份,退出时原样还原,不粗暴回 browse。
    let navUiModeBeforeFocus = null;
    function navUiBoolSnapshot() {
        const s = {};
        NAV_UI_PREFS.forEach(function(p) { if (!p.enum) s[p.k] = navPrefVal(p); });
        return s;
    }
    function navApplyModePrefs(prefs) {
        NAV_UI_PREFS.forEach(function(p) {
            if (p.enum || !prefs || prefs[p.k] === undefined) return;
            navPrefSet(p, !!prefs[p.k]);
        });
        navPaintUiMode();
    }
    function navApplyUiMode(name) {
        const mode = NAV_UI_MODES[name];
        if (!mode) return;
        // 不管是工具条还是设置里的「专注」按钮进来,都先给逐项偏好拍快照;
        // 这样从任一入口退出都能回到用户原来的「自定义」组合,而不是粗暴回 browse。
        if (name === 'zen') {
            if (navUiModeNow() !== 'zen') navUiModeBeforeFocus = navUiBoolSnapshot();
        } else {
            navUiModeBeforeFocus = null;
        }
        navApplyModePrefs(mode);
    }
    function navToggleFocus() {
        if (navUiModeNow() === 'zen') {
            const prev = navUiModeBeforeFocus;
            navUiModeBeforeFocus = null;
            navApplyModePrefs(prev || NAV_UI_MODES.browse);
            return false;
        }
        navApplyUiMode('zen');
        return true;
    }
    window.NavUiMode = {
        current: navUiModeNow,
        isFocus: function() { return navUiModeNow() === 'zen'; },
        toggleFocus: navToggleFocus,
        apply: navApplyUiMode
    };
    const focusExit = document.getElementById('navFocusExit');
    if (focusExit) focusExit.addEventListener('click', navToggleFocus);
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && navUiModeNow() === 'zen') navToggleFocus();
    });
    // 逐项微调改过任何一项,模式行跟着重算(委托在祖先,复选框自己的处理器先跑完才轮到它)
    $('#navSettingsMenu').on('change', 'input[type=checkbox]', navPaintUiMode);
    $('#navUiModeGroup, #navQuickUiModeGroup').on('click', '.btn', function() {
        navApplyUiMode(String($(this).data('ui-mode')));
    });
    $('#setFineTuneToggle').on('click', function() {
        const hidden = $('#setFineTune').toggleClass('d-none').hasClass('d-none');
        $(this).find('> i').removeClass('fa-chevron-right fa-chevron-down')
               .addClass(hidden ? 'fa-chevron-right' : 'fa-chevron-down');
    });
    navPaintUiMode();
    navSyncFocusClass();

    // 设置面板 tab(默认"显示",记住上次所在)。
    // 访客态「维护」页签被 CSS 隐藏;若记住的正是它,回落到「外观」,避免四个 pane 全空。
    const setTabKey = 'navSetTab';
    const SET_TABS = ['view', 'content', 'fx', 'sort'];
    let lastTab = localStorage.getItem(setTabKey);
    let lastBtn = lastTab && document.getElementById('tabBtn-' + lastTab);
    if (!SET_TABS.includes(lastTab) || !lastBtn || getComputedStyle(lastBtn).display === 'none') {
        lastTab = 'view';
    }
    bootstrap.Tab.getOrCreateInstance(document.getElementById('tabBtn-' + lastTab)).show();
    $('#navSettingsMenu').on('shown.bs.tab', 'button[data-bs-toggle="tab"]', function(e) {
        localStorage.setItem(setTabKey, e.target.id.replace('tabBtn-', ''));
    });

    // 设置:左侧目录显隐(默认显示)。2026-11-19 归并:主开关在目录齿轮里,
    // 快捷设置「显隐」区留一个入口(目录关掉后齿轮自己也看不见,必须有地方能打开),两处同键同步。
    const showTocKey = 'navShowToc';
    // D5 父子开关联动:「显示左侧目录」关掉时,目录形态/样式/二级三级显隐/展开折叠这些
    // 子项一并置灰禁用;主开关恢复后子项解锁。复用 navShowToc 同一本机键,不新增存储。
    function navSyncTocChildren(on) {
        const $groups = $('#navTocModeGroup, #tocStyleGroup, #tocGearModeGroup');
        $groups.toggleClass('nav-child-locked', !on);
        $groups.find('button').prop('disabled', !on)
            .attr('aria-disabled', !on ? 'true' : 'false');
        $('#tocExpandSubs, #tocCollapseSubs, #tocGearExpand, #tocGearCollapse').prop('disabled', !on)
            .attr('aria-disabled', !on ? 'true' : 'false')
            .toggleClass('opacity-50', !on);
        ['#tocShowNums', '#tocShowSubs', '#tocShowSub3', '#tocGearShowSubs', '#tocGearShowSub3'].forEach(function (sel) {
            const $i = $(sel);
            if (!$i.length) return;
            $i.prop('disabled', !on)
              .closest('.form-check').toggleClass('opacity-50', !on);
        });
    }
    function applyShowToc(on) {
        $('#navToc').toggleClass('d-none', !on);
        $('#navTocRail').prop('hidden', !on);   // 目录整个关掉时,把手也一起收起来
        if (!on) $('.nav-hub').removeClass('toc-open');
        localStorage.setItem(showTocKey, on ? '1' : '0');
        $('#setShowToc, #navQuickShowToc').prop('checked', !!on);
        navSyncTocChildren(on);
    }
    const tocOn = localStorage.getItem(showTocKey) !== '0';
    applyShowToc(tocOn);
    $('#setShowToc, #navQuickShowToc').on('change', function() {
        applyShowToc(this.checked);
        navPaintUiMode();   // 手改一项,模式行要变成「自定义」
    });

    // 目录:常驻侧栏 / 抽屉 两态(2026-11-10)。抽屉态下 .nav-toc 变成 fixed 覆盖层,
    // 文档流里只剩把手按钮,内容区自然变宽;移动端(<768)本来就走 Bootstrap offcanvas,不参与。
    const tocModeKey = 'navTocMode';
    function tocSyncRail() {
        const hub = document.querySelector('.nav-hub');
        if (!hub) return;
        const drawer = hub.classList.contains('toc-drawer');
        const open = hub.classList.contains('toc-open');
        // 常驻 = 往左收;抽屉关着 = 往右拉出;抽屉开着 = 往左收
        const icon = (!drawer || open) ? 'fa-chevron-left' : 'fa-chevron-right';
        const $rail = $('#navTocRail');
        $rail.attr('aria-expanded', open ? 'true' : 'false')
             .attr('title', !drawer ? '把目录收成抽屉' : (open ? '收起目录抽屉' : '展开目录抽屉'))
             .find('i').attr('class', 'fas ' + icon);
    }
    // 抽屉要从吸顶栏下沿开始:否则目录头和顶栏重叠,图钉/齿轮点不到(实测 elementFromPoint 命中的是 header)
    // ⚠️ 顶栏高度晚一步才定型(字体/按钮换行),初始化时量到 46px、真实是 90px,
    //    抽屉顶部 44px 就被顶栏压住,「目录」标题和图钉整个看不见(2026-11-10 实测)。
    //    所以除了 resize,还要盯顶栏自身的尺寸变化(ResizeObserver)+ load 后再量一次。
    function tocSyncTop() {
        const bar = document.querySelector('.nav-topbar');
        const hub = document.querySelector('.nav-hub');
        if (!hub) return;
        const bottom = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
        hub.style.setProperty('--nav-toc-top', bottom + 'px');
    }
    // 推开量:抽屉真实宽度 + 间距 16,减去主区原本的左边距(随容器内边距变,不能写死)。
    // 2026-11-19:宽度必须量 getBoundingClientRect —— 页面宽度档位(铺满/宽档)会给 .nav-toc
    // 挂 zoom,写死 280 时抽屉实际 330px,推开的 296px 不够,卡片会被压住一截。
    function tocSyncPush() {
        const hub = document.querySelector('.nav-hub');
        const main = document.querySelector('.nav-main');
        if (!hub || !main) return;
        // 量"没被推开时"的左边界:临时清零 margin 再量,不能用「当前 left - 当前 margin」推算 ——
        // 常驻→抽屉时目录从文档流里抽走,旧 margins 会把 base 算大,推开量只剩几十像素,
        // 抽屉就直接盖在卡片上(2026-11-12 反馈"抽屉遮挡")。
        const cur = parseFloat(getComputedStyle(main).marginLeft) || 0;
        let base;
        if (cur) {
            const prev = main.style.marginLeft;
            main.style.marginLeft = '0px';
            base = main.getBoundingClientRect().left;
            main.style.marginLeft = prev;
        } else {
            base = main.getBoundingClientRect().left;
        }
        const tocEl = document.getElementById('navToc');
        const tocW = tocEl ? Math.round(tocEl.getBoundingClientRect().width) : 280;
        hub.style.setProperty('--toc-w', tocW + 'px');   // 把手贴抽屉右边缘用
        const want = Math.max(0, Math.round(tocW + 16 - base));
        hub.style.setProperty('--toc-push', want + 'px');
    }
    tocSyncTop();
    tocSyncPush();
    (function() {
        const bar = document.querySelector('.nav-topbar');
        if (bar && window.ResizeObserver) {
            new ResizeObserver(function() { tocSyncTop(); tocSyncPush(); }).observe(bar);
        }
        window.addEventListener('load', function() { tocSyncTop(); tocSyncPush(); });
        window.addEventListener('resize', tocSyncPush);
        // 字体替换也会把顶栏撑高,拿到字体信息后再补量一次
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function() { tocSyncTop(); tocSyncPush(); });
        }
    })();
    function tocApplyMode(mode, open) {
        const drawer = mode === 'drawer';
        $('.nav-hub').toggleClass('toc-drawer', drawer).toggleClass('toc-open', drawer && !!open);
        localStorage.setItem(tocModeKey, drawer ? 'drawer' : 'dock');
        // 设置面板里的「目录形态」、目录齿轮与把手/图钉共用这一个状态,谁改都要回显
        $('#navTocModeGroup .btn, #tocGearModeGroup .btn').each(function() {
            const on = String($(this).data('toc-mode')) === (drawer ? 'drawer' : 'dock');
            $(this).toggleClass('btn-secondary', on).toggleClass('btn-outline-secondary', !on);
        });
        tocSyncTop();
        tocSyncPush();   // 常驻↔抽屉会改变主区基准位置,必须重算推开量
        tocSyncRail();
    }
    function tocCloseDrawer() {
        if (!$('.nav-hub').hasClass('toc-open')) return;
        $('.nav-hub').removeClass('toc-open');
        tocSyncPush();
        tocSyncRail();
    }
    tocApplyMode(localStorage.getItem(tocModeKey) === 'drawer' ? 'drawer' : 'dock', false);
    $('#navTocRail').on('click', function() {
        const $hub = $('.nav-hub');
        if (!$hub.hasClass('toc-drawer')) { tocApplyMode('drawer', true); return; }   // 第一次点:收成抽屉并直接打开
        tocSyncTop();   // 打开前再量一次:顶栏可能刚换行变高
        $hub.toggleClass('toc-open');
        tocSyncPush();  // 打开/收起都要重算,否则用上一次的推开量
        tocSyncRail();
    });
    $('#navTocBackdrop').on('click', tocCloseDrawer);
    $('#navTocPin').on('click', function() { tocApplyMode('dock', false); });        // 回常驻侧栏
    // 设置面板里直接选形态(选「抽屉」不自动弹开 —— 面板还开着,弹出来也是被压在下面)
    // 目录齿轮里也放了一份(不复制控件 ID,共用同一键)
    $('#navTocModeGroup, #tocGearModeGroup').on('click', '.btn', function() {
        tocApplyMode(String($(this).data('toc-mode')), false);
    });
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('.nav-hub').hasClass('toc-open')) tocCloseDrawer();
    });
    // 抽屉里点分类后是否收起(2026-11-14 按用户反馈调整):
    //   小屏是覆盖层 —— 收起才看得到内容;
    //   桌面是"推开式"(main 会让出 --toc-push),收起没有任何遮挡收益,
    //   点了就缩反而打断连续浏览。所以只在窄屏自动收。
    $('#navToc').on('click', '.toc-scroll a', function() {
        if (!$('.nav-hub').hasClass('toc-open')) return;
        if (window.innerWidth >= 992) return;
        setTimeout(tocCloseDrawer, 120);
    });

    // 目录:大类下的二级分类列表可单独折叠(状态独立于页面折叠,存本机)
    const tocCollapsedKey = 'navTocCollapsed';
    function tocCollapsedSet() {
        try { return new Set(JSON.parse(localStorage.getItem(tocCollapsedKey) || '[]')); }
        catch (e) { return new Set(); }
    }
    (function() {
        const s = tocCollapsedSet();
        $('#navToc .toc-item').each(function() {
            if (!s.has(String($(this).data('toc-cat')))) return;
            $(this).find('> .toc-subs').addClass('d-none');
            $(this).find('> .toc-row > .toc-cheve').addClass('rot');
        });
    })();
    $('#navToc').on('click', '.toc-cheve', function(e) {
        e.preventDefault();
        const $item = $(this).closest('.toc-item'), cat = String($item.data('toc-cat'));
        const s = tocCollapsedSet();
        if (s.has(cat)) s.delete(cat); else s.add(cat);
        localStorage.setItem(tocCollapsedKey, JSON.stringify([...s]));
        $item.find('> .toc-subs').toggleClass('d-none');
        $(this).toggleClass('rot');
    });

    // 目录齿轮:目录专属设置(与右上角页面设置分开),均存本机
    // defOn:localStorage 里还没写过这个键时的默认值(不传=开,保持原有二级开关行为)
    function bindTocSwitch(btnIds, prefKey, hubCls, defOn) {
        const idList = Array.isArray(btnIds) ? btnIds : [btnIds];
        const sel = idList.join(',');
        const fallback = (defOn === undefined) ? true : !!defOn;
        const saved = localStorage.getItem(prefKey);
        const on = (saved === null) ? fallback : (saved !== '0');
        $(sel).prop('checked', on);
        $('#navToc').toggleClass(hubCls, !on);
        $(sel).on('change', function() {
            const next = this.checked;
            $('#navToc').toggleClass(hubCls, !next);
            localStorage.setItem(prefKey, next ? '1' : '0');
            $(sel).prop('checked', next);   // 齿轮菜单与总设置两个开关同步
        });
    }
    bindTocSwitch('#tocShowNums', 'navTocNums', 'hide-nums');
    bindTocSwitch(['#tocShowSubs', '#tocGearShowSubs'], 'navTocSubs', 'hide-subs');
    // 三级分类默认收起:展开时目录会一口气列出几十条三级,滚动条直接翻倍;设置里仍可打开
    bindTocSwitch(['#tocShowSub3', '#tocGearShowSub3'], 'navTocSub3', 'hide-sub3', false);
    // 目录列表样式:默认 / 极简 / 时间轴 / 胶囊 / 柔光 / 缎带(存本机;「卡片」样式 2026-11-19 按用户要求删除)
    function applyTocStyle(v) {
        const toc = document.getElementById('navToc');
        if (!toc) return;
        toc.classList.remove('seeseed', 'toc-style-timeline', 'toc-style-pill',
                              'toc-style-soft', 'toc-style-ribbon');
        const styleClass = {
            seeseed: 'seeseed',
            timeline: 'toc-style-timeline',
            pill: 'toc-style-pill',
            soft: 'toc-style-soft',
            ribbon: 'toc-style-ribbon'
        }[v];
        if (styleClass) toc.classList.add(styleClass);
        $('#tocStyleGroup .btn').each(function() {
            const on = String($(this).data('toc-style')) === (v || 'default');
            $(this).toggleClass('btn-secondary', on).toggleClass('btn-outline-secondary', !on);
        });
    }
    // 旧版存过 'cards' 的浏览器:选项已不存在,回落到默认,否则目录会「没有任何按钮选中」
    let tocStyleSaved = localStorage.getItem('navTocStyle') || 'default';
    if (tocStyleSaved === 'cards') {
        tocStyleSaved = 'default';
        localStorage.setItem('navTocStyle', 'default');
    }
    applyTocStyle(tocStyleSaved);
    $('#tocStyleGroup').on('click', '.btn', function() {
        const v = String($(this).data('toc-style'));
        localStorage.setItem('navTocStyle', v);
        applyTocStyle(v);
    });
    // ===== R-14 目录宽度档(auto|narrow|card):档位类挂 #navToc,与六档 tocStyle 叠加并存 =====
    // 存储键 navTocWidth,默认 auto;applyTocStyle 只摘/挂 toc-style-* 类,不碰宽度类,互不覆盖。
    // 窄栏档(2026-11-23 返工):每个目录链接的首字写进 data-ini,CSS 用它渲染字块;
    // 整名写进 title,悬停仍可读全称。中英切换后由 MutationObserver 重算。
    function tocPaintIni() {
        const toc = document.getElementById('navToc');
        if (!toc) return;
        toc.querySelectorAll('.toc-scroll > a, .toc-row > a').forEach(function (a) {
            const label = a.querySelector('.text-truncate') || a.querySelector('span');
            let txt = (label ? label.textContent : a.textContent) || '';
            txt = txt.replace(/\s+/g, ' ').trim();
            a.setAttribute('data-ini', txt ? Array.from(txt)[0] : '·');
            if (txt) a.setAttribute('title', txt);
        });
    }
    // 目录条目会随筛选/翻译重画;用轻量观察器兜住,不额外挂钩子
    (function watchTocIni() {
        const toc = document.getElementById('navToc');
        if (!toc || !window.MutationObserver) return;
        let timer = 0;
        new MutationObserver(function () {
            clearTimeout(timer);
            timer = setTimeout(tocPaintIni, 120);
        }).observe(toc, { childList: true, subtree: true, characterData: true });
    })();
    window.navTocPaintIni = tocPaintIni;
    function paintTocWidth(v) {
        v = ['auto', 'narrow', 'card'].indexOf(String(v)) >= 0 ? String(v) : 'auto';
        const toc = document.getElementById('navToc');
        if (toc) {
            toc.classList.remove('toc-width-narrow', 'toc-width-card');
            if (v !== 'auto') toc.classList.add('toc-width-' + v);
        }
        $('#tocWidthGroup .btn').each(function() {
            const on = String($(this).data('toc-width')) === v;
            $(this).toggleClass('btn-secondary', on)
                   .toggleClass('btn-outline-secondary', !on);
        });
        tocPaintIni();
    }
    function initTocWidth() {
        const key = 'navTocWidth', def = 'auto';
        function read() { const v = navSafeGet(key); return ['auto', 'narrow', 'card'].indexOf(v) >= 0 ? v : def; }
        paintTocWidth(read());
        $('#tocWidthGroup').on('click', '.btn', function() {
            const v = String($(this).data('toc-width'));
            navSafeSet(key, v);
            paintTocWidth(v);
        });
    }
    function tocExpandAll() {
        localStorage.setItem(tocCollapsedKey, '[]');
        $('#navToc .toc-subs').removeClass('d-none');
        $('#navToc .toc-cheve').removeClass('rot');
    }
    function tocCollapseAll() {
        const cats = $('#navToc .toc-item[data-toc-cat]').map(function() {
            return String($(this).data('toc-cat'));
        }).get();
        localStorage.setItem(tocCollapsedKey, JSON.stringify(cats));
        $('#navToc .toc-subs').addClass('d-none');
        $('#navToc .toc-cheve').addClass('rot');
    }
    $('#tocExpandSubs, #tocGearExpand').on('click', tocExpandAll);
    $('#tocCollapseSubs, #tocGearCollapse').on('click', tocCollapseAll);
    // 齿轮的「更多目录设置」:收掉菜单,直接打开全部设置并停在「布局 → 目录与页面」
    $('#tocGearMore').on('click', function() {
        try { if (window.bootstrap && bootstrap.Dropdown) bootstrap.Dropdown.clearMenus(); } catch (e) {}
        const drawer = document.getElementById('navSettingsMenu');
        if (!drawer) return;
        const offcanvas = bootstrap.Offcanvas.getOrCreateInstance(drawer);
        try {
            bootstrap.Tab.getOrCreateInstance(document.getElementById('tabBtn-content')).show();
        } catch (e) {}
        drawer.addEventListener('shown.bs.offcanvas', function onShown() {
            drawer.removeEventListener('shown.bs.offcanvas', onShown);
            const block = document.getElementById('tocSettingsMenu');
            if (block) block.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        offcanvas.show();
    });

    // D5:展开/折叠状态读写 API。主页面将来挂展开/折叠控件时,经这里读/写现有本机键,
    // 不新增 localStorage key:页面大类折叠键 navCollapsed(stars-filter.js 维护),
    // 目录二级折叠键 navTocCollapsed(本文件维护)。expandAll/collapseAll 直接触发
    // 现有按钮处理器,保证 DOM 类名与存储只走一份真相。
    window.navCollapse = {
        page: {
            collapsed: function () {
                try { return new Set(JSON.parse(localStorage.getItem('navCollapsed') || '[]')); }
                catch (e) { return new Set(); }
            },
            expandAll: function () { $('#navExpandAll').trigger('click'); },
            collapseAll: function () { $('#navCollapseAll').trigger('click'); }
        },
        toc: {
            collapsed: tocCollapsedSet,
            expandAll: function () { $('#tocExpandSubs').trigger('click'); },
            collapseAll: function () { $('#tocCollapseSubs').trigger('click'); }
        }
    };

    // 设置:卡片显示详细网址 / 显示编辑按钮(同样只存本机)
    function bindPrefSwitch(btnId, hubCls, prefKey, defOn) {
        const raw = localStorage.getItem(prefKey);
        const on = raw === null ? !!defOn : raw === '1';   // defOn:没存过时的默认值
        $(btnId).prop('checked', on);
        $('.nav-hub').toggleClass(hubCls, on);
        $(btnId).on('change', function() {
            $('.nav-hub').toggleClass(hubCls, this.checked);
            localStorage.setItem(prefKey, this.checked ? '1' : '0');
        });
    }
    bindPrefSwitch('#setShowUrl', 'show-url', 'navShowUrl');
    // 「网址显示」整行只在上面的开关打开时才有意义(2026-11-18):关掉还摆着这个下拉,
    // 调它卡片毫无变化,只会让人以为设置坏了。三处要同步:初始态、拨开关、切界面模式。
    navSyncUrlModeRow($('#setShowUrl').prop('checked'));
    $('#setShowUrl').on('change', function() { navSyncUrlModeRow(this.checked); });
    bindPrefSwitch('#setShowActions', 'show-actions', 'navShowActions');    // 「显示我的 HTML 工具」默认开:模板上已带 show-tools,存过 '0' 才隐藏
    bindPrefSwitch('#setShowTools', 'show-tools', 'navShowTools', true);
    // 标签与体检状态显隐(2026-11-18):默认显示,存 '0' 才藏;独立于界面模式(浏览/编辑/专注不控制)
    function bindShowSwitch(btnId, hideCls, prefKey) {
        const off = localStorage.getItem(prefKey) === '0';
        $(btnId).prop('checked', !off);
        const apply = on => $('.nav-hub').toggleClass(hideCls, !on);
        apply(!off);
        $(btnId).on('change', function() {
            apply(this.checked);
            localStorage.setItem(prefKey, this.checked ? '1' : '0');
        });
    }
    bindShowSwitch('#setShowTags', 'hide-tags', 'navShowTags');
    bindShowSwitch('#setShowHealth', 'hide-health', 'navShowHealth');
    // 内置网站分组显隐(2026-11-23 用户要求「选项里可以打开和关闭」):
    // 只加一个 body 级 class,整组(卡片区 + 左侧目录 + 分类条/tab)一起收起,站点本身不动。
    function navSyncBuiltinTip() {
        const tip = document.getElementById('navBuiltinTip');
        if (!tip) return;
        const hub = document.querySelector('.nav-hub');
        const hide = !!(hub && hub.classList.contains('hide-builtin'));
        const visibleCats = Array.prototype.filter.call(
            document.querySelectorAll('#navGroups .nav-cat'),
            function(el) { return el.getClientRects().length > 0; }
        ).length;
        // 只在「关掉了 + 页面上再没有别的分类」时提示,否则提示条反而添乱
        tip.classList.toggle('d-none', !(hide && visibleCats === 0));
    }
    window.navSyncBuiltinTip = navSyncBuiltinTip;
    bindShowSwitch('#setShowBuiltinCat', 'hide-builtin', 'navShowBuiltinCat');
    $('#setShowBuiltinCat').on('change', function() {
        // 可见分组数变了:分类条 / 吸顶 tabs 要重算,否则会留下一条空导航
        if (window.navRefreshCatNav) window.navRefreshCatNav();
        navSyncBuiltinTip();
    });
    $('#navBuiltinTipShow').on('click', function() {
        $('#setShowBuiltinCat').prop('checked', true).trigger('change');
        navSyncBuiltinTip();
    });
    navSyncBuiltinTip();
    // 卡片操作按钮总开关(2026-11-19 用户要求「常驻的这两个按钮支持关闭」):
    // 原来的开关只管"悬停出还是常显",关掉仍会悬停冒出 ✎ / ×;这一项关掉后彻底不出,
    // 编辑/删除改走卡片右键菜单(card-menu.js),功能不丢。
    bindShowSwitch('#setCardActions', 'hide-actions', 'navShowCardActions');
    function navSyncCardActionsRow() {
        const on = localStorage.getItem('navShowCardActions') !== '0';
        $('#setShowActions').prop('disabled', !on)
            .closest('.form-check').toggleClass('opacity-50', !on);
    }
    navSyncCardActionsRow();
    $('#setCardActions').on('change', navSyncCardActionsRow);

    // 网址显示方式(2026-11-12):clip=单行省略号,wrap=完整换行
    // 整行显隐由「卡片显示详细网址」开关驱动(2026-11-18),见 navSyncUrlModeRow
    function navSyncUrlModeRow(on) { $('#setUrlModeRow').toggleClass('d-none', !on); }
    (function initUrlMode() {
        const key = 'navUrlMode';
        function apply(v) { $('.nav-hub').toggleClass('url-wrap', v === 'wrap'); }
        const val = localStorage.getItem(key) || 'clip';
        $('#setUrlMode').val(val).on('change', function() {
            localStorage.setItem(key, this.value);
            apply(this.value);
        });
        apply(val);
    })();

    // 字号档位(2026-11-12):写 html[data-nav-fs],CSS 只缩放文字不改栅格。
    // 没选过时不写属性,由 CSS 的 ≥1600px 媒体查询自动放大到 1.1。
    (function initNavFontScale() {
        const key = 'navFontScale';
        function paint(v) {
            const root = document.documentElement;
            if (v) root.setAttribute('data-nav-fs', v);
            else root.removeAttribute('data-nav-fs');
            $('#navFontScaleGroup .btn').each(function() {
                const mine = String($(this).data('nav-fs'));
                $(this).toggleClass('btn-secondary', mine === v)
                       .toggleClass('btn-outline-secondary', mine !== v);
            });
        }
        paint(localStorage.getItem(key) || '');
        $('#navFontScaleGroup').on('click', '.btn', function() {
            const v = String($(this).data('nav-fs'));
            localStorage.setItem(key, v);
            paint(v);
        });
    })();

    // 卡片密度三档(2026-11-19):只改间距/内边距/行高,不改栅格与字号。
    (function initNavDensity() {
        const key = 'navDensity';
        function paint(v) {
            v = ['compact', 'relaxed'].includes(v) ? v : 'comfortable';
            const hub = document.querySelector('.nav-hub');
            if (hub) {
                hub.classList.remove('dens-compact', 'dens-comfortable', 'dens-relaxed');
                hub.classList.add('dens-' + v);
            }
            $('#navDensityGroup .btn').each(function() {
                const mine = String($(this).data('density'));
                $(this).toggleClass('btn-secondary', mine === v)
                       .toggleClass('btn-outline-secondary', mine !== v);
            });
        }
        paint(localStorage.getItem(key) || 'comfortable');
        $('#navDensityGroup').on('click', '.btn', function() {
            const v = String($(this).data('density'));
            localStorage.setItem(key, v);
            paint(v);
        });
    })();

    // ===== R-10 简介行数档(1|2|3):写 --nav-desc-lines,与设置组双向同步 =====
    // 存储键 navCardDescLines,默认 2;非法值回落 2。卡片简介截断由 CSS 消费该变量,
    // 本函数只负责落键 / 刷变量 / 回显按钮选中态;list / icon 档既有隐藏规则优先于行数档。
    function paintNavDescLines(v) {
        v = ['1', '2', '3'].indexOf(String(v)) >= 0 ? String(v) : '2';
        document.documentElement.style.setProperty('--nav-desc-lines', v);
        $('#navDescLinesGroup .btn').each(function() {
            const on = String($(this).data('desc-lines')) === v;
            $(this).toggleClass('btn-secondary', on)
                   .toggleClass('btn-outline-secondary', !on);
        });
    }
    function initNavDescLines() {
        const key = 'navCardDescLines', def = '2';
        function read() { const v = navSafeGet(key); return ['1', '2', '3'].indexOf(v) >= 0 ? v : def; }
        paintNavDescLines(read());
        $('#navDescLinesGroup').on('click', '.btn', function() {
            const v = String($(this).data('desc-lines'));
            navSafeSet(key, v);
            paintNavDescLines(v);
        });
    }

    // 设置:卡片布局(默认卡片/大图标/紧凑列表)与主题色(覆盖 .nav-hub 内 --accent,不影响宿主)
    const navLayoutKey = 'navLayout', navAccentKey = 'navAccent',
          navColsEvenKey = 'navColsEven', navColsCountKey = 'navColsCount';
    // 2026-11-23:恢复 11-21 的六档布局(卡片 / 大图标 / 媒体行 / 杂志 / 极简 / 分栏)。
    // 11-22 曾精简为三档并把退役值归并;本次回迁后白名单恢复六值,未知值仍回落卡片。
    const NAV_LAYOUT_SURVIVORS = ['card', 'icon', 'list', 'mag', 'min', 'cols'];
    const NAV_LAYOUT_LEGACY = {};
    function navNormalizeLayout(v) {
        if (NAV_LAYOUT_SURVIVORS.indexOf(v) >= 0) return v;
        if (NAV_LAYOUT_LEGACY[v]) return NAV_LAYOUT_LEGACY[v];
        return 'card';
    }
    function applyNavLayout(v) {
        v = navNormalizeLayout(v);
        const $hub = $('.nav-hub');
        $hub.removeClass('lyr-icon lyr-list lyr-mag lyr-min lyr-cols cols-even');
        if (v !== 'card') $hub.addClass('lyr-' + v);
        // 「齐列」是分栏的从属开关,切到别的布局就失效(不删设置,切回来还在)
        $hub.toggleClass('cols-even', v === 'cols' && localStorage.getItem(navColsEvenKey) === '1');
        $('#navLayoutGroup .btn, #navQuickLayoutGroup .btn').each(function() {
            const on = String($(this).data('layout')) === v;
            $(this).toggleClass('btn-secondary', on).toggleClass('btn-outline-secondary', !on);
        });
        navSyncLayoutDeps(v);
        // 点击热力把颜色刷在「外层列」上;大图标需要它完全退场,切布局后重算一次
        if (typeof window.navApplyClickHeat === 'function') window.navApplyClickHeat();
    }
    // 只对特定布局生效的设置项,不适用时直接隐藏(免得选了没反应像坏了)
    function navSyncLayoutDeps(v) {
        const layout = v || localStorage.getItem(navLayoutKey) || 'card';
        $('#setIconBlock').toggleClass('d-none', layout !== 'icon');
        $('#setColsBlock').toggleClass('d-none', layout !== 'cols');
        // 2026-11-24:快捷下拉里也放一份分栏细节,选「分栏」就地可调,不用再去完整设置里翻
        $('#navQuickColsBlock').toggleClass('d-none', layout !== 'cols');
        $('#setShowUrl').closest('.form-check').toggleClass('d-none', layout === 'min');
    }
    navSyncLayoutDeps();
    (function initNavLayout() {
        const raw = localStorage.getItem(navLayoutKey) || 'card';
        const norm = navNormalizeLayout(raw);
        if (norm !== raw) { try { localStorage.setItem(navLayoutKey, norm); } catch (e) {} }
        applyNavLayout(norm);
    })();
    // 布局细节(大图标):每行最多/对齐/图标大小/间距 —— 写 CSS 变量,.lyr-icon 的网格与图标全部跟着走
    function navApplyLayoutExtras() {
        const cols = localStorage.getItem('navIconCols') || 'auto';
        const align = localStorage.getItem('navIconAlign') || 'start';
        const fav = localStorage.getItem('navIconSize') || '34';
        const gap = localStorage.getItem('navIconGap') || 'normal';
        let colsVal;
        if (cols !== 'auto' && align !== 'start') colsVal = 'repeat(' + cols + ', 104px)';
        else if (cols !== 'auto') colsVal = 'repeat(' + cols + ', minmax(0, 1fr))';
        else if (align !== 'start') colsVal = 'repeat(auto-fit, 104px)';
        const hub = document.querySelector('.nav-hub');
        if (!hub) return;
        hub.classList.toggle('ialign', align !== 'start');   // 对齐模式切 flex:grid 空轨道会吃掉 justify 空隙
        hub.style.setProperty('--icon-cols', colsVal || 'repeat(auto-fill, minmax(104px, 1fr))');
        hub.style.setProperty('--icon-justify', align === 'center' ? 'center' : align === 'between' ? 'space-between' : align === 'evenly' ? 'space-evenly' : 'start');
        let rowMax = 'none';
        if (cols !== 'auto') {
            const n = parseInt(cols, 10);
            rowMax = (n * 104 + (n - 1) * 12) + 'px';   // 容器封顶:满行恰好 N 个
        }
        hub.style.setProperty('--icon-row-max', rowMax);
        hub.style.setProperty('--icon-favsize', fav + 'px');
        hub.style.setProperty('--icon-gap', gap === 'tight' ? '.5rem' : gap === 'wide' ? '1.3rem' : '.9rem');
    }
    navApplyLayoutExtras();
    [['#setIconCols', 'navIconCols'], ['#setIconAlign', 'navIconAlign'],
     ['#setIconSize', 'navIconSize'], ['#setIconGap', 'navIconGap']].forEach(function(pair) {
        $(pair[0]).val(localStorage.getItem(pair[1]) || (pair[0] === '#setIconSize' ? '34' : pair[0] === '#setIconGap' ? 'normal' : pair[0] === '#setIconAlign' ? 'start' : 'auto'));
        $(pair[0]).on('change', function() {
            localStorage.setItem(pair[1], this.value);
            navApplyLayoutExtras();
        });
    });
    $('#navLayoutGroup, #navQuickLayoutGroup').on('click', '.btn', function() {
        const v = navNormalizeLayout(String($(this).data('layout')));
        localStorage.setItem(navLayoutKey, v);
        applyNavLayout(v);
    });
    // ===== R-02 / R-03:布局预设(preset)选择器接线 =====
    // 边界:preset 包内键由 nav-presets.js 的 NavPresets.apply 写入本机;本段只把已落盘的
    // 既有键重新刷到界面控件上,不写 localStorage、不发任何网络请求。既有三档 data-layout
    // 按钮语义不变:preset 是组合包,选中后用户仍可单独改卡型(覆盖包内 navLayout)。
    function syncPresetButtons(id) {
        // 两组按钮(抽屉 #navPresetGroup / 快捷下拉 #navPresetQuickGroup)选中态由本函数
        // 唯一写入;禁止在别处另写一套 active / aria-pressed。
        $('#navPresetGroup .btn, #navPresetQuickGroup .btn').each(function() {
            const on = String($(this).data('preset')) === id;
            $(this).toggleClass('active', on)
                   .attr('aria-pressed', on ? 'true' : 'false');
        });
    }
    function applyPresetNow(id) {
        if (!id) return;
        // 1. 卡型布局:既有 applier(白名单仍只有 card / icon / list)
        applyNavLayout(localStorage.getItem(navLayoutKey) || 'card');
        // 2. 目录形态 / 目录样式:既有 applier
        tocApplyMode(localStorage.getItem(tocModeKey) === 'drawer' ? 'drawer' : 'dock', false);
        applyTocStyle(localStorage.getItem('navTocStyle') || 'default');
        // 3. 显隐子开关:按注册表重刷勾选与界面类(clock/toc/search/recent/tools/url/cardactions/actions)
        //    枚举型偏好(descLines/tocWidth)走自身 applier 重刷,不写勾选框。
        NAV_UI_PREFS.forEach(function(p) {
            if (p.enum) { p.apply(navEnumVal(p)); return; }
            const on = navPrefVal(p);
            p.apply(on);
            $(p.input).prop('checked', on);
        });
        // 4. 标签 / 体检状态 / 网址换行:既有本机键对应类名同步(对应 bindShowSwitch / initUrlMode)
        $('.nav-hub').toggleClass('hide-tags', localStorage.getItem('navShowTags') === '0');
        $('.nav-hub').toggleClass('hide-health', localStorage.getItem('navShowHealth') === '0');
        $('.nav-hub').toggleClass('url-wrap', localStorage.getItem('navUrlMode') === 'wrap');
        // 2026-11-24 修「开关关了绿点还在」:预设会写 navShowTags / navShowHealth,
        // 原来只同步了 hub 类、没同步复选框 —— 于是面板显示"关"、页面上点还在(或反过来)。
        $('#setShowTags').prop('checked', localStorage.getItem('navShowTags') !== '0');
        $('#setShowHealth').prop('checked', localStorage.getItem('navShowHealth') !== '0');
        // 4b. R-17:gallery / portal 预设 hub 标记类(纯类名、无新节点);其余档摘类。只加这一步,不重排原有顺序。
        $('.nav-hub').toggleClass('nav-preset-gallery', id === 'gallery');
        $('.nav-hub').toggleClass('nav-preset-portal', id === 'portal');
        // 5. 密度:复用既有密度分组自身的点击处理器,重刷 dens-* 类与按钮选中态
        const dens = localStorage.getItem('navDensity') || 'comfortable';
        $('#navDensityGroup .btn[data-density="' + dens + '"]').trigger('click');
        // 6. 字号:复用既有字号分组处理器;空值(默认标准)清属性并复位按钮态
        const fs = localStorage.getItem('navFontScale') || '';
        if (fs) {
            $('#navFontScaleGroup .btn[data-nav-fs="' + fs + '"]').trigger('click');
        } else {
            document.documentElement.removeAttribute('data-nav-fs');
            $('#navFontScaleGroup .btn').removeClass('btn-secondary').addClass('btn-outline-secondary');
        }
        // 7. 页面宽度:既有 applier
        navApplyPageWidth();
        navPaintUiMode();
        // 8. 两组 preset 按钮选中态唯一写入点
        syncPresetButtons(id);
    }
    // 点击 [data-preset]:交 NavPresets.apply 写键;它写完派发 nav:presetchange,
    // 由下方监听统一刷界面,本段不直接改布局类名。
    $(document).on('click', '[data-preset]', function() {
        const id = String($(this).data('preset'));
        if (window.NavPresets && typeof window.NavPresets.apply === 'function') {
            window.NavPresets.apply(id);
        }
    });
    document.addEventListener('nav:presetchange', function(e) {
        const id = e.detail && e.detail.id;
        applyPresetNow(id);
    });
    // 初始化:按本机已存 preset 同步一次按钮选中态与 hub 标记类(首帧界面由既有初始化链路刷好,
    // 这里只对齐选中态;portal / gallery 的视觉类必须在这里补一次,否则首帧只读到键、读不到类)
    (function initPresetSync() {
        let id = 'classic';
        try {
            if (window.NavPresets && typeof window.NavPresets.read === 'function') {
                id = window.NavPresets.read().id;
            }
        } catch (e) {}
        syncPresetButtons(id);
        const hub = document.querySelector('.nav-hub');
        if (hub) {
            hub.classList.toggle('nav-preset-gallery', id === 'gallery');
            hub.classList.toggle('nav-preset-portal', id === 'portal');
        }
    })();
    // 分栏细节:齐列 / 流入(默认)。只在分栏布局下露出,值存本机
    function navColsEvenChanged(on) {
        localStorage.setItem(navColsEvenKey, on ? '1' : '0');
        $('#setColsEven, #qcColsEven').prop('checked', on);
        $('.nav-hub').toggleClass('cols-even', on);
    }
    $('#setColsEven').prop('checked', localStorage.getItem(navColsEvenKey) === '1')
        .on('change', function() { navColsEvenChanged(this.checked); });
    $('#qcColsEven').prop('checked', localStorage.getItem(navColsEvenKey) === '1')
        .on('change', function() { navColsEvenChanged(this.checked); });
    // 分栏列数:设置里选 2/3/4,这里按窗口宽度封顶后写 --cols-count
    // (≥1200 用所选值;992–1199 最多 2;992 以下 1)。流入与齐列共用这一个数。
    function navApplyColsCount() {
        const hub = document.querySelector('.nav-hub');
        if (!hub) return;
        const want = parseInt(localStorage.getItem(navColsCountKey) || '3', 10) || 3;
        const w = window.innerWidth;
        const cap = w >= 1200 ? want : (w >= 992 ? Math.min(want, 2) : 1);
        hub.style.setProperty('--cols-count', String(cap));
    }
    navApplyColsCount();
    let navColsRaf = 0;   // 窗口拖动时每次 resize 都改 CSS 变量会抖,合并到一帧
    // P1 新增的量宽类(R-12 分类溢出条)挂到这条既有 rAF resize 链路里,不再另起第二个全局 resize 监听。
    const navResizeHooks = [];
    // 2026-11-23:分类导航(分类条 / 吸顶 tabs)显隐重算。设置里开关「内置网站」后不触发 resize,
    // 但可见分组数变了,必须让两套导航重新判断自己该不该出现。
    const navCatNavRefreshHooks = [];
    window.addEventListener('resize', function() {
        if (navColsRaf) return;
        navColsRaf = requestAnimationFrame(function() {
            navColsRaf = 0;
            navApplyColsCount();
            tocSyncTop();   // 顶栏换行高度会变,抽屉起点跟着改
            navResizeHooks.forEach(function(fn) { if (typeof fn === 'function') fn(); });
        });
    });
    function navColsCountChanged(v) {
        localStorage.setItem(navColsCountKey, String(v));
        $('#setColsCount, #qcColsCount').val(String(v));
        navApplyColsCount();
    }
    $('#setColsCount').val(localStorage.getItem(navColsCountKey) || '3')
        .on('change', function() { navColsCountChanged(this.value); });
    $('#qcColsCount').val(localStorage.getItem(navColsCountKey) || '3')
        .on('change', function() { navColsCountChanged(this.value); });
    // 每栏条目:分栏布局下每个分类内部一行放 1 条还是 2 条(0 = 交给容器宽度自适应)
    const navCardsColsKey = 'navCardsCols';
    function navApplyCardsCols() {
        const v = localStorage.getItem(navCardsColsKey) || '0';
        const $hub = $('.nav-hub');
        if (v === '1' || v === '2') $hub.attr('data-cards-cols', v);
        else $hub.removeAttr('data-cards-cols');
    }
    function navCardsColsChanged(v) {
        localStorage.setItem(navCardsColsKey, String(v));
        $('#setCardsCols, #qcCardsCols').val(String(v));
        navApplyCardsCols();
    }
    $('#setCardsCols').val(localStorage.getItem(navCardsColsKey) || '0')
        .on('change', function() { navCardsColsChanged(this.value); });
    $('#qcCardsCols').val(localStorage.getItem(navCardsColsKey) || '0')
        .on('change', function() { navCardsColsChanged(this.value); });
    navApplyCardsCols();
    // 主题色:预设均为明暗双档(data-accent / data-accent-dark),自定义色在暗色下自动提亮
    function navIsDark() {
        const t = document.documentElement.getAttribute('data-bs-theme') ||
                  (document.body && document.body.getAttribute('data-bs-theme')) || '';
        if (t) return t === 'dark';
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    function resolveAccent(v) {
        if (!v) return '';
        if (navIsDark()) {
            const hex = /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : '';
            const paired = hex ? $('#navAccentRow .nav-swatch[data-accent="' + hex + '"]').attr('data-accent-dark') : '';
            return paired || 'color-mix(in srgb, ' + v + ' 78%, white)';
        }
        return v;
    }
    function applyNavAccent(v) {
        const root = document.documentElement;
        const rv = resolveAccent(v);
        if (rv) root.style.setProperty('--nav-accent', rv);
        else root.style.removeProperty('--nav-accent');
        $('#navAccentRow .nav-swatch').each(function() {
            $(this).toggleClass('active', String($(this).data('accent') || '') === String(v || ''));
        });
    }
    window.applyNavAccent = applyNavAccent; window.navAccentKey = navAccentKey;   // theme.js 取用(壁纸取色自动跟随)
    if (navIsDark()) {
        // 暗色下色板圆点也预览各自那一档的颜色
        $('#navAccentRow .nav-swatch[data-accent-dark]').each(function() {
            this.style.background = this.getAttribute('data-accent-dark');
        });
    }
    const navAccentVal = localStorage.getItem(navAccentKey) || '';
    if (navAccentVal) $('#navAccentCustom').val(navAccentVal);
    applyNavAccent(navAccentVal);
    $('#navAccentRow').on('click', '.nav-swatch', function() {
        const v = String($(this).data('accent') || '');
        if (v) localStorage.setItem(navAccentKey, v); else localStorage.removeItem(navAccentKey);
        applyNavAccent(v);
    });
    $('#navAccentCustom').on('input', function() {
        localStorage.setItem(navAccentKey, this.value);
        applyNavAccent(this.value);
    });
    // 壁纸主题色:手动取色 + 自动跟随开关(色片点击走 navAccentRow 的委托,与预设色同路)
    $('#navWallPaletteBtn').on('click', function() { if (window.navExtractAndStore) navExtractAndStore(true); });
    $('#navWallAccentAuto').prop('checked', localStorage.getItem('navWallAccentAuto') === '1')
        .on('change', function() {
            localStorage.setItem('navWallAccentAuto', this.checked ? '1' : '0');
            if (this.checked && window.navExtractAndStore) navExtractAndStore(true);   // 开启即取一次并应用
        });
    // 壁纸 tab:更换壁纸(触发隐藏的文件框)+ 遮罩/模糊滑杆
    $('#navWallChangeBtn').on('click', function() { $('#navBgUpload').trigger('click'); });
    $('#navWallMaskR').on('input', function() { localStorage.setItem('navWallMask', this.value); if (window.navApplyWallTweaks) navApplyWallTweaks(); });
    $('#navWallBlurR').on('input', function() { localStorage.setItem('navWallBlur', this.value); if (window.navApplyWallTweaks) navApplyWallTweaks(); });

    // 顶部搜索引擎框:引擎选择记住在本机,{query} 占位替换后新标签页打开
    const $engineSel = $('#navEngineSel');
    const ENGINE_KEY = 'navEngines';
    function navEnginesGet() {
        try { const a = JSON.parse(localStorage.getItem(ENGINE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
    }
    const ENGINE_HIDDEN_KEY = 'navEngineHiddenV1';
    const ENGINE_DEFAULTS_KEY = 'navEngineDefaultsV2';
    // 2026-11-28:这几家默认收进「管理搜索引擎」,不占顶部下拉;用户勾选后可恢复。
    const ENGINE_DEFAULT_HIDDEN = [
        'https://duckduckgo.com/?q={query}',
        'https://www.perplexity.ai/search?q={query}',
        'https://www.sogou.com/web?query={query}',
        'https://www.so.com/s?q={query}',
        'https://quark.sm.cn/s?q={query}'
    ];
    function navEngineHiddenGet() {
        let raw = null;
        try { raw = localStorage.getItem(ENGINE_HIDDEN_KEY); } catch (e) { raw = null; }
        if (raw === null) {
            // 首次使用:默认把非高频引擎收起来,并落盘,之后用户勾选就按用户的来
            navEngineHiddenSet(ENGINE_DEFAULT_HIDDEN);
            localStorage.setItem(ENGINE_DEFAULTS_KEY, '1');
            return ENGINE_DEFAULT_HIDDEN.slice();
        }
        let stored = [];
        try {
            const a = JSON.parse(raw);
            stored = Array.isArray(a) ? a.filter(function (u) { return typeof u === 'string'; }) : [];
        } catch (e) { stored = []; }
        // 旧版本已经写过 navEngineHiddenV1(可能是空数组):一次性并入新的默认隐藏项
        if (!localStorage.getItem(ENGINE_DEFAULTS_KEY)) {
            const merged = stored.slice();
            ENGINE_DEFAULT_HIDDEN.forEach(function (u) { if (merged.indexOf(u) < 0) merged.push(u); });
            navEngineHiddenSet(merged);
            localStorage.setItem(ENGINE_DEFAULTS_KEY, '1');
            return merged;
        }
        return stored;
    }
    function navEngineHiddenSet(list) {
        const uniq = [];
        (list || []).forEach(function (u) { if (typeof u === 'string' && uniq.indexOf(u) < 0) uniq.push(u); });
        localStorage.setItem(ENGINE_HIDDEN_KEY, JSON.stringify(uniq));
    }
    function navAllEngItems() {
        return $('#navEngineMenu .dropdown-item[data-url]').toArray();
    }
    function navVisibleEngItems() {
        return navAllEngItems().filter(function (el) { return !el.classList.contains('d-none'); });
    }
    function navEngineKeepOne(hidden) {
        const all = navAllEngItems().map(function (el) { return String(el.dataset.url || ''); }).filter(Boolean);
        const visible = all.filter(function (u) { return hidden.indexOf(u) < 0; });
        if (all.length && !visible.length) return hidden.filter(function (u) { return u !== all[0]; });
        return hidden;
    }
    function navEngineSelectFirstVisible() {
        const items = navVisibleEngItems();
        if (items.length) navEngineSelect(String(items[0].dataset.url || ''));
    }
    function navEngineEnsureSelection() {
        const cur = String($engineSel.val() || '');
        if (cur && navVisibleEngItems().some(function (el) { return el.dataset.url === cur; })) return;
        navEngineSelectFirstVisible();
    }
    function renderEngManageList() {
        const $list = $('#engCustomList').empty();
        const all = navAllEngItems();
        const hidden = navEngineHiddenGet();
        if (!all.length) { $list.append('<div class="text-muted">暂无引擎</div>'); return; }
        all.forEach(function (el) {
            const url = String(el.dataset.url || '');
            const name = String(el.dataset.name || url);
            const custom = el.classList.contains('eng-custom');
            const visible = hidden.indexOf(url) < 0;
            const $row = $('<div class="d-flex align-items-center gap-2 py-1 border-bottom">');
            const $cb = $('<input type="checkbox" class="form-check-input eng-visible">')
                .attr('data-url', url).prop('checked', visible)
                .prop('disabled', visible && navVisibleEngItems().length === 1);
            $row.append($cb);
            const $chip = $('<span class="eng-chip" aria-hidden="true">');
            paintEngChip($chip[0], name);
            $row.append($chip);
            $row.append($('<span class="flex-grow-1 text-truncate">').text(name));
            $row.append($('<span class="badge text-bg-light">').text(custom ? '自定义' : '内置'));
            if (custom) {
                $('<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1 eng-del">×</button>')
                    .attr('data-url', url).appendTo($row);
            }
            $list.append($row);
        });
        const shown = all.length - hidden.filter(function (u) { return all.some(function (el) { return el.dataset.url === u; }); }).length;
        $('#engVisibleHint').text('显示 ' + shown + ' / ' + all.length + '，至少保留一个');
    }
    function applyEngineVisibility() {
        const before = navEngineHiddenGet();
        let hidden = navEngineKeepOne(before);
        if (hidden.length !== before.length) navEngineHiddenSet(hidden);
        navAllEngItems().forEach(function (el) {
            el.classList.toggle('d-none', hidden.indexOf(String(el.dataset.url || '')) >= 0);
        });
        renderEngManageList();
    }
    function navEnginesSet(list) {
        localStorage.setItem(ENGINE_KEY, JSON.stringify(list));
        renderEngOptions();
    }
    function renderEngOptions() {
        const cur = String($engineSel.val() || '');
        const $menu = $('#navEngineMenu');
        $menu.find('.dropdown-item[data-url]').each(function() {
            paintEngChip(this.querySelector('.eng-chip'), this.getAttribute('data-name'));
        });
        $menu.find('.eng-custom').remove();
        // 自定义引擎插在「分隔线 + 添加搜索引擎」之前(2026-11-13):
        // 直接 append 会落到菜单最后一行「+ 添加搜索引擎」的下面,顺序看起来像内置项被截断
        const $tail = $menu.find('.dropdown-divider').first();
        navEnginesGet().forEach(function(en) {
            const $item = $('<button type="button" class="dropdown-item eng-custom">')
                .attr('data-url', en.url).attr('data-name', en.name || en.url)
                .append('<span class="eng-chip" aria-hidden="true"></span>')
                .append($('<span>').text(en.name || en.url));
            paintEngChip($item.find('.eng-chip')[0], en.name || en.url);
            if ($tail.length) $item.insertBefore($tail); else $item.appendTo($menu);
        });
        applyEngineVisibility();
        if (cur && navVisibleEngItems().some(function (el) { return el.dataset.url === cur; })) navEngineSelect(cur);
        else navEngineEnsureSelection();
    }
    // 引擎徽章(2026-11-27):每个引擎一颗首字母色块,内置四家用品牌色,
    // 自定义引擎用域名首字母 + 中性灰。比给非 Google 的引擎硬套放大镜更好认,
    // 也不依赖外网 favicon 服务(离线/被墙时不会变成破图)。
    const NAV_ENG_BADGE = {
        google: { t: 'G', bg: '#4285f4' },
        bing: { t: 'B', bg: '#0c59a4' },
        duckduckgo: { t: 'D', bg: '#de5833' },
        '百度': { t: '百', bg: '#2932e1' },
        baidu: { t: '百', bg: '#2932e1' },
        perplexity: { t: 'P', bg: '#1fb8cd' },
        '搜狗': { t: '搜', bg: '#ff6a00' },
        sogou: { t: '搜', bg: '#ff6a00' },
        '360 搜索': { t: '360', bg: '#1a9e57' },
        '360': { t: '360', bg: '#1a9e57' },
        '夸克': { t: '夸', bg: '#5a5cff' },
        quark: { t: '夸', bg: '#5a5cff' },
        yandex: { t: 'Я', bg: '#fc3f1d' },
    };
    function navEngBadge(name) {
        const raw = String(name || '').trim();
        const key = raw.toLowerCase();
        const hit = NAV_ENG_BADGE[key] || NAV_ENG_BADGE[raw];
        if (hit) return hit;
        const first = (raw.match(/[A-Za-z0-9\u4e00-\u9fa5]/) || ['?'])[0];
        const palette = ['#6b7280', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#1d4ed8'];
        let h = 0;
        for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) % palette.length;
        return { t: first.toUpperCase(), bg: palette[h] };
    }
    function paintEngChip(el, name) {
        if (!el) return;
        const b = navEngBadge(name);
        el.textContent = b.t;
        el.style.background = b.bg;
    }
    function navEngineSelect(v) {
        if (!v) return;
        const $item = $('#navEngineMenu .dropdown-item').filter(function() {
            return this.dataset.url === v && !this.classList.contains('d-none');
        }).first();
        if (!$item.length) return;
        const engName = $item.attr('data-name') || $item.text();
        $engineSel.val(v);
        $('#navEngineLabel').text(engName);
        paintEngChip(document.getElementById('navEngineIcon'), engName);
        $('#navEngineMenu .dropdown-item').removeClass('active');
        $item.addClass('active');
        localStorage.setItem('navSearchEngine', v);
    }
    renderEngOptions();
    navEngineSelect(localStorage.getItem('navSearchEngine'));
    if (!$engineSel.val()) {   // 从没选过引擎/存的已隐藏:回落第一个可见项,否则搜索会打开空白标签页
        navEngineSelectFirstVisible();
    }
    $('#navEngineMenu').on('click', '.dropdown-item', function() {
        if (!this.dataset.url) return;   // 「+ 添加搜索引擎」是菜单最后一行,交给 modal,不参与引擎切换
        navEngineSelect(this.dataset.url);
        // 收起下拉由垫片的 auto-close 负责(默认 true);不再拿 body 的 click 事件兜底
    });
    $('#engAddBtn').on('click', function() {
        const name = $('#engName').val().trim();
        let url = $('#engUrl').val().trim();
        const $err = $('#engError');
        function fail(msg) { $err.text(msg).removeClass('d-none'); }
        if (!name || !url) return fail('名称和网址模板都要填');
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
            if (!/^https?:\/\//i.test(url)) return fail('只支持 http/https 搜索地址');
        } else {
            url = 'https://' + url;
        }
        if (url.indexOf('{query}') < 0) return fail('网址模板里必须包含 {query} 占位符,例如 https://www.so.com/s?q={query}');
        // 查重要同时看内置菜单项和本机自定义列表;旧代码 $engineSel.find('option') 是
        // select 时代残留,hidden input 没有 option,查重永远不命中
        const dup = navEnginesGet().some(function(en) { return en.url === url; }) ||
            $('#navEngineMenu .dropdown-item').toArray().some(function(el) { return el.dataset.url === url; });
        if (dup) return fail('该引擎已在列表里(内置或已添加过)');
        $err.addClass('d-none');
        const list = navEnginesGet();
        list.push({name: name, url: url});
        // 同一个 URL 之前被隐藏过:添加后自动恢复显示
        navEngineHiddenSet(navEngineHiddenGet().filter(function (u) { return u !== url; }));
        navEnginesSet(list);
        // navEngineSelect 同时写 hidden 值、按钮文字/图标与 localStorage;
        // 旧写法只写 $engineSel.val(url),左侧显示的仍是上一个引擎(误以为没添加成功)
        navEngineSelect(url);
        $('#engName,#engUrl').val('');
        showToast('已添加引擎「' + name + '」');
    });
    $('#engCustomList').on('click', '.eng-del', function() {
        const url = String($(this).data('url') || '');
        navEnginesSet(navEnginesGet().filter(function(en) { return en.url !== url; }));
        navEngineHiddenSet(navEngineHiddenGet().filter(function (u) { return u !== url; }));
        if ($engineSel.val() === url) {
            // hidden input 没有 selectedIndex;清掉后回落第一个可见引擎
            $engineSel.val('');
            localStorage.removeItem('navSearchEngine');
            navEngineEnsureSelection();
        }
        renderEngManageList();
    });
    // 显示/隐藏:勾选=出现在顶部下拉,取消=只留管理清单。至少保留一个可见项。
    $('#engCustomList').on('change', '.eng-visible', function() {
        const url = String($(this).data('url') || '');
        const checked = !!this.checked;
        let hidden = navEngineHiddenGet();
        if (!checked) {
            if (navVisibleEngItems().length <= 1) {
                this.checked = true;
                showToast('至少保留一个搜索引擎');
                return;
            }
            if (hidden.indexOf(url) < 0) hidden.push(url);
        } else {
            hidden = hidden.filter(function (u) { return u !== url; });
        }
        navEngineHiddenSet(hidden);
        applyEngineVisibility();
        navEngineEnsureSelection();
    });
    // ===== 搜索前缀 Bang(2026-11-10) =====
    // `/g 关键词`、`!bd 关键词` 直接按对应引擎搜,不用先点下拉。别名解析成"引擎名/URL 片段",
    // 不另存一份配置 —— 用户自定义的引擎名本身就能当别名用,再补几个英文缩写。
    const NAV_BANG_ALIAS = { g: 'google', bd: 'baidu', b: 'bing', ddg: 'duckduckgo',
                             ppl: 'perplexity', sg: '搜狗', 360: '360 搜索', qk: '夸克',
                             yd: 'yandex',
                             gh: 'github', yt: 'youtube', w: 'wikipedia' };
    function navBangResolve(alias) {
        const key = String(alias || '').toLowerCase();
        const guess = NAV_BANG_ALIAS[key] || key;
        const items = navVisibleEngItems().map(function(el) {
            return { name: String(el.dataset.name || '').toLowerCase(), url: String(el.dataset.url || '') };
        }).filter(function(it) { return it.url; });
        const hit = items.find(function(it) { return it.name === guess; })
            || items.find(function(it) { return it.name.indexOf(guess) === 0; })
            || items.find(function(it) { return it.url.toLowerCase().indexOf(guess) >= 0; });
        return hit || null;
    }
    function navBangParse(raw) {
        const m = /^\s*[/!]([a-zA-Z][\w+-]{0,15})\s+([\s\S]+)$/.exec(String(raw || ''));
        if (!m) return null;
        const hit = navBangResolve(m[1]);
        return hit ? { url: hit.url, q: m[2].trim() } : null;   // 未知别名 → null,按普通关键词搜
    }
    // `/` 聚焦搜索框、Esc 清空并失焦(焦点已在输入框里时不劫持)
    $(document).on('keydown', function(e) {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (!$('#navWebSearch').is(':visible')) return;
        e.preventDefault();
        $('#navEngineQ').trigger('focus');
    });
    $('#navEngineQ').on('keydown', function(e) {
        if (e.key === 'Escape') { $(this).val('').trigger('blur'); }
    });

    $('#navWebSearch').on('submit', function(e) {
        e.preventDefault();
        const typed = $('#navEngineQ').val().trim();
        if (!typed) { showToast('先输入要搜索的内容'); $('#navEngineQ').trigger('focus'); return; }
        // 前缀命中就临时换引擎,但不改用户已选的引擎(下拉里保持原样)
        const bang = navBangParse(typed);
        const q = bang ? bang.q : typed;
        navHistorySave(typed);
        localStorage.setItem('navSearchEngine', $engineSel.val());
        const tpl = bang ? bang.url : ($engineSel.val() || '');
        if (window.navPetState) { navPetState('work'); navPetSay('我帮你搜「' + (q.length > 18 ? q.slice(0, 18) + '…' : q) + '」!', 2200); }   // 任务联动
        window.open(tpl.replace('{query}', encodeURIComponent(q)), '_blank', 'noopener');
    });
    // 一键三开(2026-10-26 点单 6):Shift+回车 = 前三个引擎各开一页横向比。
    // ⚠️ 必须拦 keydown:隐式提交发出的 submit 事件上没有 shiftKey,在 submit 里永远拿不到
    $('#navEngineQ').on('keydown', function(e) {
        if (e.key !== 'Enter' || !e.shiftKey) return;
        e.preventDefault();
        const q = $(this).val().trim();
        if (!q) return;
        navHistorySave(q);
        navVisibleEngItems().map(function(el) { return el.getAttribute('data-url'); })
            .filter(Boolean).slice(0, 3).forEach(function(u) {   // 只在可见引擎里取前三
            window.open(u.replace('{query}', encodeURIComponent(q)), '_blank', 'noopener');
        });
    });
    // 设置:顶部搜索框显隐(默认可见,仅当本机存了 '0' 才隐藏)
    const showSearchOn = localStorage.getItem('navShowSearch') !== '0';
    $('#setShowSearch').prop('checked', showSearchOn);
    $('#navWebSearch').toggle(showSearchOn);
    $('#setShowSearch').on('change', function() {
        $('#navWebSearch').toggle(this.checked);
        localStorage.setItem('navShowSearch', this.checked ? '1' : '0');
    });
    // 设置:页面宽度(蒸馏 Pinsflora --wrap-w)——写到 <html> 的 --nav-wrap-w(base 壳 main 的 max-width),
    // 同时落 data-nav-wrap 档位,CSS 按档位对目录做 zoom(宽度+字号一起缩放)
    function navApplyPageWidth() {
        const w = localStorage.getItem('navPageWidth') || 'default';
        document.documentElement.style.setProperty('--nav-wrap-w',
            w === 'default' ? '1400px' : (w === '100' ? '100%' : w + '%'));
        document.documentElement.setAttribute('data-nav-wrap', 'w' + w);
    }
    $('#setPageWidth').val(localStorage.getItem('navPageWidth') || 'default');
    $('#setPageWidth').on('change', function() {
        localStorage.setItem('navPageWidth', this.value);
        navApplyPageWidth();
    });
    navApplyPageWidth();

    // ===== 通知(可选开关,distilled from dsh-pet notify + voice-notify):三通道 =====
    // 桌面通知(需授权一次) + 语音朗读(受 navPetSpeak 控制) + 宠物气泡(按「工作」档,不会被碎碎念顶掉)。
    // 任一通道不可用都不影响其余通道;返回实际状态,便于菜单给提示。
    function petNotify(title, body, opts) {
        const o = opts || {};
        const head = String(title || '');
        const text = String(body || '网址导航');
        if (window.navPetSay) window.navPetSay('🔔 ' + head + (body ? ' · ' + text : ''), o.ms || 4200, 3);
        if (o.speak !== false && window.petSpeak) { try { window.petSpeak(head + '。' + text); } catch (e) {} }
        if (localStorage.getItem('navPetNotify') !== '1' || !window.Notification) return 'off';
        const fire = function() {
            try { new Notification('小鲸鱼 · ' + head, { body: text, tag: 'nav-pet' }); return 'sent'; }
            catch (e) { return 'error'; }
        };
        if (Notification.permission === 'granted') return fire();
        if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(function(p) { if (p === 'granted') fire(); });
            return 'pending';
        }
        return 'denied';
    }
    window.petNotify = petNotify;

    // ===== 设置面板问号图标:统一走 nav-tip.js 的气泡(点击固定,再点/点空白/Esc 收起) =====
    // 2026-11-14:原来还有一套独立的问号气泡(help-bubble),是第三套 tooltip(另两套是 data-tip 与 title),
    // 且不跟滚动/缩放重定位。问号上的 data-help 已全部改成 data-tip,这里只负责"点击固定"。
    document.addEventListener('click', function(e) {
        const icon = e.target.closest('.nav-help');
        if (!icon) return;
        e.stopPropagation();   // 防止垫片的外点关闭逻辑把设置菜单一起收起
        if (window.navTipToggle) window.navTipToggle(icon);
    });

    // ===== 内联 onclick 的替代方案(2026-11-14)=====
    // 模板里原来有 12 个 onclick="fn()"(AI 弹窗、批量分类),现在改成 data-on-click:
    // 逻辑收在一处、模板不再内嵌 JS,CSP 哪天禁掉 inline handler 也不会整片失效。
    // 语义保持一致:不额外 preventDefault(那些按钮本来该提交表单的仍然提交)。
    document.addEventListener('click', function(e) {
        const el = e.target.closest('[data-on-click]');
        if (!el) return;
        const act = el.getAttribute('data-on-click');
        if (act === 'toggle') {
            const sel = el.getAttribute('data-target');
            if (sel) $(sel).toggleClass('d-none');
            return;
        }
        if (act === 'copy-value') {
            const sel = el.getAttribute('data-source');
            const $src = sel ? $(sel) : null;
            if (window.navCopyText && $src && $src.length) window.navCopyText($src.val());
            return;
        }
        const fn = window[act];
        if (typeof fn === 'function') fn();
    });

    // ===== 大搜索框搜索历史(像正常搜索引擎:点击输入框弹出历史列表,底部清除所有) =====
    const HISTORY_KEY = 'navSearchHistory';
    const HISTORY_MAX = 12;
    function navHistorySave(q) {
        let list = navLsGet(HISTORY_KEY).filter(function(x) { return x && x !== q; });
        list.unshift(q);
        navLsSet(HISTORY_KEY, list.slice(0, HISTORY_MAX));
    }
    function navHistoryClose() { $('#navHistoryPanel').remove(); }
    function navHistoryPanel() {
        navHistoryClose();
        const list = navLsGet(HISTORY_KEY);
        if (!list.length) return;
        const $panel = $('<div class="nav-history-panel" id="navHistoryPanel">');
        list.forEach(function(q) {
            const $item = $('<button type="button" class="nav-history-item">');
            $item.append('<i class="fas fa-clock-rotate-left"></i>');
            $item.append($('<span class="flex-grow-1 text-truncate">').text(q));
            $item.on('click', function() {
                navHistoryClose();
                $('#navEngineQ').val(q);
                $('#navWebSearch').trigger('submit');
            });
            $panel.append($item);
        });
        const $clear = $('<button type="button" class="nav-history-clear">');
        $clear.append('<i class="fas fa-broom"></i>清除所有历史');
        $clear.on('click', function() {
            navLsSet(HISTORY_KEY, []);
            navHistoryClose();
            showToast('搜索历史已清除');
        });
        $panel.append($clear);
        $('#navWebSearch').append($panel);   // 搜索框已不是 input-group(2026-11-13 合并成单个 .nav-search)
    }
    $('#navEngineQ').on('focus', function() {
        if (!this.value.trim()) navHistoryPanel();   // 空值点击/聚焦才弹历史
    });
    $('#navEngineQ').on('input', function() {
        if (this.value.trim()) navHistoryClose();    // 一输入就收起(站内过滤接管)
    });
    $('#navEngineQ').on('keydown', function(e) {
        if (e.key === 'Escape') navHistoryClose();
    });
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#navWebSearch')) navHistoryClose();   // 点搜索框外关闭
    });

    // ===== 添加/编辑站点弹窗:每个 tab 一份完整站点表单,"+"批量多开 =====
    const SF_MAX = 20;
    let editingId = null, editLock = false, sfSeq = 0;
    let navPendingCat = '';   // 「在某分类下新建」带过来的预填分类,只对下一次打开有效
    const SF_TPL = ''
        + '<div class="sf-form">'
        + '<div class="row g-2">'
        + '<div class="col-6"><label class="form-label small mb-1">名称 <span class="text-danger">*</span></label><input class="form-control form-control-sm f-name" maxlength="100" placeholder="例如： DHL Express"></div>'
        + '<div class="col-6"><label class="form-label small mb-1">网址 <span class="text-danger">*</span></label><input class="form-control form-control-sm f-url" maxlength="300" placeholder="dhl.com(自动加 https://)"></div>'
        + '</div>'
        + '<div class="d-flex align-items-center gap-2 my-2 flex-wrap">'
        + '<button type="button" class="btn btn-sm btn-outline-secondary f-meta" title="抓取对方首页的 <title>、favicon 和 description"><i class="fas fa-wand-magic-sparkles me-1"></i>识别标题/图标</button>'
        + '<button type="button" class="btn btn-sm btn-outline-primary f-ai" title="按名称/网址让 AI 推荐分类、标签和图标文字；分类只从库里现有清单里挑，实在不合适才建议新建"><i class="fas fa-robot me-1"></i>AI 推荐</button>'
        + '<button type="button" class="btn btn-sm btn-outline-secondary f-icon" title="选择图标:纯色文字 / 在线获取 / 本地上传"><i class="fas fa-image me-1"></i>选择图标</button>'
        + '<label class="form-check form-check-inline small text-muted mb-0" title="勾上才让 AI 一起给子网页与备用网址；它只给确定存在的地址，不确定就留空"><input class="form-check-input f-ai-links" type="checkbox"><span class="ms-1">顺带子网页/备用</span></label>'
        + '<img class="site-fav f-fav d-none" alt="">'
        + '<span class="site-fav fav-letter f-fav-custom d-none"></span>'
        + '<span class="small text-muted f-status"></span></div>'
        + '<div class="f-moved small mb-2"></div>'
        + '<div class="row g-2 mb-2">'
        + '<div class="col-6 col-md-3"><label class="form-label small mb-1">大类</label><input class="form-control form-control-sm f-cat" maxlength="50" list="navCategoryList" placeholder="输入新名称即新建"></div>'
        + '<div class="col-6 col-md-3"><label class="form-label small mb-1">二级分类 <span class="text-muted">(可空)</span></label><input class="form-control form-control-sm f-subcat" maxlength="24" placeholder="如:视频"></div>'
        + '<div class="col-2"><label class="form-label small mb-1">三级 <span class="text-muted">(可选)</span></label><input class="form-control form-control-sm f-subcat2" maxlength="24" placeholder="如:图生视频"></div>'
        + '<div class="col-4"><label class="form-label small mb-1">简介 <button type="button" class="btn btn-link btn-sm p-0 f-fetch-desc" title="按网址抓取对方网站的 meta description">抓取</button></label><input class="form-control form-control-sm f-desc" maxlength="200" placeholder="一句话说明用途"></div>'
        + '</div>'
        + '<div class="mb-2"><label class="form-label small mb-1">标签 <span class="text-muted">(可选,逗号分隔,最多 8 个;点卡片上的标签可按标签筛选)</span></label><input class="form-control form-control-sm f-tags" maxlength="120" placeholder=\"如:免费,常用,推理\"></div>'
        /* 高级选项折叠(2026-11-18):子网页/备用网址低频,首屏只留 名称/网址/分类/简介/标签,
           降低「打开弹窗就被一堆字段吓退」的摩擦;编辑已有子页/备用时自动展开 */
        + '<button type="button" class="btn btn-sm btn-link p-0 mb-1 f-adv-toggle" aria-expanded="false"><i class="fas fa-chevron-down me-1"></i>高级选项(子网页 / 备用网址)</button>'
        + '<div class="collapse f-adv mb-1">'
        + '<label class="form-label small mb-1">子网页 / 子站点 <span class="text-muted">(可选,点击卡片时弹窗选择)</span></label>'
        + '<div class="f-subrows"></div>'
        + '<button type="button" class="btn btn-sm btn-outline-secondary mt-1 f-addsub"><i class="fas fa-plus me-1"></i>添加子页</button>'
        + '<label class="form-label small mb-1 mt-2 d-block">备用网址 / 镜像 <span class="text-muted">(可选,同一站点资源站/备份/新域名等,卡片弹窗可选)</span></label>'
        + '<div class="f-altrows"></div>'
        + '<button type="button" class="btn btn-sm btn-outline-secondary mt-1 f-addalt"><i class="fas fa-plus me-1"></i>添加备用网址</button>'
        + '</div>'
        + '<datalist class="f-subcat-list"></datalist>'
        + '<datalist class="f-subcat2-list"></datalist>'
        + '<div class="text-danger small mt-1 f-error"></div>'
        + '</div>';

    function sfTabButton(id, label) {
        return $('<li class="nav-item" role="presentation">'
            + '<button class="nav-link py-1 px-2 d-flex align-items-center gap-1" type="button" role="tab">'
            + '<span class="sf-label text-nowrap"></span>'
            + '<span class="sf-x text-muted" style="cursor:pointer;padding:0 2px" title="关闭此表单">×</span>'
            + '</button></li>')
            .find('button').attr({'data-bs-toggle': 'tab', 'data-bs-target': '#' + id, 'id': id + '-btn'}).end()
            .find('.sf-label').text(label).end();
    }
    // 大类 → 二级候选 / 二级 → 三级候选(都只是提示,仍可自定义)
    let catSubs = {};
    try { catSubs = JSON.parse(document.getElementById('navCatSubs').textContent) || {}; } catch (err) {}
    // 与后端 NAV_SUBCAT_SEPS 对齐:' / ' 或 ' > ' 视为「二级 / 三级」
    function sfSplitSubcat(s) {
        s = String(s || '').trim();
        for (const sep of [' / ', ' > ']) {
            const i = s.indexOf(sep);
            if (i > 0) {
                const parent = s.slice(0, i).trim();
                const leaf = s.slice(i + sep.length).trim();
                if (parent && leaf) return [parent, leaf];
            }
        }
        return [s, ''];
    }
    function sfRefreshSubcats($form) {
        const cat = $form.find('.f-cat').val().trim();
        const pairs = (catSubs[cat] || []).map(sfSplitSubcat);
        const parent = $form.find('.f-subcat').val().trim();
        const $dl1 = $form.find('.f-subcat-list').empty();
        const $dl2 = $form.find('.f-subcat2-list').empty();
        [...new Set(pairs.map(function(p) { return p[0]; }).filter(Boolean))]
            .forEach(function(name) { $dl1.append($('<option>').val(name)); });
        pairs.filter(function(p) { return p[1] && (!parent || p[0] === parent); })
            .forEach(function(p) { $dl2.append($('<option>').val(p[1])); });
    }
    // 简介抓取(2026-11-12):编辑/新增时按网址取对方 meta description,省得手写
    $(document).on('click', '.f-fetch-desc', function() {
        const $form = $(this).closest('.sf-form');
        const url = ($form.find('.f-url').val() || '').trim();
        const $btn = $(this).prop('disabled', true);
        if (!url) { showToast('先填写网址'); $btn.prop('disabled', false); return; }
        $.ajax({
            url: '/api/nav/fetch-meta/', type: 'POST', contentType: 'application/json',
            data: JSON.stringify({url: url}), beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf())
        }).done(function(res) {
            if (res && res.description) {
                $form.find('.f-desc').val(res.description);
                showToast('已填入简介');
            } else {
                showToast((res && res.message) || '没抓到简介,可手动填写');
            }
        }).fail(function() { showToast('抓取失败,可手动填写'); })
          .always(function() { $btn.prop('disabled', false); });
    });
    // 手改二级分类时,三级候选跟着换
    $(document).on('input change', '.sf-form .f-subcat', function() {
        sfRefreshSubcats($(this).closest('.sf-form'));
    });
    // 表单区的动态文案(站点 1 / 最多 N 个表单)不在词条表的纯文本替换范围内,这里按当前语言现取
    function sfI18n(zh) {
        return (window.NavI18n && NavI18n.getLang && NavI18n.getLang() === 'en')
            ? ((NavI18n.dict && NavI18n.dict[zh]) || zh) : zh;
    }
    function sfAddForm(prefill) {
        if ($('#siteFormPanes .tab-pane').length >= SF_MAX) {
            showToast(sfI18n('最多') + ' ' + SF_MAX + ' ' + sfI18n('个表单'));
            return null;
        }
        const id = 'sfPane-' + (++sfSeq);
        const $btn = sfTabButton(id, sfI18n('站点') + ' ' + sfSeq);
        $('#siteFormTabs').append($btn);
        const $pane = $('<div class="tab-pane fade" id="' + id + '" role="tabpanel">').append(SF_TPL);
        $('#siteFormPanes').append($pane);
        const $form = $pane.find('.sf-form');
        $form.find('.f-ai-links').prop('checked', aiLinksPref());
        const dlId = 'sfSubDL-' + sfSeq;
        const dl2Id = 'sfSub2DL-' + sfSeq;
        $form.find('.f-subcat-list').attr('id', dlId);
        $form.find('.f-subcat').attr('list', dlId);
        $form.find('.f-subcat2-list').attr('id', dl2Id);
        $form.find('.f-subcat2').attr('list', dl2Id);
        if (prefill) {
            $form.find('.f-name').val(prefill.name);
            $form.find('.f-url').val(prefill.url);
            $form.find('.f-cat').val(prefill.category);
            const subParts = sfSplitSubcat(prefill.subcat);
            $form.find('.f-subcat').val(subParts[0]);
            $form.find('.f-subcat2').val(subParts[1]);
            $form.find('.f-desc').val(prefill.description);
            $form.find('.f-tags').val((prefill.tags || []).join(', '));
            sfRefreshSubcats($form);
            $form.data({origTitle: prefill.site_title || '', origFavicon: prefill.favicon || ''});
            if (prefill.favicon) $form.find('.f-fav').attr('src', prefill.favicon).removeClass('d-none');
            if (prefill.iconText) {   // 已有自定义字母图标:回填选择状态与预览
                $form.data('iconPick', { mode: 'text', text: prefill.iconText,
                                         color: prefill.iconColor || '#5850ec', size: parseInt(prefill.iconSize, 10) || 34 });
                $form.find('.f-fav-custom').removeClass('d-none')
                    .text(prefill.iconText)
                    .css({ background: prefill.iconColor || '#5850ec', '--fav-fs': '10px' });
            }
            (prefill.children || []).forEach(function(c) { sfAddSubRow($form.find('.f-subrows'), c.name, c.url); });
            (prefill.alternates || []).forEach(function(a) { sfAddSubRow($form.find('.f-altrows'), a.name, a.url); });
            // 编辑时已有子页/备用:高级区自动展开(2026-11-18 折叠配套)
            if ((prefill.children || []).length || (prefill.alternates || []).length) {
                $form.find('.f-adv').addClass('show');
                $form.find('.f-adv-toggle').attr('aria-expanded', 'true')
                    .find('i').removeClass('fa-chevron-down').addClass('fa-chevron-up');
            }
        }
        sfShowPane($pane);
        return $pane;
    }
    function sfShowPane($pane) {
        const btn = document.getElementById($pane.attr('id') + '-btn');
        if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
    }
    function sfReset(keepEdit) {
        if (!keepEdit) editingId = null;
        $('#siteFormTabs').empty();
        $('#siteFormPanes').empty();
        $('#addFormError').text('');
    }
    $('#sfAddTab').on('click', function() { if (!editingId) sfAddForm(); });
    // 关闭某个表单 tab(× 不触发切换)
    $('#siteFormTabs').on('click', '.sf-x', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if ($('#siteFormPanes .tab-pane').length <= 1) { showToast('至少保留一个表单'); return; }
        const target = $(this).closest('button').attr('data-bs-target');
        const wasActive = $(this).closest('button').hasClass('active');
        $(this).closest('li').remove();
        $(target).remove();
        if (wasActive) sfShowPane($('#siteFormPanes .tab-pane').first());
    });

    // 子网页行(按表单作用域)
    function sfAddSubRow($rows, name, url) {
        if ($rows.children().length >= 30) { showToast('子网页最多 30 条'); return; }
        $('<div class="sub-row input-group input-group-sm mb-1">'
        + '<input class="form-control sub-name" maxlength="100" placeholder="名称,如 联系页">'
        + '<input class="form-control sub-url" maxlength="300" placeholder="https://example.com/contact">'
        + '<button class="btn btn-outline-secondary sub-del-row" type="button" title="移除"><i class="fas fa-times"></i></button>'
        + '</div>').appendTo($rows)
          .find('.sub-name').val(name || '').end()
          .find('.sub-url').val(url || '');
    }
    $('#siteFormPanes').on('click', '.f-addsub', function() {
        sfAddSubRow($(this).closest('.sf-form').find('.f-subrows'), '', '');
    });
    $('#siteFormPanes').on('click', '.f-addalt', function() {
        sfAddSubRow($(this).closest('.sf-form').find('.f-altrows'), '', '');
    });
    // 高级选项折叠开关(2026-11-18):手写 toggle(.collapse 的 show 类),批量多表单互不影响
    $('#siteFormPanes').on('click', '.f-adv-toggle', function() {
        const $adv = $(this).closest('.sf-form').find('.f-adv');
        const open = !$adv.hasClass('show');
        $adv.toggleClass('show', open);
        $(this).attr('aria-expanded', open)
            .find('i').toggleClass('fa-chevron-down', !open).toggleClass('fa-chevron-up', open);
    });
    $('#siteFormPanes').on('click', '.sub-del-row', function() { $(this).closest('.sub-row').remove(); });

    // ===== AI 推荐(2026-11-25):分类优先复用库里现有清单,标签优先词表;子网页/备用默认不要 =====
    var AI_LINKS_KEY = 'navAiSuggestLinks';
    function aiLinksPref() { try { return localStorage.getItem(AI_LINKS_KEY) === '1'; } catch (e) { return false; } }
    $('#siteFormPanes').on('change', '.f-ai-links', function() {
        var on = this.checked;
        try { localStorage.setItem(AI_LINKS_KEY, on ? '1' : '0'); } catch (e) {}
        $('#siteFormPanes .f-ai-links').each(function() { this.checked = on; });
    });
    // 文字图标默认值:中文取前两个汉字;英文多词取各词首字母(最多 2),单词取前 2 个字母
    function sfDefaultIconText(name) {
        var s = String(name || '').replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9\u4e00-\u9fa5 ]/g, '').trim();
        if (!s) return 'Go';
        var cjk = s.match(/[\u4e00-\u9fa5]/g);
        if (cjk && cjk.length) return cjk.slice(0, 2).join('');
        var words = s.split(/\s+/).filter(Boolean);
        if (words.length >= 2) return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
        return s.slice(0, 2).toUpperCase();
    }
    $('#siteFormPanes').on('click', '.f-ai', function() {
        var $form = $(this).closest('.sf-form');
        var $btn = $(this).prop('disabled', true);
        var name = ($form.find('.f-name').val() || '').trim();
        var url = ($form.find('.f-url').val() || '').trim();
        var desc = ($form.find('.f-desc').val() || '').trim();
        if (!name && !url) { showToast('先填名称或网址'); $btn.prop('disabled', false); return; }
        var wantLinks = $form.find('.f-ai-links').prop('checked');
        $form.find('.f-status').text('AI 推荐中…');
        $.ajax({
            url: '/api/nav/ai/suggest/', type: 'POST', contentType: 'application/json',
            data: JSON.stringify({ name: name, url: url, description: desc,
                                   want_subs: wantLinks, want_alts: wantLinks }),
            beforeSend: function(xhr) { xhr.setRequestHeader('X-CSRFToken', csrf()); }
        }).done(function(res) {
            var sug = res && res.suggestion;
            if (!sug) { $form.find('.f-status').text(''); showToast('AI 没给出建议'); return; }
            var notes = [];
            if (sug.category) { $form.find('.f-cat').val(sug.category).trigger('input'); notes.push('分类'); }
            if (sug.subcat) $form.find('.f-subcat').val(sug.subcat);
            if (sug.subcat2) $form.find('.f-subcat2').val(sug.subcat2);
            sfRefreshSubcats($form);
            if (sug.tags && sug.tags.length) {
                var cur = ($form.find('.f-tags').val() || '').split(/[,，]/).map(function(x) { return x.trim(); }).filter(Boolean);
                var merged = cur.concat(sug.tags.filter(function(t) { return cur.indexOf(t) < 0; })).slice(0, 8);
                $form.find('.f-tags').val(merged.join(','));
                notes.push('标签');
            }
            if (sug.icon_text) {
                var color = '#5850ec';
                $form.data('iconPick', { mode: 'text', text: sug.icon_text, color: color, size: 34 });
                $form.find('.f-fav-custom').removeClass('d-none').text(sug.icon_text)
                    .css({ background: color, '--fav-fs': '10px' });
                $form.find('.f-fav').addClass('d-none');
                notes.push('图标 ' + sug.icon_text);
            }
            if (sug.subs && sug.subs.length) {
                $form.find('.f-subrows').empty();
                sug.subs.forEach(function(x) { sfAddSubRow($form.find('.f-subrows'), x.name, x.url); });
                $form.find('.f-adv').addClass('show');
                $form.find('.f-adv-toggle').attr('aria-expanded', true)
                    .find('i').removeClass('fa-chevron-down').addClass('fa-chevron-up');
                notes.push('子网页 ' + sug.subs.length);
            }
            if (sug.alts && sug.alts.length) {
                $form.find('.f-altrows').empty();
                sug.alts.forEach(function(x) { sfAddSubRow($form.find('.f-altrows'), x.name, x.url); });
                $form.find('.f-adv').addClass('show');
                notes.push('备用 ' + sug.alts.length);
            }
            var extra = sug.new_category ? '（AI 建议新建大类：' + sug.category + '）' : '';
            $form.find('.f-status').text('AI 已填：' + (notes.join(' / ') || '无') + extra);
        }).fail(function(xhr) {
            var b = (xhr && xhr.responseJSON) || {};
            if (b.code === 'ai_not_configured') showToast('还没配置 AI 接口：到 设置 → AI 工具 里填地址与密钥');
            else showToast(b.message || 'AI 推荐失败');
            $form.find('.f-status').text('');
        }).always(function() { $btn.prop('disabled', false); });
    });

    // 识别标题/图标/简介(按表单作用域;失焦自动一次,按钮可强制重抓)
    // 同一次抓取顺带做"迁移新地址"提示:候选可一键加入本表单的备用网址行
    function sfUrlKey(s) {
        s = String(s || '').trim().toLowerCase();
        if (!/^https?:\/\//.test(s)) s = 'https://' + s;
        return s.replace(/\/+$/, '');
    }
    function sfAltHas($form, u) {
        const k = sfUrlKey(u);
        if (!k || k === 'https://') return false;
        if (sfUrlKey($form.find('.f-url').val()) === k) return true;
        let hit = false;
        $form.find('.f-altrows .sub-row').each(function() {
            if (sfUrlKey($(this).find('.sub-url').val()) === k) hit = true;
        });
        return hit;
    }
    function fetchMetaFor($form, force) {
        const url = $form.find('.f-url').val().trim();
        if (!url) return;
        if (!force && $form.data('metaUrl') === url && $form.data('meta')) return;
        $form.find('.f-status').text('识别中...');
        $.ajax({
            url: NAV_SITE_URLS.fetchMeta, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({url: url}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function(data) {
                $form.data({meta: data, metaUrl: url});
                if (data.favicon) { $form.find('.f-fav').attr('src', data.favicon).removeClass('d-none'); }
                else { $form.find('.f-fav').addClass('d-none'); }
                const $name = $form.find('.f-name');
                if (data.title && !$name.val().trim()) $name.val(data.title.slice(0, 100));
                const $desc = $form.find('.f-desc');
                if (data.description && !$desc.val().trim()) $desc.val(data.description.slice(0, 200));
                $form.find('.f-status').text((data.title || data.favicon || data.description) ? '已识别,可修改' : '页面没解析到标题/图标/简介');
                const $mv = $form.find('.f-moved').empty();
                const moved = data.moved || [];
                if (moved.length) {
                    $mv.append($('<div class="text-warning-emphasis fw-semibold">')
                        .text(moved.length > 1 ? `页面内容指向 ${moved.length} 个可能的新地址,请逐个确认:` : '页面可能已迁移,新地址:'));
                    moved.forEach(function(c) {
                        const $line = $('<div class="d-flex align-items-center gap-2 flex-wrap">');
                        $('<a target="_blank" rel="noopener noreferrer">').attr('href', c.url)
                            .text(c.url + '(' + (LT_REASON_LABELS[c.reason] || c.reason || '') + ')').appendTo($line);
                        $('<button class="btn btn-sm btn-outline-primary py-0 px-1" type="button">').text('加入备用')
                            .on('click', function() {
                                if (sfAltHas($form, c.url)) { showToast('该网址已在备用/主站中'); return; }
                                sfAddSubRow($form.find('.f-altrows'), '迁移检测', c.url);
                                showToast('已加入备用网址,保存后生效');
                            }).appendTo($line);
                        $mv.append($line);
                    });
                }
            },
            error: function(xhr) {
                $form.removeData('meta');
                $form.find('.f-moved').empty();
                $form.find('.f-status').text((xhr.responseJSON && xhr.responseJSON.message) || '识别失败,可手动填写');
            }
        });
    }
    $('#siteFormPanes').on('blur', '.f-url', function() { fetchMetaFor($(this).closest('.sf-form'), false); });
    $('#siteFormPanes').on('click', '.f-meta', function() { fetchMetaFor($(this).closest('.sf-form'), true); });

    // ===== 选择图标(纯色文字/在线获取/本地上传):抓不到图标或想自定义时用 =====
    let ipCtx = null;   // {$form, mode:'text'|'online'|'local', text, color, size, url}
    let ipExternal = null;   // 非表单调用方(访客编辑弹窗)传进来的 onPick 回调;有它就不写 .sf-form
    function ipShowPreview() {
        if (!ipCtx) return;
        if (ipCtx.mode === 'text') {
            $('#ipPreviewText').removeClass('d-none').text(ipCtx.text || 'Go')
                .css({ background: ipCtx.color, fontSize: ipCtx.size + 'px' });
            $('#ipPreviewImg').addClass('d-none');
        } else {
            $('#ipPreviewText').addClass('d-none');
            $('#ipPreviewImg').removeClass('d-none').toggleClass('d-none', !ipCtx.url).attr('src', ipCtx.url || '');
        }
    }
    function ipRenderOnline() {
        const formUrl = ipCtx.$form && ipCtx.$form.length ? ipCtx.$form.find('.f-url').val() : '';
        const raw = ($('#ipOnlineUrl').val() || formUrl || (ipCtx.urlFallback ? ipCtx.urlFallback() : '') || '').trim();
        let host = '';
        try { host = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).hostname; } catch (e) { host = ''; }
        const $row = $('#ipOnlineRow').empty();
        if (!host) { $row.html('<span class="small text-muted">先填网址</span>'); return; }
        [['favicon.im', 'https://favicon.im/' + host], ['Google s2', 'https://www.googleapis.com/s2/favicons?domain=' + host + '&sz=64']].forEach(function(pair) {
            const $b = $('<button type="button" class="ip-online btn" title="' + pair[0] + '">').append($('<img alt="">').attr('src', pair[1]));
            if (ipCtx.url === pair[1]) $b.addClass('active');
            $b.on('click', function() {
                ipCtx.url = pair[1];
                $row.find('.ip-online').removeClass('active');
                $b.addClass('active');
                ipShowPreview();
            });
            $row.append($b);
        });
    }
    function ipOpen(seed, $form, onPick) {
        ipExternal = typeof onPick === 'function' ? onPick : null;
        ipCtx = { $form: $form || $(), mode: 'text', text: '', color: '#5850ec', size: 34, url: '' };
        seed = seed || {};
        if (seed.mode === 'url' && seed.url) {
            ipCtx.url = seed.url;
        } else {
            ipCtx.text = seed.text || sfDefaultIconText(seed.fallbackName || '');
            if (seed.color) ipCtx.color = seed.color;
            if (seed.size) ipCtx.size = seed.size;
        }
        $('#ipText').val(ipCtx.text); $('#ipSizeR').val(ipCtx.size); $('#ipSizeV').text(ipCtx.size);
        $('#ipColors .ip-color').removeClass('active');
        $('#ipColorCustom').val(ipCtx.color);
        $('#ipOnlineUrl').val('');
        $('#ipModeGroup .btn').each(function() { $(this).toggleClass('active', this.getAttribute('data-ip-mode') === (ipCtx.url ? 'online' : 'text')); });
        $('#ipPaneText').toggle(!ipCtx.url);
        $('#ipPaneOnline').toggle(!!ipCtx.url);
        $('#ipPaneLocal').hide();
        ipShowPreview();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('iconPickerModal')).show();
    }
    // 2026-11-27:访客「添加/编辑本机书签」也复用这一个图标选择器。
    // 访客那边没有 .sf-form,拿到结果自己写字段;有 onPick 时 ipOk 不碰主人表单。
    window.navIconPickerOpen = function (seed, onPick) { ipOpen(seed || {}, $(), onPick); };
    $('#siteFormPanes').on('click', '.f-icon', function() {
        const $form = $(this).closest('.sf-form');
        const saved = $form.data('iconPick');
        const name = $form.find('.f-name').val().trim() || $form.find('.f-url').val().trim();
        ipOpen(saved || { text: sfDefaultIconText(name) }, $form);
    });
    $('#ipModeGroup').on('click', '.btn', function() {
        ipCtx.mode = String($(this).data('ip-mode'));
        const btn = this;
        $('#ipModeGroup .btn').each(function() { $(this).toggleClass('active', this === btn); });
        $('#ipPaneText').toggle(ipCtx.mode === 'text');
        $('#ipPaneOnline').toggle(ipCtx.mode === 'online');
        $('#ipPaneLocal').toggle(ipCtx.mode === 'local');
        if (ipCtx.mode === 'online') ipRenderOnline();
        ipShowPreview();
    });
    $('#ipText').on('input', function() { ipCtx.text = this.value; ipShowPreview(); });
    $('#ipSizeR').on('input', function() { ipCtx.size = parseInt(this.value, 10); $('#ipSizeV').text(this.value); ipShowPreview(); });
    $('#ipColors').on('click', '.ip-color', function() {
        ipCtx.color = String($(this).data('ip-color'));
        $('#ipColors .ip-color').removeClass('active');
        $(this).addClass('active');
        ipShowPreview();
    });
    $('#ipColorCustom').on('input', function() {
        ipCtx.color = this.value;
        $('#ipColors .ip-color').removeClass('active');
        ipShowPreview();
    });
    $('#ipOnlineUrl').on('input', function() { ipCtx.url = ''; ipRenderOnline(); });
    $('#ipFileBtn').on('click', function() { $('#ipFile').trigger('click'); });
    $('#ipFile').on('change', function() {
        const f = this.files && this.files[0];
        if (!f || !ipCtx) return;
        $('#ipLocalStatus').text('上传中…');
        const fd = new FormData();
        fd.append('file', f);
        $.ajax({
            url: NAV_SITE_URLS.iconUpload, method: 'POST', data: fd, processData: false, contentType: false,
            headers: { 'X-CSRFToken': csrf() },
            success: function(d) {
                if (d.status === 'ok') {
                    ipCtx.url = d.url;
                    $('#ipLocalStatus').text('已上传,预览见上方');
                    ipShowPreview();
                } else { $('#ipLocalStatus').text(d.message || '上传失败'); }
            },
            error: function(xhr) { $('#ipLocalStatus').text((xhr.responseJSON && xhr.responseJSON.message) || '上传失败'); }
        });
    });
    $('#ipOk').on('click', function() {
        if (!ipCtx) return;
        if (ipExternal) {
            let pick;
            if (ipCtx.mode === 'text') {
                pick = { mode: 'text', text: ipCtx.text || 'Go', color: ipCtx.color, size: ipCtx.size };
            } else {
                if (!ipCtx.url) { showToast('先点选一个图标'); return; }
                pick = { mode: 'url', url: ipCtx.url };
            }
            const cb = ipExternal;
            ipExternal = null;
            cb(pick);
            bootstrap.Modal.getOrCreateInstance(document.getElementById('iconPickerModal')).hide();
            return;
        }
        if (ipCtx.mode === 'text') {
            ipCtx.$form.data('iconPick', { mode: 'text', text: ipCtx.text || 'Go', color: ipCtx.color, size: ipCtx.size });
            ipCtx.$form.find('.f-fav-custom').removeClass('d-none')
                .text(ipCtx.text || 'Go')
                .css({ background: ipCtx.color, '--fav-fs': '10px' });
            ipCtx.$form.find('.f-fav').addClass('d-none');
        } else {
            if (!ipCtx.url) { showToast('先点选一个图标'); return; }
            ipCtx.$form.data('iconPick', { mode: 'url', url: ipCtx.url });
            ipCtx.$form.find('.f-fav').attr('src', ipCtx.url).removeClass('d-none');
            ipCtx.$form.find('.f-fav-custom').addClass('d-none');
        }
        bootstrap.Modal.getOrCreateInstance(document.getElementById('iconPickerModal')).hide();
    });
    // 换了大类 → 刷新小分类候选(下拉可直选,也可输入新名称)
    $('#siteFormPanes').on('input change', '.f-cat', function() {
        sfRefreshSubcats($(this).closest('.sf-form'));
    });

    // 打开弹窗:非编辑入口一律重置为"添加模式 + 单个空表单"
    $('#addSiteModal').on('show.bs.modal', function() {
        if (editLock) { editLock = false; navPendingCat = ''; return; }
        editingId = null;
        sfReset();
        sfAddForm();
        if (navPendingCat) {   // 分类内「新建站点」:预填大类并刷新小分类候选
            const $f = $('#siteFormPanes .sf-form').last();
            if ($f.length) { $f.find('.f-cat').val(navPendingCat); sfRefreshSubcats($f); }
            navPendingCat = '';
        }
        $('#addSiteModalTitle').text('添加站点');
        $('#addSiteSubmit').text('保存');
    });
    $('#addSiteModal').on('hidden.bs.modal', function() { editingId = null; editLock = false; });
    // 兜底:万一 show 阶段 sfAddForm 没跑成(脚本半途报错/缓存了旧版),弹窗打开后是空白的。
    // 这里补一次,并把错误显式写在弹窗里,而不是让用户面对一个空壳。
    $('#addSiteModal').on('shown.bs.modal', function() {
        if ($('#siteFormPanes .tab-pane').length) return;
        try {
            sfAddForm();
        } catch (err) {
            $('#addFormError').text('表单初始化失败:' + (err && err.message ? err.message : err));
        }
    });

    // ===== 分类就地操作(分栏布局的「···」菜单)=====
    // 排序/显隐直接复用「全部设置 → 分类排序」那份 DOM 当整表快照(接口本就是整表替换),
    // 这样页面上改一次和设置面板里改一次走的是同一条保存路径,不会出现两套顺序。
    function navCfgUrls() {
        try { return JSON.parse(document.getElementById('navStarsUrls').textContent) || {}; } catch (e) { return {}; }
    }
    function navSaveCategoryOrder() {
        const order = $('#catOrderList li').map(function() {
            return { name: String($(this).data('cat')), hidden: $(this).hasClass('cat-hidden') };
        }).get();
        if (!order.length) { showToast('分类列表未就绪,刷新后再试'); return; }
        $.ajax({
            url: navCfgUrls().categoryOrder, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({ order: order }),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: () => location.reload(),
            error: () => showToast('操作失败,请重试')
        });
    }

    // ===== D5 维护 Tab:分类排序拖拽(HTML5 draggable) =====
    // 箭头按钮在模板移除前保留为兜底;排序动作以拖拽为准。松手只改 #catOrderList 的
    // DOM 顺序并点亮「保存排序」;落库复用现有保存接口(主人 = categoryOrder 整表提交,
    // 访客 = 本机 groupOrder 存储),不新增存储键。
    (function initCatOrderDrag() {
        const $list = $('#catOrderList');
        if (!$list.length) return;
        let dragSrc = null;

        function markDirty() {
            const $save = $('#catOrderSave');
            if ($save.length) $save.prop('disabled', false);
        }
        function armLi($li) { $li.attr('draggable', 'true'); }
        $list.find('li[data-cat]').each(function () { armLi($(this)); });

        $list.on('dragstart', 'li[data-cat]', function (e) {
            dragSrc = this;
            $(this).addClass('cat-dragging');
            e.originalEvent.effectAllowed = 'move';
            try { e.originalEvent.dataTransfer.setData('text/plain', String($(this).data('cat') || '')); } catch (err) {}
        });
        // ⚠️ 落点判定不能用 offsetY:委托到 li 时事件 target 常是行内的 span,
        //    offsetY 相对 span 计算,换算成 li 的中点判断会整体错位(表现为「拖到文字上拖不动」)。
        //    这里改成 list 层监听 + clientY 对宿主 li 的 getBoundingClientRect 取中点,与 target 无关。
        $list.on('dragover', function (e) {
            if (!dragSrc) return;
            const li = $(e.target).closest('li[data-cat]')[0];
            if (!li || li === dragSrc) return;
            e.preventDefault();
            const rect = li.getBoundingClientRect();
            if (e.originalEvent.clientY < rect.top + rect.height / 2) $(li).before(dragSrc);
            else $(li).after(dragSrc);
        });
        $list.on('drop', function (e) {
            if (!dragSrc) return;
            e.preventDefault();
            dragSrc = null;
            markDirty();
        });
        $list.on('dragend', 'li[data-cat]', function () {
            dragSrc = null;
            $list.find('li').removeClass('cat-dragging');
        });
        // 访客维护块会重建 list 子项;子项出现后补挂 draggable 属性
        if (window.MutationObserver) {
            new MutationObserver(function () {
                $list.find('li[data-cat]').each(function () {
                    if ($(this).attr('draggable') !== 'true') armLi($(this));
                });
            }).observe($list[0], { childList: true });
        }

        window.navCatOrder = {
            snapshot: function () {
                return $list.find('li[data-cat]').map(function () {
                    return { name: String($(this).data('cat')), hidden: $(this).hasClass('cat-hidden') };
                }).get();
            },
            dirty: markDirty,
            save: function () { $('#catOrderSave').trigger('click'); }
        };
    })();
    // 空态「显示这些站点」:只取消隐藏,不动分类表其余记录(见 api_nav_category_unhide)。
    $('#navEmptyUnhide').on('click', function() {
        const $btn = $(this).prop('disabled', true);
        $.ajax({
            url: NAV_SITE_URLS.unhide, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({names: NAV_HIDDEN_CATS}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: () => location.reload(),
            error: function(xhr) {
                $btn.prop('disabled', false);
                showToast((xhr.responseJSON && xhr.responseJSON.message) || '恢复失败');
            }
        });
    });
    // ⚠️ 这里不能停掉冒泡:垫片的下拉是 document 上的委托(见 bootstrap-shim.js),
    //    stopPropagation 会让「···」点不开。折叠的误触改在 stars-filter.js 的 .collapsible 里拦。
    $('.nav-hub').on('click', '.nav-cat-add', function(e) {
        e.preventDefault();
        navPendingCat = String($(this).data('cat') || '');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('addSiteModal')).show();
    });
    $('.nav-hub').on('click', '[data-cat-act]', function(e) {
        e.preventDefault();
        // 菜单收起由垫片按 data-bs-auto-close 处理(2026-11-14 起垫片真的实现了这个属性)
        const act = String($(this).data('cat-act'));
        // ⚠️ 分类名在 data-collapse-id 上;.nav-cat 的 data-category 只是"这是个分类"的裸标记,取不到值
        const cat = String($(this).closest('.nav-cat').data('collapse-id') || '');
        if (!cat) return;
        if (act === 'add') {
            navPendingCat = cat;
            bootstrap.Modal.getOrCreateInstance(document.getElementById('addSiteModal')).show();
            return;
        }
        const $li = $('#catOrderList li').filter(function() { return String($(this).data('cat')) === cat; });
        if (act === 'rename') {
            navPrompt({ title: '把分类「' + cat + '」改名为:', value: cat, placeholder: '新分类名(最多 50 字)' })
                .then(function(input) {
                    if (input === null) return;
                    const next = String(input).trim();
                    if (!next || next === cat) return;
                    $.ajax({
                        url: navCfgUrls().categoryRename, type: 'POST', contentType: 'application/json',
                        data: JSON.stringify({ old: cat, new: next }),
                        beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                        success: res => {
                            if (res && res.status === 'success') location.reload();
                            else showToast((res && res.message) || '改名失败');
                        },
                        error: xhr => {
                            let msg = '改名失败';
                            try { msg = JSON.parse(xhr.responseText).message || msg; } catch (err) {}
                            showToast(msg);
                        }
                    });
                });
            return;
        }
        if (!$li.length) { showToast('分类列表未就绪,刷新后再试'); return; }
        if (act === 'hide') {
            $li.addClass('cat-hidden');
        } else if (act === 'up') {
            const $prev = $li.prev('li');
            if (!$prev.length) return;
            $li.insertBefore($prev);
        } else if (act === 'down') {
            const $next = $li.next('li');
            if (!$next.length) return;
            $li.insertAfter($next);
        } else {
            return;
        }
        navSaveCategoryOrder();
    });

    // ===== 卡片右键菜单已统一到 static/js/card-menu.js(2026-11-13) =====
    // 这里原来还有一套 .nav-ctx 右键菜单,和 card-menu.js 同时监听 contextmenu:
    // 右键会在同一位置弹出两层菜单(1080 / 1085),看起来就是"菜单打架"。
    // 现在只保留功能更全的那一套(打开/编辑/星标/复制/排序/删除 + 触屏长按)。

    // 含子页的卡片 a 现在指向真实主站地址(href="#" 会吞掉 Ctrl/中键打开)。
    // 普通左键仍由 stars-filter.js 的 `.site-card[data-has-sub]` 委托拦成「主站 + 子页」弹窗,
    // 但那边没判组合键、一律 preventDefault —— 所以这里在捕获阶段先截住带修饰键的点击,
    // 让浏览器自己的「新标签页打开主站」照常发生(默认行为不受 stopPropagation 影响)。
    document.addEventListener('click', function(e) {
        if (e.button !== 0) return;                       // 只处理主键(中键另有 auxclick,本来就不拦)
        if (!(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return;
        if (!e.target.closest('.nav-hub a.site-card[data-has-sub]')) return;
        e.stopPropagation();                              // 只挡委托拦截,不挡浏览器默认动作
    }, true);

    // 卡片 ✎ 编辑:单表单预填(含小分类与子网页)
    $('.nav-hub').on('click', '.site-edit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const d = $(this).data();
        const subs = [];
        $(this).closest('[data-site-item]').find('.site-sub').each(function() {
            subs.push({name: String($(this).data('name') || ''), url: $(this).attr('href')});
        });
        const alts = [];
        $(this).closest('[data-site-item]').find('.site-alt').each(function() {
            alts.push({name: String($(this).data('name') || ''), url: $(this).attr('href')});
        });
        sfReset();
        editLock = true;
        editingId = d.id;
        sfAddForm({name: String(d.name || ''), url: String(d.url || ''),
                   category: String(d.category || ''), subcat: String(d.subcat || ''),
                   description: String(d.desc || ''), site_title: String(d.title || ''),
                   tags: String(d.tags || '').split(',').map(s=>s.trim()).filter(Boolean),
                   favicon: String(d.favicon || ''), children: subs, alternates: alts,
                   iconText: String(d.iconText || ''), iconColor: String(d.iconColor || ''), iconSize: d.iconSize || 0});
        $('#addSiteModalTitle').text('编辑站点');
        $('#addSiteSubmit').text('保存修改');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('addSiteModal')).show();
    });

    // 保存:新增模式逐个提交所有非空表单(批量),编辑模式提交单表单
    $('#addSiteSubmit').on('click', function() {
        const $btn = $(this).prop('disabled', true);
        $('#addFormError').text('');
        const jobs = [];
        let firstInvalid = null;
        $('#siteFormPanes .tab-pane').each(function() {
            const $pane = $(this);
            const $form = $pane.find('.sf-form');
            $form.find('.f-error').text('');
            const name = $form.find('.f-name').val().trim();
            const url = $form.find('.f-url').val().trim();
            if (!name && !url && !editingId) return; // 空白表单跳过(仅新增模式)
            if (!name || !url) {
                $form.find('.f-error').text('名称和网址必填');
                if (!firstInvalid) firstInvalid = $pane;
                return;
            }
            const children = [];
            $form.find('.f-subrows .sub-row').each(function() {
                const sn = $(this).find('.sub-name').val().trim();
                const su = $(this).find('.sub-url').val().trim();
                if (sn || su) children.push({name: sn, url: su});
            });
            const alternates = [];
            $form.find('.f-altrows .sub-row').each(function() {
                const an = $(this).find('.sub-name').val().trim();
                const au = $(this).find('.sub-url').val().trim();
                if (an || au) alternates.push({name: an, url: au});
            });
            const meta = $form.data('meta') || {};
            const pick = $form.data('iconPick') || {};
            jobs.push({
                $pane: $pane, $form: $form,
                payload: {
                    name: name, url: url,
                    category: $form.find('.f-cat').val().trim(),
                     subcat: (function() {
                         const p = $form.find('.f-subcat').val().trim();
                         const c = $form.find('.f-subcat2').val().trim();
                         return c ? (p ? p + ' / ' + c : c) : p;
                     })(),
                    description: $form.find('.f-desc').val().trim(),
                    site_title: meta.title || String($form.data('origTitle') || ''),
                    favicon: pick.mode === 'url' ? pick.url : (meta.favicon || String($form.data('origFavicon') || '')),
                    icon_text: pick.mode === 'text' ? String(pick.text || '') : '',
                    icon_color: pick.mode === 'text' ? String(pick.color || '') : '',
                    icon_size: pick.mode === 'text' ? (parseInt(pick.size, 10) || 0) : 0,
                    children: children,
                    alternates: alternates,
                    tags: $form.find('.f-tags').val().split(/[,，]/).map(s => s.trim()).filter(Boolean),
                },
            });
        });
        if (firstInvalid) { sfShowPane(firstInvalid); $btn.prop('disabled', false); return; }
        if (!jobs.length) { $('#addFormError').text('没有可保存的站点'); $btn.prop('disabled', false); return; }
        if (editingId) jobs.forEach(j => { j.payload.id = editingId; });
        const apiUrl = editingId ? NAV_SITE_URLS.edit : NAV_SITE_URLS.add;
        let okCount = 0;
        (function step(i) {
            if (i >= jobs.length) {
                if (okCount === jobs.length) {
                    // 「保存后继续添加」(2026-11-12):批量录入时不必反复开关弹窗
                    if (!editingId && $('#addSiteKeepOpen').is(':checked')) {
                        try { sfAddForm(); } catch (err) {}
                        $('#addFormError').text('');
                        $btn.prop('disabled', false);
                        showToast('已保存 ' + jobs.length + ' 条,可继续添加');
                        return;
                    }
                    try { sessionStorage.setItem('navPetWelcome', jobs.map(j => j.payload.name).slice(0, 3).join('、') + (jobs.length > 3 ? ' 等 ' + jobs.length + ' 个' : '')); } catch (e) {}
                    location.reload(); return;
                }
                $btn.prop('disabled', false);
                showToast(`成功 ${okCount} 条,失败 ${jobs.length - okCount} 条(见各表单红字)`);
                return;
            }
            const j = jobs[i];
            $.ajax({
                url: apiUrl, type: 'POST', contentType: 'application/json',
                data: JSON.stringify(j.payload),
                beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                success: function() { okCount++; step(i + 1); },
                error: function(xhr) {
                    j.$form.find('.f-error').text((xhr.responseJSON && xhr.responseJSON.message) || '保存失败');
                    sfShowPane(j.$pane);
                    step(i + 1);
                }
            });
        })(0);
    });

    // 删除站点:不问,直接删。原生 confirm 已全站下线(2026-10-30),而站点删除本来就能恢复
    // ——nav_delete 返回整行、nav_restore 原样建回,下面成功分支那条带「撤销」的 8 秒 toast
    // 就是这道确认的替代品:少一次点击,反悔的机会放在做完之后。
    $('.nav-hub').on('click', '.site-del', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $card = $(this).closest('[data-site-item]');
        const delName = String($(this).data('name') || '');
        $.ajax({
            url: NAV_SITE_URLS.delete, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({id: $(this).data('id')}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function(resp) {
                $card.remove();
                const $cat = $card.closest('[data-category]');
                if (!$cat.find('[data-site-item]').length) $cat.remove();
                const row = resp && resp.site;
                if (!row) { showToast('已删除'); return; }
                showToast('已删除「' + delName + '」', {label: '撤销', ms: 8000, fn: function() {
                    $.ajax({
                        url: NAV_SITE_URLS.restore, type: 'POST', contentType: 'application/json',
                        data: JSON.stringify({site: row}),
                        beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                        // 恢复后整页刷新:卡片是服务端渲染的,前端拼不出一模一样的子页/备用结构
                        success: function() { location.reload(); },
                        error: function(xhr) { showToast((xhr.responseJSON && xhr.responseJSON.message) || '恢复失败'); }
                    });
                }});
                if (window.navPetState) {   // 任务联动:送别搬走的站点
                    navPetState('fail');
                    navPetSay('「' + delName + '」搬走了,我送送它~', 2600);
                }
            },
            error: () => showToast('删除失败')
        });
    });

    // 编辑工具:只改名称/分类/简介(文件与托管地址不动,工具自己的本机数据保留)
    let toolEditId = null;
    $('.nav-hub').on('click', '.tool-edit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $b = $(this);
        toolEditId = $b.data('id');
        $('#toolEditName').val(String($b.data('name') || ''));
        $('#toolEditCategory').val(String($b.data('category') || ''));
        $('#toolEditDesc').val(String($b.data('desc') || ''));
        $('#toolEditError').text('');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('toolEditModal')).show();
    });
    $('#toolEditSubmit').on('click', function() {
        if (!toolEditId) return;
        $('#toolEditError').text('');
        const $btn = $(this).prop('disabled', true);
        $.ajax({
            url: NAV_SITE_URLS.toolEdit, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({id: toolEditId, name: $('#toolEditName').val().trim(),
                                  category: $('#toolEditCategory').val().trim(),
                                  description: $('#toolEditDesc').val().trim()}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function() { location.reload(); },
            error: function(xhr) {
                $btn.prop('disabled', false);
                $('#toolEditError').text((xhr.responseJSON && xhr.responseJSON.message) || '保存失败');
            }
        });
    });

    // C:选完文件立即把 <title>/meta description 回填到名称/简介(只填空字段,你填过的不动)
    $('#toolFile').on('change', function() {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function() {
            const doc = new DOMParser().parseFromString(String(reader.result || ''), 'text/html');
            const title = ((doc.querySelector('title') || {}).textContent || '').trim().slice(0, 100);
            const desc = ((doc.querySelector('meta[name="description"]') || {}).getAttribute('content') || '').trim().slice(0, 200);
            let filled = [];
            if (!$('#toolName').val() && title) { $('#toolName').val(title); filled.push('名称'); }
            if (!$('#toolDesc').val() && desc) { $('#toolDesc').val(desc); filled.push('简介'); }
            if (filled.length) showToast('已从文件回填' + filled.join('/') + ',可再改');
        };
        reader.readAsText(file);
    });

    // 上传 HTML 工具
    $('#addToolSubmit').on('click', function() {
        const fileInput = $('#toolFile')[0];
        $('#toolFormError').text('');
        if (!fileInput.files.length) { $('#toolFormError').text('请选择 .html / .htm 文件'); return; }
        const file = fileInput.files[0];
        if (!/\.html?$/i.test(file.name)) { $('#toolFormError').text('只支持 .html / .htm 单文件工具'); return; }
        if (file.size > 2 * 1024 * 1024) { $('#toolFormError').text('文件超过 2MB 上限'); return; }
        const fd = new FormData();
        fd.append('tool_file', file);
        fd.append('name', $('#toolName').val().trim());
        fd.append('category', $('#toolCategory').val().trim());
        fd.append('description', $('#toolDesc').val().trim());
        const $btn = $(this).prop('disabled', true);
        $.ajax({
            url: NAV_SITE_URLS.toolUpload, type: 'POST', data: fd,
            processData: false, contentType: false,
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function() { location.reload(); },
            error: function(xhr) {
                $btn.prop('disabled', false);
                $('#toolFormError').text((xhr.responseJSON && xhr.responseJSON.message) || '上传失败');
            }
        });
    });

    // 删除工具:文件会从库里一起移除,而且没有恢复通道(站点删除才有 nav_restore),
    // 所以这道确认必须留着——只是换成页内的 navConfirm,不再是锁整页的原生框。
    $('.nav-hub').on('click', '.tool-del', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $btn = $(this);
        navConfirm({
            title: '删除工具「' + String($btn.data('name') || '') + '」？',
            body: '文件会从库里一起移除，删掉不能恢复。',
            danger: true,
            confirmLabel: '删除',
            onOk: function() {
                const $card = $btn.closest('[data-site-item]');
                $.ajax({
                    url: NAV_SITE_URLS.toolDelete, type: 'POST', contentType: 'application/json',
                    data: JSON.stringify({id: $btn.data('id')}),
                    beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                    success: function() {
                        $card.remove();
                        if (!$('#toolsGrid [data-site-item]').length) {
                            $('#toolsGrid').html('<div class="col-12 text-muted small">还没有工具，点右上角"上传 HTML 工具"。</div>');
                        }
                        showToast('工具已删除');
                    },
                    error: () => showToast('删除失败')
                });
            }
        });
    });

    let catUrls = {}, catChildUrls = {}, siteMap = {};
    try {
        catUrls = JSON.parse(document.getElementById('navCatUrls').textContent) || {};
        catChildUrls = JSON.parse(document.getElementById('navCatChildUrls').textContent) || {};
        siteMap = JSON.parse(document.getElementById('navSiteMap').textContent) || {};
    } catch (err) {}
    window.siteMap = siteMap; window.catUrls = catUrls; window.catChildUrls = catChildUrls;   // linktest.js 取用

    // 齿轮快捷下拉:明暗只留一档「跟随系统」(2026-11-24 用户点名:三档和皮肤重叠)。
    // manual = 不跟随、固定浅色;想要深色去选「水墨」「书房」皮肤。
    // 老值 light/dark 的迁移写在 base.html 的早期脚本里(必须早于首帧 apply),这里只兜底。
    const NAV_CM_KEY = 'navColorMode';
    function navCmGet() {
        return localStorage.getItem(NAV_CM_KEY) === 'manual' ? 'manual' : 'auto';
    }
    function navPaintColorMode() {
        $('#setColorModeAuto').prop('checked', navCmGet() === 'auto');
    }
    $('#setColorModeAuto').on('change', function() {
        const on = this.checked;
        localStorage.setItem(NAV_CM_KEY, on ? 'auto' : 'manual');
        if (window.navSetColorMode) window.navSetColorMode(on ? 'auto' : 'manual');   // 真正切 data-bs-theme 在 base.html 的早期脚本里
        applyNavAccent(localStorage.getItem('navAccent') || '');                      // 主题色是明暗双档,切完要重算
        navPaintColorMode();
    });
    navPaintColorMode();

    // 全部设置面板形态:抽屉(默认)/ 居中弹窗,选择存本机(2026-11-12)。
    // 两种形态共用同一个 offcanvas 实例,只切 #navSettingsMenu 上的 nav-set-center;
    // 打开/关闭、遮罩、Esc、焦点都还是 Bootstrap 那套,不用再造一个 modal。
    (function initSetForm() {
        const key = 'navSetForm';
        function paint(v) {
            $('#navSettingsMenu').toggleClass('nav-set-center', v === 'center');
            $('#navSetFormGroup .btn').each(function() {
                const on = String($(this).data('set-form')) === v;
                $(this).toggleClass('btn-secondary', on).toggleClass('btn-outline-secondary', !on);
            });
        }
        const val = localStorage.getItem(key) === 'center' ? 'center' : 'drawer';
        paint(val);
        $('#navSetFormGroup').on('click', '.btn', function() {
            const v = String($(this).data('set-form')) === 'center' ? 'center' : 'drawer';
            localStorage.setItem(key, v);
            paint(v);
        });
    })();

    // 快捷下拉底部「全部设置 →」:先收起下拉,再打开右侧抽屉(抽屉里是原来的完整设置面板,含内置站点维护)
    $('#navOpenAllSettings').on('click', function() {
        $('#navQuickSettingsMenu').removeClass('show');
        $('#navSettingsToggle').attr('aria-expanded', 'false');
        bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('navSettingsMenu')).show();
    });

    // ===== 快捷工具条位置:顶部 / 左下 / 右下(2026-11-24 按用户口径改) =====
    // 管的是左下那组圆按钮(回顶 / 皮肤 / 明暗 / 收起),不是顶栏齿轮;
    // 齿轮固定顶栏,不再跟着三档搬动。
    const SETTINGS_DOCK_KINDS = ['top', 'bottom-left', 'bottom-right'];
    function settingsDockValue() {
        try {
            const v = localStorage.getItem('navSettingsDock');
            return SETTINGS_DOCK_KINDS.indexOf(v) >= 0 ? v : 'bottom-left';
        } catch (e) { return 'bottom-left'; }
    }
    function navApplySettingsDock(v) {
        const kind = SETTINGS_DOCK_KINDS.indexOf(v) >= 0 ? v : 'bottom-left';
        if (window.NavFixbar && typeof NavFixbar.setDock === 'function') {
            try { NavFixbar.setDock(kind); } catch (e) {}
        }
        $('#navSettingsDockGroup .btn').each(function() {
            const on = String($(this).data('settings-dock')) === kind;
            $(this).toggleClass('btn-secondary', on).toggleClass('btn-outline-secondary', !on);
        });
    }
    $('#navSettingsDockGroup').on('click', '.btn', function() {
        const v = String($(this).data('settings-dock'));
        try { localStorage.setItem('navSettingsDock', v); } catch (e) {}
        navApplySettingsDock(v);
    });
    navApplySettingsDock(settingsDockValue());

    // ===== 快捷设置:分段折叠 + 低频段默认收起(2026-11-24) =====
    // 现状是三段全展开近 700px,顶到屏幕底;这里把「外观/排列/显隐」改成可点标题,
    // 并把外观里的「背景」拆成子段(背景特效 + 壁纸提示 + 背景皮肤),默认收起。
    function navQuickSecCollapseInit() {
        const MENU = document.getElementById('navQuickSettingsMenu');
        if (!MENU) return;
        const KEY = 'navQuickSecCollapsed';
        const DEFAULT_COLLAPSED = ['bg', 'preset'];
        const T = function (zh) { return (window.NavI18n && NavI18n.t) ? NavI18n.t(zh) : zh; };
        function readSet() {
            try {
                const raw = localStorage.getItem(KEY);
                if (raw === null) return new Set(DEFAULT_COLLAPSED);
                const arr = JSON.parse(raw);
                return new Set(Array.isArray(arr) ? arr : DEFAULT_COLLAPSED);
            } catch (e) { return new Set(DEFAULT_COLLAPSED); }
        }
        function saveSet(s) { try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch (e) {} }
        const collapsed = readSet();
        function makeHead(text, cls) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = cls;
            b.innerHTML = '<span></span><i class="fas fa-chevron-down"></i>';
            b.firstChild.textContent = T(text);
            return b;
        }
        function bindFold(host, head, key) {
            head.addEventListener('click', function () {
                const on = !host.classList.contains('is-collapsed');
                host.classList.toggle('is-collapsed', on);
                if (on) collapsed.add(key); else collapsed.delete(key);
                saveSet(collapsed);
            });
            if (collapsed.has(key)) host.classList.add('is-collapsed');
        }
        const secs = Array.prototype.slice.call(MENU.querySelectorAll('.nav-quick-sec'));
        const SEC_KEYS = ['look', 'layout', 'preset', 'showhide'];
        secs.forEach(function (sec, i) {
            if (sec.dataset.quickFold === '1') return;
            const h = sec.querySelector('.form-text.small.mb-1');
            if (!h) return;
            const key = SEC_KEYS[i] || ('sec' + i);
            const head = makeHead(h.textContent.trim(), 'nav-quick-sec-h');
            h.replaceWith(head);
            const body = document.createElement('div');
            body.className = 'nav-quick-sec-body';
            while (head.nextSibling) body.appendChild(head.nextSibling);
            sec.appendChild(body);
            sec.dataset.quickFold = '1';
            bindFold(sec, head, key);
        });
        // 外观里的「背景」子段:背景特效 + 壁纸提示 + 背景皮肤(nav-skins 动态挂的那块)
        const look = secs[0];
        if (!look) return;
        let sub = look.querySelector('.nav-quick-sub[data-quick-sub="bg"]');
        let sb = sub && sub.querySelector('.nav-quick-sub-body');
        if (!sub) {
            const fx = look.querySelector('#navFxToggle');
            if (!fx) return;
            sub = document.createElement('div');
            sub.className = 'nav-quick-sub';
            sub.setAttribute('data-quick-sub', 'bg');
            const sh = makeHead('背景', 'nav-quick-sub-h');
            sb = document.createElement('div');
            sb.className = 'nav-quick-sub-body';
            sub.appendChild(sh);
            sub.appendChild(sb);
            fx.parentNode.insertBefore(sub, fx);
            sb.appendChild(fx);
            bindFold(sub, sh, 'bg');
        }
        // nav-skins 的控件可能晚一拍挂载:每轮把它收进子段(已在内则不动)
        const hint = look.querySelector('#navWallLockHintQuick');
        if (hint && hint.parentNode !== sb) sb.appendChild(hint);
        const skin = look.querySelector('.nav-skin-box');
        if (skin && skin.parentNode !== sb) sb.appendChild(skin);
    }
    navQuickSecCollapseInit();
    [0, 600, 1500].forEach(function (t) { setTimeout(navQuickSecCollapseInit, t); });

    // 旧版本曾把齿轮挪到角落;模板每页重建 #navSettingsWrap,这里只清残留定位类。
    (function resetSettingsWrap() {
        const wrap = document.getElementById('navSettingsWrap');
        if (!wrap) return;
        wrap.classList.remove('nav-settings-dock', 'nav-settings-dock--bl', 'nav-settings-dock--br');
    })();

    // ===== P1 · R-12 / R-13 / R-16 / R-09 新增导航链路 =====
    // 边界:只消费模板已渲染的 DOM 与既有上下文;零网络请求;不另建第二套滚动监听 / 存储层。
    // 滚动高亮唯一真相是既有 navTocSpy(stars-filter.js)与 nav-ux.js 写入 #navToc 链接的
    // .active 类;下方经 MutationObserver 观察该类变化派生 Tabs / 胶囊 / 面包屑,不自己算滚动位置。
    const navSpyDependentSync = [];
    // #navGroups 子树重渲染(筛选/搜索/切分类替换卡片)后的派生重跑钩子;
    // 复用 R-16 同一个 MutationObserver,不另起第二套观察器。
    const navGroupsMutateSync = [];

    // 当前被目录高亮的链接(可能是大类 / 二级 / 三级)
    function navActiveTocLink() {
        return document.querySelector('#navToc .toc-scroll a.active') || null;
    }
    // 由高亮链接反推所属大类锚点(二级 / 三级链接回挂到其 .toc-item 的大类行链接)
    function tocLinkGroupAnchor(a) {
        if (!a) return '';
        const item = a.closest('.toc-item');
        const rowA = item ? item.querySelector(':scope > .toc-row a') : null;
        const href = (rowA || a).getAttribute('href') || '';
        return href.charAt(0) === '#' ? href : '';
    }
    // 锚点定位:补偿顶栏 + 吸顶分组条高度;CSS 既有 scroll-margin-top 仍兜底
    function navAnchorOffset() {
        let h = 0;
        const bar = document.querySelector('.nav-topbar');
        if (bar) h += bar.getBoundingClientRect().height;
        const tabs = document.getElementById('navGroupTabs');
        if (tabs) h += tabs.getBoundingClientRect().height;
        return h + 8;
    }
    function navScrollToAnchor(target) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY - navAnchorOffset();
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    // ----- R-12 顶部分类溢出 More:横滚条可用宽 vs 子项总宽,溢出项移入 More 下拉 -----
    function initCatStrip() {
        const $strip = $('#navCatStrip');
        if (!$strip.length) return;
        const $scroll = $('#navCatStripScroll');
        const $menu = $('#navCatMoreMenu');
        const $wrap = $('#navCatMoreWrap');
        const $btn = $('#navCatMoreBtn');
        let lastSig = '';
        // 每次测量前重新查询清单:横滚条内 + More 菜单内的真实 chip 都纳入,
        // 按 data-cat-target 去重;#navCatMoreBtn 自身带 nav-cat-chip 类,必须排除。
        function queryChips() {
            const seen = new Set();
            const out = [];
            $scroll.find('.nav-cat-chip').add($menu.find('.nav-cat-chip'))
                .not('#navCatMoreBtn').each(function() {
                    if (!seen.has(this)) { seen.add(this); out.push(this); }
                });
            return out;
        }
        function inMenu(el) { return $menu.length && $.contains($menu[0], el); }
        function measure() {
            const chips = queryChips();
            // 2026-11-23:分类条只服务窄屏。桌面上它和吸顶 #navGroupTabs 会并排出现,
            // 分类标题上方因此叠了两条一模一样的分类名;单分类时两套都没有导航价值。
            const narrow = window.matchMedia('(max-width: 991.98px)').matches;
            const visible = chips.filter(function(el) { return el.getClientRects().length > 0; });
            if (!narrow || visible.length < 2) { $strip.addClass('d-none'); return; }
            $strip.removeClass('d-none');
            const avail = $scroll[0].clientWidth;
            const gap = parseFloat(getComputedStyle($scroll[0]).columnGap) ||
                        parseFloat(getComputedStyle($scroll[0]).gap) || 8;
            let used = 0, overflow = false;
            const plan = visible.map(function(el) {
                const w = el.getBoundingClientRect().width; // 每帧实测,避免尺寸变化后读陈旧缓存
                if (!overflow && used + w > avail) overflow = true;
                if (!overflow) used += w + gap;
                return { el: el, menu: overflow, target: el.dataset.catTarget || '' };
            });
            const sig = plan.map(function(p) {
                return (p.menu ? 'M' : 'S') + '|' + p.target;
            }).join(';');
            if (sig === lastSig) return; // 布局签名一致:自家移动不二次写入,防自激
            plan.forEach(function(p) {
                const el = p.el;
                const $clone = $menu.find('.dropdown-item').filter(function() {
                    return $(this).data('cat-target') === p.target;
                });
                const parked = inMenu(el);
                if (p.menu && !parked) { $menu.append(el); $clone.addClass('d-none'); }
                else if (!p.menu && parked) { $scroll.append(el); $clone.removeClass('d-none'); }
                else if (!p.menu) { $clone.removeClass('d-none'); }
                else { $clone.addClass('d-none'); }
            });
            const $more = $wrap.length ? $wrap : $btn;
            $more.toggleClass('d-none', !overflow);
            lastSig = sig;
        }
        function jump(el) {
            const target = String($(el).data('cat-target') || '');
            if (target) navScrollToAnchor(target);
        }
        $scroll.on('click', '.nav-cat-chip', function() { jump(this); });
        $menu.on('click', '.nav-cat-chip, .dropdown-item', function() { jump(this); });
        navResizeHooks.push(measure);
        navCatNavRefreshHooks.push(measure);
        // 运行时增删 chip:子树 childList 变化经 rAF 合并后重算;自家移动幂等 + 签名比对,不构成循环。
        if (window.MutationObserver) {
            let raf = 0;
            function schedule() {
                if (raf) return;
                raf = requestAnimationFrame(function() { raf = 0; measure(); });
            }
            const mo = new MutationObserver(schedule);
            mo.observe($scroll[0], { childList: true, subtree: true });
            if ($menu[0]) mo.observe($menu[0], { childList: true, subtree: true });
        }
        measure();
    }

    // ----- R-13 吸顶分组 Tabs:点击定位 + 滑块跟随;高亮由目录 spy 的 active 派生 -----
    function initGroupTabs() {
        const $tabs = $('#navGroupTabs');
        if (!$tabs.length) return;
        const $slider = $('#groupTabsSlider');
        const $allTabs = $tabs.find('.group-tab');
        if (!$allTabs.length) return;
        function moveSlider(tabEl) {
            if (!$slider.length) return;
            if (!tabEl) { $slider.css('transform', 'translateX(0px)'); return; }
            $slider.css({ width: tabEl.offsetWidth + 'px',
                          transform: 'translateX(' + tabEl.offsetLeft + 'px)' });
        }
        function setActive($tab) {
            $tabs.find('.group-tab').removeClass('active');
            if ($tab && $tab.length) {
                $tab.addClass('active');
                moveSlider($tab[0]);
                $tab[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } else {
                moveSlider(null);
            }
        }
        $tabs.on('click', '.group-tab', function() {
            const $t = $(this);
            setActive($t);
            const target = String($t.data('group-target') || '');
            if (target) navScrollToAnchor(target);
        });
        function syncFromSpy() {
            const groupHref = tocLinkGroupAnchor(navActiveTocLink());
            const $t = $tabs.find('.group-tab').filter(function() {
                return String($(this).data('group-target')) === groupHref;
            });
            setActive($t);
        }
        syncFromSpy();
        navSpyDependentSync.push(syncFromSpy);
        // 2026-11-23:只在桌面且可见分组 ≥2 时露出;窄屏由分类条负责,避免两套分类名叠加
        function refresh() {
            const wide = window.matchMedia('(min-width: 992px)').matches;
            const visible = $allTabs.filter(function() { return this.getClientRects().length > 0; });
            if (!wide || visible.length < 2) { $tabs.addClass('d-none'); return; }
            $tabs.removeClass('d-none');
            const $active = $tabs.find('.group-tab.active');
            if ($active.length) moveSlider($active[0]);
        }
        refresh();
        navResizeHooks.push(refresh);
        navCatNavRefreshHooks.push(refresh);
    }

    // ----- R-09 二级胶囊:按当前一级分类的二级分类填充;点击 / 横滚联动 + aria-current -----
    // 抽屉开合复用既有 offcanvas 钩子(tocCloseDrawer / #navTocBackdrop),本函数不另写开关;无持久化键。
    function initSubCapsule() {
        const $cap = $('#navSubCapsule');
        if (!$cap.length) return;
        let lastGroupId = '';
        function setCurrent($el) {
            $cap.find('.nav-sub-capsule').removeAttr('aria-current');
            if ($el && $el.length) $el.attr('aria-current', 'true');
        }
        // 标题取文本节点,剔除数量徽章(.text-muted / .badge / 计数节点)与 R-19 入口按钮,不带数字/按钮文案进胶囊
        function titleText(titleEl) {
            const clone = titleEl.cloneNode(true);
            clone.querySelectorAll('.text-muted, .badge, .toc-num, [class*="count"], .nav-sub-enter').forEach(function(n) { n.remove(); });
            return clone.textContent.trim();
        }
        // R-20 深:块对应的完整 subcat 串取 data-collapse-id 首段斜杠之后;三级 leaf 的末段含「父 / 子」。
        // 模型仍是扁平 NavSite.subcat,层级仅为串内分隔符约定(views_nav_check NAV_SUBCAT_SEPS),不改模型。
        function subcatFull(bl) {
            const cid = String(bl.dataset.collapseId || '');
            const slash = cid.indexOf('/');
            const rest = slash >= 0 ? cid.slice(slash + 1).trim() : '';
            if (rest) return rest;
            const titleEl = bl.querySelector('.nav-sub-title, .nav-sub2-title');
            return titleText(titleEl || bl);
        }
        // 按首个「 / 」或「 > 」拆两段(第一段=二级,第二段=三级);无分隔符或拆出某侧为空时保持一段。
        function splitDepth(txt) {
            const s = (txt || '').trim();
            if (!s) return [];
            const seps = [' / ', ' > '];
            for (let k = 0; k < seps.length; k++) {
                const i = s.indexOf(seps[k]);
                if (i >= 0) {
                    const a = s.slice(0, i).trim(), b = s.slice(i + seps[k].length).trim();
                    return a && b ? [a, b] : [s];
                }
            }
            return [s];
        }
        function groupFromAnchor(href) {
            if (!href) return null;
            const el = document.getElementById(String(href).slice(1));
            return el && el.classList.contains('nav-cat') ? el : null;
        }
        // 只取当前一级分类下可见且带卡片的二级块;直属站块(data-collapse-id 末段为空)跳过;
        // 筛选/搜索后整块被隐藏或卡片全部藏起的块也不进胶囊,不留空壳。
        function subBlocks(groupEl) {
            if (!groupEl) return [];
            return Array.from(groupEl.querySelectorAll('.nav-sub[id^="navSub"], .nav-sub2[id^="navSub"]')).filter(function(bl) {
                const parts = String(bl.dataset.collapseId || '').split('/');
                if (parts.length < 2 || !parts[1]) return false;
                if (bl.style.display === 'none' || getComputedStyle(bl).display === 'none') return false;
                const items = bl.querySelectorAll('[data-site-item]');
                const probe = items.length ? items : bl.querySelectorAll('.site-card');
                return Array.from(probe).some(function(c) {
                    return c.style.display !== 'none' && getComputedStyle(c).display !== 'none';
                });
            });
        }
        function render(groupEl, activeHref) {
            // 重渲染 / 高亮丢失时沿用上次分组;分组本身已不存在才回退空态
            if (!groupEl && lastGroupId) groupEl = document.getElementById(lastGroupId);
            const subs = subBlocks(groupEl);
            const prevTarget = $cap.find('.nav-sub-capsule[aria-current="true"]').data('capsule-target') || '';
            $cap.empty();
            if (!subs.length) { $cap.addClass('d-none'); if (!document.getElementById(lastGroupId)) lastGroupId = ''; return; }
            subs.forEach(function(bl) {
                const $btn = $('<button type="button" class="nav-sub-capsule">')
                    .attr('data-capsule-target', bl.id);
                splitDepth(subcatFull(bl)).forEach(function(part) {
                    if (part) $('<span class="nav-sub-capsule-seg"></span>').text(part).appendTo($btn);
                });
                $btn.appendTo($cap);
            });
            $cap.removeClass('d-none');
            lastGroupId = groupEl ? groupEl.id : '';
            let $c = $cap.find('.nav-sub-capsule').filter(function() {
                return String($(this).data('capsule-target')) === activeHref;
            });
            if (!$c.length && prevTarget) {
                $c = $cap.find('.nav-sub-capsule').filter(function() {
                    return String($(this).data('capsule-target')) === prevTarget;
                });
            }
            setCurrent($c);
            if ($c.length) $c[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        function activeGroupEl() {
            // R-19 过滤态:胶囊跟随被过滤的二级块所属大类,不被滚动 spy 的漂移高亮带空(与过滤态并存)
            const filtered = document.querySelector('.is-sub-filter-target');
            if (filtered) { const fc = filtered.closest('.nav-cat'); if (fc) return fc; }
            const a = navActiveTocLink();
            const g = groupFromAnchor(tocLinkGroupAnchor(a));
            if (g) return g;
            if (lastGroupId) { const lg = document.getElementById(lastGroupId); if (lg) return lg; }
            return document.querySelector('#navGroups > .nav-cat:not([style*="display: none"])') || null;
        }
        function syncFromSpy() {
            const a = navActiveTocLink();
            render(activeGroupEl(), a ? (a.getAttribute('href') || '') : '');
        }
        $cap.on('click', '.nav-sub-capsule', function() {
            const $c = $(this);
            setCurrent($c);
            const target = String($c.data('capsule-target') || '');
            if (!target) return;
            const bl = document.getElementById(target);
            // 折叠态先展开:摘 is-collapsed 与箭头 rot,再定位
            if (bl && bl.classList.contains('is-collapsed')) {
                bl.classList.remove('is-collapsed');
                const chev = bl.querySelector('.cheve');
                if (chev) chev.classList.remove('rot');
            }
            navScrollToAnchor(target);
            // 窄屏抽屉开着时,点胶囊定位后复用既有关闭钩子收起;桌面推开式不动
            if (window.innerWidth < 992 && $('.nav-hub').hasClass('toc-open')) tocCloseDrawer();
        });
        syncFromSpy();
        navSpyDependentSync.push(syncFromSpy);
        // 重渲染后重跑派生:保留 aria-current,目标块已不存在则随空壳一并移除
        navGroupsMutateSync.push(syncFromSpy);
    }

    // ----- R-19 二级子页入口:前端过滤态(只看某二级块);清除恢复;与 R-13 Tabs / R-09 胶囊并存 -----
    // 纯前端:零请求、无持久化键;显隐走 .nav-hub 类名 + 块级标记类,不写内联 display,不动既有搜索/折叠样式。
    function initSubFilter() {
        const $bar = $('#navSubFilterBar');
        if (!$bar.length) return;
        const $hub = $('.nav-hub');
        const $groups = $('#navGroups');
        let activeId = '';

        function blockName(bl) {
            const titleEl = bl.querySelector('.nav-sub-title, .nav-sub2-title');
            const clone = (titleEl || bl).cloneNode(true);
            clone.querySelectorAll('.text-muted, .badge, .toc-num, [class*="count"], .nav-sub-enter').forEach(function(n) { n.remove(); });
            return clone.textContent.trim();
        }
        function catName(catEl) {
            const nm = catEl ? catEl.querySelector('.nav-cat-name') : null;
            return nm ? nm.textContent.trim() : (catEl ? String(catEl.dataset.collapseId || '') : '');
        }
        function applyFilter(bl) {
            if (!bl) return;
            activeId = bl.id;
            const cat = bl.closest('.nav-cat');
            // 折叠态先展开:摘 is-collapsed 与箭头 rot,与胶囊点击同口径
            if (bl.classList.contains('is-collapsed')) {
                bl.classList.remove('is-collapsed');
                const chev = bl.querySelector('.cheve');
                if (chev) chev.classList.remove('rot');
            }
            $groups.find('.is-sub-filter-cat').removeClass('is-sub-filter-cat');
            $groups.find('.is-sub-filter-target').removeClass('is-sub-filter-target');
            if (cat) cat.classList.add('is-sub-filter-cat');
            bl.classList.add('is-sub-filter-target');
            $bar.find('.nav-sub-filter-crumb-cat').text(catName(cat));
            $bar.find('.nav-sub-filter-crumb-sub').text(blockName(bl));
            $hub.addClass('nav-sub-filter-on');
            $bar.removeClass('d-none');
            navScrollToAnchor(bl);
        }
        function clearFilter() {
            activeId = '';
            $hub.removeClass('nav-sub-filter-on');
            $groups.find('.is-sub-filter-cat').removeClass('is-sub-filter-cat');
            $groups.find('.is-sub-filter-target').removeClass('is-sub-filter-target');
            $bar.find('.nav-sub-filter-crumb-cat').text('');
            $bar.find('.nav-sub-filter-crumb-sub').text('');
            $bar.addClass('d-none');
        }
        // 捕获阶段拦点击:先于 .nav-hub 上的 .collapsible 委托(stars-filter.js)拦截,
        // stopPropagation 阻止冒泡到折叠标题,入口按钮不触发折叠切换。
        document.addEventListener('click', function(e) {
            const btn = e.target && e.target.closest ? e.target.closest('.nav-sub-enter') : null;
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const id = String(btn.dataset.subEnter || '');
            const bl = id ? document.getElementById(id.slice(1)) : null;
            applyFilter(bl);
        }, true);
        $bar.on('click', '.nav-sub-filter-clear', function(e) {
            e.preventDefault();
            clearFilter();
        });
        // 与 R-12 分类条 / R-13 Tabs / R-09 胶囊并存:点向过滤范围外的块时先退出过滤态,避免落到隐藏块
        $(document).on('click', '.group-tab, .nav-cat-chip, .nav-sub-capsule', function() {
            if (!activeId) return;
            const raw = String($(this).data('group-target') || $(this).data('cat-target') ||
                                $(this).data('capsule-target') || '');
            if (!raw) return;
            const target = raw.charAt(0) === '#' ? raw.slice(1) : raw;
            const bl = document.getElementById(target);
            if (bl && !bl.classList.contains('is-sub-filter-target') &&
                !bl.closest('.is-sub-filter-target')) clearFilter();
        });
    }

    // ----- R-16 面包屑:由目录当前激活项派生层级;guest 态同套节点只读渲染 -----
    function paintNavCrumb(a) {
        const $crumb = $('#navCrumb');
        if (!$crumb.length) return;
        let $list = $crumb.find('ol').first();
        if (!$list.length) { $list = $('<ol class="nav-crumb-list"></ol>').appendTo($crumb); }
        $list.empty();
        if (!a) { $crumb.addClass('d-none').attr('aria-hidden', 'true'); return; }
        const item = a.closest('.toc-item');
        const rowA = item ? item.querySelector(':scope > .toc-row a') : null;
        const levels = [];
        const isSub3 = a.classList.contains('toc-sub3');
        const isSub = a.classList.contains('toc-sub');
        if (rowA && rowA !== a) levels.push(rowA);
        if (isSub3) {
            const subs3 = a.closest('.toc-subs3');
            const subA = subs3 ? subs3.parentElement.querySelector(':scope > a.toc-sub') : null;
            if (subA) levels.push(subA);
        }
        if (isSub || isSub3) levels.push(a);
        else if (rowA) levels.push(rowA);
        else levels.push(a);
        function crumbText(link) {
            const src = link.querySelector('.text-truncate') || link;
            const clone = src.cloneNode(true);
            clone.querySelectorAll('.toc-num, .badge, .toc-count, .count, [class*="count"]').forEach(function(n) { n.remove(); });
            return clone.textContent.trim();
        }
        // 2026-11-24 按用户口径:面包屑就是「我现在在哪」,只显示当前分类(一层)也要给;
        // 只有真的拿不到任何层级时才隐藏。
        if (!levels.length) {
            $crumb.addClass('d-none').attr('aria-hidden', 'true');
            return;
        }
        levels.forEach(function(link, i) {
            const li = document.createElement('li');
            li.className = 'nav-crumb-item';
            if (i === levels.length - 1) li.setAttribute('aria-current', 'page');
            li.textContent = crumbText(link);
            $list[0].appendChild(li);
        });
        $crumb.removeClass('d-none').attr('aria-hidden', 'false');
    }
    function initNavCrumb() {
        if (!$('#navCrumb').length) return;
        function syncFromSpy() { paintNavCrumb(navActiveTocLink()); }
        syncFromSpy();
        navSpyDependentSync.push(syncFromSpy);
    }

    // ----- R-16 加载环:首绘 / 既有筛选重渲染前后切显隐;不新拉数据、不发请求 -----
    function initNavLoadRing() {
        const $ring = $('#navLoadRing');
        if (!$ring.length) return;
        let hideTimer = 0;
        function show() { $ring.removeClass('d-none'); }
        function hide() { $ring.addClass('d-none'); }
        show();
        function hideOnReady() { if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(hide, 120); }
        if (document.readyState === 'complete') hideOnReady();
        else window.addEventListener('load', hideOnReady);
        // 既有筛选 / 排序 / 标签重渲染只回写卡片内联 display(本地 DOM,不走网络);
        // 观察该产物批量收尾后收环。stars-filter 未暴露完成回调,这里只观察既有 DOM 变化。
        if (window.MutationObserver) {
            const groups = document.getElementById('navGroups');
            if (groups) {
                new MutationObserver(function() {
                    show();
                    if (hideTimer) clearTimeout(hideTimer);
                    hideTimer = setTimeout(hide, 120);
                    // 子树重渲染后重跑派生视图(胶囊等);复用本观察器,不另起第二套
                    navGroupsMutateSync.forEach(function(fn) { if (typeof fn === 'function') fn(); });
                }).observe(groups, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
            }
        }
    }

    // ----- R-16 开发态测试钩子:仅 ?navTest=1 挂载;无网络请求、不写存储、无参数访问零差异 -----
    function initP1TestHooks() {
        if (!/[?&]navTest=1(&|$)/.test(location.search)) return;
        const $ring = $('#navLoadRing');
        let emptySnapshot = null;
        window.NavP1TestHooks = {
            showRing: function() { $ring.removeClass('d-none'); },
            hideRing: function() { $ring.addClass('d-none'); },
            forceEmpty: function(on) {
                const $groups = $('#navGroups > .nav-cat');
                if (on) {
                    emptySnapshot = $groups.map(function() { return this.style.display; }).get();
                    $groups.css('display', 'none');
                    $('#navNoResult').removeClass('d-none');
                } else {
                    if (emptySnapshot) {
                        $groups.each(function(i) { this.style.display = emptySnapshot[i] || ''; });
                        emptySnapshot = null;
                    }
                    $('#navNoResult').addClass('d-none');
                }
            }
        };
    }

    // 目录 spy active 变化的唯一观察口:一个 MutationObserver 驱动上面三个派生视图,
    // 不另起滚动监听、不重复算高亮。
    function initSpyDependentSync() {
        const toc = document.getElementById('navToc');
        if (!toc) return;
        function runAll() { navSpyDependentSync.forEach(function(fn) { if (typeof fn === 'function') fn(); }); }
        if (window.MutationObserver) {
            new MutationObserver(runAll).observe(toc, { subtree: true, attributes: true, attributeFilter: ['class'] });
        }
    }

    // 初始化链尾部接入(时机与 initPresetSync 同级;DOM 未落地时各 init 内部按选择器长度空转)
    initNavDescLines();
    initTocWidth();
    initCatStrip();
    initGroupTabs();
    initSubCapsule();
    initSubFilter();
    initNavCrumb();
    initNavLoadRing();
    initP1TestHooks();
    initSpyDependentSync();
    // 供设置面板「显示内置网站」开关调用:可见分组数变了,两套分类导航重算显隐
    window.navRefreshCatNav = function() {
        navCatNavRefreshHooks.forEach(function(fn) { try { fn(); } catch (e) {} });
        if (window.navSyncBuiltinTip) window.navSyncBuiltinTip();
    };

    // ===== D7 多选模式:计数 / 禁用态 / 全选范围 / 二次确认 行为层 =====
    // 主操作条 DOM 由 batch.js 渲染(选中集合在它闭包内),这里只经 DOM 状态做外层收口:
    // 计数按 .ms-sel 卡片实时统计;0 项时变更类批量按钮禁用并同步 aria-disabled;全选按钮
    // 文案标明作用范围(当前可见 = 经过搜索/标签/分类筛选后的结果);一次全选 >10 项时经
    // window.navConfirm 二次确认,不引入原生 confirm。访客内联工具条经 window.navBulk
    // 的同名 helper 收口(模板迁移见报告 Markup 需求)。
    (function initBulkBehavior() {
        const ACTION_BTNS = ['#navMsGoOpen', '#navMsGoStar', '#navMsGoDel', '#navMsGoCopy',
            '#navMsGoCat', '#navMsGoTags', '#navMsGoArch'];
        let barObserver = null;
        let programmaticAll = false;
        let syncingBar = false;   // 防重入:观察器回调里改文案/属性会再触发回调,守卫断掉循环

        function selCount() { return document.querySelectorAll('.nav-hub .ms-sel').length; }
        function visibleCount() {
            return Array.prototype.filter.call(
                document.querySelectorAll('.nav-hub [data-site-item][data-id]'),
                function (c) { return c.offsetParent !== null; }
            ).length;
        }
        // 写前比对:先读回当前 DOM 值,相等直接 return,避免同值重写触发
        // #navMsBar 子树 childList 观察器再次回调形成自激循环(D7 修法①,非时间窗去重)。
        function setTextIfChanged($el, text) {
            if (!$el || !$el.length) return false;
            if ($el[0].textContent === text) return false;
            $el[0].textContent = text;
            return true;
        }
        function setAttrIfChanged($el, name, val) {
            if (!$el || !$el.length) return false;
            const el = $el[0];
            const want = val == null ? null : String(val);
            if (el.getAttribute(name) === want) return false;
            if (want == null) el.removeAttribute(name); else el.setAttribute(name, want);
            return true;
        }
        function setPropIfChanged($el, name, val) {
            if (!$el || !$el.length) return false;
            if ($el.prop(name) === val) return false;
            $el.prop(name, val);
            return true;
        }
        function syncBar() {
            const $bar = $('#navMsBar');
            if (!$bar.length || syncingBar) return;
            syncingBar = true;
            try {
            const n = selCount();
            const $label = $bar.find('b.small');
            setTextIfChanged($label, '已选 ' + n + ' 项');
            const $all = $bar.find('#navMsGoAll');
            setTextIfChanged($all, '全选当前可见(' + visibleCount() + ' 项)');
            const disabled = n === 0;
            ACTION_BTNS.forEach(function (sel) {
                const $b = $bar.find(sel);
                if (!$b.length) return;
                setPropIfChanged($b, 'disabled', disabled);
                setAttrIfChanged($b, 'aria-disabled', disabled ? 'true' : 'false');
            });
            if (window.MutationObserver && !barObserver) {
                barObserver = new MutationObserver(syncBar);
                barObserver.observe($bar[0], { childList: true, subtree: true });
            }
            } finally { syncingBar = false; }
        }
    // 全选 >10 项二次确认;确认后用程序点击放行,避免再次进确认框。
        document.addEventListener('click', function (e) {
            const $all = e.target.closest ? e.target.closest('#navMsGoAll') : null;
            if (!$all) return;
            if (programmaticAll) { programmaticAll = false; return; }
            const n = visibleCount();
            if (n <= 10) return;
            e.preventDefault();
            e.stopPropagation();
            window.navConfirm({
                title: '一次选中 ' + n + ' 个站点？',
                body: '当前可见结果共 ' + n + ' 个站点,全选后可批量打开 / 收藏 / 分类 / 删除。',
                confirmLabel: '全选',
                onOk: function () { programmaticAll = true; $all.click(); }
            });
        }, true);
        // 勾选/取消后同步按钮态与计数(委托在 document,卡片与复选框都走得到)
        document.addEventListener('click', function () { requestAnimationFrame(syncBar); }, true);
        document.addEventListener('change', function () { requestAnimationFrame(syncBar); }, true);

        // 顶栏多选按钮:active / aria-pressed / aria-label 与 body.bulk-mode 同步
        function syncToggle() {
            const btn = document.getElementById('navBulkToggle');
            if (!btn) return;
            const on = document.body.classList.contains('bulk-mode');
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.setAttribute('aria-label', on ? '退出多选模式' : '批量选择');
        }
        if (window.MutationObserver) {
            new MutationObserver(syncToggle).observe(document.body,
                { attributes: true, attributeFilter: ['class'] });
        }

        // #11:并入而非覆盖 batch.js / nav-guest-batch.js 挂到同一对象的 enter/exit/isActive/
        // count/render/selectAll;这里只补视图侧的计数与同步辅助。
        window.navBulk = Object.assign(window.navBulk || {}, {
            // count 由两端闭包各自派生(主人 sel.size / 访客选中表),此处不覆盖
            visibleCount: visibleCount,
            syncBar: syncBar,
            syncToggle: syncToggle,
            // 访客内联工具条:按钮文案与多选状态保持一致(靠右布局归 CSS)
            toggleLabel: function (btn, active) {
                if (!btn) return;
                btn.textContent = active ? '退出多选' : '多选';
                btn.classList.toggle('active', !!active);
            },
            confirmBulkSelect: function (n) {
                return window.navConfirm({
                    title: '一次选中 ' + n + ' 个站点？',
                    body: '全选后可批量打开 / 收藏 / 分类 / 删除。',
                    confirmLabel: '全选'
                });
            }
        });
    })();

});


    /* ===== 顶栏下拉:点完条目就收起(2026-11-13 精修) ==========================
       Bootstrap 垫片只在「点菜单外」时才关菜单:点「上传工具」会弹出弹窗,但下拉
       还浮在上面;点主题/数据条目也一样留着。顶栏这几个菜单全是一次性动作,点完即收。 */
    document.addEventListener('click', function (e) {
        const item = e.target.closest('.nav-bar .dropdown-menu .dropdown-item');
        if (!item) return;
        const menu = item.closest('.dropdown-menu');
        if (!menu) return;
        menu.classList.remove('show');
        if (menu._uiToggle) menu._uiToggle.setAttribute('aria-expanded', 'false');
    }, false);
