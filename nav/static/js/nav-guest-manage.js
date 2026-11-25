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

    // ===== 书签编辑 / 新增 =====
    var editModal = null, editOldUrl = '', editMode = 'local';
    // 图标长度上限:外链按短串截断;data URI 是整段图片,给 100KB 上限,防止超大 data URI 塞爆本机存储
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
            '<div class="modal-dialog modal-lg">' +
            '<div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title" id="ngeTitle">编辑本机书签</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngeName">名称</label>' +
            '<input id="ngeName" class="form-control form-control-sm" maxlength="80" placeholder="站点名称"></div>' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngeSiteTitle">页面标题(可空,≤80 字)</label>' +
            '<input id="ngeSiteTitle" class="form-control form-control-sm" maxlength="80" placeholder="浏览器标签页标题,留空用名称"></div>' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngeUrl">网址</label>' +
            '<input id="ngeUrl" class="form-control form-control-sm font-monospace" placeholder="https://example.com"></div>' +
            '<div class="mb-2 d-flex align-items-center gap-2 flex-wrap">' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngeFetchMeta" title="按网址抓取对方的页面标题、favicon 和简介">' +
            '<i class="fas fa-wand-magic-sparkles me-1"></i>识别标题/图标</button>' +
            '<span id="ngeFetchStatus" class="small text-muted"></span></div>' +
            '<div class="row g-2 mb-2"><div class="col-6"><label class="small text-muted mb-0" for="ngeCat">大类</label>' +
            '<input id="ngeCat" class="form-control form-control-sm" list="ngeCatList" placeholder="我的导入">' +
            '<datalist id="ngeCatList"></datalist></div>' +
            '<div class="col-6"><label class="small text-muted mb-0" for="ngeSub">小分类(可空)</label>' +
            '<input id="ngeSub" class="form-control form-control-sm" placeholder="二级 / 三级"></div></div>' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngeTags">标签(逗号分隔,最多 8 个)</label>' +
            '<input id="ngeTags" class="form-control form-control-sm" placeholder="免费, 开源, 需代理"></div>' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="ngeDesc">简介(可空)</label>' +
            '<textarea id="ngeDesc" class="form-control form-control-sm" rows="2" maxlength="200"></textarea></div>' +
            '<div class="ng-meta-sep">子网页</div>' +
            '<div id="ngeChildren" class="ng-meta-rows"></div>' +
            '<div class="mb-2"><button type="button" class="btn btn-sm btn-outline-secondary" id="ngeAddChild">+ 添加子网页</button></div>' +
            '<div class="ng-meta-sep">备用网址</div>' +
            '<div id="ngeAlts" class="ng-meta-rows"></div>' +
            '<div class="mb-2"><button type="button" class="btn btn-sm btn-outline-secondary" id="ngeAddAlt">+ 添加备用网址</button></div>' +
            '<div class="ng-meta-sep">自定义图标(可留空;留空用首字母色块)</div>' +
            '<div class="row g-2 mb-2"><div class="col-7"><label class="small text-muted mb-0" for="ngeFavicon">图标链接 / data URI</label>' +
            '<input id="ngeFavicon" class="form-control form-control-sm font-monospace" placeholder="https://example.com/icon.png 或 data:image/..."></div>' +
            '<div class="col-5"><label class="small text-muted mb-0" for="ngeIconText">文字图标(≤2 字)</label>' +
            '<input id="ngeIconText" class="form-control form-control-sm" maxlength="2" placeholder="如 A"></div></div>' +
            '<div class="row g-2 mb-2"><div class="col-6"><label class="small text-muted mb-0" for="ngeIconColor">底色(可空)</label>' +
            '<input id="ngeIconColor" class="form-control form-control-sm" placeholder="#5850ec"></div>' +
            '<div class="col-6"><label class="small text-muted mb-0" for="ngeIconSize">字号 px(8–48,可空)</label>' +
            '<input id="ngeIconSize" type="number" min="8" max="48" class="form-control form-control-sm" placeholder="10"></div></div>' +
            '<div class="mb-2 d-flex align-items-center gap-2 flex-wrap">' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngeLocalize">尝试本地化图标</button>' +
            '<span id="ngeLocStatus" class="small text-muted"></span></div>' +
            '<div id="ngeErr" class="small text-danger mt-2"></div>' +
            '</div>' +
            '<div class="modal-footer"><button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '<button type="button" class="btn btn-sm btn-primary nav-modal-primary" id="ngeSave">保存到本机</button></div>' +
            '</div></div>';
        document.body.appendChild(editModal);
        document.getElementById('ngeSave').addEventListener('click', saveEdit);
        // 2026-11-24:游客端补「识别标题/图标」——主人端添加表单早有 .f-meta,游客只能手填;
        // 这里走同一个 /api/nav/fetch-meta/(后端 _guard_public_url 已挡内网/非法 scheme)。
        document.getElementById('ngeFetchMeta').addEventListener('click', function () {
            var btn = this;
            var st = document.getElementById('ngeFetchStatus');
            var url = (document.getElementById('ngeUrl').value || '').trim();
            if (!url) { st.textContent = '先填写网址'; return; }
            var tok = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
            btn.disabled = true;
            st.textContent = '识别中…';
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
                var nameEl = document.getElementById('ngeName');
                var titleEl = document.getElementById('ngeSiteTitle');
                var descEl = document.getElementById('ngeDesc');
                var favEl = document.getElementById('ngeFavicon');
                if (res.d.title && !nameEl.value.trim()) nameEl.value = res.d.title.slice(0, 80);
                if (res.d.title && !titleEl.value.trim()) titleEl.value = res.d.title.slice(0, 80);
                if (res.d.description && !descEl.value.trim()) descEl.value = res.d.description.slice(0, 200);
                if (res.d.favicon && !favEl.value.trim()) favEl.value = res.d.favicon;
                st.textContent = (res.d.title || res.d.favicon || res.d.description)
                    ? '已识别,可修改' : '没解析到标题/图标/简介,可手动填写';
            }).catch(function (err) {
                st.textContent = (err && err.message) || '识别失败,可手动填写';
            }).finally(function () { btn.disabled = false; });
        });
        document.getElementById('ngeAddChild').addEventListener('click', function () { addLinkRow('ngeChildren', 'child', null); });
        document.getElementById('ngeAddAlt').addEventListener('click', function () { addLinkRow('ngeAlts', 'alt', null); });
        document.getElementById('ngeLocalize').addEventListener('click', localizeCurrent);
        return editModal;
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
    function addLinkRow(boxId, kind, data) {
        var box = document.getElementById(boxId);
        if (box) box.appendChild(linkRow(kind, data || {}));
    }
    function clearLinkRows(boxId) {
        var box = document.getElementById(boxId);
        if (box) box.innerHTML = '';
    }
    // 收集一组链接:整行留空跳过;填了内容就必须有合法 http/https 网址
    function collectLinks(kind, boxId, err) {
        var box = document.getElementById(boxId);
        var rows = box ? box.querySelectorAll('.nge-link-row') : [];
        var out = [];
        for (var i = 0; i < rows.length; i++) {
            var inputs = rows[i].querySelectorAll('input');
            var name = inputs[0].value.trim();
            var rawUrl = inputs[1].value.trim();
            var desc = inputs[2].value.trim();
            if (!name && !rawUrl && !desc) continue;
            if (!rawUrl) { err.textContent = '第 ' + (i + 1) + ' 条链接缺少网址'; return null; }
            var url = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
            var parsed = null;
            try { parsed = new URL(url); } catch (e) { parsed = null; }
            if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
                err.textContent = '第 ' + (i + 1) + ' 条链接网址无效,需要 http/https'; return null;
            }
            var item = { url: parsed.href, description: desc.slice(0, 200) };
            if (kind === 'child') item.name = (name || parsed.hostname).slice(0, 80);
            else item.name = name.slice(0, 80);
            out.push(item);
        }
        return out;
    }
    // 图标字段清洗:空串回退字母图标;外链限长;data URI 只收图片且限 100KB
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
        // 快照分类也进候选:访客可在同一位置新建到某个快照分类
        document.querySelectorAll('#navGroups > .nav-cat[data-collapse-id]').forEach(function (el) {
            var c = el.getAttribute('data-collapse-id') || '';
            if (c && names.indexOf(c) < 0) names.push(c);
        });
        names.forEach(function (c) {
            var o = document.createElement('option'); o.value = c; list.appendChild(o);
        });
    }
    function openEdit(url, opts) {
        ensureEditModal();
        opts = opts || {};
        var snapshot = !!opts.snapshot;
        editMode = snapshot ? 'snapshot' : 'local';
        editOldUrl = url || '';
        fillCats();
        var it = snapshot ? null : (url ? window.navGuestLocal.find(url) : null);
        var src = snapshot ? (opts.data || {}) : (it || {});
        document.getElementById('ngeTitle').textContent = snapshot
            ? '编辑访客视图（只存本机）'
            : (it ? '编辑本机书签' : '添加本机书签');
        document.getElementById('ngeName').value = src.name || '';
        document.getElementById('ngeSiteTitle').value = src.siteTitle || '';
        document.getElementById('ngeUrl').value = src.url || '';
        document.getElementById('ngeCat').value = src.category || (snapshot ? '' : '我的导入');
        document.getElementById('ngeSub').value = src.subcat || '';
        document.getElementById('ngeTags').value = src.tags ? (Array.isArray(src.tags) ? src.tags.join(', ') : String(src.tags)) : '';
        document.getElementById('ngeDesc').value = src.description || '';
        clearLinkRows('ngeChildren');
        clearLinkRows('ngeAlts');
        (src.children || []).forEach(function (c) { addLinkRow('ngeChildren', 'child', c); });
        (src.alternates || []).forEach(function (a) { addLinkRow('ngeAlts', 'alt', a); });
        document.getElementById('ngeFavicon').value = src.favicon || '';
        document.getElementById('ngeIconText').value = src.iconText || '';
        document.getElementById('ngeIconColor').value = src.iconColor || '';
        document.getElementById('ngeIconSize').value = src.iconSize || '';
        document.getElementById('ngeErr').textContent = '';
        var locStatus = document.getElementById('ngeLocStatus');
        if (locStatus) locStatus.textContent = '';
        var locBtn = document.getElementById('ngeLocalize');
        if (locBtn) locBtn.disabled = false;
        bootstrap.Modal.getOrCreateInstance(editModal).show();
    }
    window.navGuestEdit = openEdit;

    function saveEdit() {
        var name = document.getElementById('ngeName').value.trim();
        var rawUrl = document.getElementById('ngeUrl').value.trim();
        var cat = document.getElementById('ngeCat').value.trim() || '我的导入';
        var sub = document.getElementById('ngeSub').value.trim();
        var tags = document.getElementById('ngeTags').value;
        var desc = document.getElementById('ngeDesc').value.trim();
        var siteTitle = document.getElementById('ngeSiteTitle').value.trim().slice(0, 80);
        var err = document.getElementById('ngeErr');
        if (!rawUrl) { err.textContent = '网址不能为空'; return; }
        var url = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
        var parsed = null;
        try {
            parsed = new URL(url);
            if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error('bad');
        } catch (e) { err.textContent = '网址无效,需要 http/https 链接'; return; }
        var children = collectLinks('child', 'ngeChildren', err);
        if (children === null) return;
        var alternates = collectLinks('alt', 'ngeAlts', err);
        if (alternates === null) return;
        var fav = cleanFaviconInput(document.getElementById('ngeFavicon').value);
        if (fav.error) { err.textContent = fav.error; return; }
        var iconText = document.getElementById('ngeIconText').value.trim().slice(0, 2);
        var iconColor = cleanColorInput(document.getElementById('ngeIconColor').value);
        var sizeRaw = document.getElementById('ngeIconSize').value.trim();
        var iconSize = 0;
        if (sizeRaw) {
            var sz = Number(sizeRaw);
            if (!(sz >= 8 && sz <= 48)) { err.textContent = '图标字号需在 8–48 px 之间'; return; }
            iconSize = Math.floor(sz);
        }
        name = name || parsed.hostname;
        var payload = {
            name: name, url: url, category: cat, subcat: sub, description: desc, tags: tags,
            siteTitle: siteTitle,
            children: children, alternates: alternates,
            favicon: fav.value, iconText: iconText, iconColor: iconColor, iconSize: iconSize
        };
        var btn = document.getElementById('ngeSave');
        btn.disabled = true;
        var snapshot = editMode === 'snapshot';
        var task = snapshot
            ? window.navGuestLocal.updateSnapshot(editOldUrl, payload)
            : (editOldUrl ? window.navGuestLocal.patch(editOldUrl, payload) : window.navGuestLocal.addSites([payload]));
        Promise.resolve(task).then(function (res) {
            btn.disabled = false;
            if (res && res.ok === false) { err.textContent = res.message || '保存失败'; return; }
            if (snapshot) {
                bootstrap.Modal.getOrCreateInstance(editModal).hide();
                toast('已保存到本机视图，主人分享的原始站点不受影响');
                return;
            }
            var added = res && res.added ? res.added.length : 1;
            if (!editOldUrl && !added) {
                var reason = res && res.skipped && res.skipped[0] && res.skipped[0].reason;
                err.textContent = reason || '没有写入';
                return;
            }
            bootstrap.Modal.getOrCreateInstance(editModal).hide();
            toast(editOldUrl ? '已保存本机修改' : '已添加到本机书签');
            window.dispatchEvent(new CustomEvent('nav-guest-site-changed', {
                detail: { oldUrl: editOldUrl, newUrl: url }
            }));
        }).catch(function (e2) {
            btn.disabled = false;
            err.textContent = (e2 && e2.message) || '保存失败';
        });
    }

    // ===== 图标本地化(best-effort,纯浏览器直连;缓存只进本机 IDB,不回写书签) =====
    function localizeCurrent() {
        var url = editOldUrl || document.getElementById('ngeUrl').value.trim();
        var status = document.getElementById('ngeLocStatus');
        var btn = document.getElementById('ngeLocalize');
        if (!url) { status.className = 'small text-danger ms-2'; status.textContent = '先填网址'; return; }
        btn.disabled = true;
        status.className = 'small text-muted ms-2';
        status.textContent = '抓取中…';
        Promise.resolve(window.navGuestLocal.localizeFavicons([url], {})).then(function (res) {
            btn.disabled = false;
            var r = (res && res[0]) || {};
            if (r.ok) { status.className = 'small text-success ms-2'; status.textContent = '已缓存到本机'; }
            else { status.className = 'small text-danger ms-2'; status.textContent = '未本地化:' + (r.reason || '失败'); }
        }).catch(function () {
            btn.disabled = false;
            status.className = 'small text-danger ms-2';
            status.textContent = '本地化失败';
        });
    }
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
            '<h5 class="offcanvas-title"><i class="fas fa-basket-shopping me-2"></i>体检篮 · 本机</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="关闭"></button></div>' +
            '<div class="offcanvas-body pt-1">' +
            '<div class="d-flex align-items-center gap-2 mb-2 flex-wrap">' +
            '<button type="button" class="btn btn-sm btn-primary" id="ngbScan">体检本机书签</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngbRecheck">重测篮内地址</button>' +
            '<span class="small text-muted ms-auto">浏览器直连检测,只判断能否连上;403/404 也会算"可连"</span>' +
            '</div>' +
            '<div class="small text-muted mb-2" id="ngbStatus"></div>' +
            '<div id="ngbList"></div>' +
            '</div>';
        document.body.appendChild(basketModal);
        document.getElementById('ngbScan').addEventListener('click', scanAll);
        document.getElementById('ngbRecheck').addEventListener('click', recheckBasket);
        return basketModal;
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
    function openBasket() {
        ensureBasketModal();
        renderBasket();
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

    // ===== 工具元数据编辑(名称 / 简介 / 分类 / 文字图标 / 底色) =====
    var toolModal = null, toolCtxId = '';
    function ensureToolModal() {
        if (toolModal) return toolModal;
        toolModal = document.createElement('div');
        toolModal.className = 'modal fade';
        toolModal.id = 'navGuestToolEditModal';
        toolModal.tabIndex = -1;
        toolModal.setAttribute('data-no-resize', '1');
        toolModal.innerHTML =
            '<div class="modal-dialog">' +
            '<div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title">编辑本机工具</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="tgeName">名称</label>' +
            '<input id="tgeName" class="form-control form-control-sm" maxlength="100"></div>' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="tgeCat">分类</label>' +
            '<input id="tgeCat" class="form-control form-control-sm" placeholder="我的工具"></div>' +
            '<div class="mb-2"><label class="small text-muted mb-0" for="tgeDesc">简介(可空)</label>' +
            '<textarea id="tgeDesc" class="form-control form-control-sm" rows="2" maxlength="200"></textarea></div>' +
            '<div class="row g-2 mb-2"><div class="col-5"><label class="small text-muted mb-0" for="tgeIconText">文字图标(≤2 字,可空)</label>' +
            '<input id="tgeIconText" class="form-control form-control-sm" maxlength="2"></div>' +
            '<div class="col-7"><label class="small text-muted mb-0" for="tgeIconColor">底色(可空)</label>' +
            '<input id="tgeIconColor" class="form-control form-control-sm" placeholder="#5850ec"></div></div>' +
            '<div id="tgeErr" class="small text-danger mt-2"></div>' +
            '</div>' +
            '<div class="modal-footer"><button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '<button type="button" class="btn btn-sm btn-primary nav-modal-primary" id="tgeSave">保存到本机</button></div>' +
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
