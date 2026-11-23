/* 访客本机保养维护(线 C,2026-11-20):
   保养分组视图(失败 / 未测 / 从未点击 / 久未访问 / 归档)、体检记录回写、
   URL 卫生扫描(先预览后批量应用)。
   只读写这台浏览器的本机书签(window.navGuestLocal 冻结 API),不调任何服务端接口;
   探测复用 navGuestAi.probe(no-cors,拿不到可靠状态码就不伪造 code)。
   对外:window.navGuestCare.open。 */
(function () {
    'use strict';
    if (!window.NAV_GUEST_MODE) return;
    var L = window.navGuestLocal;
    if (!L) return;

    var STALE_DAYS = 90;          // 久未访问阈值(天),按本机时间戳估算
    var DAY_MS = 86400000;
    var PROBE_TIMEOUT = 7000;

    var careModal = null;
    var view = 'care';            // care | url
    var archiveFilter = '';
    var hygieneRows = [];         // {url, name, next, rules:[], conflict, checked}
    var hygieneScanned = false;

    // ---- 链接检测 / AI 提示词 / 粘贴导入(线 C 第二轮) ----
    var linkRows = [];            // {url, name, ok, note, ms}
    var linkSelected = {};        // 勾选表,独立于批量栏 selected
    var linkFilter = 'all';       // all | dead | untested | ok
    var linkBusy = false;
    var linkPreview = [];         // 解析后的导入预览行
    var promptMode = 'alt';       // alt | fix | info

    // ---------- 基础工具 ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(msg) {
        if (L.toast) L.toast(msg);
        else if (window.navToast) window.navToast(msg);
    }
    function hostOf(u) {
        try { return new URL(u).hostname; } catch (e) { return u; }
    }
    function fmtTime(at) {
        var t = Number(at);
        if (!t) return '';
        var d = new Date(t);
        var p = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function ageMs(site) {
        var t = Number(site.updatedAt || site.createdAt) || null;
        return t ? Date.now() - t : null;
    }

    // ---------- 本机探测 + 体检记录回写 ----------
    function probe(url) {
        var t0 = Date.now();
        var fn = (window.navGuestAi && window.navGuestAi.probe) || window.navGuestProbeUrl;
        if (!fn) return Promise.resolve({ ok: true, error: '', ms: 0 });
        return Promise.resolve(fn(url, PROBE_TIMEOUT)).then(function (r) {
            return { ok: !!(r && r.ok), error: (r && r.error) || '', ms: Date.now() - t0 };
        });
    }
    // 回写 lastCheck:note 取错误信息或「可连」;ms 调用侧计时;code 拿不到可靠值就不写
    function writeCheck(url, r) {
        return L.recordCheck(url, {
            ok: !!r.ok,
            note: r.ok ? '可连' : (r.error || '连不上'),
            ms: Math.max(0, Number(r.ms) || 0)
        });
    }

    // ---------- 保养分组 ----------
    var GROUP_META = [
        { key: 'dead', title: '体检失败', hint: '最近一次本机探测打不开' },
        { key: 'untested', title: '尚未体检', hint: '还没有本机体检记录' },
        { key: 'never', title: '从未点击', hint: '导入后一次都没打开过' },
        { key: 'stale', title: '久未访问', hint: '按本机时间戳估算,超过 ' + STALE_DAYS + ' 天未更新' },
        { key: 'archived', title: '归档 / 休眠', hint: '已归档,可在下方搜索并逐条唤醒' }
    ];

    function groupsOf(s) {
        var g = [];
        if (s.lastCheck && s.lastCheck.ok === false) g.push('dead');
        if (s.lastCheck == null) g.push('untested');
        if ((s.clicks || 0) === 0) g.push('never');
        var age = ageMs(s);
        if ((s.clicks || 0) > 0 && age != null && age > STALE_DAYS * DAY_MS) g.push('stale');
        if (s.archived) g.push('archived');
        return g;
    }

    function checkText(s) {
        var c = s.lastCheck;
        if (!c) return '未体检';
        var parts = [c.ok ? '可连' : '打不开'];
        if (c.note) parts.push(c.note);
        if (c.ms) parts.push(Math.round(c.ms) + 'ms');
        if (c.at) parts.push(fmtTime(c.at));
        return parts.join(' · ');
    }

    function rowHtml(s) {
        var canClear = !!s.lastCheck;
        var archLabel = s.archived ? '唤醒' : '归档';
        var html = '<div class="ngc-row" data-url="' + esc(s.url) + '">'
            + '<div class="ngc-main">'
            + '<b class="ngc-name text-truncate" title="' + esc(s.name) + '">' + esc(s.name) + '</b>'
            + '<span class="ngc-domain">' + esc(hostOf(s.url)) + '</span>'
            + '<span class="ngc-cat">' + esc(s.category) + (s.subcat ? ' / ' + esc(s.subcat) : '') + '</span>'
            + '<span class="ngc-clicks">点击 ' + (s.clicks || 0) + '</span>'
            + '</div>'
            + '<div class="ngc-sub"><span class="text-truncate">' + esc(checkText(s)) + '</span></div>'
            + '<div class="ngc-ops">'
            + '<button type="button" class="btn btn-sm btn-link p-0" data-ngc-act="open">打开</button>'
            + '<button type="button" class="btn btn-sm btn-link p-0" data-ngc-act="edit">编辑</button>'
            + '<button type="button" class="btn btn-sm btn-link p-0" data-ngc-act="retest">重测</button>'
            + '<button type="button" class="btn btn-sm btn-link p-0" data-ngc-act="archive">' + archLabel + '</button>'
            + (canClear ? '<button type="button" class="btn btn-sm btn-link p-0" data-ngc-act="clearcheck">清记录</button>' : '')
            + '<button type="button" class="btn btn-sm btn-link p-0 text-danger" data-ngc-act="del">删除</button>'
            + '</div></div>';
        return html;
    }

    function matchesFilter(s, kw) {
        if (!kw) return true;
        var hay = [s.name, s.url, s.category, s.subcat, (s.tags || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(kw) >= 0;
    }

    function renderCare() {
        var box = document.getElementById('ngcCareView');
        if (!box) return;
        if (!document.getElementById('ngcArchiveSearch')) {
            box.innerHTML =
                '<div class="mb-2"><input id="ngcArchiveSearch" class="form-control form-control-sm" placeholder="在归档区按名称 / 网址 / 分类 / 标签搜索" value="' + esc(archiveFilter) + '"></div>'
                + '<div id="ngcGroups"></div>';
            var search = document.getElementById('ngcArchiveSearch');
            search.addEventListener('input', function () { archiveFilter = search.value; renderGroups(); });
        }
        renderGroups();
    }

    function renderGroups() {
        var box = document.getElementById('ngcGroups');
        if (!box) return;
        var sites = L.list() || [];
        var groups = {};
        GROUP_META.forEach(function (m) { groups[m.key] = []; });
        sites.forEach(function (s) {
            groupsOf(s).forEach(function (k) { groups[k].push(s); });
        });
        var kw = archiveFilter.trim().toLowerCase();
        var html = '';
        GROUP_META.forEach(function (meta) {
            var list = groups[meta.key];
            if (meta.key === 'archived') list = list.filter(function (s) { return matchesFilter(s, kw); });
            if (!list.length && meta.key !== 'archived') return;
            html += '<div class="ngc-group">'
                + '<div class="ngc-group-title"><span>' + esc(meta.title) + '</span>'
                + '<span class="ngc-group-count">' + list.length + '</span></div>'
                + '<div class="ngc-group-hint">' + esc(meta.hint) + '</div>';
            if (!list.length) {
                html += '<div class="ngc-empty small text-muted">没有匹配的书签。</div>';
            } else {
                list.forEach(function (s) { html += rowHtml(s); });
            }
            html += '</div>';
        });
        box.innerHTML = html;
    }

    // ---------- 保养动作 ----------
    function actArchive(url, archived) {
        L.bulkArchive([url], archived).then(function (r) {
            if (!r || r.ok === false) { toast('保存失败:本机存储空间不足,改动已回滚'); return; }
            toast(archived ? '已归档' : '已唤醒到主列表');
            renderCare();
        });
    }
    function actDelete(url) {
        var it = L.find(url);
        function doDel() {
            L.remove(url).then(function (ok) {
                if (!ok) { toast('删除失败:本机存储空间不足'); return; }
                toast('已删除本机书签');
                renderCare();
            });
        }
        if (window.navConfirm) {
            window.navConfirm({
                title: '删除本机书签',
                body: '只删这台浏览器里的「' + (it ? it.name : url) + '」,主人分享的站点不受影响;此操作不可恢复。',
                danger: true, confirmLabel: '删除'
            }).then(function (ok) { if (ok) doDel(); });
        } else { doDel(); }
    }
    function actRetest(btn, url) {
        btn.disabled = true;
        probe(url).then(function (r) {
            btn.disabled = false;
            writeCheck(url, r).then(function () {
                toast(r.ok ? '已记录:可连' : '已记录:' + (r.error || '连不上'));
                renderCare();
            });
        });
    }
    function actClearCheck(url) {
        L.clearCheck(url).then(function (r) {
            if (r && r.ok === false) { toast('清除失败,请重试'); return; }
            toast('已清除这条书签的本机体检记录');
            renderCare();
        });
    }

    // ---------- URL 卫生扫描 ----------
    // 常见点击 / 跟踪标识;用正则集合辨认,避免逐个硬编码键名判断
    var TRACKING_RE = /^(utm_source|utm_medium|utm_campaign|utm_term|utm_content|fbclid|gclid|spm|spm_id|spm_campaign|from|ref|ref_source|share_source|share_medium|share_campaign|share_channel|icid|chan|from_uid)$/i;

    function suggestUrl(raw) {
        var u;
        try { u = new URL(raw); } catch (e) { return null; }
        var rules = [];
        // 1. 跟踪参数
        var drop = [];
        u.searchParams.forEach(function (v, k) { if (TRACKING_RE.test(k)) drop.push(k); });
        if (drop.length) {
            drop.forEach(function (k) { u.searchParams.delete(k); });
            var shown = drop.slice(0, 3).join(', ');
            rules.push({ key: 'track', label: '跟踪参数(' + shown + (drop.length > 3 ? '…' : '') + ')' });
        }
        // 2. 域名大写 → 小写
        var host = u.hostname;
        if (host !== host.toLowerCase()) {
            u.hostname = host.toLowerCase();
            rules.push({ key: 'hostcase', label: '域名大写' });
        }
        // 3. 重复斜杠 / 尾斜杠(根路径 / 保留)
        var path = u.pathname;
        var path2 = path.replace(/\/{2,}/g, '/');
        if (path2 !== path) { path = path2; rules.push({ key: 'slash', label: '重复斜杠' }); }
        if (path.length > 1 && path.endsWith('/')) { path = path.slice(0, -1); rules.push({ key: 'trailing', label: '尾斜杠' }); }
        u.pathname = path;
        // 4. http → https 建议
        if (u.protocol === 'http:') {
            u.protocol = 'https:';
            rules.push({ key: 'https', label: '建议升级 https' });
        }
        var next = u.toString();
        if (next === raw) return null;
        return { next: next, rules: rules };
    }

    function scanHygiene() {
        var sites = L.list() || [];
        var existing = {};
        sites.forEach(function (s) { existing[s.url] = 1; });
        var rows = [];
        sites.forEach(function (s) {
            var sug = suggestUrl(s.url);
            if (!sug) return;
            var conflict = sug.next !== s.url && existing[sug.next];
            rows.push({
                url: s.url, name: s.name, next: sug.next, rules: sug.rules,
                conflict: !!conflict, checked: !conflict
            });
        });
        hygieneRows = rows;
        hygieneScanned = true;
        renderHygiene();
    }

    function renderHygiene() {
        var box = document.getElementById('ngcUrlView');
        if (!box) return;
        if (!hygieneScanned) {
            box.innerHTML =
                '<div class="alert alert-light border py-3 small mb-2">先在本机书签里扫描可规整的网址;只生成预览,确认前不会写入。</div>'
                + '<button type="button" class="btn btn-sm btn-primary" id="ngcUrlScan">扫描本机书签</button>';
            document.getElementById('ngcUrlScan').addEventListener('click', scanHygiene);
            return;
        }
        if (!hygieneRows.length) {
            box.innerHTML = '<div class="alert alert-light border py-3 small mb-0">没有发现需要规整的网址。</div>';
            return;
        }
        var issueCount = hygieneRows.length;
        var conflictCount = hygieneRows.filter(function (r) { return r.conflict; }).length;
        var html =
            '<div class="alert alert-secondary small py-2 mb-2">本机书签网址规整:只改这台浏览器里保存的网址,不代表站点真实可用;删除跟踪参数可能影响来源统计,http 升级 https 若站点不支持会打不开。</div>'
            + '<div class="d-flex align-items-center gap-2 mb-2 flex-wrap">'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngcUrlRescan">重新扫描</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngcUrlAll">全选</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngcUrlNone">清空勾选</button>'
            + '<span class="small text-muted ms-auto">共 ' + issueCount + ' 条建议' + (conflictCount ? ',' + conflictCount + ' 条冲突已跳过' : '') + '</span>'
            + '</div>'
            + '<div id="ngcUrlRows"></div>'
            + '<div class="mt-2"><button type="button" class="btn btn-sm btn-primary" id="ngcUrlApply">应用勾选改动到本机书签</button></div>';
        box.innerHTML = html;
        renderHygieneRows();
        document.getElementById('ngcUrlRescan').addEventListener('click', scanHygiene);
        document.getElementById('ngcUrlAll').addEventListener('click', function () {
            hygieneRows.forEach(function (r) { if (!r.conflict) r.checked = true; });
            renderHygieneRows();
        });
        document.getElementById('ngcUrlNone').addEventListener('click', function () {
            hygieneRows.forEach(function (r) { r.checked = false; });
            renderHygieneRows();
        });
        document.getElementById('ngcUrlApply').addEventListener('click', applyHygiene);
    }

    function renderHygieneRows() {
        var box = document.getElementById('ngcUrlRows');
        if (!box) return;
        var html = '';
        hygieneRows.forEach(function (r, i) {
            var badges = r.rules.map(function (rule) {
                return '<span class="ngc-hyg-rule">' + esc(rule.label) + '</span>';
            }).join('');
            html += '<div class="ngc-hyg-row' + (r.conflict ? ' is-conflict' : '') + '">'
                + '<label class="ngc-hyg-check"><input type="checkbox" data-ngc-hyg="' + i + '"'
                + (r.checked ? ' checked' : '') + (r.conflict ? ' disabled' : '') + '></label>'
                + '<div class="ngc-hyg-body">'
                + '<div class="ngc-hyg-line"><span class="ngc-hyg-old" title="' + esc(r.url) + '">' + esc(r.url) + '</span>'
                + '<span class="ngc-hyg-arrow">→</span>'
                + '<span class="ngc-hyg-new" title="' + esc(r.next) + '">' + esc(r.next) + '</span></div>'
                + '<div class="ngc-hyg-meta"><span class="text-truncate">' + esc(r.name) + '</span>' + badges + '</div>'
                + (r.conflict ? '<div class="ngc-hyg-conflict">建议网址已被本机其它书签占用,已跳过</div>' : '')
                + '</div></div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('[data-ngc-hyg]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var r = hygieneRows[Number(cb.getAttribute('data-ngc-hyg'))];
                if (r) r.checked = cb.checked;
            });
        });
    }

    function applyHygiene() {
        var targets = hygieneRows.filter(function (r) { return r.checked && !r.conflict; });
        if (!targets.length) { toast('先勾选要应用的网址改动'); return; }
        function doApply() {
            var acc = { updated: 0, skipped: [] };
            var chain = Promise.resolve(acc);
            targets.forEach(function (r) {
                chain = chain.then(function () {
                    return Promise.resolve(L.patch(r.url, { url: r.next })).then(function (res) {
                        if (res && res.ok !== false) acc.updated += 1;
                        else acc.skipped.push({ url: r.url, reason: (res && res.message) || '未写入' });
                    }).catch(function () { acc.skipped.push({ url: r.url, reason: '保存失败' }); });
                });
            });
            chain.then(function () {
                var msg = 'URL 规整完成:更新 ' + acc.updated + ' 条'
                    + (acc.skipped.length ? ',跳过 ' + acc.skipped.length + ' 条(失败改动已回滚)' : '');
                toast(msg);
                scanHygiene();
            });
        }
        if (window.navConfirm) {
            window.navConfirm({
                title: '批量规整本机书签网址',
                body: '将把勾选的 ' + targets.length + ' 条本机书签网址改为建议值;只改本机书签,不代表站点真实可用,删除跟踪参数可能影响来源统计。',
                confirmLabel: '应用'
            }).then(function (ok) { if (ok) doApply(); });
        } else { doApply(); }
    }

    // ---------- 弹层 ----------
    function ensureModal() {
        if (careModal) return careModal;
        careModal = document.createElement('div');
        careModal.className = 'modal fade';
        careModal.id = 'navGuestCareModal';
        careModal.tabIndex = -1;
        careModal.setAttribute('data-no-resize', '1');
        careModal.innerHTML =
            '<div class="modal-dialog modal-lg modal-dialog-centered">' +
            '<div class="modal-content"><div class="modal-header">' +
            '<h5 class="modal-title"><i class="fas fa-screwdriver-wrench me-2"></i>本机保养维护</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="d-flex align-items-center gap-2 mb-2 flex-wrap">' +
            '<button type="button" class="btn btn-sm btn-primary" id="ngcTabCare">保养分组</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngcTabUrl">URL 卫生</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngcTabLink">链接检测 / AI 提示词</button>' +
            '<span class="small text-muted ms-auto">只读写本机书签,不经过服务器</span>' +
            '</div>' +
            '<div id="ngcCareView"></div>' +
            '<div id="ngcUrlView" class="d-none"></div>' +
            '<div id="ngcLinkView" class="d-none"></div>' +
            '</div></div></div>';
        document.body.appendChild(careModal);
        document.getElementById('ngcTabCare').addEventListener('click', function () { switchView('care'); });
        document.getElementById('ngcTabUrl').addEventListener('click', function () { switchView('url'); });
        document.getElementById('ngcTabLink').addEventListener('click', function () { switchView('link'); });
        careModal.addEventListener('click', onCareClick);
        return careModal;
    }

    function switchView(v) {
        view = v;
        var care = document.getElementById('ngcCareView');
        var url = document.getElementById('ngcUrlView');
        var link = document.getElementById('ngcLinkView');
        var tCare = document.getElementById('ngcTabCare');
        var tUrl = document.getElementById('ngcTabUrl');
        var tLink = document.getElementById('ngcTabLink');
        if (!care || !url || !link) return;
        care.classList.toggle('d-none', v !== 'care');
        url.classList.toggle('d-none', v !== 'url');
        link.classList.toggle('d-none', v !== 'link');
        if (tCare) tCare.className = 'btn btn-sm ' + (v === 'care' ? 'btn-primary' : 'btn-outline-secondary');
        if (tUrl) tUrl.className = 'btn btn-sm ' + (v === 'url' ? 'btn-primary' : 'btn-outline-secondary');
        if (tLink) tLink.className = 'btn btn-sm ' + (v === 'link' ? 'btn-primary' : 'btn-outline-secondary');
        if (v === 'care') renderCare();
        else if (v === 'url') renderHygiene();
        else renderLinkView();
    }

    function onCareClick(ev) {
        var btn = ev.target.closest('[data-ngc-act]');
        if (!btn) return;
        var row = btn.closest('[data-url]');
        var url = row ? row.getAttribute('data-url') : '';
        var act = btn.getAttribute('data-ngc-act');
        if (!url) return;
        if (act === 'open') { window.open(url, '_blank', 'noopener'); return; }
        if (act === 'edit') { if (window.navGuestEdit) window.navGuestEdit(url); return; }
        if (act === 'retest') { actRetest(btn, url); return; }
        if (act === 'clearcheck') { actClearCheck(url); return; }
        if (act === 'del') { actDelete(url); return; }
        if (act === 'archive') {
            var it = L.find(url);
            actArchive(url, !(it && it.archived));
        }
    }

    function openCare() {
        ensureModal();
        switchView('care');
        bootstrap.Modal.getOrCreateInstance(careModal).show();
    }

    // ---------- 链接检测 / AI 提示词 / 粘贴导入 ----------
    function initLinkRows() {
        if (linkRows.length) return;
        (L.list() || []).forEach(function (s) {
            linkRows.push({
                url: s.url, name: s.name,
                ok: s.lastCheck ? !!s.lastCheck.ok : null,
                note: s.lastCheck ? (s.lastCheck.note || '') : '',
                ms: s.lastCheck ? (s.lastCheck.ms || 0) : 0
            });
        });
    }
    function runLinkCheck() {
        if (linkBusy) return;
        var sites = L.list() || [];
        if (!sites.length) { toast('本机还没有书签'); return; }
        linkBusy = true;
        linkRows = [];
        initLinkRows();
        var idx = 0;
        var concurrency = 4;
        function one() {
            if (idx >= sites.length) return Promise.resolve();
            var site = sites[idx++];
            return probe(site.url).then(function (r) {
                writeCheck(site.url, r);
                var row = linkRows.find(function (x) { return x.url === site.url; });
                if (row) { row.ok = r.ok; row.note = r.error || ''; row.ms = r.ms || 0; }
                renderLinkRows();
                return one();
            });
        }
        var workers = [];
        for (var w = 0; w < concurrency; w++) workers.push(one());
        Promise.all(workers).then(function () { linkBusy = false; });
    }
    function selectedSites() {
        return linkRows.filter(function (r) { return linkSelected[r.url]; })
            .map(function (r) { return { name: r.name, url: r.url }; });
    }
    function selectedSiteLines() {
        return selectedSites().map(function (s) { return s.name + ' | ' + s.url; });
    }

    // ---- 提示词三套模板 ----
    function buildPromptDefault() {
        var vocab = (L.tagVocab() || []).slice(0, 20).join('、');
        var cats = (L.categories() || []).slice(0, 20).join('、');
        var heads = {
            alt: '请为下列每个站点找一个可替代的同类网址。只输出 JSON 数组,不要编造不存在的网址;无法确定就留空。\n输出结构:[{"url":"原网址","new_url":"替代首页","name":"站点名","reason":"一句话"}]',
            fix: '请检查并规范化下列网址(去跟踪参数、域名小写、去重复斜杠与尾斜杠、必要时升级 https)。只输出 JSON 数组,不要编造不存在的网址;无法确定就留空。\n输出结构:[{"url":"原网址","fixed_url":"修正后","reason":""}]',
            info: '请为下列站点补全分类与标签信息。只输出 JSON 数组,不要编造不存在的网址;无法确定就留空。\n可用标签词表:' + vocab + '\n可用分类词表:' + cats + '\n输出结构:[{"url":"原网址","name":"","description":"","tags":["≤8个,每个≤10字"],"category":"","subcat":""}]'
        };
        var preamble = '下面是我本机收藏的一批站点。这是把清单发给任意外部 AI、再把整段回复粘回来的手动玩法,不是本站 AI 检测;本机闭环不需要任何 Key。\n';
        return preamble + heads[promptMode];
    }
    function switchPromptMode(mode) {
        promptMode = mode;
        var ta = document.getElementById('ngcPromptInput');
        if (ta) ta.value = buildPromptDefault();
        var box = document.getElementById('ngcPromptModes');
        if (box) box.querySelectorAll('[data-ngc-prompt]').forEach(function (b) {
            var on = b.getAttribute('data-ngc-prompt') === mode;
            b.classList.toggle('btn-primary', on);
            b.classList.toggle('btn-outline-secondary', !on);
        });
    }
    function copyPrompt() {
        var ta = document.getElementById('ngcPromptInput');
        var promptText = ta ? ta.value : '';
        var lines = selectedSiteLines();
        var text = promptText + '\n\n选中站点清单:\n' + (lines.length ? lines.join('\n') : '(未勾选站点)');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { toast('提示词与清单已复制'); })
                .catch(function () { fallbackCopy(text); });
            return;
        }
        fallbackCopy(text);
    }
    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('提示词与清单已复制'); }
        catch (e) { toast('复制失败,请手动选择复制'); }
        if (ta.parentNode) ta.parentNode.removeChild(ta);
    }

    // ---- 粘贴导入:解析 / 预览 / 应用 ----
    function normalizeParsed(o) {
        if (!o || typeof o !== 'object') return null;
        var url = String(o.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return null;
        var item = { url: url };
        item.newUrl = String(o.new_url || o.fixed_url || o.newUrl || '').trim();
        item.name = String(o.name || '').trim();
        item.description = String(o.description || '').trim();
        item.tags = Array.isArray(o.tags) ? o.tags.map(String).slice(0, 8) : [];
        item.category = String(o.category || '').trim();
        item.subcat = String(o.subcat || '').trim();
        return item;
    }
    function parseAiReply(text) {
        var raw = String(text || '').trim();
        if (!raw) return { error: '没有粘贴内容' };
        raw = raw.replace(/```(?:json)?/gi, '').trim();
        var arr = null;
        var li = raw.indexOf('['), ri = raw.lastIndexOf(']');
        if (li >= 0 && ri > li) {
            try { arr = JSON.parse(raw.slice(li, ri + 1)); } catch (e) { arr = null; }
        }
        if (Array.isArray(arr)) {
            var items = arr.map(normalizeParsed).filter(Boolean);
            if (items.length) return { items: items };
            return { error: 'JSON 里没有可识别的条目' };
        }
        var lines = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        var textItems = [];
        lines.forEach(function (line) {
            var m = line.match(/^(.*?)\s*(?:->|=>|→)\s*(.*)$/);
            if (m) textItems.push({ url: m[1].trim(), newUrl: m[2].trim() });
        });
        if (textItems.length) return { items: textItems };
        return { error: '解析失败:未找到 JSON 数组或「原网址 -> 新网址」文本行' };
    }
    function parseImport() {
        var ta = document.getElementById('ngcImportInput');
        var res = parseAiReply(ta ? ta.value : '');
        var result = document.getElementById('ngcImportResult');
        if (res.error) {
            linkPreview = [];
            renderImportPreview();
            if (result) result.textContent = res.error;
            toast(res.error);
            return;
        }
        var existing = {};
        (L.list() || []).forEach(function (s) { existing[s.url] = 1; });
        linkPreview = res.items.map(function (it) {
            var valid = /^https?:\/\//i.test(it.newUrl || '');
            var conflict = valid && existing[it.newUrl] && it.newUrl !== it.url;
            return Object.assign({}, it, { valid: valid, conflict: conflict, checked: valid && !conflict });
        });
        renderImportPreview();
        if (result) result.textContent = '解析出 ' + linkPreview.length + ' 条,请核对后应用。';
    }
    function changesForLink(r, overwrite) {
        var changes = {};
        if (r.newUrl) changes.url = r.newUrl;
        if (promptMode === 'info') {
            var cur = L.find(r.url) || {};
            function put(key, val) {
                if (val == null || val === '') return;
                if (overwrite || !cur[key]) changes[key] = val;
            }
            put('name', r.name);
            put('description', r.description);
            if (r.tags && r.tags.length) {
                if (overwrite || !(cur.tags && cur.tags.length)) changes.tags = r.tags;
            }
            put('category', r.category);
            put('subcat', r.subcat);
        }
        return changes;
    }
    function rollbackSnaps(snaps, curUrl) {
        var failed = [];
        var chain = Promise.resolve();
        Object.keys(snaps).forEach(function (u) {
            var b = snaps[u];
            var locate = (curUrl && curUrl[u]) || u;
            chain = chain.then(function () {
                return Promise.resolve(L.patch(locate, { url: b.url, name: b.name, description: b.description, tags: b.tags, category: b.category, subcat: b.subcat }))
                    .then(function (res) {
                        if (!res || res.ok === false) failed.push(u);
                    });
            });
        });
        return chain.then(function () { return failed.length; });
    }
    function applyLinkFix() {
        var targets = linkPreview.filter(function (r) { return r.checked && !r.conflict && r.valid; });
        if (!targets.length) { toast('没有可应用的勾选条目'); return; }
        var overwrite = false;
        var ow = document.getElementById('ngcFillModeOverwrite');
        if (ow) overwrite = !!ow.checked;
        var snaps = {};
        targets.forEach(function (r) { var f = L.find(r.url); if (f) snaps[r.url] = f; });
        var curUrl = {};   // 原网址 → 应用后的当前网址(换网址条目回滚按当前网址定位)
        var applied = [], skipped = [];
        var chain = Promise.resolve();
        targets.forEach(function (r) {
            chain = chain.then(function () {
                var changes = changesForLink(r, overwrite);
                return Promise.resolve(L.patch(r.url, changes)).then(function (res) {
                    if (res && res.ok !== false) {
                        applied.push(r.url);
                        curUrl[r.url] = r.newUrl || r.url;
                    } else {
                        skipped.push({ url: r.url, reason: (res && res.message) || '未写入' });
                    }
                }).catch(function () { skipped.push({ url: r.url, reason: '保存失败' }); });
            });
        });
        chain.then(function () {
            var result = document.getElementById('ngcImportResult');
            if (skipped.length) {
                rollbackSnaps(snaps, curUrl).then(function (failedCount) {
                    var msg = '应用失败:' + skipped.length + ' 条未写入,已回滚本次已成功的改动';
                    if (failedCount) msg += ';部分回滚未完成: ' + failedCount + ' 条(存储空间不足)';
                    if (result) result.textContent = msg;
                    toast(msg);
                    renderImportPreview();
                });
                return;
            }
            var msg = '应用完成:成功 ' + applied.length + ' 条,跳过 ' + skipped.length + ' 条(冲突/非法)';
            if (result) result.textContent = msg;
            toast(msg);
            if (L.render) L.render();
            renderImportPreview();
        });
    }

    // ---- 链接检测视图渲染 ----
    function linkViewShell() {
        return ''
            + '<div class="d-flex align-items-center gap-2 mb-2 flex-wrap">'
            + '<button type="button" class="btn btn-sm btn-primary" id="ngcLinkRun">检测全部书签</button>'
            + '<span class="small text-muted">浏览器直连,只判能否连上;403/404 也可能算可连,不记状态码</span>'
            + '<div class="ms-auto d-flex gap-1">'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-ngc-link-filter="all">全部</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-ngc-link-filter="dead">失败</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-ngc-link-filter="untested">未测</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-ngc-link-filter="ok">可连</button>'
            + '</div></div>'
            + '<div id="ngcLinkRows"></div>'
            + '<hr class="my-3">'
            + '<div class="ngc-section-title">复制提示词 + 选中站点清单(发给外部 AI 手动补全 / 修正)</div>'
            + '<div class="btn-group mb-2" id="ngcPromptModes">'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-ngc-prompt="alt">找替代网址</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-ngc-prompt="fix">修正网址</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-ngc-prompt="info">补全信息</button>'
            + '</div>'
            + '<textarea id="ngcPromptInput" class="form-control form-control-sm" rows="6"></textarea>'
            + '<div class="mt-2 d-flex gap-2 align-items-center">'
            + '<button type="button" class="btn btn-sm btn-primary" id="ngcPromptCopy">复制提示词与清单</button>'
            + '<span class="small text-muted">文本框可手改;复制以当前内容为准</span></div>'
            + '<hr class="my-3">'
            + '<div class="ngc-section-title">粘贴 AI 回复,预览后应用到本机书签</div>'
            + '<textarea id="ngcImportInput" class="form-control form-control-sm" rows="5" placeholder="粘贴 ```json 围栏或说明文字包裹的 JSON,也支持「原网址 -> 新网址」文本行"></textarea>'
            + '<div class="mt-2 d-flex gap-2 flex-wrap align-items-center">'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" id="ngcImportParse">解析预览</button>'
            + '<label class="small"><input type="radio" name="ngcFillMode" id="ngcFillModeFill" checked> 仅补空字段</label>'
            + '<label class="small"><input type="radio" name="ngcFillMode" id="ngcFillModeOverwrite"> 覆盖已有</label>'
            + '<span class="small text-muted ms-auto">只处理勾选行;不删原书签、不新增重复条目</span></div>'
            + '<div id="ngcImportRows" class="mt-2"></div>'
            + '<div id="ngcImportResult" class="small mt-1"></div>'
            + '<div class="mt-2"><button type="button" class="btn btn-sm btn-primary" id="ngcImportApply">应用勾选改动</button></div>';
    }
    function wireLinkView() {
        document.getElementById('ngcLinkRun').addEventListener('click', runLinkCheck);
        document.getElementById('ngcPromptCopy').addEventListener('click', copyPrompt);
        document.getElementById('ngcImportParse').addEventListener('click', parseImport);
        document.getElementById('ngcImportApply').addEventListener('click', applyLinkFix);
        document.getElementById('ngcLinkView').querySelectorAll('[data-ngc-link-filter]').forEach(function (b) {
            b.addEventListener('click', function () { linkFilter = b.getAttribute('data-ngc-link-filter'); renderLinkRows(); });
        });
        document.getElementById('ngcLinkView').querySelectorAll('[data-ngc-prompt]').forEach(function (b) {
            b.addEventListener('click', function () { switchPromptMode(b.getAttribute('data-ngc-prompt')); });
        });
    }
    function renderLinkView() {
        var box = document.getElementById('ngcLinkView');
        if (!box) return;
        if (!document.getElementById('ngcLinkRun')) {
            box.innerHTML = linkViewShell();
            wireLinkView();
            var ta = document.getElementById('ngcPromptInput');
            if (ta && !ta.value) ta.value = buildPromptDefault();
        }
        renderLinkRows();
    }
    function renderLinkRows() {
        var box = document.getElementById('ngcLinkRows');
        if (!box) return;
        initLinkRows();
        var list = linkRows.filter(function (r) {
            if (linkFilter === 'dead') return r.ok === false;
            if (linkFilter === 'untested') return r.ok == null;
            if (linkFilter === 'ok') return r.ok === true;
            return true;
        });
        if (!list.length) {
            box.innerHTML = '<div class="ngc-empty small text-muted">没有符合筛选的书签。点「检测全部书签」开始。</div>';
            return;
        }
        var html = '';
        list.forEach(function (r) {
            var status = r.ok == null ? '未测' : (r.ok ? '可连' : '失败');
            var badgeCls = r.ok == null ? 'ngc-badge-muted' : (r.ok ? 'ngc-badge-ok' : 'ngc-badge-danger');
            html += '<div class="ngc-hyg-row">'
                + '<label class="ngc-hyg-check"><input type="checkbox" data-ngc-link="' + esc(r.url) + '"'
                + (linkSelected[r.url] ? ' checked' : '') + '></label>'
                + '<div class="ngc-hyg-body">'
                + '<div class="ngc-hyg-line"><span class="ngc-hyg-old" title="' + esc(r.name) + '">' + esc(r.name) + '</span>'
                + '<span class="ngc-hyg-new" title="' + esc(r.url) + '">' + esc(r.url) + '</span></div>'
                + '<div class="ngc-hyg-meta"><span class="' + badgeCls + '">' + status + '</span>'
                + (r.ms ? '<span>' + Math.round(r.ms) + ' ms</span>' : '')
                + (r.note ? '<span class="text-truncate">' + esc(r.note) + '</span>' : '')
                + '</div></div></div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('[data-ngc-link]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var u = cb.getAttribute('data-ngc-link');
                if (cb.checked) linkSelected[u] = true;
                else delete linkSelected[u];
            });
        });
    }
    function renderImportPreview() {
        var box = document.getElementById('ngcImportRows');
        if (!box) return;
        if (!linkPreview.length) { box.innerHTML = ''; return; }
        var html = '';
        linkPreview.forEach(function (r, i) {
            var badges = [];
            if (!r.valid) badges.push('<span class="ngc-hyg-rule ngc-badge-danger">非法网址</span>');
            if (r.conflict) badges.push('<span class="ngc-hyg-rule ngc-badge-danger">冲突,跳过</span>');
            html += '<div class="ngc-hyg-row' + (r.conflict || !r.valid ? ' is-conflict' : '') + '">'
                + '<label class="ngc-hyg-check"><input type="checkbox" data-ngc-import="' + i + '"'
                + (r.checked ? ' checked' : '') + ((r.conflict || !r.valid) ? ' disabled' : '') + '></label>'
                + '<div class="ngc-hyg-body">'
                + '<div class="ngc-hyg-line"><span class="ngc-hyg-old" title="' + esc(r.url) + '">' + esc(r.url) + '</span>'
                + '<span class="ngc-hyg-arrow">→</span>'
                + '<span class="ngc-hyg-new" title="' + esc(r.newUrl || '') + '">' + esc(r.newUrl || '(无新网址)') + '</span></div>'
                + '<div class="ngc-hyg-meta"><span class="text-truncate">' + esc(r.name || r.description || '') + '</span>' + badges.join('') + '</div>'
                + '</div></div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('[data-ngc-import]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var r = linkPreview[Number(cb.getAttribute('data-ngc-import'))];
                if (r) r.checked = cb.checked;
            });
        });
    }

    window.navGuestCare = { open: openCare };

    // ---------- 入口委托 ----------
    document.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-nav-care]');
        if (el) { ev.preventDefault(); openCare(); }
    });
})();
