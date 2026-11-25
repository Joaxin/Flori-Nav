/* ==========================================================================
   R-24 左下 fixbar(独立组件)
   - 两个动作:回到顶部 / 收起展开(2026-11-25 按用户要求下架「切换皮肤」「切换明暗」两颗;
     明暗与皮肤的入口仍留在设置面板与快捷设置,这里不再重复开第二处入口)。
   - 全部复用既有存储键与既有对外 API,不自造主题逻辑、不发任何网络请求、
     访客态零写库(不触发 /api/nav/ 请求)。
   - 注册表协议:window.NavWidgets 存在则 register;否则压入 __navWidgetQueue
     兜底队列,等注册表落地后 drain。不自己实现第二套注册表。
   - 几何避让:固定在左下角,右下角留给既有 #navBackTop 回顶钮与 #navPet 桌宠;
     多选条(#navMsBar / #ngSnapBulkBar / #navBulkBar)激活时按其实测高度抬高
     fixbar,多选条消失后回落。z-index 1030,低于桌宠 1035 与多选条 1055。
   ========================================================================== */
(function () {
    'use strict';

    var BULK_SELECTORS = ['#navMsBar', '#ngSnapBulkBar', '#navBulkBar'];
    var DOCK_KINDS = ['top', 'bottom-left', 'bottom-right'];
    var dockKind = 'bottom-left';

    var root = null;
    var mounted = false;
    var observers = { mo: null, ro: null, listeners: [], observed: [] };
    var syncRaf = 0;

    /* ---------- 存储:全部 try/catch,只读既有键,不新增本地键 ---------- */
    function storageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    /* ---------- 多选条动态让位 ---------- */
    function visibleBar() {
        var best = null;
        var bestH = 0;
        BULK_SELECTORS.forEach(function (sel) {
            var el = document.querySelector(sel);
            if (!el) return;
            if (el.style && el.style.display === 'none') return;
            var r = el.getBoundingClientRect();
            if (r.height > 2 && r.width > 2 && r.height > bestH) { best = el; bestH = r.height; }
        });
        return best;
    }

    function syncAvoid() {
        if (!root) return;
        if (dockKind === 'top') {
            // 顶部横排,不受底部多选条影响
            if (root.style.bottom !== '') root.style.bottom = '';
            if (root.classList.contains('nav-fixbar-dodging')) root.classList.remove('nav-fixbar-dodging');
            return;
        }
        var bar = visibleBar();
        var bottom = '';
        var dodging = false;
        if (bar) {
            var br = bar.getBoundingClientRect();
            // 多选条距视口底 = innerHeight - br.bottom;fixbar 底偏移 = 条高 + 条底偏移 + 8px 间隙
            bottom = ((window.innerHeight - br.bottom) + br.height + 8) + 'px';
            dodging = true;
        }
        // 本组件在 body 上观察 style/class;若每次 rAF 都写同样的值,
        // 会由观察器再排一次 rAF,形成自激。只在值真正变化时落 DOM。
        if (root.style.bottom !== bottom) root.style.bottom = bottom;
        if (dodging !== root.classList.contains('nav-fixbar-dodging')) {
            root.classList.toggle('nav-fixbar-dodging', dodging);
        }
    }

    function scheduleSync() {
        if (syncRaf) return;
        syncRaf = window.requestAnimationFrame(function () {
            syncRaf = 0;
            syncAvoid();
        });
    }

    function observeBars() {
        if (!observers.ro) return;
        BULK_SELECTORS.forEach(function (sel) {
            var el = document.querySelector(sel);
            if (el && observers.observed.indexOf(el) < 0) {
                observers.ro.observe(el);
                observers.observed.push(el);
            }
        });
    }

    function bindAvoidObservers() {
        observers.observed = [];
        if (typeof ResizeObserver !== 'undefined') {
            observers.ro = new ResizeObserver(scheduleSync);
        }
        observeBars();
        observers.mo = new MutationObserver(function () {
            observeBars();   // 懒渲染后才出现的多选条补挂观察
            scheduleSync();
        });
        observers.mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-nav-wall'] });

        var onResize = scheduleSync;
        var onScroll = scheduleSync;
        window.addEventListener('resize', onResize, { passive: true });
        window.addEventListener('scroll', onScroll, { passive: true });
        observers.listeners = [
            { el: window, type: 'resize', fn: onResize },
            { el: window, type: 'scroll', fn: onScroll }
        ];
        // 懒渲染兜底:挂载后再复测两次,接住晚到的工具条
        [300, 800].forEach(function (ms) {
            setTimeout(syncAvoid, ms);
        });
    }

    function teardownAvoidObservers() {
        if (observers.mo) { observers.mo.disconnect(); observers.mo = null; }
        if (observers.ro) { observers.ro.disconnect(); observers.ro = null; }
        observers.observed = [];
        observers.listeners.forEach(function (l) { l.el.removeEventListener(l.type, l.fn); });
        observers.listeners = [];
    }

    /* ---------- 收起 / 展开 ---------- */
    function setCollapsed(v) {
        if (!root) return;
        root.classList.toggle('is-collapsed', !!v);
        var toggle = root.querySelector('[data-fix-act="toggle"]');
        if (toggle) {
            var icon = toggle.querySelector('i');
            if (icon) icon.className = v ? 'fas fa-sliders-h' : 'fas fa-chevron-down';
            toggle.title = v ? '展开工具条' : '收起为小圆钮';
            toggle.setAttribute('aria-label', v ? '展开工具条' : '收起工具条');
        }
    }

    /* ---------- 位置档:顶部 / 左下 / 右下(2026-11-24) ----------
       设置里「快捷工具条位置」三档只管这一组圆按钮;顶栏齿轮不再跟着搬。 */
    function readDock() {
        var v = storageGet('navSettingsDock');
        return DOCK_KINDS.indexOf(v) >= 0 ? v : 'bottom-left';
    }
    function applyDock(kind) {
        dockKind = DOCK_KINDS.indexOf(kind) >= 0 ? kind : 'bottom-left';
        if (!root) return;
        root.classList.toggle('nav-fixbar--top', dockKind === 'top');
        root.classList.toggle('nav-fixbar--br', dockKind === 'bottom-right');
        syncAvoid();
    }

    /* ---------- 挂载 / 卸载 ---------- */
    function mount() {
        if (mounted) return;
        root = document.createElement('div');
        root.id = 'navFixbar';
        root.setAttribute('role', 'toolbar');
        root.setAttribute('aria-label', '快捷工具条');
        root.innerHTML =
            '<div class="nav-fixbar-main">' +
            '  <button type="button" class="nav-fixbar-btn" data-fix-act="top" title="回到顶部" aria-label="回到顶部"><i class="fas fa-arrow-up"></i></button>' +
            '</div>' +
            '<button type="button" class="nav-fixbar-btn nav-fixbar-toggle" data-fix-act="toggle" title="收起为小圆钮" aria-label="收起工具条"><i class="fas fa-chevron-down"></i></button>';

        root.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-fix-act]') : null;
            if (!btn) return;
            var act = btn.getAttribute('data-fix-act');
            if (act === 'top') actBackTop();
            else if (act === 'toggle') setCollapsed(!root.classList.contains('is-collapsed'));
        });

        document.body.appendChild(root);
        applyDock(readDock());

        bindAvoidObservers();
        // 移动端默认收起为小圆钮;桌面端默认展开
        setCollapsed(window.innerWidth < 768);
        syncAvoid();
        mounted = true;
    }

    function unmount() {
        if (!mounted) return;
        teardownAvoidObservers();
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = null;
        mounted = false;
    }

    var descriptor = {
        id: 'fixbar',
        name: 'R-24 左下工具条',
        priority: 20,
        mount: mount,
        unmount: unmount
    };

    /* 注册表协议:有注册表就 register;没有就进兜底队列,等注册表 drain。
       不实现第二套注册表;mount 本身幂等,重复调用不会挂出第二份 DOM。 */
    if (window.NavWidgets && typeof window.NavWidgets.register === 'function') {
        window.NavWidgets.register(descriptor);
    } else {
        window.__navWidgetQueue = window.__navWidgetQueue || [];
        window.__navWidgetQueue.push(descriptor);
    }

    // 暴露描述符供测试/集成层 drain 与核对;不做网络请求。
    window.__navFixbarDescriptor = descriptor;

    // 设置面板「快捷工具条位置」三档的唯一入口(顶栏齿轮不再搬动)
    window.NavFixbar = {
        setDock: applyDock,
        getDock: function () { return dockKind; },
        mount: mount
    };

    // 兜底自启:若页面始终没有注册表(独立加载/老页面),队列没人 drain 时也保证组件可用;
    // 后续注册表再 drain 调 mount,幂等守卫拦住重复挂载。
    function bootFallback() {
        if (!mounted && !(window.NavWidgets && typeof window.NavWidgets.register === 'function')) {
            mount();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootFallback);
    } else {
        bootFallback();
    }
})();
