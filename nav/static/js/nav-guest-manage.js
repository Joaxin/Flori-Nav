/* 访客本机管理(2026-11-20):
   书签编辑/新增(含标签、子网页、备用网址、自定义图标)、工具元数据编辑、
   体检篮、本机统计、标签快筛。
   全部只读写这台浏览器的 navStore / 内存里的访客书签,不调用本站任何写接口。
   对外:window.navGuestEdit / window.navGuestToolEdit / window.navGuestBasket / window.navGuestStatsOpen。 */
(function () {
    'use strict';
    if (!window.NAV_GUEST_MODE) return;
    if (!window.navGuestLocal) return;

    var BASKET_KEY = 'navGuestBasketV1';
    var BASKET_MAX = 80;
    var activeTag = '';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(msg) {
        if (window.navToast) window.navToast(msg);
        else if (window.console) console.warn('[nav-guest-manage] ' + msg);
    }
    function storeGet(key, fallback) {
        if (window.navStore && window.navStore.get) {
            return window.navStore.get(key, null).then(function (v) { return v == null ? fallback() : v; }).catch(fallback);
        }
        try { var raw = localStorage.getItem(key); return Promise.resolve(raw ? JSON.parse(raw) : fallback()); }
        catch (e) { return Promise.resolve(fallback()); }
    }
    function storeSet(key, val) {
        if (window.navStore && window.navStore.set) return window.navStore.set(key, val);
        try { localStorage.setItem(key, JSON.stringify(val)); return Promise.resolve(true); }
        catch (e) { return Promise.resolve(false); }
    }

    // 2026-11-25:访客端卡面 ✎/× 与主人端统一——不再有 navGuestCardBtnsV1 独立开关,
    // 显隐/常显直接走 nav-sites.js 的 #setCardActions / #setShowActions 两级偏好(同一套 CSS/JS)。

    // ===== 书签编辑 / 新增:与主人 #addSiteModal 同一套多 tab 表单 =====
    var editModal = null, editOldUrl = '', editMode = 'local', ngeSeq = 0;
    var NGE_MAX = 20;
    var AI_LINKS_KEY = 'navAiSuggestLinks';
    var FAV_URL_MAX = 500;
    var FAV_DATA_MAX = 100 * 1024;

    function ensureEditModal() {
        if (editModal) return editModal;
        editModal = document.createElement('div');
        editModal.className = 'modal fade';
        editModal.id = 'navGuestEditModal';
        editModal.tabIndex = -1;
        editModal.setAttribute('data-no-resize', '1');
        editModal.innerHTML =
            '<div class="modal-dialog modal-lg"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title" id="ngeTitle">编辑本机书签</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="d-flex align-items-end gap-1 mb-3">' +
            '<ul class="nav nav-tabs small flex-nowrap sf-tabs" id="ngeTabs" role="tablist"></ul>' +
            '<button type="button" class="btn btn-sm btn-outline-primary flex-shrink-0" id="ngeAddTab" title="再加一个站点表单(批量添加，最多 20 个)"><i class="fas fa-plus"></i></button>' +
            '<datalist id="ngeCatList"></datalist>' +
            '</div>' +
            '<div class="tab-content" id="ngePanes"></div>' +
            '<div class="form-text small mt-1">「识别标题/图标」只回填名称与图标；简介旁的「抓取」只回填简介。</div>' +
            '<div class="text-danger small mt-2" id="ngeErr"></div>' +
            '</div>' +
            '<div class="modal-footer flex-wrap gap-2">' +
            '<div class="form-check form-switch me-auto mb-0">' +
            '<input class="form-check-input" type="checkbox" id="ngeKeepOpen">' +
            '<label class="form-check-label small" for="ngeKeepOpen">保存后继续添加</label></div>' +
            '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>' +
            '<button type="button" class="btn btn-primary" id="ngeSave">保存</button>' +
            '</div></div></div>';
        document.body.appendChild(editModal);
        document.getElementById('ngeSave').addEventListener('click', saveEdit);
        document.getElementById('ngeAddTab').addEventListener('click', function () { if (editOldUrl) return; addPane(); });
        editModal.addEventListener('click', onPaneClick);
        editModal.addEventListener('change', function (ev) {
            if (!ev.target.classList.contains('nge-ai-links')) return;
            var on = ev.target.checked;
            try { localStorage.setItem(AI_LINKS_KEY, on ? '1' : '0'); } catch (e) {}
            editModal.querySelectorAll('.nge-ai-links').forEach(function (el) { el.checked = on; });
        });
        return editModal;
    }

    function ngeFormHtml() {
        return '<div class="sf-form">' +
            '<div class="row g-2">' +
            '<div class="col-6"><label class="form-label small mb-1">名称 <span class="text-danger">*</span></label>' +
            '<input class="form-control form-control-sm nge-name" maxlength="100" placeholder="例如： DHL Express"></div>' +
            '<div class="col-6"><label class="form-label small mb-1">网址 <span class="text-danger">*</span></label>' +
            '<input class="form-control form-control-sm font-monospace nge-url" maxlength="300" placeholder="dhl.com(自动加 https://)"></div>' +
            '</div>' +
            '<div class="d-flex align-items-center gap-2 my-2 flex-wrap">' +
            '<button type="button" class="btn btn-sm btn-outline-secondary nge-meta" title="抓取对方首页的 title、favicon 和 description">' +
            '<i class="fas fa-wand-magic-sparkles me-1"></i>识别标题/图标</button>' +
            '<button type="button" class="btn btn-sm btn-outline-primary nge-ai" title="按名称/网址让 AI 推荐分类、标签和图标文字；分类只从本机现有清单里挑">' +
            '<i class="fas fa-robot me-1"></i>AI 推荐</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary nge-icon" title="选择图标:纯色文字 / 在线获取 / 本地上传">' +
            '<i class="fas fa-image me-1"></i>选择图标</button>' +
            '<label class="form-check form-check-inline small text-muted mb-0" title="勾上才让 AI 一起给子网页与备用网址；它只给确定存在的地址，不确定就留空">' +
            '<input class="form-check-input nge-ai-links" type="checkbox"><span class="ms-1">顺带子网页/备用</span></label>' +
            '<img class="site-fav nge-fav d-none" alt=""><span class="site-fav fav-letter nge-fav-custom d-none"></span>' +
            '<span class="small text-muted nge-status"></span></div>' +
            '<div class="row g-2 mb-2">' +
            '<div class="col-6 col-md-3"><label class="form-label small mb-1">大类</label>' +
            '<input class="form-control form-control-sm nge-cat" maxlength="50" list="ngeCatList" placeholder="输入新名称即新建"></div>' +
            '<div class="col-6 col-md-3"><label class="form-label small mb-1">二级分类 <span class="text-muted">(可空)</span></label>' +
            '<input class="form-control form-control-sm nge-sub" maxlength="24" placeholder="如:视频"></div>' +
            '<div class="col-2"><label class="form-label small mb-1">三级 <span class="text-muted">(可选)</span></label>' +
            '<input class="form-control form-control-sm nge-sub2" maxlength="24" placeholder="如:图生视频"></div>' +
            '<div class="col-4"><label class="form-label small mb-1">简介 ' +
            '<button type="button" class="btn btn-link btn-sm p-0 nge-fetch-desc" title="按网址抓取对方网站的 meta description">抓取</button></label>' +
            '<input class="form-control form-control-sm nge-desc" maxlength="200" placeholder="一句话说明用途"></div>' +
            '</div>' +
            '<div class="mb-2"><label class="form-label small mb-1">标签 <span class="text-muted">(可选,逗号分隔,最多 8 个;点卡片上的标签可按标签筛选)</span></label>' +
            '<input class="form-control form-control-sm nge-tags" maxlength="120" placeholder="如:免费,常用,推理"></div>' +
            '<button type="button" class="btn btn-sm btn-link p-0 mb-1 nge-adv-toggle" aria-expanded="false">' +
            '<i class="fas fa-chevron-down me-1"></i>高级选项(子网页 / 备用网址)</button>' +
            '<div class="collapse nge-adv mb-1">' +
            '<label class="form-label small mb-1">子网页 / 子站点 <span class="text-muted">(可选,点击卡片时弹窗选择)</span></label>' +
            '<div class="nge-children"></div>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary mt-1 nge-add-child"><i class="fas fa-plus me-1"></i>添加子页</button>' +
            '<label class="form-label small mb-1 mt-2 d-block">备用网址 / 镜像 <span class="text-muted">(可选,同一站点资源站/备份/新域名等,卡片弹窗可选)</span></label>' +
            '<div class="nge-alts"></div>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary mt-1 nge-add-alt"><i class="fas fa-plus me-1"></i>添加备用网址</button>' +
            '<input type="hidden" class="nge-title"><input type="hidden" class="nge-favicon">' +
            '<input type="hidden" class="nge-icontext"><input type="hidden" class="nge-iconcolor"><input type="hidden" class="nge-iconsize">' +
            '</div>' +
            '<div class="text-danger small mt-1 nge-pane-err"></div>' +
            '</div>';
    }

    function paneList() {
        return editModal ? Array.prototype.slice.call(editModal.querySelectorAll('#ngePanes > .tab-pane')) : [];
    }
    function paneField(pane, cls) { return pane ? pane.querySelector('.' + cls) : null; }
    function activePane() {
        var list = paneList();
        for (var i = 0; i < list.length; i++) if (list[i].classList.contains('active')) return list[i];
        return list[0] || null;
    }
    function activatePane(pane) {
        var panes = paneList();
        panes.forEach(function (p) { p.classList.remove('show', 'active'); });
        pane.classList.add('show', 'active');
        editModal.querySelectorAll('#ngeTabs .nge-tab').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-pane') === '#' + pane.id);
        });
        var first = pane.querySelector('input:not([type=hidden]), textarea');
        if (first) first.focus();
    }
    function renumberTabs() {
        editModal.querySelectorAll('#ngeTabs .nge-tab .sf-label').forEach(function (el, i) {
            el.textContent = '站点 ' + (i + 1);
        });
    }
    function addPane(src) {
        if (paneList().length >= NGE_MAX) { toast('最多 20 个站点表单'); return null; }
        ensureEditModal();
        var id = 'ngePane' + (++ngeSeq);
        var li = document.createElement('li');
        li.className = 'nav-item';
        li.setAttribute('role', 'presentation');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-link py-1 px-2 d-flex align-items-center gap-1 nge-tab';
        btn.setAttribute('data-pane', '#' + id);
        var label = document.createElement('span');
        label.className = 'sf-label text-nowrap';
        label.textContent = '站点';
        var x = document.createElement('span');
        x.className = 'sf-x text-muted nge-tab-x';
        x.style.cssText = 'cursor:pointer;padding:0 2px';
        x.title = '关闭此表单';
        x.textContent = '×';
        btn.appendChild(label); btn.appendChild(x);
        li.appendChild(btn);
        editModal.querySelector('#ngeTabs').appendChild(li);
        var pane = document.createElement('div');
        pane.className = 'tab-pane fade';
        pane.id = id;
        pane.setAttribute('role', 'tabpanel');
        pane.innerHTML = ngeFormHtml();
        editModal.querySelector('#ngePanes').appendChild(pane);
        try { pane.querySelector('.nge-ai-links').checked = localStorage.getItem(AI_LINKS_KEY) === '1'; } catch (e) {}
        fillPane(pane, src || {});
        renumberTabs();
        activatePane(pane);
        return pane;
    }
    function removePane(pane) {
        if (paneList().length <= 1) { toast('至少保留一个表单'); return; }
        var btn = editModal.querySelector('#ngeTabs .nge-tab[data-pane="#' + pane.id + '"]');
        if (btn && btn.parentNode) btn.parentNode.remove();
        pane.remove();
        renumberTabs();
        var rest = paneList();
        if (rest.length) activatePane(rest[0]);
    }
    function onPaneClick(ev) {
        var tab = ev.target.closest('.nge-tab');
        if (tab) {
            if (ev.target.closest('.nge-tab-x')) {
                var p0 = editModal.querySelector(tab.getAttribute('data-pane'));
                if (p0) removePane(p0);
                return;
            }
            var p1 = editModal.querySelector(tab.getAttribute('data-pane'));
            if (p1) activatePane(p1);
            return;
        }
        var pane = ev.target.closest('.tab-pane');
        if (!pane) return;
        if (ev.target.closest('.nge-adv-toggle')) {
            setAdv(pane, !pane.querySelector('.nge-adv').classList.contains('show'));
            return;
        }
        if (ev.target.closest('.nge-add-child')) { addLinkRow(pane.querySelector('.nge-children'), 'child', null); return; }
        if (ev.target.closest('.nge-add-alt')) { addLinkRow(pane.querySelector('.nge-alts'), 'alt', null); return; }
        if (ev.target.closest('.nge-meta')) { fetchMeta(pane, 'all'); return; }
        if (ev.target.closest('.nge-fetch-desc')) { fetchMeta(pane, 'desc'); return; }
        if (ev.target.closest('.nge-ai')) { aiSuggest(pane); return; }
        if (ev.target.closest('.nge-icon')) { pickIcon(pane); return; }
    }

    function setAdv(pane, on) {
        var box = pane.querySelector('.nge-adv');
        if (!box) return;
        box.classList.toggle('show', !!on);
        var btn = pane.querySelector('.nge-adv-toggle');
        if (!btn) return;
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        var ic = btn.querySelector('i');
        if (ic) ic.className = 'fas fa-chevron-' + (on ? 'up' : 'down') + ' me-1';
    }

    function paintFav(pane) {
        var img = pane.querySelector('.nge-fav');
        var letter = pane.querySelector('.nge-fav-custom');
        if (!img || !letter) return;
        var fav = paneField(pane, 'nge-favicon').value.trim();
        var text = paneField(pane, 'nge-icontext').value.trim();
        img.classList.add('d-none');
        letter.classList.add('d-none');
        if (fav) {
            img.src = fav;
            img.classList.remove('d-none');
        } else if (text) {
            letter.textContent = text;
            letter.style.background = paneField(pane, 'nge-iconcolor').value.trim() || '#5850ec';
            letter.style.setProperty('--fav-fs', '10px');
            letter.classList.remove('d-none');
        }
    }

    function setStatus(pane, msg) {
        var st = paneField(pane, 'nge-status');
        if (st) st.textContent = msg || '';
    }

    function fetchMeta(pane, mode) {
        var urlEl = paneField(pane, 'nge-url');
        var status = paneField(pane, 'nge-status');
        var url = (urlEl.value || '').trim();
        if (!url) { status.textContent = '先填写网址'; return; }
        var btn = pane.querySelector(mode === 'desc' ? '.nge-fetch-desc' : '.nge-meta');
        var tok = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
        if (btn) btn.disabled = true;
        status.textContent = mode === 'desc' ? '抓取简介中…' : '识别中…';
        fetch('/api/nav/fetch-meta/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': tok },
            body: JSON.stringify({ url: url })
        }).then(function (r) {
            return r.json().catch(function () { return {}; })
                .then(function (d) { return { ok: r.ok, d: d || {} }; });
        }).then(function (res) {
            if (!res.ok) throw new Error(res.d.message || '识别失败');
            var nameEl = paneField(pane, 'nge-name');
            var descEl = paneField(pane, 'nge-desc');
            var favEl = paneField(pane, 'nge-favicon');
            var titleEl = paneField(pane, 'nge-title');
            if (mode === 'desc') {
                if (res.d.description) descEl.value = res.d.description.slice(0, 200);
                status.textContent = res.d.description ? '简介已抓取,可修改' : '没解析到简介,可手动填写';
            } else {
                if (res.d.title && !nameEl.value.trim()) nameEl.value = res.d.title.slice(0, 80);
                if (res.d.title && !titleEl.value.trim()) titleEl.value = res.d.title.slice(0, 80);
                if (res.d.description && !descEl.value.trim()) descEl.value = res.d.description.slice(0, 200);
                if (res.d.favicon && !favEl.value.trim()) favEl.value = res.d.favicon;
                paintFav(pane);
                status.textContent = (res.d.title || res.d.favicon || res.d.description)
                    ? '已识别,可修改' : '没解析到标题/图标/简介,可手动填写';
            }
        }).catch(function (err) {
            status.textContent = (err && err.message) || '识别失败,可手动填写';
        }).then(function () { if (btn) btn.disabled = false; });
    }

    function aiSuggest(pane) {
        var st = paneField(pane, 'nge-status');
        var name = paneField(pane, 'nge-name').value;
        var url = paneField(pane, 'nge-url').value;
        var desc = paneField(pane, 'nge-desc').value;
        var wantLinks = !!pane.querySelector('.nge-ai-links').checked;
        if (!window.navGuestAi || !window.navGuestAi.suggest) { st.textContent = 'AI 模块还没加载'; return; }
        if (!(name || url).trim()) { st.textContent = '先填名称或网址'; return; }
        var btn = pane.querySelector('.nge-ai');
        btn.disabled = true;
        st.textContent = 'AI 推荐中…';
        window.navGuestAi.suggest({ name: name, url: url, description: desc, links: wantLinks }).then(function (sug) {
            var notes = [];
            if (sug.category) { paneField(pane, 'nge-cat').value = sug.category; notes.push('分类'); }
            var parts = splitSubParts(sug.subcat || '');
            if (parts[0]) { paneField(pane, 'nge-sub').value = parts[0]; notes.push('小分类'); }
            if (parts[1]) paneField(pane, 'nge-sub2').value = parts[1];
            if (sug.tags && sug.tags.length) {
                var tagsEl = paneField(pane, 'nge-tags');
                var cur = (tagsEl.value || '').split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
                var merged = cur.concat(sug.tags.filter(function (t) { return cur.indexOf(t) < 0; })).slice(0, 8);
                tagsEl.value = merged.join(',');
                notes.push('标签');
            }
            if (sug.icon_text) {
                paneField(pane, 'nge-icontext').value = sug.icon_text;
                paneField(pane, 'nge-favicon').value = '';
                paintFav(pane);
                notes.push('图标 ' + sug.icon_text);
            }
            if (wantLinks && sug.children && sug.children.length) {
                var box = pane.querySelector('.nge-children');
                sug.children.forEach(function (c) { addLinkRow(box, 'child', c); });
                notes.push('子网页 ' + sug.children.length);
            }
            if (wantLinks && sug.alternates && sug.alternates.length) {
                var abox = pane.querySelector('.nge-alts');
                sug.alternates.forEach(function (a) { addLinkRow(abox, 'alt', a); });
                notes.push('备用 ' + sug.alternates.length);
            }
            if (wantLinks && ((sug.children && sug.children.length) || (sug.alternates && sug.alternates.length))) {
                setAdv(pane, true);
            }
            st.textContent = notes.length ? 'AI 已填：' + notes.join(' / ') : 'AI 没给出建议';
        }).catch(function (err) {
            var msg = (err && err.message) || 'AI 推荐失败';
            if (err && err.kind === 'config') msg = '还没填 AI 接口：菜单 → AI 接口，填好地址和模型';
            st.textContent = '✗ ' + msg;
        }).then(function () { btn.disabled = false; });
    }

    function pickIcon(pane) {
        if (!window.navIconPickerOpen) { toast('图标选择器还没加载'); return; }
        var url = (paneField(pane, 'nge-url').value || '').trim();
        var name = (paneField(pane, 'nge-name').value || '').trim();
        var textVal = paneField(pane, 'nge-icontext').value.trim();
        var colorVal = paneField(pane, 'nge-iconcolor').value.trim();
        var sizeVal = parseInt(paneField(pane, 'nge-iconsize').value, 10);
        var fav = paneField(pane, 'nge-favicon').value.trim();
        window.navIconPickerOpen({
            text: textVal,
            color: /^#[0-9a-fA-F]{6}$/.test(colorVal) ? colorVal : '#5850ec',
            size: (sizeVal >= 8 && sizeVal <= 48) ? sizeVal : 34,
            url: /^https?:\/\//i.test(fav) ? fav : '',
            fallbackName: name || url
        }, function (pick) {
            if (pick.mode === 'text') {
                paneField(pane, 'nge-icontext').value = pick.text || '';
                paneField(pane, 'nge-iconcolor').value = pick.color || '';
                paneField(pane, 'nge-iconsize').value = pick.size || '';
                paneField(pane, 'nge-favicon').value = '';
            } else {
                paneField(pane, 'nge-favicon').value = pick.url || '';
                paneField(pane, 'nge-icontext').value = '';
            }
            paintFav(pane);
        });
    }

    function splitSubParts(v) {
        var parts = String(v == null ? '' : v).split(/\s*\/\s*|\s*>\s*/).filter(Boolean);
        return [parts[0] || '', parts[1] || ''];
    }
    function linkRow(kind, data) {
        var row = document.createElement('div');
        row.className = 'nge-link-row';
        row.setAttribute('data-kind', kind);
        var name = document.createElement('input');
        name.className = 'form-control form-control-sm';
        name.maxLength = 80;
        name.placeholder = kind === 'child' ? '子网页名称' : '备用名称(可空)';
        name.value = (data && data.name) || '';
        var url = document.createElement('input');
        url.className = 'form-control form-control-sm font-monospace';
        url.placeholder = 'https://example.com/page';
        url.value = (data && data.url) || '';
        var desc = document.createElement('input');
        desc.className = 'form-control form-control-sm';
        desc.maxLength = 200;
        desc.placeholder = '简介(可空)';
        desc.value = (data && data.description) || '';
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-sm btn-outline-danger py-0 px-2';
        del.title = '删除此行';
        del.innerHTML = '<i class="fas fa-times"></i>';
        del.addEventListener('click', function () { row.remove(); });
        row.appendChild(name); row.appendChild(url); row.appendChild(desc); row.appendChild(del);
        return row;
    }
    function addLinkRow(box, kind, data) {
        if (box) box.appendChild(linkRow(kind, data || {}));
    }
    function clearLinkRows(box) { if (box) box.innerHTML = ''; }
    function collectLinks(kind, box) {
        var rows = box ? box.querySelectorAll('.nge-link-row') : [];
        var out = [];
        for (var i = 0; i < rows.length; i++) {
            var inputs = rows[i].querySelectorAll('input');
            var name = inputs[0].value.trim();
            var rawUrl = inputs[1].value.trim();
            var desc = inputs[2].value.trim();
            if (!name && !rawUrl && !desc) continue;
            if (!rawUrl) return { error: '第 ' + (i + 1) + ' 条链接缺少网址' };
            var url = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
            var parsed = null;
            try { parsed = new URL(url); } catch (e) { parsed = null; }
            if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
                return { error: '第 ' + (i + 1) + ' 条链接网址无效,需要 http/https' };
            }
            var item = { url: parsed.href, description: desc.slice(0, 200) };
            if (kind === 'child') item.name = (name || parsed.hostname).slice(0, 80);
            else item.name = name.slice(0, 80);
            out.push(item);
        }
        return { list: out };
    }
    function cleanFaviconInput(v) {
        var s = String(v == null ? '' : v).trim();
        if (!s) return { value: '', error: '' };
        if (/^data:/i.test(s)) {
            if (!/^data:image\//i.test(s)) return { value: '', error: 'data URI 必须是图片(data:image/...)' };
            if (s.length > FAV_DATA_MAX) return { value: '', error: '图标 data URI 超过 100KB,请改用外链或文字图标' };
            return { value: s, error: '' };
        }
        if (/^https?:\/\//i.test(s)) {
            if (s.length > FAV_URL_MAX) return { value: '', error: '图标外链过长' };
            return { value: s, error: '' };
        }
        return { value: '', error: '图标只支持 http/https 外链或图片 data URI' };
    }
    function cleanColorInput(v) {
        var s = String(v == null ? '' : v).trim();
        if (!s) return '';
        if (/[<>"'`;{}]/.test(s)) return '';
        return s.slice(0, 40);
    }
    function fillCats() {
        var list = document.getElementById('ngeCatList');
        if (!list) return;
        list.innerHTML = '';
        var names = (window.navGuestLocal.categories() || []).slice();
        document.querySelectorAll('#navGroups > .nav-cat[data-collapse-id]').forEach(function (el) {
            var c = el.getAttribute('data-collapse-id') || '';
            if (c && names.indexOf(c) < 0) names.push(c);
        });
        names.forEach(function (c) {
            var o = document.createElement('option'); o.value = c; list.appendChild(o);
        });
    }
    function fillPane(pane, src) {
        paneField(pane, 'nge-name').value = src.name || '';
        paneField(pane, 'nge-url').value = src.url || '';
        paneField(pane, 'nge-cat').value = src.category || '';
        var parts = splitSubParts(src.subcat || '');
        paneField(pane, 'nge-sub').value = parts[0];
        paneField(pane, 'nge-sub2').value = parts[1];
        paneField(pane, 'nge-tags').value = src.tags ? (Array.isArray(src.tags) ? src.tags.join(', ') : String(src.tags)) : '';
        paneField(pane, 'nge-desc').value = src.description || '';
        paneField(pane, 'nge-title').value = src.siteTitle || '';
        paneField(pane, 'nge-favicon').value = src.favicon || '';
        paneField(pane, 'nge-icontext').value = src.iconText || '';
        paneField(pane, 'nge-iconcolor').value = src.iconColor || '';
        paneField(pane, 'nge-iconsize').value = src.iconSize || '';
        clearLinkRows(pane.querySelector('.nge-children'));
        clearLinkRows(pane.querySelector('.nge-alts'));
        (src.children || []).forEach(function (c) { addLinkRow(pane.querySelector('.nge-children'), 'child', c); });
        (src.alternates || []).forEach(function (a) { addLinkRow(pane.querySelector('.nge-alts'), 'alt', a); });
        setStatus(pane, '');
        pane.querySelector('.nge-pane-err').textContent = '';
        setAdv(pane, (src.children && src.children.length) || (src.alternates && src.alternates.length));
        paintFav(pane);
    }
    function openEdit(url, opts) {
        ensureEditModal();
        opts = opts || {};
        var snapshot = !!opts.snapshot;
        editMode = snapshot ? 'snapshot' : 'local';
        editOldUrl = url || '';
        fillCats();
        editModal.querySelector('#ngePanes').innerHTML = '';
        editModal.querySelector('#ngeTabs').innerHTML = '';
        document.getElementById('ngeKeepOpen').checked = false;
        document.getElementById('ngeErr').textContent = '';
        var it = snapshot ? null : (url ? window.navGuestLocal.find(url) : null);
        var src = snapshot ? (opts.data || {}) : (it || {});
        if (!snapshot && !url && opts.category) src = Object.assign({}, src, { category: opts.category });
        document.getElementById('ngeTitle').textContent = snapshot
            ? '编辑访客视图（只存本机）'
            : (it ? '编辑本机书签' : '添加本机书签');
        addPane(src);
        bootstrap.Modal.getOrCreateInstance(editModal).show();
    }
    window.navGuestEdit = openEdit;

    function collectPane(pane, requireUrl) {
        var name = paneField(pane, 'nge-name').value.trim();
        var rawUrl = paneField(pane, 'nge-url').value.trim();
        var cat = paneField(pane, 'nge-cat').value.trim() || '我的导入';
        var sub = paneField(pane, 'nge-sub').value.trim();
        var sub2 = paneField(pane, 'nge-sub2').value.trim();
        var tags = paneField(pane, 'nge-tags').value;
        var desc = paneField(pane, 'nge-desc').value.trim();
        var siteTitle = paneField(pane, 'nge-title').value.trim().slice(0, 80);
        if (!rawUrl) {
            if (!requireUrl && !name && !desc && !tags.trim() && !sub && !sub2 &&
                !pane.querySelector('.nge-children .nge-link-row') && !pane.querySelector('.nge-alts .nge-link-row')) {
                return { empty: true };
            }
            return { error: '网址不能为空' };
        }
        var url = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
        var parsed = null;
        try {
            parsed = new URL(url);
            if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error('bad');
        } catch (e) { return { error: '网址无效,需要 http/https 链接' }; }
        var children = collectLinks('child', pane.querySelector('.nge-children'));
        if (children.error) return { error: children.error };
        var alternates = collectLinks('alt', pane.querySelector('.nge-alts'));
        if (alternates.error) return { error: alternates.error };
        var fav = cleanFaviconInput(paneField(pane, 'nge-favicon').value);
        if (fav.error) return { error: fav.error };
        var iconText = paneField(pane, 'nge-icontext').value.trim().slice(0, 2);
        var iconColor = cleanColorInput(paneField(pane, 'nge-iconcolor').value);
        var sizeRaw = paneField(pane, 'nge-iconsize').value.trim();
        var iconSize = 0;
        if (sizeRaw) {
            var sz = Number(sizeRaw);
            if (!(sz >= 8 && sz <= 48)) return { error: '图标字号需在 8–48 px 之间' };
            iconSize = Math.floor(sz);
        }
        name = name || parsed.hostname;
        return {
            payload: {
                name: name, url: url, category: cat,
                subcat: sub && sub2 ? (sub + ' / ' + sub2) : (sub2 || sub),
                description: desc, tags: tags, siteTitle: siteTitle,
                children: children.list, alternates: alternates.list,
                favicon: fav.value, iconText: iconText, iconColor: iconColor, iconSize: iconSize
            }
        };
    }

    function saveEdit() {
        var err = document.getElementById('ngeErr');
        err.textContent = '';
        var panes = paneList();
        var btn = document.getElementById('ngeSave');
        var snapshot = editMode === 'snapshot';
        btn.disabled = true;
        if (editOldUrl && !snapshot) {
            var one = collectPane(panes[0], true);
            btn.disabled = false;
            if (one.error) { err.textContent = one.error; return; }
            if (one.empty) { err.textContent = '网址不能为空'; return; }
            window.navGuestLocal.patch(editOldUrl, one.payload).then(function (res) {
                if (res && res.ok === false) { err.textContent = res.message || '保存失败'; return; }
                bootstrap.Modal.getOrCreateInstance(editModal).hide();
                toast('已保存本机修改');
                window.dispatchEvent(new CustomEvent('nav-guest-site-changed', { detail: { oldUrl: editOldUrl, newUrl: one.payload.url } }));
            }).catch(function (e2) { err.textContent = (e2 && e2.message) || '保存失败'; });
            return;
        }
        var payloads = [], errors = [];
        panes.forEach(function (pane, i) {
            var r = collectPane(pane, false);
            if (r.error) errors.push('第 ' + (i + 1) + ' 个：' + r.error);
            else if (r.payload) payloads.push(r.payload);
        });
        if (errors.length) { btn.disabled = false; err.textContent = errors[0]; return; }
        if (!payloads.length) { btn.disabled = false; err.textContent = '至少填一个站点'; return; }
        var task = snapshot
            ? window.navGuestLocal.updateSnapshot(editOldUrl, payloads[0])
            : window.navGuestLocal.addSites(payloads);
        Promise.resolve(task).then(function (res) {
            if (res && res.ok === false) { btn.disabled = false; err.textContent = res.message || '保存失败'; return; }
            if (snapshot) {
                bootstrap.Modal.getOrCreateInstance(editModal).hide();
                toast('已保存到本机视图，主人分享的原始站点不受影响');
                btn.disabled = false;
                return;
            }
            var added = res && res.added ? res.added.length : payloads.length;
            if (!added) {
                btn.disabled = false;
                var reason = res && res.skipped && res.skipped[0] && res.skipped[0].reason;
                err.textContent = reason || '没有写入';
                return;
            }
            var keep = document.getElementById('ngeKeepOpen').checked;
            if (keep) {
                editModal.querySelector('#ngePanes').innerHTML = '';
                editModal.querySelector('#ngeTabs').innerHTML = '';
                addPane();
                err.textContent = '';
                toast(added > 1 ? ('已添加 ' + added + ' 个书签，可继续填') : '已添加到本机书签，可继续填下一个');
            } else {
                bootstrap.Modal.getOrCreateInstance(editModal).hide();
                toast(added > 1 ? ('已添加 ' + added + ' 个书签') : '已添加到本机书签');
            }
            btn.disabled = false;
            window.dispatchEvent(new CustomEvent('nav-guest-site-changed', { detail: { added: added } }));
        }).catch(function (e2) {
            btn.disabled = false;
            err.textContent = (e2 && e2.message) || '保存失败';
        });
    }

    // ===== 图标本地化(best-effort,纯浏览器直连;缓存只进本机 IDB,不回写书签) =====
    function localizeAll() {
        var urls = window.navGuestLocal.list().map(function (s) { return s.url; });
        if (!urls.length) { toast('本机还没有书签'); return; }
        var btn = document.querySelector('[data-nav-localize-all]');
        if (btn) btn.disabled = true;
        Promise.resolve(window.navGuestLocal.localizeFavicons(urls, {})).then(function (results) {
            if (btn) btn.disabled = false;
            var ok = 0, fail = 0, cors = 0, skip = 0;
            (results || []).forEach(function (r) {
                if (r.ok) { if (r.reason === '已缓存') skip += 1; else ok += 1; }
                else if (r.reason === 'CORS 受限') { fail += 1; cors += 1; }
                else if (r.reason === 'data 链接跳过' || r.reason === '非 http/https') skip += 1;
                else fail += 1;
            });
            toast('图标本地化完成:成功 ' + ok + ' / 失败 ' + fail + '(CORS 受限 ' + cors + ') / 跳过 ' + skip);
        }).catch(function () {
            if (btn) btn.disabled = false;
            toast('图标本地化失败:本机存储读取异常');
        });
    }

    // ===== 标签快筛(每次 render 后重建) =====
    function applyTagFilter() {
        var root = document.getElementById('navGuestImports');
        if (!root) return;
        root.querySelectorAll('[data-site-item]').forEach(function (col) {
            var tags = [];
            try { tags = JSON.parse(col.getAttribute('data-tags') || '[]'); } catch (e) { tags = []; }
            col.style.display = (!activeTag || tags.indexOf(activeTag) !== -1) ? '' : 'none';
        });
        root.querySelectorAll('.nav-cat').forEach(function (cat) {
            var cards = cat.querySelectorAll('[data-site-item]');
            var visible = 0;
            cards.forEach(function (c) { if (c.style.display !== 'none') visible += 1; });
            if (cards.length) cat.style.display = visible ? '' : 'none';
        });
    }
    function buildTagBar() {
        var root = document.getElementById('navGuestImports');
        if (!root) return;
        var old = root.querySelector('.nav-guest-tagbar');
        if (old) old.remove();
        var tags = window.navGuestLocal.tagVocab() || [];
        if (!tags.length) return;
        var bar = document.createElement('div');
        bar.className = 'nav-guest-tagbar';
        var label = document.createElement('span');
        label.className = 'nav-guest-tagbar__label';
        label.textContent = '标签';
        bar.appendChild(label);
        var all = document.createElement('button');
        all.type = 'button'; all.className = 'nav-guest-tag' + (activeTag ? '' : ' on');
        all.textContent = '全部';
        all.addEventListener('click', function () { activeTag = ''; applyTagFilter(); paintTagBar(); });
        bar.appendChild(all);
        tags.slice(0, 20).forEach(function (t) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'nav-guest-tag' + (activeTag === t ? ' on' : '');
            b.textContent = t;
            b.setAttribute('data-tag', t);
            b.addEventListener('click', function () {
                activeTag = activeTag === t ? '' : t;
                applyTagFilter();
                paintTagBar();
            });
            bar.appendChild(b);
        });
        var hint = document.createElement('span');
        hint.className = 'nav-guest-tagbar__hint';
        hint.textContent = '再点一次取消';
        bar.appendChild(hint);
        root.insertBefore(bar, root.firstChild);
        paintTagBar();
        applyTagFilter();
    }
    function paintTagBar() {
        var root = document.getElementById('navGuestImports');
        if (!root) return;
        root.querySelectorAll('.nav-guest-tagbar .nav-guest-tag').forEach(function (b) {
            var t = b.getAttribute('data-tag') || '';
            b.classList.toggle('on', t ? t === activeTag : !activeTag);
        });
    }
    window.navGuestLocal.onRender(buildTagBar);

    // ===== 体检篮(纯浏览器探测) =====
    var basketModal = null, basketBusy = false;
    function basketGet() {
        return storeGet(BASKET_KEY, function () { return []; }).then(function (v) { return Array.isArray(v) ? v : []; });
    }
    function basketSet(list) { return storeSet(BASKET_KEY, list.slice(0, BASKET_MAX)); }
    function basketCount() { return basketGet().then(function (l) { return l.length; }); }
    function basketRefreshLabels() {
        basketCount().then(function (n) {
            document.querySelectorAll('[data-nav-basket]').forEach(function (el) {
                if (el.getAttribute('data-nav-basket') === 'menu') return;
            });
            var menu = document.querySelector('[data-nav-basket]');
            if (menu && menu.classList.contains('dropdown-item')) {
                menu.innerHTML = '<i class="fas fa-basket-shopping"></i> 体检篮(本机)' + (n ? '(' + n + ')' : '');
            }
            // 抽屉里的「死链篮」页签跟主人一样带条数
            var badge = document.getElementById('ngbTabCount');
            if (badge) badge.textContent = n ? '（' + n + '）' : '';
        });
    }
    window.navGuestBasketRefresh = basketRefreshLabels;

    function ensureBasketModal() {
        if (basketModal) return basketModal;
        // 与主人 navBasketDrawer 同一骨架:右侧 offcanvas 抽屉 + 共享 .nav-drawer 类
        // (宽 var(--nav-drawer-w)、贴右满高、滚动容器在 offcanvas-body),不再用居中 modal。
        basketModal = document.createElement('div');
        basketModal.className = 'offcanvas offcanvas-end nav-drawer';
        basketModal.id = 'navGuestBasketModal';
        basketModal.tabIndex = -1;
        basketModal.setAttribute('data-no-resize', '1');
        basketModal.innerHTML =
            '<div class="offcanvas-header pb-1">' +
            '<h5 class="offcanvas-title"><i class="fas fa-basket-shopping me-2"></i>体检篮 ' +
            '<small class="text-muted fw-normal fs-6 ms-1">本机</small></h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="关闭"></button></div>' +
            '<div class="offcanvas-body pt-1">' +
            /* 页签与主人 navBasketDrawer 逐字对齐:死链篮 / 保养 / URL 卫生,三颗等宽 btn-sm,
               当前页签 btn-primary、其余 btn-outline-secondary(主人同款)。 */
            '<div class="d-flex gap-2 mb-2">' +
            '<button type="button" class="btn btn-sm btn-primary flex-grow-1" id="ngbTabBasket">' +
            '<i class="fas fa-basket-shopping me-1"></i>死链篮<span id="ngbTabCount" class="ms-1"></span></button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary flex-grow-1" id="ngbTabCare" ' +
            'title="体检 + 使用情况：打不开、没测过、从没点开、很久没访问、休眠"><i class="fas fa-stethoscope me-1"></i>保养</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary flex-grow-1" id="ngbTabHygiene" ' +
            'title="扫描本机书签可清理的 URL：跟踪参数、尾斜杠、域名大写、重复斜杠、http 升级"><i class="fas fa-broom me-1"></i>URL 卫生</button>' +
            '</div>' +
            '<div id="ngbPaneBasket">' +
            '<div class="d-flex gap-1 mb-2">' +
            '<button type="button" class="btn btn-sm btn-primary flex-grow-1" id="ngbScan">体检本机书签</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary flex-grow-1" id="ngbRecheck">重测篮内地址</button>' +
            '</div>' +
            '<div class="small text-muted mb-2" id="ngbStatus"></div>' +
            '<div id="ngbList"></div>' +
            '</div>' +
            '<div id="ngbPaneCare" class="d-none"></div>' +
            '<div id="ngbPaneHygiene" class="d-none"></div>' +
            '</div>';
        document.body.appendChild(basketModal);
        document.getElementById('ngbScan').addEventListener('click', scanAll);
        document.getElementById('ngbRecheck').addEventListener('click', recheckBasket);
        document.getElementById('ngbTabBasket').addEventListener('click', function () { switchBasketTab('basket'); });
        document.getElementById('ngbTabCare').addEventListener('click', function () { switchBasketTab('care'); });
        document.getElementById('ngbTabHygiene').addEventListener('click', function () { switchBasketTab('hygiene'); });
        return basketModal;
    }
    var basketTab = 'basket';
    function switchBasketTab(tab) {
        basketTab = tab;
        var paneBasket = document.getElementById('ngbPaneBasket');
        var paneCare = document.getElementById('ngbPaneCare');
        var paneHygiene = document.getElementById('ngbPaneHygiene');
        if (!paneBasket) return;
        paneBasket.classList.toggle('d-none', tab !== 'basket');
        paneCare.classList.toggle('d-none', tab !== 'care');
        paneHygiene.classList.toggle('d-none', tab !== 'hygiene');
        var map = { basket: 'ngbTabBasket', care: 'ngbTabCare', hygiene: 'ngbTabHygiene' };
        Object.keys(map).forEach(function (k) {
            var b = document.getElementById(map[k]);
            if (b) b.className = 'btn btn-sm flex-grow-1 ' + (k === tab ? 'btn-primary' : 'btn-outline-secondary');
        });
        if (tab === 'basket') renderBasket();
        else if (tab === 'care' && window.navGuestCare) window.navGuestCare.mount(paneCare, 'care');
        else if (tab === 'hygiene' && window.navGuestCare) window.navGuestCare.mount(paneHygiene, 'url');
    }
    // 修改书签地址后把旧地址移出体检篮;监听在模块加载时就挂上,
    // 不依赖用户先打开过体检篮——否则上次会话留下的篮内旧地址会一直留着。
    window.addEventListener('nav-guest-site-changed', function (ev) {
        var d = ev.detail || {};
        if (!d.oldUrl) return;
        basketGet().then(function (list) {
            var next = list.filter(function (it) { return it.url !== d.oldUrl; });
            if (next.length !== list.length) basketSet(next).then(function () {
                basketRefreshLabels(); renderBasket();
            });
        });
    });
    function errorLabel(err) { return String(err || '连不上'); }
    function renderBasket() {
        var box = document.getElementById('ngbList');
        if (!box) return;
        basketGet().then(function (list) {
            if (!list.length) {
                box.innerHTML = '<div class="alert alert-light border py-3 small mb-0">篮子是空的。点「体检本机书签」会把连不上的书签叼进来。</div>';
                return;
            }
            var html = '';
            list.forEach(function (it, i) {
                html += '<div class="ngb-row" data-ngb="' + i + '">'
                    + '<div class="ngb-main"><b class="text-truncate" title="' + esc(it.url) + '">' + esc(it.name || it.url) + '</b>'
                    + '<span class="ngb-ops">'
                    + '<button type="button" class="btn btn-sm btn-link p-0" data-ngb-act="open">打开</button>'
                    + '<button type="button" class="btn btn-sm btn-link p-0" data-ngb-act="edit">修改</button>'
                    + '<button type="button" class="btn btn-sm btn-link p-0" data-ngb-act="recheck">重测</button>'
                    + '<button type="button" class="btn btn-sm btn-link p-0" data-ngb-act="ignore">忽略</button>'
                    + '<button type="button" class="btn btn-sm btn-link p-0 text-danger" data-ngb-act="del">删除</button>'
                    + '</span></div>'
                    + '<div class="ngb-sub"><span class="text-truncate">' + esc(it.url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')) + '</span>'
                    + '<span class="ngb-tag">' + esc(errorLabel(it.error)) + '</span></div></div>';
            });
            box.innerHTML = html;
            box.querySelectorAll('[data-ngb-act]').forEach(function (btn) {
                btn.addEventListener('click', function () { basketAct(btn); });
            });
        });
    }
    function basketAct(btn) {
        var row = btn.closest('[data-ngb]');
        var i = Number(row.getAttribute('data-ngb'));
        var act = btn.getAttribute('data-ngb-act');
        basketGet().then(function (list) {
            var it = list[i];
            if (!it) return;
            if (act === 'open') { window.open(it.url, '_blank', 'noopener'); return; }
            if (act === 'edit') { openEdit(it.url); return; }
            if (act === 'ignore') {
                list.splice(i, 1);
                return basketSet(list).then(function () { basketRefreshLabels(); renderBasket(); toast('已从篮子忽略'); });
            }
            if (act === 'del') {
                function doDel() {
                    window.navGuestLocal.remove(it.url).then(function () {
                        list.splice(i, 1);
                        basketSet(list).then(function () { basketRefreshLabels(); renderBasket(); toast('已删除本机书签'); });
                    });
                }
                if (window.navConfirm) {
                    window.navConfirm({ title: '删除本机书签', body: '只删这台浏览器里的「' + (it.name || it.url) + '」。', danger: true, confirmLabel: '删除' })
                        .then(function (ok) { if (ok) doDel(); });
                } else { doDel(); }
                return;
            }
            if (act === 'recheck') {
                btn.disabled = true;
                statusText('正在重测 1 条…');
                probe(it.url).then(function (r) {
                    btn.disabled = false;
                    writeCheck(it.url, r);
                    if (r.ok) {
                        list.splice(i, 1);
                        basketSet(list).then(function () { basketRefreshLabels(); renderBasket(); statusText('这条已能连上,移出篮子'); });
                    } else {
                        it.error = r.error;
                        basketSet(list).then(function () { renderBasket(); statusText('仍然连不上:' + r.error); });
                    }
                });
            }
        });
    }
    function statusText(msg) {
        var el = document.getElementById('ngbStatus');
        if (el) el.textContent = msg || '';
    }
    function probe(url) {
        var t0 = Date.now();
        var fn = (window.navGuestAi && window.navGuestAi.probe) || window.navGuestProbeUrl;
        if (!fn) return Promise.resolve({ ok: true, error: '', ms: 0 });
        return Promise.resolve(fn(url, 6000)).then(function (r) {
            return { ok: !!(r && r.ok), error: (r && r.error) || '', ms: Date.now() - t0 };
        });
    }
    // 体检记录回写:note 取错误信息或「可连」;ms 调用侧计时;code 拿不到可靠值就不写
    function writeCheck(url, r) {
        if (!window.navGuestLocal || !window.navGuestLocal.recordCheck) return;
        window.navGuestLocal.recordCheck(url, {
            ok: !!r.ok,
            note: r.ok ? '可连' : (r.error || '连不上'),
            ms: Math.max(0, Number(r.ms) || 0)
        });
    }
    function scanAll() {
        if (basketBusy) return;
        var sites = window.navGuestLocal.list().filter(function (s) { return !s.archived; });
        if (!sites.length) { statusText('本机还没有书签'); return; }
        basketBusy = true;
        var scanBtn = document.getElementById('ngbScan');
        scanBtn.disabled = true;
        var alive = 0, dead = [], done = 0, idx = 0;
        var concurrency = 3;
        function one() {
            if (idx >= sites.length) return Promise.resolve();
            var site = sites[idx++];
            statusText('体检中 ' + done + '/' + sites.length + '…');
            return probe(site.url).then(function (r) {
                done += 1;
                writeCheck(site.url, r);
                if (r.ok) alive += 1;
                else dead.push({ url: site.url, name: site.name, error: r.error, ts: Date.now() });
                return one();
            });
        }
        var workers = [];
        for (var w = 0; w < concurrency; w++) workers.push(one());
        Promise.all(workers).then(function () {
            return basketGet();
        }).then(function (list) {
            var known = {};
            list.forEach(function (it) { known[it.url] = 1; });
            var added = 0;
            dead.forEach(function (d) {
                if (!known[d.url]) { known[d.url] = 1; list.unshift(d); added += 1; }
            });
            // 本轮能连上的,从篮子里移出
            var aliveUrls = {};
            sites.forEach(function (s) {
                if (!dead.some(function (d) { return d.url === s.url; })) aliveUrls[s.url] = 1;
            });
            var next = list.filter(function (it) { return !aliveUrls[it.url]; });
            return basketSet(next).then(function () {
                basketBusy = false;
                scanBtn.disabled = false;
                basketRefreshLabels();
                renderBasket();
                statusText('体检完成:' + alive + ' 条可连,' + dead.length + ' 条打不开' + (added ? ',新叼进 ' + added + ' 条' : '') + '。');
                if (added && window.navPetSay) window.navPetSay('我把 ' + added + ' 个打不开的书签叼回篮子了~', 3600);
            });
        }).catch(function () {
            basketBusy = false;
            scanBtn.disabled = false;
            statusText('体检中断,请重试');
        });
    }
    function recheckBasket() {
        if (basketBusy) return;
        basketGet().then(function (list) {
            if (!list.length) { statusText('篮子是空的'); return; }
            basketBusy = true;
            var btn = document.getElementById('ngbRecheck');
            btn.disabled = true;
            var keep = [], alive = 0, done = 0;
            var chain = list.reduce(function (p, it) {
                return p.then(function () {
                    return probe(it.url).then(function (r) {
                        done += 1;
                        statusText('重测中 ' + done + '/' + list.length + '…');
                        writeCheck(it.url, r);
                        if (r.ok) { alive += 1; return; }
                        it.error = r.error;
                        keep.push(it);
                    });
                });
            }, Promise.resolve());
            chain.then(function () {
                basketSet(keep).then(function () {
                    basketBusy = false;
                    btn.disabled = false;
                    basketRefreshLabels();
                    renderBasket();
                    statusText(alive ? (alive + ' 条已恢复,移出篮子') : '还是没有能连上的');
                });
            }).catch(function () {
                basketBusy = false;
                btn.disabled = false;
                statusText('重测失败,请重试');
            });
        });
    }
    function openBasket(tab) {
        ensureBasketModal();
        switchBasketTab(tab || 'basket');
        statusText('');
        bootstrap.Offcanvas.getOrCreateInstance(basketModal).show();
    }
    window.navGuestBasket = { open: openBasket, count: basketCount, refresh: basketRefreshLabels };

    // ===== 本机统计 =====
    var statsModal = null;
    function ensureStatsModal() {
        if (statsModal) return statsModal;
        // 与主人 navFootPanel 同一容器骨架:.nav-foot 全屏垫层 + .nav-foot__box 居中面板,
        // 宽度 min(600px, 100vw-28px)、圆角 --nav-r-lg、9vh 起顶,全部复用主人 CSS。
        statsModal = document.createElement('div');
        statsModal.className = 'nav-foot';
        statsModal.id = 'navGuestStatsModal';
        statsModal.setAttribute('aria-hidden', 'true');
        statsModal.innerHTML =
            '<div class="nav-foot__backdrop" data-ngs-close></div>' +
            '<div class="nav-foot__box" role="dialog" aria-modal="true" aria-label="本机统计">' +
            '<div class="nav-foot__head"><i class="fas fa-chart-simple"></i><b>本机统计</b>' +
            '<span class="nav-foot__tag">仅本机</span>' +
            '<button type="button" class="btn-close ms-auto" aria-label="关闭" data-ngs-close></button></div>' +
            '<div class="nav-foot__top" id="ngsBody" style="max-height: calc(100vh - 160px);"></div>' +
            '</div>';
        document.body.appendChild(statsModal);
        statsModal.addEventListener('click', function (ev) {
            if (ev.target.closest('[data-ngs-close]')) closeStats();
        });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && statsModal.classList.contains('show')) closeStats();
        });
        return statsModal;
    }
    function closeStats() {
        if (!statsModal) return;
        statsModal.classList.remove('show');
        statsModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('nav-foot-open');
    }
    function statCard(label, value, sub) {
        return '<div class="ngs-card"><div class="ngs-value">' + esc(value) + '</div>'
            + '<div class="ngs-label">' + esc(label) + '</div>'
            + (sub ? '<div class="ngs-sub">' + esc(sub) + '</div>' : '') + '</div>';
    }
    function openStats() {
        ensureStatsModal();
        statsModal.classList.add('show');
        statsModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('nav-foot-open');
        var body = document.getElementById('ngsBody');
        body.innerHTML = '<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div> 读取本机数据…</div>';
        var sites = window.navGuestLocal.list();
        var visible = sites.filter(function (s) { return !s.archived; });
        var archived = sites.filter(function (s) { return s.archived; });
        var tools = window.navGuestLocal.tools();
        var cats = {};
        visible.forEach(function (s) { cats[s.category] = (cats[s.category] || 0) + 1; });
        var tagCounts = {};
        visible.forEach(function (s) { (s.tags || []).forEach(function (t) { tagCounts[t] = (tagCounts[t] || 0) + 1; }); });
        var stars = [];
        try { stars = JSON.parse(localStorage.getItem('navStars') || '[]'); } catch (e) { stars = []; }
        var clicks = visible.reduce(function (n, s) { return n + (s.clicks || 0); }, 0);
        var top = visible.slice().sort(function (a, b) { return (b.clicks || 0) - (a.clicks || 0); }).slice(0, 8);
        var recent = [];
        try { recent = JSON.parse(localStorage.getItem('navRecent') || '[]'); } catch (e) { recent = []; }
        // 保养口径指标(全部来自本机快照):坏链 / 未测 / 未点击 / 久未访问
        var STALE_DAYS = 90, DAY_MS = 86400000;
        function ageMs(site) { var t = Number(site.updatedAt || site.createdAt) || null; return t ? Date.now() - t : null; }
        var deadCount = sites.filter(function (s) { return s.lastCheck && s.lastCheck.ok === false; }).length;
        var untestedCount = sites.filter(function (s) { return s.lastCheck == null; }).length;
        var neverCount = sites.filter(function (s) { return (s.clicks || 0) === 0; }).length;
        var staleCount = sites.filter(function (s) {
            var age = ageMs(s);
            return (s.clicks || 0) > 0 && age != null && age > STALE_DAYS * DAY_MS;
        }).length;
        Promise.all([
            storeGet('navFootprintsV1', function () { return null; }),
            storeGet('navGuestAiHistoryV1', function () { return []; })
        ]).then(function (parts) {
            var fp = parts[0] || { days: {}, total: 0 };
            var aiHist = Array.isArray(parts[1]) ? parts[1] : [];
            var days = fp.days || {};
            var last7 = 0;
            var now = new Date();
            for (var i = 0; i < 7; i++) {
                var d = new Date(now.getTime() - i * 86400000);
                var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                var bucket = days[key] || {};
                Object.keys(bucket).forEach(function (u) { last7 += Number(bucket[u]) || 0; });
            }
            var maxCat = Math.max(1, Math.max.apply(null, Object.keys(cats).map(function (c) { return cats[c]; }).concat([1])));
            var maxTag = Math.max(1, Math.max.apply(null, Object.keys(tagCounts).map(function (t) { return tagCounts[t]; }).concat([1])));
            var html = '<div class="ngs-grid">'
                + statCard('本机书签', visible.length, '归档 ' + archived.length)
                + statCard('大类', Object.keys(cats).length, '标签 ' + Object.keys(tagCounts).length + ' 种')
                + statCard('本机工具', tools.length, '')
                + statCard('累计点击', clicks, '星标 ' + stars.filter(Boolean).length)
                + statCard('近 7 天打开', last7, '足迹累计 ' + (fp.total || 0))
                + statCard('AI 对话', Math.floor(aiHist.length / 2), '只存本机')
                + '</div>';
            html += '<div class="ngs-grid mt-2">'
                + statCard('坏链', deadCount, '最近体检打不开')
                + statCard('未测', untestedCount, '还没有体检记录')
                + statCard('未点击', neverCount, '导入后未打开过')
                + statCard('久未访问', staleCount, '按时间戳估算超 ' + STALE_DAYS + ' 天')
                + '</div>';
            html += '<div class="row g-3 mt-1"><div class="col-md-6"><div class="ngs-block"><div class="ngs-block-title">分类分布</div>';
            Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 8).forEach(function (c) {
                html += '<div class="ngs-bar-row"><span class="ngs-bar-label text-truncate" title="' + esc(c) + '">' + esc(c) + '</span>'
                    + '<span class="ngs-bar"><i style="width:' + Math.round(cats[c] / maxCat * 100) + '%"></i></span>'
                    + '<span class="ngs-bar-num">' + cats[c] + '</span></div>';
            });
            if (!Object.keys(cats).length) html += '<div class="small text-muted">还没有书签</div>';
            html += '</div></div><div class="col-md-6"><div class="ngs-block"><div class="ngs-block-title">标签分布</div>';
            Object.keys(tagCounts).sort(function (a, b) { return tagCounts[b] - tagCounts[a]; }).slice(0, 8).forEach(function (t) {
                html += '<div class="ngs-bar-row"><span class="ngs-bar-label text-truncate" title="' + esc(t) + '">' + esc(t) + '</span>'
                    + '<span class="ngs-bar"><i style="width:' + Math.round(tagCounts[t] / maxTag * 100) + '%"></i></span>'
                    + '<span class="ngs-bar-num">' + tagCounts[t] + '</span></div>';
            });
            if (!Object.keys(tagCounts).length) html += '<div class="small text-muted">还没有标签,可在编辑书签或 AI 分类时补上</div>';
            html += '</div></div></div>';
            html += '<div class="ngs-block mt-3"><div class="ngs-block-title">点得最多的书签</div>';
            if (!top.length) html += '<div class="small text-muted">还没有书签</div>';
            top.forEach(function (s) {
                html += '<div class="ngs-top-row"><span class="text-truncate">' + esc(s.name) + '</span>'
                    + '<span class="text-muted small">' + esc(s.category) + '</span>'
                    + '<span class="badge text-bg-secondary">' + (s.clicks || 0) + ' 次</span></div>';
            });
            html += '</div>';
            body.innerHTML = html;
        });
    }
    window.navGuestStatsOpen = openStats;

    // ===== 工具元数据编辑(与主人 #toolEditModal 同一套字段:名称 / 分类 / 简介) =====
    var toolModal = null, toolCtxId = '';
    function ensureToolModal() {
        if (toolModal) return toolModal;
        toolModal = document.createElement('div');
        toolModal.className = 'modal fade';
        toolModal.id = 'navGuestToolEditModal';
        toolModal.tabIndex = -1;
        toolModal.setAttribute('data-no-resize', '1');
        toolModal.innerHTML =
            '<div class="modal-dialog"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title"><i class="fas fa-pen me-2 acc-ico"></i>编辑工具</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="mb-3"><label class="form-label" for="tgeName">工具名称 <span class="text-danger">*</span></label>' +
            '<input id="tgeName" class="form-control" maxlength="100"></div>' +
            '<div class="mb-3"><label class="form-label" for="tgeCat">分类</label>' +
            '<input id="tgeCat" class="form-control" maxlength="50" placeholder="我的工具"></div>' +
            '<div class="mb-3"><label class="form-label" for="tgeDesc">简介</label>' +
            '<input id="tgeDesc" class="form-control" maxlength="200"></div>' +
            '<div class="form-text">只改这几项：托管地址与文件本身不动，工具存在本机的数据照常保留。</div>' +
            '<div class="text-danger small" id="tgeErr"></div>' +
            '<input type="hidden" id="tgeIconText"><input type="hidden" id="tgeIconColor">' +
            '</div>' +
            '<div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>' +
            '<button type="button" class="btn btn-primary" id="tgeSave"><i class="fas fa-check me-1"></i>保存</button></div>' +
            '</div></div>';
        document.body.appendChild(toolModal);
        document.getElementById('tgeSave').addEventListener('click', saveToolEdit);
        return toolModal;
    }
    function openToolEdit(id) {
        var meta = window.navGuestLocal.toolMeta(id);
        if (!meta) { toast('工具不在本机工具里'); return; }
        ensureToolModal();
        toolCtxId = id;
        document.getElementById('tgeName').value = meta.name || '';
        document.getElementById('tgeCat').value = meta.category || '我的工具';
        document.getElementById('tgeDesc').value = meta.description || '';
        document.getElementById('tgeIconText').value = meta.iconText || '';
        document.getElementById('tgeIconColor').value = meta.iconColor || '';
        document.getElementById('tgeErr').textContent = '';
        bootstrap.Modal.getOrCreateInstance(toolModal).show();
    }
    function saveToolEdit() {
        var err = document.getElementById('tgeErr');
        var name = document.getElementById('tgeName').value.trim();
        var cat = document.getElementById('tgeCat').value.trim() || '我的工具';
        var desc = document.getElementById('tgeDesc').value.trim();
        var iconText = document.getElementById('tgeIconText').value.trim().slice(0, 2);
        var iconColor = cleanColorInput(document.getElementById('tgeIconColor').value);
        if (!name) { err.textContent = '名称不能为空'; return; }
        var btn = document.getElementById('tgeSave');
        btn.disabled = true;
        window.navGuestLocal.updateToolMeta(toolCtxId, {
            name: name, category: cat, description: desc,
            iconText: iconText, iconColor: iconColor
        }).then(function (res) {
            btn.disabled = false;
            if (res && res.ok === false) { err.textContent = res.message || '保存失败'; return; }
            bootstrap.Modal.getOrCreateInstance(toolModal).hide();
            toast('已保存本机工具');
        }).catch(function (e2) {
            btn.disabled = false;
            err.textContent = (e2 && e2.message) || '保存失败';
        });
    }
    window.navGuestToolEdit = openToolEdit;

    // ===== 入口委托 =====
    document.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-nav-basket]')) { ev.preventDefault(); openBasket(); return; }
        if (ev.target.closest('[data-nav-stats]')) { ev.preventDefault(); openStats(); }
        if (ev.target.closest('[data-nav-localize-all]')) { ev.preventDefault(); localizeAll(); return; }
    });
    basketRefreshLabels();
})();
