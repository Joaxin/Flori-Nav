/* 链接检测 / AI 提示词 / 粘贴导入(主人版,2026-11-20)。
   边界约定同 linktest.js:csrf 走 window.navCsrf,toast 走 window.navToast;
   URL 走模板渲染的配置岛 #navLinkFixUrls(静态文件里禁模板标签,不写死服务端路径)。
   与访客 #navGuestCareModal 完全不共享 id / class 前缀,内部 id 一律 nail 前缀。
   对外:无(window 上只有事件绑定,外部不直接调用)。*/
jQuery(function ($) {
    'use strict';

    const csrf = window.navCsrf, showToast = window.navToast;
    const NAIL_URLS = JSON.parse(document.getElementById('navLinkFixUrls').textContent);
    const NAIL_BATCH = 4;            // 每批 4 条,批间串行(并发 ≤4)
    const FIX_BATCH = 50;            // 写库每批上限(服务端契约 50)

    // ---- 面板状态 ----
    let checkRows = [];              // { site, result:null|{ok,status,error,ms,skipped} }
    let nailSelected = {};           // 勾选表:site.id → true,独立于批量栏 selected
    let linkFilter = 'all';
    let linkQuery = '';              // 名称 / 网址 / 分类 关键字(2026-11-24)
    let nailCat = '';                // 分类筛选:空=全部分类(2026-11-24,站点上千时按分类收窄)
    let checkBusy = false;
    let promptMode = 'alt';
    let linkPreview = [];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ---- 数据来源:活跃卡片 + 可选休眠站 ----
    function parseTags(str) {
        if (!str) return [];
        try {
            const v = JSON.parse(str);
            return Array.isArray(v) ? v.map(String) : [];
        } catch (e) { return []; }
    }

    function collectSites() {
        const includeArchived = $('#nailIncludeArchived').prop('checked');
        const sites = [];
        const seen = {};
        $('.nav-hub [data-site-item][data-id][data-url]').each(function () {
            const $el = $(this);
            const id = Number($el.attr('data-id'));
            const url = String($el.attr('data-url') || '').trim();
            if (!id || !url || seen[url]) return;
            seen[url] = 1;
            sites.push({
                id: id, url: url,
                name: String($el.attr('data-name') || ''),
                cat: String($el.attr('data-cat') || ''),
                tags: parseTags($el.attr('data-tags')),
                archived: false, el: this,
                old: {
                    at: Number($el.attr('data-check-at') || 0),
                    code: $el.attr('data-check-code'),
                    ms: Number($el.attr('data-check-ms') || 0)
                }
            });
        });
        if (includeArchived) {
            $('#navArchiveList .arch-row[data-id][data-url]').each(function () {
                const $el = $(this);
                const id = Number($el.attr('data-id'));
                const url = String($el.attr('data-url') || '').trim();
                if (!id || !url || seen[url]) return;
                seen[url] = 1;
                sites.push({
                    id: id, url: url,
                    name: String($el.attr('data-name') || ''),
                    cat: String($el.attr('data-cat') || ''),
                    tags: [], archived: true, el: this,
                    old: { at: 0, code: '', ms: 0 }
                });
            });
        }
        return sites;
    }

    function allExistingUrls() {
        const out = [];
        const seen = {};
        $('.nav-hub [data-site-item][data-url]').each(function () {
            const u = String(this.getAttribute('data-url') || '').trim();
            if (u && !seen[u]) { seen[u] = 1; out.push(u); }
        });
        $('#navArchiveList .arch-row[data-url]').each(function () {
            const u = String(this.getAttribute('data-url') || '').trim();
            if (u && !seen[u]) { seen[u] = 1; out.push(u); }
        });
        return out;
    }

    // 词表:分类来自 #navCatUrls JSON 的 key;标签扫全部卡片 data-tags 去重
    function categories() {
        try { return Object.keys(JSON.parse($('#navCatUrls').textContent || '{}') || {}); }
        catch (e) { return []; }
    }
    function tagVocab() {
        const out = [], seen = {};
        $('[data-site-item][data-tags]').each(function () {
            parseTags(this.getAttribute('data-tags')).forEach(function (t) {
                if (!seen[t]) { seen[t] = 1; out.push(t); }
            });
        });
        return out;
    }

    function chunk(arr, n) {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    }

    // ---- 链接检测 ----
    function refreshCheckRows() {
        const sites = collectSites();
        const prev = {};
        checkRows.forEach(function (r) { prev[r.url] = r; });
        checkRows = sites.map(function (s) {
            const p = prev[s.url];
            return { site: s, result: p ? p.result : null };
        });
        fillNailCats();
        renderCheckRows();
    }

    function siteCat(site) {
        return site.cat || (site.archived ? '休眠' : '未分类');
    }

    // 分类下拉:按当前站点集重算选项(带条数),保留用户已选分类
    function fillNailCats() {
        const sel = document.getElementById('nailCatFilter');
        if (!sel) return;
        const counts = {};
        checkRows.forEach(function (r) {
            const c = siteCat(r.site);
            counts[c] = (counts[c] || 0) + 1;
        });
        const t = window.NavI18n && NavI18n.t ? NavI18n.t : function (s) { return s; };
        const cur = nailCat;
        let html = '<option value="">' + esc(t('全部分类')) + ' (' + checkRows.length + ')</option>';
        Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, 'zh-Hans-CN'); }).forEach(function (c) {
            html += '<option value="' + esc(c) + '">' + esc(t(c)) + ' (' + counts[c] + ')</option>';
        });
        sel.innerHTML = html;
        sel.value = counts[cur] ? cur : '';
        nailCat = sel.value;
    }

    function matchesFilter(r) {
        if (nailCat && siteCat(r.site) !== nailCat) return false;
        if (linkQuery) {
            const hay = ((r.site.name || '') + ' ' + (r.site.url || '') + ' ' + (r.site.cat || '')).toLowerCase();
            if (hay.indexOf(linkQuery) < 0) return false;
        }
        if (linkFilter === 'all') return true;
        if (linkFilter === 'archived') return r.site.archived;
        if (!r.result) return linkFilter === 'untested';
        if (linkFilter === 'dead') return r.result.ok === false;
        if (linkFilter === 'ok') return r.result.ok === true;
        return true;
    }

    $(document).on('click', '#nailSelectAll', function () {
        // 只作用于当前筛选后可见的行:3000 个站点靠一个一个点不现实
        const $btn = $(this);
        const T = function (s) { return (window.NavI18n && NavI18n.t) ? NavI18n.t(s) : s; };
        const $cbs = $('#nailRows [data-nail-check]');
        if (!$cbs.length) return;
        const allOn = $cbs.toArray().every(function (el) { return el.checked; });
        $cbs.each(function () {
            const id = $(this).attr('data-site-id');
            this.checked = !allOn;
            if (id != null) nailSelected[id] = !allOn;
        });
        $btn.toggleClass('btn-secondary', !allOn).toggleClass('btn-outline-secondary', allOn)
            .text(allOn ? T('全选可见') : T('取消全选'));
    });

    function renderCheckRows() {
        const $box = $('#nailRows').empty();
        const T = function (s) { return (window.NavI18n && NavI18n.t) ? NavI18n.t(s) : s; };
        const en = !!(window.NavI18n && NavI18n.getLang() === 'en');
        let nOk = 0, nDead = 0, nUntested = 0, shown = 0;
        // 状态计数按全量算,不然切到「失败」后汇总会显示成 0 可连/0 未测,看着像数据丢了
        checkRows.forEach(function (r) {
            if (r.result) { if (r.result.ok) nOk++; else nDead++; } else nUntested++;
        });
        checkRows.forEach(function (r) {
            if (!matchesFilter(r)) return;
            shown++;
            let codeTxt, msTxt, note, codeCls;
            if (r.result) {
                if (r.result.ok) { codeTxt = r.result.status != null ? 'HTTP ' + r.result.status : '—'; note = ''; codeCls = 'nail-badge-ok'; }
                else { codeTxt = T('打不开'); note = r.result.error || ''; codeCls = 'nail-badge-dead'; }
                msTxt = r.result.ms ? r.result.ms + ' ms' : '';
            } else {
                codeTxt = r.site.old.at ? (r.site.old.code ? 'HTTP ' + r.site.old.code : '—') : T('未测');
                msTxt = r.site.old.at && r.site.old.ms ? r.site.old.ms + ' ms' : '';
                note = ''; codeCls = 'nail-badge-muted';
            }
            const $row = $('<div class="nail-row">');
            const $cb = $('<input type="checkbox" class="form-check-input" data-nail-check>')
                .attr('data-site-id', r.site.id)
                .prop('checked', !!nailSelected[r.site.id]);
            $cb.on('change', function () { nailSelected[r.site.id] = this.checked; });
            const $name = $('<div class="nail-name fw-bold">').text(r.site.name || r.site.url);
            const $url = $('<div class="nail-url">').text(r.site.url);
            const $cat = $('<div class="nail-meta">').text(r.site.cat || (r.site.archived ? T('休眠') : ''));
            const $code = $('<div class="nail-code">').addClass(codeCls).text(codeTxt);
            const $ms = $('<div class="nail-meta">').text(msTxt);
            const $note = $('<div class="nail-note">').text(note);
            $row.append($cb, $name, $url, $cat, $code, $ms, $note);
            $box.append($row);
        });
        const sum = $('#nailCheckSummary');
        if (sum) {
            sum.text(en
                ? 'Total ' + checkRows.length + ' · OK ' + nOk + ' · Failed ' + nDead + ' · Untested ' + nUntested
                  + (shown !== checkRows.length ? ' · Showing ' + shown : '')
                : '共 ' + checkRows.length + ' 条 · 可连 ' + nOk + ' · 失败 ' + nDead + ' · 未测 ' + nUntested
                  + (shown !== checkRows.length ? ' · 当前筛选 ' + shown + ' 条' : ''));
        }
        const $sa = $('#nailSelectAll');
        if ($sa.length) {
            const $cs = $('#nailRows [data-nail-check]');
            const allOn = !!$cs.length && $cs.toArray().every(function (el) { return el.checked; });
            $sa.toggleClass('btn-secondary', allOn).toggleClass('btn-outline-secondary', !allOn)
                .text(allOn ? T('取消全选') : T('全选可见'));
        }
    }

    function runLinkCheck(onlySelected) {
        if (checkBusy) return;
        refreshCheckRows();
        let targets = checkRows.map(function (r) { return r.site; });
        if (onlySelected) targets = targets.filter(function (s) { return nailSelected[s.id]; });
        if (!targets.length) { showToast('没有可检测的勾选站点'); return; }
        checkBusy = true;
        const batches = chunk(targets, NAIL_BATCH);
        let done = 0;
        function step(k) {
            if (k >= batches.length) {
                checkBusy = false;
                renderCheckRows();
                showToast('检测完成:' + done + ' 条,刷新页面后卡片状态更新');
                return;
            }
            const batch = batches[k].map(function (s) { return s.url; });
            $.ajax({
                url: NAIL_URLS.check, type: 'POST', contentType: 'application/json',
                data: JSON.stringify({ urls: batch, proxy: '' }),
                beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                success: function (data) {
                    const byUrl = {};
                    (data.results || []).forEach(function (r) { byUrl[r.url] = r; });
                    checkRows.forEach(function (r) {
                        const res = byUrl[r.site.url];
                        if (res) r.result = res;
                    });
                    done += batch.length;
                    renderCheckRows();
                    step(k + 1);
                },
                error: function (xhr) {
                    checkBusy = false;
                    renderCheckRows();
                    showToast((xhr.responseJSON && xhr.responseJSON.message) || '检测请求失败');
                }
            });
        }
        step(0);
    }

    // ---- 提示词三套模板 ----
    function selectedSites() {
        return checkRows.filter(function (r) { return nailSelected[r.site.id]; })
            .map(function (r) { return { name: r.site.name, url: r.site.url }; });
    }
    function selectedSiteLines() {
        return selectedSites().map(function (s) { return s.name + ' | ' + s.url; });
    }

    function buildPromptDefault() {
        const vocab = tagVocab().slice(0, 20).join('、');
        const cats = categories().slice(0, 20).join('、');
        const heads = {
            alt: '请为下列每个站点找一个可替代的同类网址。只输出 JSON 数组,不要编造不存在的网址;无法确定就留空。\n输出结构:[{"url":"原网址","new_url":"替代首页","name":"站点名","reason":"一句话"}]',
            fix: '请检查并规范化下列网址(去跟踪参数、域名小写、去重复斜杠与尾斜杠、必要时升级 https)。只输出 JSON 数组,不要编造不存在的网址;无法确定就留空。\n输出结构:[{"url":"原网址","fixed_url":"修正后","reason":""}]',
            info: '请为下列站点补全分类与标签信息。只输出 JSON 数组,不要编造不存在的网址;无法确定就留空。\n可用标签词表:' + vocab + '\n可用分类词表:' + cats + '\n优先使用给定词表,不要自造分类。\n输出结构:[{"url":"原网址","name":"","description":"","tags":["≤8个,每个≤10字"],"category":"","subcat":""}]'
        };
        const preamble = '下面是我导航里的一批站点。把清单发给任意 AI,再把整段回复粘回本站「粘贴导入」页签预览;这是手动玩法,不消耗本站 AI 额度。\n';
        return preamble + heads[promptMode];
    }

    function switchPromptMode(mode) {
        promptMode = mode;
        $('#nailPromptInput').val(buildPromptDefault());
        $('#nailPromptPane [data-nail-prompt]').each(function () {
            const on = $(this).attr('data-nail-prompt') === mode;
            $(this).toggleClass('btn-primary', on).toggleClass('btn-outline-primary', !on);
        });
    }

    function copyPrompt() {
        const ta = $('#nailPromptInput');
        const promptText = ta.val() || '';
        const lines = selectedSiteLines();
        const text = promptText + '\n\n选中站点清单:\n' + (lines.length ? lines.join('\n') : '(未勾选站点)');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { showToast('提示词与清单已复制'); })
                .catch(function () { fallbackCopy(text); });
            return;
        }
        fallbackCopy(text);
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('提示词与清单已复制'); }
        catch (e) { showToast('复制失败,请手动选择复制'); }
        if (ta.parentNode) ta.parentNode.removeChild(ta);
    }

    // ---- 粘贴导入:解析 / 预览 / 应用 ----
    function normalizeParsed(o) {
        if (!o || typeof o !== 'object') return null;
        const url = String(o.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return null;
        const item = { url: url };
        item.newUrl = String(o.new_url || o.fixed_url || o.newUrl || '').trim();
        item.name = String(o.name || '').trim();
        item.description = String(o.description || '').trim();
        item.tags = Array.isArray(o.tags) ? o.tags.map(String).slice(0, 8) : [];
        item.category = String(o.category || '').trim();
        item.subcat = String(o.subcat || '').trim();
        return item;
    }

    function parseAiReply(text) {
        const raw = String(text || '').trim();
        if (!raw) return { error: '没有粘贴内容' };
        const stripped = raw.replace(/```(?:json)?/gi, '').trim();
        let arr = null;
        const li = stripped.indexOf('['), ri = stripped.lastIndexOf(']');
        if (li >= 0 && ri > li) {
            try { arr = JSON.parse(stripped.slice(li, ri + 1)); } catch (e) { arr = null; }
        }
        if (Array.isArray(arr)) {
            const items = arr.map(normalizeParsed).filter(Boolean);
            if (items.length) return { items: items };
            return { error: 'JSON 里没有可识别的条目' };
        }
        const lines = stripped.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        const textItems = [];
        lines.forEach(function (line) {
            const m = line.match(/^(.*?)\s*(?:->|=>|→)\s*(.*)$/);
            if (m) textItems.push({ url: m[1].trim(), newUrl: m[2].trim() });
        });
        if (textItems.length) return { items: textItems };
        return { error: '解析失败:未找到 JSON 数组或「原网址 -> 新网址」文本行' };
    }

    function parseImport() {
        const res = parseAiReply($('#nailImportInput').val());
        const $result = $('#nailResult');
        if (res.error) {
            linkPreview = [];
            renderImportPreview();
            if ($result) $result.text(res.error);
            showToast(res.error);
            return;
        }
        const byUrl = {};
        checkRows.forEach(function (r) { byUrl[r.site.url] = r.site; });
        const existing = {};
        allExistingUrls().forEach(function (u) { existing[u] = 1; });
        const seenTargets = {};
        linkPreview = res.items.map(function (it) {
            const site = byUrl[String(it.url || '').trim()];
            let valid = /^https?:\/\//i.test(it.newUrl || '');
            let conflict = false, reason = '';
            if (!site) { valid = false; reason = '库里找不到该网址'; }
            else if (valid && existing[it.newUrl] && it.newUrl !== site.url) {
                conflict = true; reason = '冲突,跳过';
            } else if (valid && seenTargets[it.newUrl]) {
                conflict = true; reason = '与本次批次内重复';
            }
            if (valid && !conflict) seenTargets[it.newUrl] = 1;
            return Object.assign({}, it, {
                site: site, valid: valid, conflict: conflict, reason: reason,
                checked: valid && !conflict
            });
        });
        renderImportPreview();
        if ($result) $result.text('解析出 ' + linkPreview.length + ' 条,请核对后应用。');
    }

    function renderImportPreview() {
        const $box = $('#nailImportRows').empty();
        linkPreview.forEach(function (r) {
            const bad = r.conflict || !r.valid;
            const $row = $('<div class="nail-preview-row">').toggleClass('is-conflict', bad);
            const $cb = $('<input type="checkbox" class="form-check-input" data-nail-import>')
                .prop('checked', !!r.checked).prop('disabled', bad);
            $cb.on('change', function () { r.checked = this.checked; });
            const $from = $('<div class="nail-url">').text(r.url);
            const $arrow = $('<div class="nail-arrow">→</div>');
            const $to = $('<div class="nail-url">').text(r.newUrl || '(仅补字段)');
            const $badge = $('<div class="nail-meta">');
            if (r.conflict) $badge.addClass('nail-badge-dead').text(r.reason);
            else if (!r.valid) $badge.addClass('nail-badge-warn').text(r.reason || '非法 URL');
            else $badge.addClass('nail-badge-ok').text('可应用');
            $row.append($cb, $from, $arrow, $to, $badge);
            $box.append($row);
        });
    }

    function snapshotOf(site) {
        const $ed = site.el ? $(site.el).find('.site-edit') : $();
        const tags = $ed.length
            ? String($ed.attr('data-tags') || '').split(',').filter(Boolean)
            : (site.tags || []);
        return {
            url: site.url,
            name: $ed.length ? String($ed.attr('data-name') || '') : site.name,
            description: $ed.length ? String($ed.attr('data-desc') || '') : '',
            tags: tags,
            category: $ed.length ? String($ed.attr('data-category') || '') : site.cat,
            subcat: $ed.length ? String($ed.attr('data-subcat') || '') : ''
        };
    }

    function fixItem(x) {
        const r = x.r;
        const item = { id: r.site.id, url: r.site.url };
        if (r.newUrl) item.new_url = r.newUrl;
        if (r.name) item.name = r.name;
        if (r.description) item.description = r.description;
        if (r.tags && r.tags.length) item.tags = r.tags;
        if (r.category) item.category = r.category;
        if (r.subcat) item.subcat = r.subcat;
        return item;
    }

    function postFix(payload) {
        return new Promise(function (resolve, reject) {
            $.ajax({
                url: NAIL_URLS.fix, type: 'POST', contentType: 'application/json',
                data: JSON.stringify(payload),
                beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                success: function (data) { resolve(data); },
                error: function (xhr) { reject(xhr); }
            });
        });
    }

    // 回滚:对本次已成功的条目发反向请求,把网址与字段还原成快照;回滚失败如实计数
    function rollbackApplied(appliedList) {
        let failed = 0;
        let chain = Promise.resolve();
        appliedList.forEach(function (x) {
            const snap = x.snap;
            const reverseItem = {
                id: x.r.site.id,
                url: x.currentUrl,
                new_url: snap.url,
                name: snap.name, description: snap.description, tags: snap.tags,
                category: snap.category, subcat: snap.subcat,
                overwrite: true
            };
            chain = chain.then(function () {
                return postFix({ items: [reverseItem], overwrite: true }).then(function (data) {
                    const rs = (data.results || [])[0];
                    if (!rs || rs.ok === false) failed++;
                }).catch(function () { failed++; });
            });
        });
        return chain.then(function () { return failed; });
    }

    function applyLinkFix() {
        const targets = linkPreview.filter(function (r) { return r.checked && !r.conflict && r.valid && r.site; });
        if (!targets.length) { showToast('没有可应用的勾选条目'); return; }
        const owEl = $('#nailFillModeOverwrite');
        const overwrite = !!(owEl && owEl.prop('checked'));   // 默认仅补空字段:overwrite:false
        const snaps = targets.map(function (r) {
            return { r: r, snap: snapshotOf(r.site), currentUrl: r.site.url, newUrl: r.newUrl || r.site.url };
        });
        const applied = [], skipped = [];
        const batches = chunk(snaps, FIX_BATCH);
        let chain = Promise.resolve();
        batches.forEach(function (batch) {
            chain = chain.then(function () {
                const items = batch.map(fixItem);
                return postFix({ items: items, overwrite: overwrite }).then(function (data) {
                    const results = (data && data.results) || [];
                    const byId = {};
                    results.forEach(function (rs) { byId[rs.id] = rs; });
                    batch.forEach(function (x) {
                        const rs = byId[x.r.site.id];
                        if (rs && rs.ok !== false) {
                            if (x.r.newUrl) x.currentUrl = x.newUrl;
                            applied.push(x);
                        } else {
                            skipped.push({ url: x.r.site.url, reason: (rs && rs.message) || '未写入' });
                        }
                    });
                }).catch(function () {
                    batch.forEach(function (x) { skipped.push({ url: x.r.site.url, reason: '保存失败' }); });
                });
            });
        });
        chain.then(function () {
            const $result = $('#nailResult');
            if (skipped.length) {
                rollbackApplied(applied).then(function (failedCount) {
                    let msg = '应用失败:' + skipped.length + ' 条未写入,已回滚本次已成功的改动';
                    if (failedCount) msg += ';部分回滚未完成: ' + failedCount + ' 条';
                    if ($result) $result.text(msg);
                    showToast(msg);
                    renderImportPreview();
                });
                return;
            }
            const msg = '应用完成:成功 ' + applied.length + ' 条,跳过 ' + skipped.length + ' 条(冲突/非法/失败)';
            if ($result) $result.text(msg);
            showToast(msg);
            setTimeout(function () { location.reload(); }, 800);
        });
    }

    // ---- 事件绑定 ----
    $('#nailRunCheck').on('click', function () { runLinkCheck(false); });
    $('#nailRetestSelected').on('click', function () { runLinkCheck(true); });
    $('#nailFilters').on('click', '[data-nail-filter]', function () {
        linkFilter = $(this).attr('data-nail-filter');
        // 点击给了视觉反馈,否则看不出筛选是否生效
        $('#nailFilters [data-nail-filter]').removeClass('btn-secondary').addClass('btn-outline-secondary');
        $(this).removeClass('btn-outline-secondary').addClass('btn-secondary');
        renderCheckRows();
    });
    $('#nailSearch').on('input', function () {
        linkQuery = this.value.trim().toLowerCase();
        renderCheckRows();
    });
    $('#nailCatFilter').on('change', function () {
        nailCat = this.value;
        renderCheckRows();
    });
    $('#nailPromptPane').on('click', '[data-nail-prompt]', function () {
        switchPromptMode($(this).attr('data-nail-prompt'));
    });
    $('#nailCopyPrompt').on('click', copyPrompt);
    $('#nailParseImport').on('click', parseImport);
    $('#nailApplyFix').on('click', applyLinkFix);
    // 保养页签底部入口按钮(health.js 渲染收尾处追加):打开同一个弹窗
    $(document).on('click', '#navHealthLinkEntry', function () {
        $('#navAiLinkModal').modal('show');
    });
    $('#navAiLinkModal').on('show.bs.modal', function () {
        refreshCheckRows();
        if (!$('#nailPromptInput').val()) $('#nailPromptInput').val(buildPromptDefault());
    });
});
