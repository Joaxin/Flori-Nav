/* 访客快照站点:站点编辑/删除、分类菜单、新建站点、多选。
   主人分享的 419 条快照只读;这里的编辑/删除/隐藏全部写本机覆盖表
   `navGuestSnapshotOverridesV1`,不改服务端、也不改主人库。
   对外:window.navGuestSnapshot = { toggleBulk, editSite, hideSite, renderHiddenBar }; */
(function () {
    'use strict';
    if (!window.NAV_GUEST_MODE || !window.navGuestLocal) return;

    var RENAME_KEY = 'navGuestCatRenameV1';
    var renameMap = {};
    try { renameMap = JSON.parse(localStorage.getItem(RENAME_KEY) || '{}') || {}; } catch (e) { renameMap = {}; }
    var bulkOn = false;
    var selected = {};
    var bulkBar = null;

    function toast(msg) {
        if (window.navToast) window.navToast(msg);
        else if (window.console) console.warn('[nav-guest-snapshot] ' + msg);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function snapshotCard(el) {
        var col = el.closest ? el.closest('[data-site-item]') : null;
        if (!col || !col.closest('#navGroups')) return null;
        if (col.closest('#navGuestImports')) return null;
        return col;
    }
    function cardKey(col) {
        return String(col.getAttribute('data-orig-url') || col.getAttribute('data-url') || '');
    }
    function catOf(el) {
        var cat = el.closest ? el.closest('.nav-cat') : null;
        return cat ? String(cat.getAttribute('data-collapse-id') || '') : '';
    }
    function saveRename() {
        try { localStorage.setItem(RENAME_KEY, JSON.stringify(renameMap)); } catch (e) { /* ignore */ }
    }
    function applyRenames() {
        document.querySelectorAll('#navGroups > .nav-cat[data-collapse-id]').forEach(function (cat) {
            var old = cat.getAttribute('data-collapse-id') || '';
            var nameEl = cat.querySelector('.nav-cat-name');
            if (nameEl && renameMap[old]) nameEl.textContent = renameMap[old];
            var add = cat.querySelector('.nav-cat-add');
            if (add) add.setAttribute('data-cat', renameMap[old] || old);
        });
        // 目录 TOC 同步显示名
        document.querySelectorAll('#navToc a[href^="#navCat"]').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            var cat = document.querySelector(href);
            if (!cat) return;
            var label = renameMap[cat.getAttribute('data-collapse-id') || ''];
            if (!label) return;
            var span = a.querySelector('.nav-toc-name') || a;
            if (span === a) {
                var textNode = null;
                a.childNodes.forEach(function (n) { if (!textNode && n.nodeType === 3 && n.textContent.trim()) textNode = n; });
                if (textNode) textNode.textContent = label + ' ';
            }
        });
        // 维护面板分类排序列表同步显示名
        document.querySelectorAll('#catOrderList li[data-cat]').forEach(function (li) {
            var c = li.getAttribute('data-cat') || '';
            var span = li.querySelector('span.small');
            if (span && renameMap[c]) span.textContent = renameMap[c];
        });
    }
    function catOrderFromList() {
        var list = document.getElementById('catOrderList');
        var order = [], hidden = [];
        if (list) {
            list.querySelectorAll('li[data-cat]').forEach(function (li) {
                var c = li.getAttribute('data-cat') || '';
                if (!c) return;
                order.push(c);
                if (li.classList.contains('cat-hidden')) hidden.push(c);
            });
        }
        return { order: order, hidden: hidden };
    }
    function moveSnapshotCat(el, dir) {
        var cat = catOf(el);
        if (!cat) return;
        var cur = catOrderFromList();
        var i = cur.order.indexOf(cat);
        if (i < 0) {
            // 排序列表还没建好时用 DOM 顺序兜底
            cur.order = [];
            document.querySelectorAll('#navGroups > .nav-cat[data-collapse-id]').forEach(function (c) {
                cur.order.push(c.getAttribute('data-collapse-id'));
                if (c.classList.contains('d-none')) cur.hidden.push(c.getAttribute('data-collapse-id'));
            });
            i = cur.order.indexOf(cat);
        }
        if (i < 0) return;
        var j = dir === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= cur.order.length) return;
        cur.order.splice(i, 1);
        cur.order.splice(j, 0, cat);
        window.navGuestLocal.setCatOrder(cur.order, cur.hidden).then(function (ok) {
            toast(ok ? '本机分类顺序已更新' : '排序保存失败');
        });
    }
    function promptRename(el) {
        var old = catOf(el);
        if (!old || !window.navPrompt) return;
        window.navPrompt({ title: '重命名分类（只改本机显示）', value: renameMap[old] || old, placeholder: '新分类名（最多 50 字）' })
            .then(function (input) {
                if (input === null) return;
                var next = String(input).trim().slice(0, 50);
                if (!next || next === (renameMap[old] || old)) return;
                renameMap[old] = next;
                saveRename();
                applyRenames();
                toast('分类已改名，只影响这台浏览器');
            });
    }
    function addSiteToCat(el, presetCat) {
        if (!window.navGuestEdit) return;
        window.navGuestEdit('', {});
        // openEdit 是同步 show modal,这里补上分类
        var catInput = document.getElementById('ngeCat');
        if (catInput) catInput.value = presetCat || catOf(el) || '';
        var nameInput = document.getElementById('ngeName');
        if (nameInput) setTimeout(function () { try { nameInput.focus(); } catch (e) {} }, 40);
    }
    function editSnapshot(col) {
        var key = cardKey(col);
        if (!key) return;
        var data = window.navGuestLocal.snapshotCardData(key);
        if (!data) { toast('这张卡片的数据读不到，刷新后再试'); return; }
        if (!window.navGuestEdit) { toast('访客编辑组件未加载'); return; }
        window.navGuestEdit(key, { snapshot: true, data: data });
    }
    function hideSnapshot(col) {
        var key = cardKey(col);
        if (!key) return;
        var name = String(col.getAttribute('data-name') || key);
        function doHide() {
            Promise.resolve(window.navGuestLocal.deleteSnapshot(key)).then(function (ok) {
                if (!ok) { toast('隐藏失败，请重试'); return; }
                toast('已从访客页隐藏「' + name + '」，只影响这台浏览器');
                renderHiddenBar();
            });
        }
        if (window.navConfirm) {
            window.navConfirm({
                title: '从访客页隐藏站点',
                body: '只隐藏这台浏览器里的「' + name + '」；主人分享的原始站点和服务器数据都不受影响。',
                danger: true, confirmLabel: '隐藏'
            }).then(function (ok) { if (ok) doHide(); });
        } else { doHide(); }
    }

    // ---------- 多选 ----------
    function ensureCheck(col) {
        var box = col.querySelector('.site-card-box');
        if (!box) return null;
        var ck = box.querySelector(':scope > .ng-check');
        if (!ck) {
            ck = document.createElement('input');
            ck.type = 'checkbox';
            ck.className = 'ng-check';
            ck.setAttribute('data-url', cardKey(col));
            ck.addEventListener('change', function () {
                if (ck.checked) selected[ck.getAttribute('data-url')] = true;
                else delete selected[ck.getAttribute('data-url')];
                paintBulkBar();
            });
            box.appendChild(ck);
        }
        ck.checked = !!selected[ck.getAttribute('data-url')];
        return ck;
    }
    function visibleCards() {
        var out = [];
        document.querySelectorAll('#navGroups [data-site-item]').forEach(function (col) {
            if (col.closest('#navGuestImports')) return;
            if (col.classList.contains('site-archived')) return;
            if (col.offsetParent === null) return;   // 搜索/标签筛选后不可见的卡片不参与全选
            out.push(col);
        });
        return out;
    }
    function mountChecks() {
        visibleCards().forEach(function (col) { ensureCheck(col); });
    }
    function dropChecks() {
        document.querySelectorAll('#navGroups [data-site-item] .ng-check').forEach(function (ck) {
            if (ck.closest('#navGuestImports')) return;
            ck.remove();
        });
    }
    function allVisibleSelected() {
        var cards = visibleCards();
        return cards.length > 0 && cards.every(function (c) { return !!selected[cardKey(c)]; });
    }
    function updateBulkAllLabel() {
        if (!bulkBar) return;
        var allBtn = bulkBar.querySelector('[data-ngs-all]');
        if (!allBtn) return;
        var n = visibleCards().length;
        var label = (allVisibleSelected() ? '取消全选当前可见' : '全选当前可见') + '（' + n + ' 项）';
        allBtn.textContent = label;
        allBtn.setAttribute('aria-label', label);
        allBtn.disabled = !n;
    }
    function paintBulkBar() {
        if (!bulkBar) return;
        var n = Object.keys(selected).length;
        var count = bulkBar.querySelector('[data-ngs-count]');
        if (count) count.textContent = n ? ('已选 ' + n + ' 项') : '已选 0 项';
        var hideBtn = bulkBar.querySelector('[data-ngs-hide]');
        if (hideBtn) hideBtn.disabled = !n;
        var openBtn = bulkBar.querySelector('[data-ngs-open]');
        if (openBtn) openBtn.disabled = !n;
        updateBulkAllLabel();
    }
    function selectAllVisible() {
        var cards = visibleCards();
        if (!cards.length) return;
        if (allVisibleSelected()) { selected = {}; mountChecks(); paintBulkBar(); return; }
        selected = {};
        cards.forEach(function (c) { selected[cardKey(c)] = true; });
        mountChecks(); paintBulkBar();
    }
    function buildBulkBar() {
        if (bulkBar) return bulkBar;
        bulkBar = document.createElement('div');
        bulkBar.id = 'ngSnapBulkBar';
        bulkBar.className = 'ng-bulkbar';
        bulkBar.innerHTML = '<span class="small text-muted" data-ngs-count>已选 0 项</span>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" data-ngs-all aria-label="全选当前可见">全选当前可见</button>'
            + '<button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" data-ngs-open disabled>打开所选</button>'
            + '<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-ngs-hide disabled>隐藏所选</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 ms-auto" data-ngs-exit>退出多选</button>'
            + '<span class="small text-muted">只作用于这台浏览器；主人库不变</span>';
        bulkBar.querySelector('[data-ngs-all]').addEventListener('click', function () {
            var cards = visibleCards();
            if (!cards.length) return;
            if (!allVisibleSelected() && cards.length > 10 && window.navConfirm) {
                window.navConfirm({
                    title: '一次选中 ' + cards.length + ' 个站点？',
                    body: '当前可见结果共 ' + cards.length + ' 个站点，全选后可以批量打开或隐藏。',
                    confirmLabel: '全选'
                }).then(function (ok) { if (ok) selectAllVisible(); });
                return;
            }
            selectAllVisible();
        });
        bulkBar.querySelector('[data-ngs-open]').addEventListener('click', function () {
            Object.keys(selected).forEach(function (u) { window.open(u, '_blank', 'noopener'); });
        });
        bulkBar.querySelector('[data-ngs-hide]').addEventListener('click', function () {
            var urls = Object.keys(selected);
            if (!urls.length) return;
            function run() {
                var chain = Promise.resolve();
                urls.forEach(function (u) {
                    chain = chain.then(function () { return window.navGuestLocal.deleteSnapshot(u); });
                });
                chain.then(function () {
                    selected = {};
                    mountChecks(); paintBulkBar(); renderHiddenBar();
                    toast('已隐藏 ' + urls.length + ' 个站点（只影响这台浏览器）');
                });
            }
            if (window.navConfirm) {
                window.navConfirm({ title: '批量隐藏站点', body: '把这 ' + urls.length + ' 个站点从这台浏览器的访客页移除；主人库不受影响。', danger: true, confirmLabel: '隐藏' })
                    .then(function (ok) { if (ok) run(); });
            } else { run(); }
        });
        bulkBar.querySelector('[data-ngs-exit]').addEventListener('click', function () { toggleBulk(false); });
        return bulkBar;
    }
    function toggleBulk(force) {
        bulkOn = typeof force === 'boolean' ? force : !bulkOn;
        var groups = document.getElementById('navGroups');
        if (!groups) return;
        if (bulkOn) {
            buildBulkBar();
            groups.insertBefore(bulkBar, groups.firstChild);
            mountChecks();
            paintBulkBar();
        } else {
            if (bulkBar) { bulkBar.remove(); bulkBar = null; }
            selected = {};
            dropChecks();
        }
        var top = document.getElementById('navBulkToggle');
        if (top) top.classList.toggle('active', bulkOn);
    }
    window.navGuestSnapshot = { toggleBulk: toggleBulk, editSite: editSnapshot, hideSite: hideSnapshot, renderHiddenBar: renderHiddenBar };
    // #11 统一多选 API:快照站点这条路径不再自成一套,状态与动作以同形方法挂到
    // window.navGuestSnapshotBulk,由 nav-guest-batch.js 在 ready 末尾按当前页主内容路由进
    // window.navBulk(enter/exit/isActive/count/render/selectAll),与主人侧、本机书签侧同一口径。
    window.navGuestSnapshotBulk = {
        active: function () { return bulkOn; },
        enter: function () { toggleBulk(true); },
        exit: function () { toggleBulk(false); },
        count: function () { return Object.keys(selected).length; },
        render: function () { paintBulkBar(); },
        selectAll: selectAllVisible,
        visibleCount: function () { return visibleCards().length; }
    };
    window.navGuestCatLabel = function (name) { return renameMap[name] || name; };

    // ---------- 已隐藏恢复条 ----------
    var hiddenBar = null;
    function renderHiddenBar() {
        var groups = document.getElementById('navGroups');
        if (!groups) return;
        var total = window.navGuestLocal.snapshotOverrideCount ? window.navGuestLocal.snapshotOverrideCount() : 0;
        var n = window.navGuestLocal.snapshotHiddenCount();
        if (!total) { if (hiddenBar) { hiddenBar.remove(); hiddenBar = null; } return; }
        if (!hiddenBar) {
            hiddenBar = document.createElement('div');
            hiddenBar.id = 'ngSnapHiddenBar';
            hiddenBar.className = 'ng-bulkbar';
            hiddenBar.innerHTML = '<span class="small text-muted"></span>'
                + '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2">恢复全部</button>';
            hiddenBar.querySelector('button').addEventListener('click', function () {
                if (window.navConfirm) {
                    window.navConfirm({ title: '恢复快照站点', body: '清除这台浏览器里对快照站点的所有编辑和隐藏，主人分享的原始内容不变。', confirmLabel: '恢复' })
                        .then(function (ok) { if (ok) window.navGuestLocal.restoreSnapshots(); });
                } else { window.navGuestLocal.restoreSnapshots(); }
            });
        }
        hiddenBar.querySelector('span').textContent = '本机覆盖 ' + total + ' 项' + (n ? '（已隐藏 ' + n + '）' : '');
        groups.insertBefore(hiddenBar, groups.firstChild);
    }

    // ---------- 事件捕获:在主人侧 nav-sites.js / batch.js 之前截住 ----------
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var edit = t.closest('.site-edit');
        if (edit) {
            var col = snapshotCard(edit);
            if (!col) return;
            ev.preventDefault(); ev.stopImmediatePropagation();
            editSnapshot(col);
            return;
        }
        var del = t.closest('.site-del');
        if (del) {
            var dcol = snapshotCard(del);
            if (!dcol) return;
            ev.preventDefault(); ev.stopImmediatePropagation();
            hideSnapshot(dcol);
            return;
        }
        var catBtn = t.closest('[data-cat-act]');
        if (catBtn) {
            var cat = catOf(catBtn);
            if (!cat) return;
            var act = String(catBtn.getAttribute('data-cat-act') || '');
            ev.preventDefault(); ev.stopImmediatePropagation();
            if (act === 'add') { addSiteToCat(catBtn, cat); return; }
            if (act === 'rename') { promptRename(catBtn); return; }
            if (act === 'hide') {
                window.navGuestLocal.setCatHidden(cat, true).then(function (ok) {
                    toast(ok ? '已隐藏「' + (renameMap[cat] || cat) + '」，只影响这台浏览器' : '隐藏失败');
                });
                return;
            }
            if (act === 'up' || act === 'down') { moveSnapshotCat(catBtn, act); return; }
            return;
        }
        var add = t.closest('.nav-cat-add');
        if (add) {
            ev.preventDefault(); ev.stopImmediatePropagation();
            addSiteToCat(add, catOf(add));
            return;
        }
        if (t.closest('#navBulkToggle')) {
            ev.preventDefault(); ev.stopImmediatePropagation();
            toggleBulk();
            return;
        }
        if (bulkBar && t.closest('#ngSnapHiddenBar button')) {
            // 上面单独绑过,这里不拦
        }
    }, true);

    // 本机渲染后补回多选勾选框 / 隐藏条 / 改名
    window.navGuestLocal.onRender(function () {
        applyRenames();
        renderHiddenBar();
        if (bulkOn) { mountChecks(); paintBulkBar(); }
    });
    setTimeout(function () { applyRenames(); renderHiddenBar(); }, 300);
})();
