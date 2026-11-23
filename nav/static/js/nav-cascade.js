/* ==========================================================================
   R-23 分类级联(零迁移前端增强,独立组件)
   - 前缀补全:按现有分类 / 子分类全集,为主分类、二级、三级输入提供 datalist 候选;
     候选只作建议,仍可自由输入新名称。
   - 上级变更清下级:主分类输入值变化后,清空二级 / 三级(访客端清空小分类);
     用「值比较 + WeakMap 记录上一次值」判定,值未变直接返回,不写事件、不回流。
   - 边界:纯前端交互,不发任何网络请求,不读写 localStorage / sessionStorage /
     cookie,不写库;不新增弹窗,不改 data-layout 白名单。
   - 注册表协议:window.NavWidgets 存在则 register;否则推入 __navWidgetQueue
     兜底队列,等注册表落地后 drain。不自己实现第二套注册表。
   - 数据源(全部只读):
       1. #navCatSubs JSON(主人页 {大类: ["二级 / 三级", ...]};访客页为 "{}");
       2. window.navGuestLocal.subs()(访客本机书签 + 快照覆盖,只读调用);
       3. DOM 卡片 [data-site-item][data-cat] 的大类属性。
   ========================================================================== */
(function () {
    'use strict';

    var CAT_SUBS_SCRIPT = 'navCatSubs';
    var OWNER_MODAL = 'addSiteModal';
    var GUEST_MODAL = 'navGuestEditModal';

    // 与后端 NAV_SUBCAT_SEPS 对齐:' / ' 或 ' > ' 视为「二级 / 三级」分隔。
    var SUBCAT_SEPS = [' / ', ' > '];

    var mounted = false;
    var observer = null;
    var universe = null;
    // 记录每个上级输入的上一次值:值未变即跳过,避免重复清空与事件回流。
    var lastParentValue = new WeakMap();

    /* ---------- 只读工具 ---------- */

    function trim(v) { return String(v == null ? '' : v).trim(); }

    function splitSubcat(s) {
        s = trim(s);
        for (var i = 0; i < SUBCAT_SEPS.length; i++) {
            var sep = SUBCAT_SEPS[i];
            var idx = s.indexOf(sep);
            if (idx > 0) {
                var parent = s.slice(0, idx).trim();
                var leaf = s.slice(idx + sep.length).trim();
                if (parent && leaf) return [parent, leaf];
            }
        }
        return [s, ''];
    }

    function dedupe(arr) {
        var out = [];
        (arr || []).forEach(function (v) {
            v = trim(v);
            if (v && out.indexOf(v) < 0) out.push(v);
        });
        return out;
    }

    function pushUnique(arr, v) {
        v = trim(v);
        if (v && arr.indexOf(v) < 0) arr.push(v);
    }

    /* ---------- 全集构建(只读扫描,不发请求) ---------- */

    function readCatSubsJson() {
        var el = document.getElementById(CAT_SUBS_SCRIPT);
        if (!el) return {};
        try {
            var parsed = JSON.parse(el.textContent || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function buildUniverse() {
        var cats = [];
        var subMap = {};    // 大类 -> [二级 ...]
        var thirdMap = {};  // "大类 / 二级" -> [三级 ...]
        var seconds = [];   // 全局二级候选(兜底)
        var thirds = [];    // 全局三级候选(兜底)

        function bucket(key) {
            if (!subMap[key]) subMap[key] = [];
            return subMap[key];
        }

        // 1) #navCatSubs:主人页服务端注入的大类 -> 子分类串全集。
        var subs = readCatSubsJson();
        Object.keys(subs).forEach(function (cat) {
            pushUnique(cats, cat);
            (subs[cat] || []).forEach(function (raw) {
                var parts = splitSubcat(raw);
                if (parts[0]) {
                    pushUnique(bucket(cat), parts[0]);
                    pushUnique(seconds, parts[0]);
                }
                if (parts[0] && parts[1]) {
                    var key = cat + ' / ' + parts[0];
                    if (!thirdMap[key]) thirdMap[key] = [];
                    pushUnique(thirdMap[key], parts[1]);
                    pushUnique(thirds, parts[1]);
                }
            });
        });

        // 2) 访客本机 store(只读):subs() 返回 {大类: [层级片段 ...]}。
        var local = window.navGuestLocal;
        if (local && typeof local.subs === 'function') {
            try {
                var guestMap = local.subs() || {};
                Object.keys(guestMap).forEach(function (cat) {
                    pushUnique(cats, cat);
                    (guestMap[cat] || []).forEach(function (part) {
                        pushUnique(bucket(cat), part);
                        pushUnique(seconds, part);
                    });
                });
            } catch (e) { /* store 不可用时静默回落,不抛错 */ }
        }

        // 3) DOM 卡片大类属性兜底。
        Array.prototype.forEach.call(
            document.querySelectorAll('[data-site-item][data-cat]'),
            function (el) { pushUnique(cats, el.getAttribute('data-cat')); }
        );

        return { cats: dedupe(cats), subMap: subMap, thirdMap: thirdMap,
                 seconds: dedupe(seconds), thirds: dedupe(thirds) };
    }

    /* ---------- datalist 注入 / 回填(幂等) ---------- */

    function ensureDatalist(container, id, input) {
        var dl = document.getElementById(id);
        if (!dl) {
            dl = document.createElement('datalist');
            dl.id = id;
            container.appendChild(dl);
        }
        if (input && input.getAttribute('list') !== id) {
            input.setAttribute('list', id);
        }
        return dl;
    }

    // 幂等回填:按 option.value 去重,已存在的选项不重复插入;返回当前选项总数。
    function fillOptions(dl, values) {
        if (!dl) return 0;
        var existing = {};
        Array.prototype.forEach.call(dl.options, function (o) { existing[o.value] = true; });
        dedupe(values).forEach(function (v) {
            if (!existing[v]) {
                var opt = document.createElement('option');
                opt.value = v;
                dl.appendChild(opt);
                existing[v] = true;
            }
        });
        return dl.options.length;
    }

    /* ---------- 主人端:#addSiteModal 内动态表单 ---------- */

    function ownerForms() {
        var modal = document.getElementById(OWNER_MODAL);
        if (!modal) return [];
        return Array.prototype.slice.call(modal.querySelectorAll('.sf-form'));
    }

    function refreshOwnerDatalists(form) {
        if (!universe || !form) return;
        var catInput = form.querySelector('.f-cat');
        var subInput = form.querySelector('.f-subcat');
        var cat = trim(catInput && catInput.value);
        var parent = trim(subInput && subInput.value);

        var dl1 = form.querySelector('.f-subcat-list');
        var dl2 = form.querySelector('.f-subcat2-list');

        var secondCands = (universe.subMap[cat] || []).concat(universe.seconds);
        var thirdKey = cat + ' / ' + parent;
        var thirdCands = (universe.thirdMap[thirdKey] || []).concat(universe.thirds);

        fillOptions(dl1, secondCands);
        fillOptions(dl2, thirdCands);
    }

    // 上级(主分类)变更:值比较通过后清空二级 / 三级。
    function onOwnerCatChange(input) {
        var form = input.closest ? input.closest('.sf-form') : null;
        if (!form) return;
        var next = trim(input.value);
        var prev = lastParentValue.has(input) ? lastParentValue.get(input) : null;
        if (prev === next) return; // 值未变:跳过,不重复清空、不回流事件
        lastParentValue.set(input, next);

        var sub = form.querySelector('.f-subcat');
        var sub2 = form.querySelector('.f-subcat2');
        // 直接写 value,不 dispatch input/change,避免触发级联回流。
        if (sub && sub.value) sub.value = '';
        if (sub2 && sub2.value) sub2.value = '';
        refreshOwnerDatalists(form);
    }

    function onOwnerSubChange(input) {
        var form = input.closest ? input.closest('.sf-form') : null;
        if (!form) return;
        refreshOwnerDatalists(form);
    }

    function onOwnerDelegate(e) {
        var t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('f-cat')) onOwnerCatChange(t);
        else if (t.classList.contains('f-subcat')) onOwnerSubChange(t);
    }

    /* ---------- 访客端:#navGuestEditModal(JS 动态构建) ---------- */

    function refreshGuestSubList() {
        if (!universe) return;
        var catInput = document.getElementById('ngeCat');
        var modal = document.getElementById(GUEST_MODAL);
        if (!modal) return;
        var subInput = document.getElementById('ngeSub');
        var subList = ensureDatalist(modal, 'ngeSubList', subInput);
        var cat = trim(catInput && catInput.value);
        fillOptions(subList, (universe.subMap[cat] || []).concat(universe.seconds));
    }

    function ensureGuestModal() {
        var modal = document.getElementById(GUEST_MODAL);
        if (!modal) return;
        var catInput = document.getElementById('ngeCat');
        var subInput = document.getElementById('ngeSub');
        if (!catInput || !subInput) return;

        // 访客大类候选:与既有 fillCats() 结果取并集(去重),不清空既有选项。
        var catList = document.getElementById('ngeCatList');
        if (catList) fillOptions(catList, universe.cats);
        refreshGuestSubList();

        if (modal.dataset.cascadeBound !== '1') {
            modal.dataset.cascadeBound = '1';
            lastParentValue.set(catInput, trim(catInput.value));
            catInput.addEventListener('input', onGuestCatChange);
            catInput.addEventListener('change', onGuestCatChange);
        }
    }

    function onGuestCatChange(e) {
        var input = e.target;
        var next = trim(input.value);
        var prev = lastParentValue.has(input) ? lastParentValue.get(input) : null;
        if (prev === next) return;
        lastParentValue.set(input, next);

        var sub = document.getElementById('ngeSub');
        if (sub && sub.value) sub.value = ''; // 不清空即不回流:直接写 value
        refreshGuestSubList();
    }

    /* ---------- 挂载 / 卸载 ---------- */

    function mount() {
        if (mounted) return;
        universe = buildUniverse();

        var owner = document.getElementById(OWNER_MODAL);
        if (owner) {
            owner.addEventListener('input', onOwnerDelegate);
            owner.addEventListener('change', onOwnerDelegate);
            ownerForms().forEach(function (form) {
                var cat = form.querySelector('.f-cat');
                if (cat) lastParentValue.set(cat, trim(cat.value));
                refreshOwnerDatalists(form);
            });
        }

        ensureGuestModal();

        // 访客弹窗由 JS 晚到构建:观察 body 子树,出现后补挂;幂等守卫挡住重复绑定。
        if (typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(function () {
                ensureGuestModal();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        mounted = true;
    }

    function unmount() {
        if (!mounted) return;
        if (observer) { observer.disconnect(); observer = null; }
        var owner = document.getElementById(OWNER_MODAL);
        if (owner) {
            owner.removeEventListener('input', onOwnerDelegate);
            owner.removeEventListener('change', onOwnerDelegate);
        }
        mounted = false;
    }

    var descriptor = {
        id: 'nav-cascade',
        name: 'R-23 分类级联补全与清下级',
        selector: '#addSiteModal',
        priority: 50,
        mount: mount,
        unmount: unmount
    };

    // 注册表协议:有注册表就 register;没有就进兜底队列,等注册表 drain。
    if (window.NavWidgets && typeof window.NavWidgets.register === 'function') {
        window.NavWidgets.register(descriptor);
    } else {
        window.__navWidgetQueue = window.__navWidgetQueue || [];
        window.__navWidgetQueue.push(descriptor);
    }

    // 暴露描述符供测试 / 集成层核对;不做网络请求。
    window.__navCascadeDescriptor = descriptor;

    // 兜底自启:页面始终没有注册表时也保证组件可用;注册表再 drain 调 mount,
    // 幂等守卫(mounted 标志 + 注册表 mounted 表)拦住重复挂载。
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
