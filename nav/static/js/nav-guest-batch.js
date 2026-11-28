/* 访客本机批量维护 + 分组/站点排序显隐(线 B,2026-11-20)
   ----------------------------------------------------------------------------
   只依赖 window.navGuestLocal 冻结 API(批量 / 分组 / 站点排序扩展接口 + onRender 钩子),
   不碰存储层、不调任何服务端接口;所有动作只写这台浏览器的本机数据。
   对外:window.navGuestBatch.siteAct(url, act) 供模板右键菜单分支挂接。 */
(function () {
    'use strict';
    if (!window.NAV_GUEST_MODE) return;
    var L = window.navGuestLocal;
    if (!L) return;

    // 勾选状态跨 render / 跨分组保持:DOM 勾选框每次渲染重建,以这份表为准
    var selected = {};
    var moveModal = null, tagModal = null, hiddenModal = null;
    var moveCtx = null;   // { single:true, url } 或 { single:false, urls:[] }
    var tagCtx = null;    // { mode:'add'|'remove', urls:[] }

    function T(zh) {
        return (window.NavI18n && typeof window.NavI18n.t === 'function') ? window.NavI18n.t(zh) : zh;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(msg) {
        if (L.toast) L.toast(msg);
        else if (window.navToast) window.navToast(msg);
    }
    function rootEl() { return document.getElementById('navGuestImports'); }

    function isBulkMode(root) {
        // 2026-11-27:判态改读 render() 写在容器上的 data-bulk,不再依赖某颗按钮是否存在
        return !!(root && root.getAttribute('data-bulk') === '1');
    }

    // ---------- 勾选收集与同步 ----------
    function currentUrls() {
        var root = rootEl();
        var urls = [];
        if (root) {
            root.querySelectorAll('.ng-check:checked').forEach(function (cb) {
                if (cb.dataset.url && urls.indexOf(cb.dataset.url) < 0) urls.push(cb.dataset.url);
            });
        }
        Object.keys(selected).forEach(function (u) {
            if (selected[u] && urls.indexOf(u) < 0) urls.push(u);
        });
        return urls;
    }
    function allBookmarkUrls() {
        return (L.list() || []).map(function (s) { return s.url; });
    }
    function allSelected(urls) {
        return urls.length > 0 && urls.every(function (u) { return selected[u]; });
    }
    function toggleSelectAll() {
        var urls = allBookmarkUrls();
        if (allSelected(urls)) selected = {};
        else urls.forEach(function (u) { selected[u] = true; });
        var root = rootEl();
        if (root) syncCheckboxes(root);
    }
    function bindCheck(cb) {
        var u = cb.dataset.url;
        cb.checked = !!selected[u];
        cb.onchange = function () {
            if (cb.checked) selected[u] = true;
            else delete selected[u];
            // 勾选变化即时刷新「已选 N 项」与禁用态,不必等下一次整块重渲染
            var bar = document.getElementById('navBulkBar');
            if (bar && bar.getAttribute('data-built') === '1') refreshBar(bar);
        };
    }
    function syncCheckboxes(root) {
        root.querySelectorAll('.ng-check').forEach(bindCheck);
        // 归档区卡片基础线不渲染勾选框;多选模式下由本线补上,便于批量唤醒
        if (isBulkMode(root)) {
            root.querySelectorAll('.site-archived [data-site-item]').forEach(function (col) {
                var box = col.querySelector('.site-card-box');
                if (!box || box.querySelector(':scope > .ng-check')) return;
                var ck = document.createElement('input');
                ck.type = 'checkbox';
                ck.className = 'ng-check';
                ck.setAttribute('data-url', col.dataset.url);
                box.insertBefore(ck, box.firstChild);
                bindCheck(ck);
            });
        }
    }
    function pruneSelected(urls, res) {
        if (!res || res.ok === false) return;
        (urls || []).forEach(function (u) { if (!L.find(u)) delete selected[u]; });
    }
    function needUrls() {
        var urls = currentUrls();
        if (!urls.length) { toast(T('先勾选要操作的书签')); return null; }
        return urls;
    }

    // ---------- 结果回执:保存失败如实提示,不伪造成功 ----------
    function report(res, label) {
        if (!res || res.ok === false) { toast(T('保存失败:本机存储空间不足,改动已回滚')); return; }
        var skip = (res.skipped || []).length;
        var msg = T('{label}:更新 {n} 条').replace('{label}', T(label)).replace('{n}', String(res.updated || 0));
        if (skip) msg += T(',跳过 {n} 条').replace('{n}', String(skip));
        toast(msg);
    }
    function paintOrder(res) { if (res && res.ok === false) toast(T('保存失败:本机存储空间不足')); }
    function paintSite(res) { if (res && res.ok === false) toast(T('保存失败:本机存储空间不足')); }

    // ---------- 批量动作 ----------
    function actPinned(pinned) {
        var urls = needUrls(); if (!urls) return;
        L.bulkSetPinned(urls, pinned).then(function (r) {
            report(r, pinned ? '已批量星标' : '已批量取消星标');
            pruneSelected(urls, r);
        });
    }
    function actArchive(archived) {
        var urls = needUrls(); if (!urls) return;
        L.bulkArchive(urls, archived).then(function (r) {
            report(r, archived ? '已批量归档' : '已批量唤醒');
            pruneSelected(urls, r);
        });
    }
    function actDelete() {
        var urls = needUrls(); if (!urls) return;
        function doDel() {
            L.bulkDelete(urls).then(function (r) { report(r, '已批量删除'); pruneSelected(urls, r); });
        }
        if (window.navConfirm) {
            window.navConfirm({
                title: T('批量删除本机书签'),
                body: T('只删除这台浏览器里勾选的 {n} 个书签,主人分享的站点不受影响;此操作不可恢复。').replace('{n}', String(urls.length)),
                danger: true, confirmLabel: T('删除')
            }).then(function (ok) { if (ok) doDel(); });
        } else { doDel(); }
    }
    function actResetOrder() {
        function doReset() {
            L.resetCatOrder().then(function (r) {
                if (r && r.ok === false) toast(T('保存失败:本机存储空间不足'));
                else toast(T('已恢复默认分组顺序与显隐'));
            });
        }
        if (window.navConfirm) {
            window.navConfirm({
                title: T('恢复默认分组顺序'),
                body: T('本机当前的分组上下顺序与隐藏设置都会还原为默认,书签本身不动。'),
                confirmLabel: T('恢复默认')
            }).then(function (ok) { if (ok) doReset(); });
        } else { doReset(); }
    }

    // ---------- 隐藏分组入口 ----------
    function ensureHiddenModal() {
        if (hiddenModal) return hiddenModal;
        hiddenModal = document.createElement('div');
        hiddenModal.className = 'modal fade';
        hiddenModal.id = 'ngbHiddenModal';
        hiddenModal.tabIndex = -1;
        hiddenModal.setAttribute('data-no-resize', '1');
        hiddenModal.innerHTML =
            '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title"><i class="fas fa-eye-slash me-2"></i>' + T('隐藏的分组') + '</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="' + T('关闭') + '"></button></div>' +
            '<div class="modal-body" id="ngbHiddenBody"></div></div></div>';
        document.body.appendChild(hiddenModal);
        return hiddenModal;
    }
    function openHidden() {
        ensureHiddenModal();
        var body = document.getElementById('ngbHiddenBody');
        var hidden = (L.groupOrder().hidden) || [];
        if (!hidden.length) {
            body.innerHTML = '<div class="alert alert-light border py-3 small mb-0">' + T('当前没有隐藏的分组。') + '</div>';
        } else {
            var sites = L.list() || [];
            var html = '';
            hidden.forEach(function (name) {
                var n = sites.filter(function (s) { return !s.archived && s.category === name; }).length;
                html += '<div class="ng-batch-row">' +
                    '<span class="ng-batch-name text-truncate" title="' + esc(name) + '">' + esc(name) + '</span>' +
                    '<span class="ng-batch-count">' + T('{n} 个书签').replace('{n}', String(n)) + '</span>' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" data-ngb-restore="' + esc(name) + '">' + T('恢复显示') + '</button>' +
                    '</div>';
            });
            body.innerHTML = html;
            body.querySelectorAll('[data-ngb-restore]').forEach(function (b) {
                b.addEventListener('click', function () {
                    var name = b.getAttribute('data-ngb-restore');
                    L.setCatHidden(name, false).then(function (r) {
                        if (r && r.ok === false) { toast(T('保存失败:本机存储空间不足')); return; }
                        toast(T('已恢复显示分组「{name}」').replace('{name}', name));
                        openHidden();
                    });
                });
            });
        }
        bootstrap.Modal.getOrCreateInstance(hiddenModal).show();
    }

    // ---------- 分组标题按钮注入 ----------
    function catBtn(icon, tip, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm btn-outline-secondary py-0 px-1';
        b.title = tip;
        b.setAttribute('data-ngb-cat', '');
        var i = document.createElement('i');
        i.className = 'fas ' + icon;
        b.appendChild(i);
        b.addEventListener('click', onClick);
        return b;
    }
    function enhanceCats(root) {
        root.querySelectorAll('.nav-cat[data-category]').forEach(function (cat) {
            var name = cat.getAttribute('data-category');
            var title = cat.querySelector('.nav-cat-title');
            var act = title && title.querySelector('span.d-flex');
            if (!act || act.querySelector('[data-ngb-cat]')) return;
            act.appendChild(catBtn('fa-eye-slash', T('隐藏分组'), function () {
                L.setCatHidden(name, true).then(function (r) {
                    if (r && r.ok === false) { toast(T('保存失败:本机存储空间不足')); return; }
                    toast(T('已隐藏分组「{name}」,可从「隐藏分组」入口恢复').replace('{name}', name));
                });
            }));
            act.appendChild(catBtn('fa-angle-double-up', T('分组置顶'), function () {
                L.moveCatTo(name, 'top').then(paintOrder);
            }));
            act.appendChild(catBtn('fa-angle-double-down', T('分组置底'), function () {
                L.moveCatTo(name, 'bottom').then(paintOrder);
            }));
        });
    }

    // ---------- 多选工具条:与主人 #navMsBar 同一形态 ----------
    function enhanceBar(root) {
        var bar = root.querySelector('#navBulkBar');
        if (!bar) return;
        var on = isBulkMode(root);
        bar.style.display = on ? 'flex' : 'none';
        if (!on) { bar.innerHTML = ''; bar.removeAttribute('data-built'); return; }
        if (bar.getAttribute('data-built') !== '1') buildBar(bar);
        refreshBar(bar);
    }

    function buildBar(bar) {
        var cats = L.categories() || [];
        var subMap = (L.subs && L.subs()) || {};
        bar.setAttribute('data-built', '1');
        bar.innerHTML =
            '<b class="small" id="navBulkCount" data-bulk-count></b>' +
            '<button class="btn btn-sm btn-primary" data-bulk-act="open" data-ngb-act="open">' + T('打开') + '</button>' +
            '<button class="btn btn-sm btn-outline-primary" data-ngb-act="pin">' + T('收藏') + '</button>' +
            '<button class="btn btn-sm btn-outline-danger" data-ngb-act="delete">' + T('删除') + '</button>' +
            '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="more">' + T('更多') + '<i class="fas fa-chevron-up ms-1" style="font-size:.7em"></i></button>' +
            '<button class="btn btn-sm btn-outline-secondary" id="navBulkExit" data-bulk-act="exit" data-bulk-exit data-ngb-act="exit">' + T('退出') + '</button>' +
            '<div class="ms-more-panel d-none" id="ngbMore">' +
              '<div class="ms-more-row">' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="copy">' + T('复制链接') + '</button>' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="all">' + T('全选当前可见') + '</button>' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="unpin">' + T('取消收藏') + '</button>' +
              '</div>' +
              '<div class="ms-more-row">' +
                '<select id="ngbCat" class="form-select form-select-sm" style="width:auto"><option value="">' + T('换分类到…') + '</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>' +
                '<select id="ngbSub" class="form-select form-select-sm" style="width:auto"><option value="">' + T('(清空小分类)') + '</option></select>' +
                '<button class="btn btn-sm btn-outline-primary" data-ngb-act="move">' + T('换分类') + '</button>' +
              '</div>' +
              '<div class="ms-more-row">' +
                '<input id="ngbTags" class="form-control form-control-sm" style="width:150px" placeholder="' + T('标签,逗号分隔') + '">' +
                '<button class="btn btn-sm btn-outline-primary" data-ngb-act="addtag">' + T('加标签') + '</button>' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="deltag">' + T('删标签') + '</button>' +
              '</div>' +
              '<div class="ms-more-row">' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="archive">💤 ' + T('休眠') + '</button>' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="wake">↩ ' + T('唤醒') + '</button>' +
              '</div>' +
              '<div class="ms-more-row">' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="hidden">' + T('隐藏分组') + '</button>' +
                '<button class="btn btn-sm btn-outline-secondary" data-ngb-act="reset">' + T('恢复默认分组顺序') + '</button>' +
              '</div>' +
            '</div>';
        var catSel = bar.querySelector('#ngbCat');
        var subSel = bar.querySelector('#ngbSub');
        function syncSubs() {
            var cat = catSel.value;
            subSel.innerHTML = '<option value="">' + T('(清空小分类)') + '</option>' +
                (subMap[cat] || []).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
        }
        catSel.addEventListener('change', syncSubs);
        syncSubs();
        bar.addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-ngb-act]');
            if (!b) return;
            var act = b.getAttribute('data-ngb-act');
            var urls = currentUrls();
            if (act === 'more') {
                var panel = bar.querySelector('#ngbMore');
                var open = panel.classList.toggle('d-none') === false;
                b.setAttribute('aria-expanded', open ? 'true' : 'false');
                var ic = b.querySelector('i');
                if (ic) ic.className = 'fas fa-chevron-' + (open ? 'down' : 'up') + ' ms-1';
                return;
            }
            if (act === 'exit') { if (window.navGuestBulk) window.navGuestBulk.exit(); return; }
            if (act === 'all') { toggleSelectAll(); return; }
            if (act === 'hidden') { openHidden(); return; }
            if (act === 'reset') { actResetOrder(); return; }
            if (act === 'copy') {
                if (!urls.length) { toast(T('先勾选书签')); return; }
                var text = urls.map(function (u) { var it = L.find(u) || {}; return (it.name ? it.name + ' ' : '') + u; }).join('\n');
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () {
                        toast(T('已复制 {n} 条链接').replace('{n}', String(urls.length)));
                    });
                } else { toast(T('当前浏览器不支持剪贴板')); }
                return;
            }
            if (!urls.length) { toast(T('先勾选书签')); return; }
            if (act === 'open') { urls.forEach(function (u) { window.open(u, '_blank'); }); return; }
            if (act === 'pin') { actPinned(true); return; }
            if (act === 'unpin') { actPinned(false); return; }
            if (act === 'archive') { actArchive(true); return; }
            if (act === 'wake') { actArchive(false); return; }
            if (act === 'delete') { actDelete(); return; }
            if (act === 'move') {
                var cat = catSel.value.trim();
                var sub = subSel.value.trim();
                if (!cat) { toast(T('先选目标大类')); return; }
                L.bulkMove(urls, { category: cat, subcat: sub }).then(function () {
                    toast(T('已移动到 {cat}').replace('{cat}', cat));
                });
                return;
            }
            if (act === 'addtag' || act === 'deltag') {
                var tags = (bar.querySelector('#ngbTags').value || '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
                if (!tags.length) { toast(T('先填标签')); return; }
                var p = act === 'addtag' ? L.bulkAddTags(urls, tags) : L.bulkRemoveTags(urls, tags);
                Promise.resolve(p).then(function () { toast(act === 'addtag' ? T('已加标签') : T('已删标签')); });
                return;
            }
        });
    }

    function refreshBar(bar) {
        var n = currentUrls().length;
        var c = bar.querySelector('[data-bulk-count]');
        if (c) c.textContent = T('已选 {n} 项').replace('{n}', String(n));
        bar.querySelectorAll('[data-ngb-act]').forEach(function (b) {
            var act = b.getAttribute('data-ngb-act');
            if (['pin', 'unpin', 'archive', 'wake', 'move', 'addtag', 'deltag', 'delete', 'copy'].indexOf(act) >= 0) b.disabled = n === 0;
        });
    }

    // ---------- 设置面板「分组」入口(工具条只在多选态出现,这两件事常驻设置里) ----------
    document.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-nav-guest-hidden]')) { ev.preventDefault(); openHidden(); }
        else if (ev.target.closest('[data-nav-guest-reset-order]')) { ev.preventDefault(); actResetOrder(); }
    });

    // ---------- 卡片右键菜单分支(模板 gOnAct 调用) ----------
    function siteAct(url, act) {
        if (!L.find(url)) return;
        if (act === 'top') L.moveSiteTo(url, 'top').then(paintSite);
        else if (act === 'bottom') L.moveSiteTo(url, 'bottom').then(paintSite);
        // 单个站点的「换分类」交给本机编辑弹窗(与主人点 ✎ 进同一个大表单),不再自开小窗
        else if (act === 'recat') { if (window.navGuestEdit) window.navGuestEdit(url); }
    }
    window.navGuestBatch = { siteAct: siteAct };

    // ---------- 0 项禁用:批量动作按钮在未勾选时置灰;全选/分组维护项不受限 ----------
    function syncBarDisabled(root) {
        var bar = root && root.querySelector('#navBulkBar');
        if (bar) refreshBar(bar);
    }

    // ---------- 多选工具栏扩展 ----------
    function barBtn(label, tip, cls, onClick, act) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm ' + (cls || 'btn-outline-secondary') + ' py-0 px-2';
        b.textContent = label;
        b.title = tip || '';
        b.setAttribute('data-ngb-bar', '');
        if (act) b.setAttribute('data-ngb-act', act);
        b.addEventListener('click', onClick);
        return b;
    }

    // ---------- render 后重建控件 ----------
    L.onRender(function () {
        var root = rootEl();
        if (!root) return;
        if (!isBulkMode(root)) selected = {};
        syncCheckboxes(root);
        enhanceBar(root);
        enhanceCats(root);
        syncBarDisabled(root);
    });

    // #11 统一多选 API:访客侧同形挂到 window.navBulk,与主人 batch.js 共用方法名与工具条钩子。
    // 菜单「多选」在访客页总入口:快照有卡片时交给快照多选,否则切本机导入多选。
    // 捕获阶段截住,避免共享的 batch.js(主人多选)在访客页也画一条空的 #navMsBar。
    document.addEventListener('click', function (ev) {
        if (!ev.target.closest('#navBulkToggle')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var snap = document.querySelector('#navGroups [data-site-item]') ? window.navGuestSnapshotBulk : null;
        if (snap) { (snap.active && snap.active()) ? snap.exit() : snap.enter(); return; }
        if (window.navGuestBulk) {
            if (window.navGuestBulk.active()) window.navGuestBulk.exit();
            else window.navGuestBulk.enter();
        }
    }, true);

    // 延迟到 jQuery ready 队列末尾再挂:batch.js 的主人侧方法也在 ready 回调里合并,
    // 访客委托必须后挂盖过它,否则访客页 enter/exit 会走到主人闭包(空选中集合)而不是内联 bulkMode 桥。
    jQuery(function () {
        function snapBulk() {
            // 页面主内容是快照站点(#navGroups 有卡片)时,#navBulkToggle 驱动的是快照多选;
            // 没有卡片时才走本机书签导入区的 navGuestBulk。两条路径共用同一组方法名。
            if (!window.navGuestSnapshotBulk) return null;
            return document.querySelector('#navGroups [data-site-item]') ? window.navGuestSnapshotBulk : null;
        }
        window.navBulk = Object.assign(window.navBulk || {}, {
            enter: function () { var s = snapBulk(); if (s) s.enter(); else if (window.navGuestBulk) window.navGuestBulk.enter(); },
            exit: function () { var s = snapBulk(); if (s) s.exit(); else if (window.navGuestBulk) window.navGuestBulk.exit(); },
            isActive: function () { var s = snapBulk(); return s ? !!s.active() : !!(window.navGuestBulk && window.navGuestBulk.active()); },
            count: function () { var s = snapBulk(); return s ? s.count() : currentUrls().length; },
            setCount: function () { /* 访客计数由选中表 + 勾选框派生,保留适配位 */ },
            render: function () { var s = snapBulk(); if (s) s.render(); else if (L.render) L.render(); },
            selectAll: function () { var s = snapBulk(); if (s) s.selectAll(); else toggleSelectAll(); }
        });
    });
})();
