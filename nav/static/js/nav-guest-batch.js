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
        var bar = root && root.querySelector('.ng-bulkbar');
        // 不再靠中文「退出多选」判态:英文环境下文案会变(2026-11-26)
        return !!(bar && bar.querySelector('[data-bulk-act="open"]'));
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

    // ---------- 移动 / 换分类弹层 ----------
    function ensureMoveModal() {
        if (moveModal) return moveModal;
        moveModal = document.createElement('div');
        moveModal.className = 'modal fade';
        moveModal.id = 'ngbMoveModal';
        moveModal.tabIndex = -1;
        moveModal.setAttribute('data-no-resize', '1');
        moveModal.innerHTML =
            '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title" id="ngbMoveTitle">' + T('移动到分组') + '</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="' + T('关闭') + '"></button></div>' +
            '<div class="modal-body">' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngbMoveCat">' + T('大类(可选已有,也可直接新建)') + '</label>' +
            '<input id="ngbMoveCat" class="form-control form-control-sm" list="ngbMoveCatList" maxlength="50" placeholder="' + T('我的导入') + '">' +
            '<datalist id="ngbMoveCatList"></datalist></div>' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngbMoveSub">' + T('小分类(可留空,二级 / 三级)') + '</label>' +
            '<input id="ngbMoveSub" class="form-control form-control-sm" maxlength="80" placeholder="' + T('二级 / 三级') + '"></div>' +
            '<div id="ngbMoveErr" class="small text-danger mt-2"></div></div>' +
            '<div class="modal-footer"><button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">' + T('取消') + '</button>' +
            '<button type="button" class="btn btn-sm btn-primary nav-modal-primary" id="ngbMoveSave">' + T('移动到本机分组') + '</button></div>' +
            '</div></div>';
        document.body.appendChild(moveModal);
        document.getElementById('ngbMoveSave').addEventListener('click', saveMove);
        return moveModal;
    }
    function openMove(ctx) {
        ensureMoveModal();
        moveCtx = ctx;
        var list = document.getElementById('ngbMoveCatList');
        list.innerHTML = '';
        (L.categories() || []).forEach(function (c) {
            var o = document.createElement('option'); o.value = c; list.appendChild(o);
        });
        var it = ctx.single ? L.find(ctx.url) : null;
        document.getElementById('ngbMoveTitle').textContent = ctx.single ? T('更换分类') : T('移动 {n} 个书签').replace('{n}', String(ctx.urls.length));
        document.getElementById('ngbMoveCat').value = it ? (it.category || '') : '';
        document.getElementById('ngbMoveSub').value = it ? (it.subcat || '') : '';
        document.getElementById('ngbMoveErr').textContent = '';
        bootstrap.Modal.getOrCreateInstance(moveModal).show();
    }
    function saveMove() {
        var cat = document.getElementById('ngbMoveCat').value.trim();
        var sub = document.getElementById('ngbMoveSub').value.trim();
        var err = document.getElementById('ngbMoveErr');
        if (!cat) { err.textContent = T('大类不能为空'); return; }
        var btn = document.getElementById('ngbMoveSave');
        btn.disabled = true;
        var task = moveCtx.single
            ? L.setSiteCategory(moveCtx.url, cat, sub)
            : L.bulkMove(moveCtx.urls, { category: cat, subcat: sub });
        Promise.resolve(task).then(function (res) {
            btn.disabled = false;
            if (!res || res.ok === false) { err.textContent = (res && res.message) || T('本机存储空间不足,未保存'); return; }
            bootstrap.Modal.getOrCreateInstance(moveModal).hide();
            toast(moveCtx.single ? T('已更换分类') : T('已移动 {n} 个书签').replace('{n}', String(res.updated || 0)));
        }).catch(function () { btn.disabled = false; err.textContent = T('操作失败,请重试'); });
    }

    // ---------- 标签弹层(加 / 删) ----------
    function splitTags(raw) {
        var parts = String(raw || '').split(/[,，、;；\s]+/);
        var out = [], seen = {};
        parts.forEach(function (t) {
            t = String(t == null ? '' : t).trim().slice(0, 10);
            if (t && !seen[t] && out.length < 8) { seen[t] = 1; out.push(t); }
        });
        return out;
    }
    function ensureTagModal() {
        if (tagModal) return tagModal;
        tagModal = document.createElement('div');
        tagModal.className = 'modal fade';
        tagModal.id = 'ngbTagModal';
        tagModal.tabIndex = -1;
        tagModal.setAttribute('data-no-resize', '1');
        tagModal.innerHTML =
            '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title" id="ngbTagTitle">' + T('批量标签') + '</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="' + T('关闭') + '"></button></div>' +
            '<div class="modal-body">' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngbTagInput">' + T('标签(逗号分隔,最多 8 个)') + '</label>' +
            '<input id="ngbTagInput" class="form-control form-control-sm" list="ngbTagList" placeholder="' + T('免费, 开源, 需代理') + '"></div>' +
            '<datalist id="ngbTagList"></datalist>' +
            '<div id="ngbTagErr" class="small text-danger mt-2"></div></div>' +
            '<div class="modal-footer"><button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">' + T('取消') + '</button>' +
            '<button type="button" class="btn btn-sm btn-primary nav-modal-primary" id="ngbTagSave">' + T('应用到本机书签') + '</button></div>' +
            '</div></div>';
        document.body.appendChild(tagModal);
        document.getElementById('ngbTagSave').addEventListener('click', saveTags);
        return tagModal;
    }
    function openTag(mode, urls) {
        ensureTagModal();
        tagCtx = { mode: mode, urls: urls };
        var list = document.getElementById('ngbTagList');
        list.innerHTML = '';
        (L.tagVocab() || []).forEach(function (t) {
            var o = document.createElement('option'); o.value = t; list.appendChild(o);
        });
        document.getElementById('ngbTagTitle').textContent = mode === 'add' ? T('批量加标签') : T('批量删标签');
        document.getElementById('ngbTagInput').value = '';
        document.getElementById('ngbTagErr').textContent = '';
        bootstrap.Modal.getOrCreateInstance(tagModal).show();
    }
    function saveTags() {
        var tags = splitTags(document.getElementById('ngbTagInput').value);
        var err = document.getElementById('ngbTagErr');
        if (!tags.length) { err.textContent = T('请输入至少一个标签'); return; }
        var btn = document.getElementById('ngbTagSave');
        btn.disabled = true;
        var task = tagCtx.mode === 'add'
            ? L.bulkAddTags(tagCtx.urls, tags)
            : L.bulkRemoveTags(tagCtx.urls, tags);
        Promise.resolve(task).then(function (res) {
            btn.disabled = false;
            if (!res || res.ok === false) { err.textContent = T('本机存储空间不足,未保存'); return; }
            bootstrap.Modal.getOrCreateInstance(tagModal).hide();
            report(res, tagCtx.mode === 'add' ? '已批量加标签' : '已批量删标签');
        }).catch(function () { btn.disabled = false; err.textContent = T('操作失败,请重试'); });
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

    function enhanceBar(root) {
        var bar = root.querySelector('.ng-bulkbar');
        if (!bar || bar.querySelector('[data-ngb-bar]')) return;
        // 隐藏分组入口常驻,不依赖多选模式
        bar.appendChild(barBtn(T('隐藏分组'), T('列出并恢复已隐藏的分组'), 'btn-outline-secondary', openHidden));
        bar.appendChild(barBtn(T('恢复默认分组顺序'), T('还原分组上下顺序与显隐'), 'btn-outline-secondary', actResetOrder));
        if (!isBulkMode(root)) return;
        bar.appendChild(barBtn(allSelected(allBookmarkUrls()) ? T('取消全选') : T('全选'),
            T('勾选 / 取消勾选全部本机书签(含归档区)'), 'btn-outline-primary', toggleSelectAll, 'all'));
        bar.appendChild(barBtn(T('星标'), T('批量星标选中'), 'btn-outline-primary', function () { actPinned(true); }, 'pin'));
        bar.appendChild(barBtn(T('取消星标'), T('批量取消星标'), 'btn-outline-secondary', function () { actPinned(false); }, 'unpin'));
        bar.appendChild(barBtn(T('归档'), T('批量归档选中'), 'btn-outline-secondary', function () { actArchive(true); }, 'archive'));
        bar.appendChild(barBtn(T('唤醒'), T('批量恢复到主列表'), 'btn-outline-secondary', function () { actArchive(false); }, 'wake'));
        bar.appendChild(barBtn(T('移动…'), T('批量移动到其他大类 / 小分类'), 'btn-outline-secondary', function () {
            var urls = needUrls(); if (urls) openMove({ single: false, urls: urls });
        }, 'move'));
        bar.appendChild(barBtn(T('加标签…'), T('批量给选中书签加标签'), 'btn-outline-secondary', function () {
            var urls = needUrls(); if (urls) openTag('add', urls);
        }, 'addtag'));
        bar.appendChild(barBtn(T('删标签…'), T('批量给选中书签删标签'), 'btn-outline-secondary', function () {
            var urls = needUrls(); if (urls) openTag('remove', urls);
        }, 'deltag'));
        bar.appendChild(barBtn(T('删除'), T('批量删除选中书签(仅本机)'), 'btn-outline-danger', actDelete, 'delete'));
    }

    // ---------- 卡片右键菜单分支(模板 gOnAct 调用) ----------
    function siteAct(url, act) {
        if (!L.find(url)) return;
        if (act === 'top') L.moveSiteTo(url, 'top').then(paintSite);
        else if (act === 'bottom') L.moveSiteTo(url, 'bottom').then(paintSite);
        else if (act === 'recat') openMove({ single: true, url: url });
    }
    window.navGuestBatch = { siteAct: siteAct };

    // ---------- 0 项禁用:批量动作按钮在未勾选时置灰;全选/分组维护项不受限 ----------
    var BAR_ACT_ACTS = ['pin', 'unpin', 'archive', 'wake', 'move', 'addtag', 'deltag', 'delete'];
    function syncBarDisabled(root) {
        var bar = root && root.querySelector('.ng-bulkbar');
        if (!bar) return;
        var n = currentUrls().length;
        bar.querySelectorAll('[data-ngb-bar]').forEach(function (b) {
            var act = b.getAttribute('data-ngb-act') || '';
            b.disabled = n === 0 && BAR_ACT_ACTS.indexOf(act) >= 0;
        });
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
