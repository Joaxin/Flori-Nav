/* ==========================================================================
   R-24 快捷工具条(独立组件)
   - 动作:回到顶部 / 全部收起(展开)分类 / 专注模式 / 回到底部 /
     上一分类 / 下一分类。默认只露出前三个,低频动作可在设置里逐项打开。
   - 实现在本文件内,复用页面既有 API:
     · 分类展开/收起走 window.navCollapse.page(与目录齿轮同一套按钮处理器)
     · 专注模式走 window.NavUiMode.toggleFocus()(会保存并还原用户的逐项偏好)
   - 收起态只留一个展开钮;展开态动作由设置里的「快捷工具条动作」勾选控制,
     至少保留一个动作。访客态和主人态共用同一份脚本与同一份设置。
   - 几何避让:固定在左下角,右下角留给既有 #navBackTop 回顶钮与 #navPet 桌宠;
     多选条(#navMsBar / #ngSnapBulkBar / #navBulkBar)激活时按其实测高度抬高
     fixbar,多选条消失后回落。z-index 1030,低于桌宠 1035 与多选条 1055。
   - 展开态若显示「回到顶部」,临时隐藏右下角重复的回顶钮;收起态仍保留它。
   ========================================================================== */
(function () {
    'use strict';

    var BULK_SELECTORS = ['#navMsBar', '#ngSnapBulkBar', '#navBulkBar'];
    var DOCK_KINDS = ['top', 'bottom-left', 'bottom-right'];
    var ACTION_KEY = 'navFixbarActionsV1';
    var dockKind = 'bottom-left';

    var root = null;
    var mounted = false;
    var settingsBound = false;
    var observers = { mo: null, ro: null, listeners: [], observed: [] };
    var syncRaf = 0;

    /* ---------- 小工具 ---------- */
    function storageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function storageSet(key, value) {
        try { localStorage.setItem(key, String(value)); return true; } catch (e) { return false; }
    }
    function toast(message) {
        try {
            if (typeof window.navToast === 'function') window.navToast(message);
            else if (typeof window.showToast === 'function') window.showToast(message);
        } catch (e) {}
    }

    /* ---------- 动作定义 ---------- */
    function actTop() {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
        catch (e) { window.scrollTo(0, 0); }
    }
    function actBottom() {
        var top = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
        try { window.scrollTo({ top: top, behavior: 'smooth' }); }
        catch (e) { window.scrollTo(0, top); }
    }
    function pageCats() {
        var cats = document.querySelectorAll('#navGroups > .nav-cat[data-collapse-id]');
        return cats.length ? cats : document.querySelectorAll('#navGroups > .nav-cat');
    }
    function allCatsCollapsed() {
        var cats = pageCats();
        if (!cats.length) return false;
        return Array.prototype.every.call(cats, function (c) { return c.classList.contains('is-collapsed'); });
    }
    function actCollapse() {
        var cats = pageCats();
        var allCollapsed = allCatsCollapsed();
        if (window.navCollapse && window.navCollapse.page) {
            if (allCollapsed) window.navCollapse.page.expandAll();
            else window.navCollapse.page.collapseAll();
        } else {
            // 没拿到页面 API 时的兜底:只切类,不动 localStorage(避免造第二套状态源)。
            Array.prototype.forEach.call(cats, function (c) {
                c.classList.toggle('is-collapsed', !allCollapsed);
                var t = c.querySelector('.nav-cat-title');
                if (t) t.setAttribute('aria-expanded', String(allCollapsed));
            });
        }
    }
    function actFocus() {
        if (window.NavUiMode && typeof window.NavUiMode.toggleFocus === 'function') {
            window.NavUiMode.toggleFocus();
        } else {
            toast('专注模式还没准备好');
        }
    }
    function catTarget(step) {
        var cats = pageCats();
        var visible = [];
        Array.prototype.forEach.call(cats, function (c) {
            if (!c.getClientRects || !c.getClientRects().length) return;
            var cs = window.getComputedStyle ? window.getComputedStyle(c) : null;
            if (cs && cs.display === 'none') return;
            visible.push(c);
        });
        if (!visible.length) return null;
        var y = window.scrollY + 96;
        var cur = 0;
        visible.forEach(function (c, i) {
            var top = c.getBoundingClientRect().top + window.scrollY;
            if (top <= y) cur = i;
        });
        var idx = step < 0 ? cur - 1 : cur + 1;
        if (idx < 0) idx = 0;
        if (idx >= visible.length) idx = visible.length - 1;
        return visible[idx];
    }
    function jumpCat(step) {
        var c = catTarget(step);
        if (!c) { toast('当前没有分类可跳'); return; }
        var top = c.getBoundingClientRect().top + window.scrollY - 76;
        try { window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
        catch (e) { window.scrollTo(0, Math.max(0, top)); }
    }
    function actPrevCat() { jumpCat(-1); }
    function actNextCat() { jumpCat(1); }

    var ACTIONS = [
        { id: 'top', icon: 'fa-arrow-up', label: '回到顶部', defaultOn: true, run: actTop },
        { id: 'collapse', icon: 'fa-angles-up', label: '全部收起分类', defaultOn: true, dynamic: 'collapse', run: actCollapse },
        { id: 'focus', icon: 'fa-expand', label: '专注模式', defaultOn: true, dynamic: 'focus', run: actFocus },
        { id: 'bottom', icon: 'fa-arrow-down', label: '回到底部', defaultOn: false, run: actBottom },
        { id: 'prevcat', icon: 'fa-chevron-up', label: '上一分类', defaultOn: false, run: actPrevCat },
        { id: 'nextcat', icon: 'fa-chevron-down', label: '下一分类', defaultOn: false, run: actNextCat }
    ];

    function actionById(id) {
        for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i];
        return null;
    }
    function readActionMap() {
        var map = {};
        ACTIONS.forEach(function (a) { map[a.id] = !!a.defaultOn; });
        var raw = storageGet(ACTION_KEY);
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    ACTIONS.forEach(function (a) {
                        if (typeof parsed[a.id] === 'boolean') map[a.id] = parsed[a.id];
                    });
                }
            } catch (e) {}
        }
        // 旧值/损坏值导致全关时兜底到「回到顶部」,避免工具条空成一个孤零零的展开钮。
        if (!ACTIONS.some(function (a) { return map[a.id]; })) map.top = true;
        return map;
    }
    function visibleActions(map) {
        map = map || readActionMap();
        return ACTIONS.filter(function (a) { return !!map[a.id]; });
    }
    function saveActionMap(map) {
        storageSet(ACTION_KEY, JSON.stringify(map));
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
            if (root.style.bottom !== '') root.style.bottom = '';
            if (root.classList.contains('nav-fixbar-dodging')) root.classList.remove('nav-fixbar-dodging');
            return;
        }
        var bar = visibleBar();
        var bottom = '';
        var dodging = false;
        if (bar) {
            var br = bar.getBoundingClientRect();
            bottom = ((window.innerHeight - br.bottom) + br.height + 8) + 'px';
            dodging = true;
        }
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
            observeBars();
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
        [300, 800].forEach(function (ms) { setTimeout(syncAvoid, ms); });
    }

    function teardownAvoidObservers() {
        if (observers.mo) { observers.mo.disconnect(); observers.mo = null; }
        if (observers.ro) { observers.ro.disconnect(); observers.ro = null; }
        observers.observed = [];
        observers.listeners.forEach(function (l) { l.el.removeEventListener(l.type, l.fn); });
        observers.listeners = [];
    }

    /* ---------- 动作渲染 / 动态图标 ---------- */
    function hasTopAction() {
        return !!readActionMap().top;
    }
    function syncBackTop() {
        if (!document.body || !root) return;
        var showToolbarTop = !root.classList.contains('is-collapsed') && hasTopAction();
        document.body.classList.toggle('nav-fixbar-expanded-has-top', !!showToolbarTop);
    }
    function updateActionLabels() {
        if (!root) return;
        Array.prototype.forEach.call(root.querySelectorAll('[data-fix-act]'), function (btn) {
            var id = btn.getAttribute('data-fix-act');
            var a = actionById(id);
            if (!a || !a.dynamic) return;
            var icon = btn.querySelector('i');
            var isFocus = false;
            try { isFocus = !!(window.NavUiMode && window.NavUiMode.isFocus && window.NavUiMode.isFocus()); } catch (e) {}
            if (a.dynamic === 'collapse') {
                var collapsed = allCatsCollapsed();
                if (icon) icon.className = 'fas ' + (collapsed ? 'fa-angles-down' : 'fa-angles-up');
                var label = collapsed ? '全部展开分类' : '全部收起分类';
                btn.title = label;
                btn.setAttribute('aria-label', label);
            } else if (a.dynamic === 'focus') {
                if (icon) icon.className = 'fas ' + (isFocus ? 'fa-compress' : 'fa-expand');
                var flabel = isFocus ? '退出专注模式' : '专注模式';
                btn.title = flabel;
                btn.setAttribute('aria-label', flabel);
            }
        });
    }
    function renderActions() {
        if (!root) return;
        var main = root.querySelector('.nav-fixbar-main');
        if (!main) return;
        var actions = visibleActions();
        main.innerHTML = actions.map(function (a) {
            return '<button type="button" class="nav-fixbar-btn" data-fix-act="' + a.id +
                '" title="' + a.label + '" aria-label="' + a.label + '"><i class="fas ' + a.icon + '"></i></button>';
        }).join('');
        updateActionLabels();
        syncBackTop();
    }

    /* ---------- 设置里的动作勾选 ---------- */
    function paintSettings() {
        var list = document.getElementById('navFixbarActionList');
        if (!list) return;
        var map = readActionMap();
        list.innerHTML = ACTIONS.map(function (a) {
            var id = 'navFixAct-' + a.id;
            return '<div class="form-check form-switch">' +
                '<input class="form-check-input" type="checkbox" id="' + id + '" data-fix-action="' + a.id + '"' +
                (map[a.id] ? ' checked' : '') + '>' +
                '<label class="form-check-label small" for="' + id + '"><i class="fas ' + a.icon + ' me-1"></i>' +
                a.label + '</label></div>';
        }).join('');
        if (!settingsBound) {
            settingsBound = true;
            list.addEventListener('change', function (e) {
                var input = e.target && e.target.closest ? e.target.closest('input[data-fix-action]') : null;
                if (!input) return;
                var id = input.getAttribute('data-fix-action');
                var mapNow = readActionMap();
                if (!input.checked && visibleActions(mapNow).filter(function (a) { return a.id !== id; }).length === 0) {
                    input.checked = true;
                    toast('至少保留一个工具条动作');
                    return;
                }
                mapNow[id] = !!input.checked;
                saveActionMap(mapNow);
                renderActions();
            });
        }
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
        syncBackTop();
    }

    /* ---------- 位置档:顶部 / 左下 / 右下 ---------- */
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
            '<div class="nav-fixbar-main"></div>' +
            '<button type="button" class="nav-fixbar-btn nav-fixbar-toggle" data-fix-act="toggle" title="收起为小圆钮" aria-label="收起工具条"><i class="fas fa-chevron-down"></i></button>';

        root.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-fix-act]') : null;
            if (!btn) return;
            var act = btn.getAttribute('data-fix-act');
            if (act === 'toggle') {
                setCollapsed(!root.classList.contains('is-collapsed'));
                return;
            }
            var a = actionById(act);
            if (!a || typeof a.run !== 'function') return;
            a.run();
            window.setTimeout(updateActionLabels, 80);
            window.setTimeout(syncBackTop, 80);
        });

        document.body.appendChild(root);
        applyDock(readDock());
        renderActions();
        paintSettings();

        bindAvoidObservers();
        // 移动端默认收起为小圆钮;桌面端默认展开
        setCollapsed(window.innerWidth < 768);
        syncAvoid();
        mounted = true;
        // 设置面板可能晚一点渲染(部分页面动态挂载),再补一次勾选列表,不重复绑事件。
        window.setTimeout(paintSettings, 300);
    }

    function unmount() {
        if (!mounted) return;
        teardownAvoidObservers();
        if (document.body) document.body.classList.remove('nav-fixbar-expanded-has-top');
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

    if (window.NavWidgets && typeof window.NavWidgets.register === 'function') {
        window.NavWidgets.register(descriptor);
    } else {
        window.__navWidgetQueue = window.__navWidgetQueue || [];
        window.__navWidgetQueue.push(descriptor);
    }

    window.__navFixbarDescriptor = descriptor;

    // 设置面板「快捷工具条位置」三档的唯一入口;refresh 供设置改动后重画动作。
    window.NavFixbar = {
        setDock: applyDock,
        getDock: function () { return dockKind; },
        mount: mount,
        refresh: function () { renderActions(); paintSettings(); }
    };

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
