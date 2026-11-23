/* nav-tip.js — 统一 Tooltip(2026-11-13)
 *
 * 为什么单独一个文件:纯图标按钮、状态圆点、收藏星、搜索框问号都要提示,
 * 各写各的会出现四五套手感(浏览器原生 title 还是浅色小方块,飘得又慢)。
 * 这里只做一件事:给带 data-tip 的元素一个深色半透明小气泡。
 *
 * 用法:
 *   <button data-tip="标签管理">…</button>
 *   <span data-tip="测活异常:上次检测无法访问&#10;2 小时前检测 · HTTP 500"></span>
 *   data-tip-pos="top|bottom|left|right"  可强制方向,默认按空间自动翻转
 *
 * 手感的几个硬指标(用户在上一版特别提过):
 *   1. 悬停 260ms 才弹 —— 卡片区那么密,鼠标一划就满屏闪很烦
 *   2. 深色半透明 + 小圆角 + 轻微上浮,不抢内容
 *   3. 第一行当标题加粗,后面的行变淡,长说明也不用挤成一段
 *   4. 触屏不靠 hover:点一下也能固定住(见 window.navTipToggle)
 *
 * ⚠️ 与下拉菜单的关系(2026-11-13 修):
 *   气泡是 fixed + z-index 2200,菜单就落在按钮正下方 —— 顶栏点开下拉时,
 *   气泡会把第一行条目整块盖住,看起来就是"tooltip 和下拉列表打架"。
 *   现在三条规矩:
 *     a. 任何一个下拉展开/收起,气泡先收起;
 *     b. 自己的菜单开着时,触发器不再弹气泡(内容重复,还挡菜单);
 *     c. 菜单条目自带的 data-tip 改放左右两侧,不压住相邻行。
 *
 * 纯 DOM,不依赖 jQuery,不发请求;只在真有 data-tip 的地方工作。
 */
(function () {
    'use strict';

    var SHOW_DELAY = 260;      // 悬停多久才弹
    var HIDE_DELAY = 90;       // 移开多久收起(留一点余量,手抖不闪)
    var GAP = 8;               // 气泡与目标的间距
    var EDGE = 8;              // 距视口边缘的最小留白
    var MAX_W = 300;

    var bubble = null;
    var anchor = null;         // { el, text }
    var pinned = false;        // 点开后固定,点空白才收
    var open = false;          // 气泡当前可见(淡出中为 false)
    var showTimer = 0;
    var hideTimer = 0;
    var hideToken = 0;         // 淡出计时令牌:期间又 show 过就作废
    var lastPointerAt = 0;     // 最近一次指针按下,用于区分"鼠标点出来的焦点"

    function reduceMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function ensureBubble() {
        if (bubble) return bubble;
        bubble = document.createElement('div');
        bubble.className = 'nav-tip';
        bubble.setAttribute('role', 'tooltip');
        bubble.style.display = 'none';
        document.body.appendChild(bubble);
        return bubble;
    }

    function splitLines(text) {
        return String(text || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }

    /* 目标所在 .dropdown 的菜单是不是正开着。开着就一律不弹:
       气泡 z-index 2200 会整块压在菜单上,这是"打架"的主要来源。 */
    function menuOpenFor(el) {
        // 菜单条目自己不算:它靠 place() 摆到菜单外侧,压不到菜单行
        // (这里判成 true 会把菜单里的 data-tip 全部压死 —— 2026-11-13 实测踩到)
        if (inMenu(el)) return false;
        var dd = el.closest ? el.closest('.dropdown') : null;
        if (!dd) return false;
        var menu = dd.querySelector('.dropdown-menu');
        return !!(menu && menu.classList.contains('show'));
    }

    /* 目标本身就在菜单里(条目带 data-tip):气泡改放侧边,不压住相邻条目 */
    function inMenu(el) {
        return !!(el.closest && el.closest('.dropdown-menu'));
    }

    /* 不该弹的目标:已脱离 DOM、被折叠隐藏、或自己那一组下拉正开着 */
    function suppressed(el) {
        if (!el || !el.isConnected) return true;
        if (el.getClientRects().length === 0) return true;
        return menuOpenFor(el);
    }

    /* 把气泡摆到目标旁边。
       默认上下(顶栏按钮在页面上沿,下方放不下就翻到上方);
       菜单里的条目走左右,免得压住菜单行。
       方向定完再夹进视口,箭头跟着目标中心走。 */
    function place(el) {
        var r = el.getBoundingClientRect();
        var b = ensureBubble();
        var w = b.offsetWidth;
        var h = b.offsetHeight;
        var vw = window.innerWidth || document.documentElement.clientWidth;
        var vh = window.innerHeight || document.documentElement.clientHeight;
        var want = (el.getAttribute('data-tip-pos') || '').toLowerCase();

        var side;
        if (inMenu(el)) {
            side = (want === 'left' || want === 'top' || want === 'bottom') ? want : 'right';
        } else if (want === 'top' || want === 'bottom' || want === 'left' || want === 'right') {
            side = want;
        } else {
            side = 'bottom';
        }

        var fits = {
            bottom: r.bottom + GAP + h <= vh - EDGE,
            top: r.top - GAP - h >= EDGE,
            right: r.right + GAP + w <= vw - EDGE,
            left: r.left - GAP - w >= EDGE
        };
        var flip = { bottom: 'top', top: 'bottom', right: 'left', left: 'right' };
        if (!fits[side]) {
            var alt = flip[side];
            if (fits[alt]) side = alt;
            else if (inMenu(el)) side = fits.left ? 'left' : (fits.right ? 'right' : 'bottom');
            else side = fits.top ? 'top' : 'bottom';
        }

        var top, left;
        if (side === 'bottom' || side === 'top') {
            top = side === 'bottom' ? r.bottom + GAP : r.top - h - GAP;
            left = r.left + r.width / 2 - w / 2;
        } else {
            left = side === 'right' ? r.right + GAP : r.left - w - GAP;
            top = r.top + r.height / 2 - h / 2;
        }
        left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
        top = Math.max(EDGE, Math.min(top, vh - h - EDGE));

        b.style.left = Math.round(left) + 'px';
        b.style.top = Math.round(top) + 'px';
        b.classList.toggle('is-below', side === 'bottom');
        b.classList.toggle('is-above', side === 'top');
        b.classList.toggle('is-right', side === 'right');
        b.classList.toggle('is-left', side === 'left');

        // 箭头对准目标中心,再限制在圆角内(上下用 x 轴,左右用 y 轴)
        var cx = r.left + r.width / 2 - left;
        cx = Math.max(12, Math.min(cx, w - 12));
        b.style.setProperty('--tip-arrow-x', Math.round(cx) + 'px');
        var cy = r.top + r.height / 2 - top;
        cy = Math.max(12, Math.min(cy, h - 12));
        b.style.setProperty('--tip-arrow-y', Math.round(cy) + 'px');
    }

    function render(el) {
        var text = el.getAttribute('data-tip') || '';
        var rows = splitLines(text);
        if (!rows.length) return false;
        var b = ensureBubble();
        b.textContent = '';
        rows.forEach(function (line, i) {
            var div = document.createElement('div');
            div.className = 'nav-tip__line';
            div.textContent = line;
            if (i === 0) div.classList.add('nav-tip__line--head');
            b.appendChild(div);
        });
        b.style.maxWidth = Math.min(MAX_W, Math.max(160, (window.innerWidth || 360) - 2 * EDGE)) + 'px';
        return true;
    }

    function clearTimers() {
        if (showTimer) { clearTimeout(showTimer); showTimer = 0; }
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    }

    function show(el, immediate) {
        if (!el || suppressed(el)) return;
        if (!render(el)) { if (anchor && anchor.el !== el) hideNow(); return; }
        clearTimers();
        var b = ensureBubble();
        if (anchor && anchor.el !== el) anchor.el.removeAttribute('aria-describedby');

        var switching = !!(anchor && anchor.el !== el);
        if (switching) pinned = false;   // 固定着的那个已经换走了,别把"固定"带到新目标上
        anchor = { el: el, text: el.getAttribute('data-tip') || '' };
        if (b.style.display === 'none') b.style.display = 'block';
        place(el);   // 先量尺寸,再上位置

        var openIt = function () {
            if (!anchor || anchor.el !== el) return;   // 期间已经切走/收起
            place(el);
            b.classList.add('is-open');
            b.id = 'navTipBubble';
            el.setAttribute('aria-describedby', 'navTipBubble');
            open = true;
        };
        // 已经显示时换目标:直接搬过去,不再重新淡入(鼠标沿工具栏划一趟满屏闪就是这个问题)
        if (immediate || open || switching || reduceMotion()) openIt();
        else requestAnimationFrame(openIt);   // 让 transition 有起点,不跳出来
    }

    function hideNow() {
        clearTimers();
        pinned = false;
        open = false;
        if (anchor) anchor.el.removeAttribute('aria-describedby');
        anchor = null;
        if (!bubble) return;
        bubble.classList.remove('is-open');
        // 等淡出结束再隐藏,避免闪一下;期间又 show 过就作废这次隐藏
        var token = ++hideToken;
        window.setTimeout(function () {
            if (token !== hideToken || !bubble) return;
            if (bubble.classList.contains('is-open')) return;
            bubble.style.display = 'none';
        }, reduceMotion() ? 0 : 130);
    }

    function scheduleShow(el) {
        if (pinned && anchor && anchor.el === el) return;
        clearTimers();
        showTimer = window.setTimeout(function () {
            showTimer = 0;
            show(el, false);
        }, SHOW_DELAY);
    }

    function scheduleHide() {
        if (pinned) return;
        clearTimers();
        hideTimer = window.setTimeout(function () {
            hideTimer = 0;
            hideNow();
        }, HIDE_DELAY);
    }

    function findAnchor(node) {
        while (node && node !== document) {
            if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-tip')) return node;
            node = node.parentNode;
        }
        return null;
    }

    /* ---------- 事件:全部委托在 document 上,动态加的卡片/星标也能用 ---------- */
    document.addEventListener('pointerdown', function () { lastPointerAt = Date.now(); }, true);

    document.addEventListener('pointerover', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;   // 触屏不靠 hover
        var el = findAnchor(e.target);
        if (!el) return;
        if (anchor && anchor.el === el) { clearTimers(); return; }
        if (suppressed(el)) { if (anchor) hideNow(); return; }     // 菜单正开着,别叠一层
        scheduleShow(el);
    }, true);

    document.addEventListener('pointerout', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        var el = findAnchor(e.target);
        if (!el) return;
        // 在同一个目标内部移动不算离开
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        if (anchor && anchor.el === el) scheduleHide();
        else clearTimers();
    }, true);

    // 指针被系统收走(手势、触控笔离开)也要收,否则气泡会挂在原地
    document.addEventListener('pointercancel', function (e) {
        if (anchor && findAnchor(e.target) === anchor.el) scheduleHide();
    }, true);

    // 键盘 Tab 过来直接显示,不用等 260ms。
    // 鼠标点出来的焦点不弹:否则点开下拉的那一下会先冒气泡、再被菜单顶住 —— 正是"打架"的观感。
    document.addEventListener('focusin', function (e) {
        if (Date.now() - lastPointerAt < 500) return;
        var el = findAnchor(e.target);
        if (el) show(el, true);
    }, true);
    document.addEventListener('focusout', function (e) {
        var el = findAnchor(e.target);
        if (el) hideNow();
    }, true);

    // 点一下就收起(触屏/误触);被 navHelp 之类主动固定住的不在此列
    document.addEventListener('click', function (e) {
        if (!anchor) return;
        if (anchor.el.contains(e.target)) {
            if (!pinned) hideNow();
            return;
        }
        hideNow();
    });

    /* 下拉菜单一展开就收气泡:菜单落在按钮正下方,气泡会把第一行条目整块盖住。
       收起时也收:菜单条目可能正带着气泡,条目随菜单一起消失,气泡不能留在原地。
       弹窗同理(卡片编辑弹窗里也有 data-tip)。 */
    ['show.bs.dropdown', 'hide.bs.dropdown', 'hide.bs.modal',
     'show.bs.modal', 'show.bs.offcanvas'].forEach(function (type) {
        document.addEventListener(type, function () { hideNow(); }, true);
    });

    // 右键/长按卡片会弹出 .card-menu,占的是同一块位置,气泡先让位
    document.addEventListener('contextmenu', function () { hideNow(); }, true);

    // 滚动/缩放时位置就错了,直接收
    window.addEventListener('scroll', function () { if (anchor && !pinned) hideNow(); }, { passive: true, capture: true });
    window.addEventListener('resize', function () { if (anchor) hideNow(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideNow(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) hideNow(); });

    // 点击固定(给触屏和搜索框问号用):再点一次取消;弹不出来就别冒充"已固定"
    window.navTipToggle = function (el) {
        if (!el) return;
        if (anchor && anchor.el === el && pinned) { hideNow(); return; }
        pinned = false;
        show(el, true);
        pinned = !!(anchor && anchor.el === el);
    };

    window.navTip = {
        show: function (el) { show(el, true); },
        hide: hideNow,
        toggle: window.navTipToggle
    };
})();
