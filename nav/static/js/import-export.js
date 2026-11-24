/* 导出 / 导入(JSON 预览 + 浏览器书签)/ 恢复内置——从 nav_sites.html 拆出的第四刀(2026-10-25,渐进拆分,同 pet.js 模式)。
   边界约定见 pet.js 文件头:主脚本挂 window 的共享工具在此取用(siteMap 由主脚本解析 JSON 岛后挂 window);
   URL 走模板渲染的配置岛 #navIeUrls(静态文件里禁模板标签)。
   对外:无(window 上只有事件绑定,外部不直接调用)。*/
jQuery(function ($) {
    'use strict';
    const csrf = window.navCsrf, showToast = window.navToast;
    const siteMap = window.siteMap;
    const IE_URLS = JSON.parse(document.getElementById('navIeUrls').textContent);
    // 导出 JSON(直接下载)
    $('#navExportBtn').on('click', function() {
        window.location.href = IE_URLS.export;
    });

    // 导出浏览器书签(Netscape HTML,服务端生成)
    $('#navExportBookmarkBtn').on('click', function() { window.location.href = IE_URLS.exportBookmark; });

    // 退出主人态(2026-11-21 单入口):清 cookie 后同一个地址回到访客页,不换 URL
    $('#navLogoutBtn').on('click', function() {
        $.ajax({
            url: IE_URLS.logout, type: 'POST',
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function() { window.location.href = IE_URLS.home; },
            error: function() { showToast('退出失败，请重试'); }
        });
    });

    // 导入 JSON(.html/.htm 走书签解析预览,其余按原 JSON 逻辑)
    $('#navImportBtn').on('click', function() { $('#navImportInput').val('').trigger('click'); });
    $('#navImportInput').on('change', function() {
        const file = this.files[0];
        if (!file) return;
        if (/\.html?$/i.test(file.name || '')) {   // 浏览器书签:先解析预览,再走同一落库管道
            navBmReadFile(file);
            this.value = '';
            return;
        }
        navJsonPreview(file);   // A:先预览确认,不再直接写库
    });
    let bmJsonFile = null;      // 非空 = 当前预览是 JSON 文件(确认时原样上传,工具不进勾选)
    function navJsonPreview(file) {
        const reader = new FileReader();
        reader.onload = function() {
            let data;
            try { data = JSON.parse(String(reader.result || '')); }
            catch (e) { showToast('这不是合法的 JSON 导出文件'); return; }
            if (!data || !Array.isArray(data.sites)) {
                showToast('格式不对:要的是含 sites 数组的导航 JSON'); return;
            }
            bmJsonFile = file;
            const known = {};
            Object.keys(siteMap || {}).forEach(function(k) { known[navBmNormalize(k)] = siteMap[k]; });
            bmItems = [];
            bmExcluded.clear();
            const rows = [];
            let added = 0, exists = 0;
            data.sites.forEach(function(it) {
                const url = navBmNormalize(it.url);
                const hit = known[url];
                if (hit) exists++; else added++;
                bmItems.push({name: it.name, url: url, description: it.description || '',
                              category: it.category, subcat: it.subcat});
                rows.push({name: it.name, url: url, cat: it.category, sub: it.subcat,
                           badge: hit ? '已存在' : '新增', cls: hit ? 'text-bg-warning' : 'text-bg-success'});
            });
            $('#bmModalTitle').html('<i class="fas fa-file-import me-2 acc-ico"></i>导入 JSON 预览 '
                + '<small class="text-muted fw-normal fs-6">确认后原样入库,工具 ' + ((data.tools || []).length) + ' 个随文件一起导入</small>');
            $('#bmSummary').html('共 ' + data.sites.length + ' 个站点:新增 ' + added + ',已存在 ' + exists
                + '(已选 <b id="bmSelCount">' + bmItems.length + '</b> 条)');
            bmRenderRows(rows);
            $('#bmImportConfirm').prop('disabled', bmItems.length === 0);
            $('#bmMetaWrap').addClass('d-none');   // JSON 恢复走原文件,不提供抓简介/合并
            $('#bmMergeWrap').addClass('d-none');
            bootstrap.Modal.getOrCreateInstance(document.getElementById('bookmarkModal')).show();
        };
        reader.readAsText(file);
    }
    function _legacy_json_import(file, wipe) {
        const fd = new FormData();
        fd.append('nav_file', file);
        if (wipe) fd.append('wipe', '1');
        $.ajax({
            url: IE_URLS.import, type: 'POST', data: fd,
            processData: false, contentType: false,
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function(data) { try { sessionStorage.setItem('navPetWelcome', '导入的 ' + data.created + ' 个新伙伴'); } catch (e) {} showToast(`导入完成：新增 ${data.created}，更新 ${data.updated}` + (data.wiped ? `，已清空 ${data.wiped}` : '')); setTimeout(() => location.reload(), 900); },
            error: function(xhr) { showToast((xhr.responseJSON && xhr.responseJSON.message) || '导入失败'); }
        });
    }
    const bmExcluded = new Set();   // 预览里被取消勾选的 bmItems 下标
    // 导入方式(2026-11-24):合并 = 保留现有、同网址 upsert;覆盖 = 先清空现有站点再导入。
    // 只作用于 NavSite;分类显隐/排序与工具不动。
    let bmMode = 'merge';
    let bmWipeOK = false;   // 覆盖模式已确认过清库(同一次弹窗只问一次)
    $('#bmModeGroup').on('click', '[data-bm-mode]', function () {
        bmMode = String($(this).attr('data-bm-mode')) === 'replace' ? 'replace' : 'merge';
        bmWipeOK = false;
        $('#bmModeGroup [data-bm-mode]').removeClass('btn-secondary').addClass('btn-outline-secondary');
        $(this).removeClass('btn-outline-secondary').addClass('btn-secondary');
        $('#bmReplaceWarn').toggleClass('d-none', bmMode !== 'replace');
    });

    // ===== 浏览器书签导入:前端解析 Netscape HTML → 预览 → 复用 nav_import 端点 =====
    const BM_BATCH = 200;   // 前端分批大小:每批 POST 到 nav_import;大书签集(实测 Firefox 2154 条)逐批全量入库,不再有单次上限
    // 导入时抓 meta description(2026-11-12,可选):每条都真去访问对方首页,单条最坏 8s 超时。
    // 并发只给 2 —— 服务端是同步 WSGI,4 条并发就可能把 worker 占满,入库批次跟着排队。
    const BM_META_CONCURRENCY = 2;
    const BM_META_BUDGET_MS = 4 * 60 * 1000;
    const BM_FALLBACK_DESC = '书签分类:';   // 与后端 NAV_FALLBACK_DESC_PREFIX 同义
    let bmMetaAbort = false;   // 抓简介阶段被取消
    let bmAbortAll = false;    // 整个导入被取消(关掉预览框)
    let bmItems = [];          // 当前预览里的可导入条目(新增+已存在);合并模式下含 children
    let bmRaw = [];            // 解析出的原始条目,切换「合并/分别导入」时据此重算
    let bmKnown = {};          // 规范网址 → 库里已有记录 {id,name,d}
    let bmMergeOn = true;      // 同域名合并为一个站点(其余作为子网页)
    let bmDescEls = {};        // 预览行里显示简介的节点,抓取完原地刷新
    let bmMetaHits = 0;
    // 网址归一化(与后端 _normalize_nav_url 同效果):去空白、小写、补 https://、去结尾斜杠
    function navBmNormalize(u) {
        u = String(u || '').trim().toLowerCase();
        if (!u) return '';
        if (!/^https?:\/\//.test(u)) u = 'https://' + u;
        return u.replace(/\/+$/, '');
    }
    function navBmReadFile(file) {
        const reader = new FileReader();
        reader.onload = () => navBmOpen(String(reader.result || ''));
        reader.readAsText(file);
    }
    // 解析收藏夹 HTML:根 DL → 递归 DT;H3=文件夹(1层=大类,2层=小分类,3层+拼 ' / '),A=书签
    // 「书签栏」这类容器层(PERSONAL_TOOLBAR_FOLDER="true")不占层级:其子文件夹直接当大类,
    // 与"书签栏里的文件夹=大类"的历史行为一致,同时不再丢「其他书签/移动书签」里的内容
    function bmIsToolbarFolder(h3) {
        return String(h3.getAttribute('personal_toolbar_folder') || '').toLowerCase() === 'true';
    }
    // 子 DL 定位:标准导出里 <DL> 会被 HTML 解析器嵌进 <DT> 内部;个别来源写成紧随的兄弟 DL,一并容错
    function bmChildDl(node) {
        const inner = node.querySelector(':scope > dl');
        if (inner) return inner;
        const nx = node.nextElementSibling;
        return (nx && nx.nodeName === 'DL') ? nx : null;
    }
    function bmParse(text) {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        // 固定取根 DL。旧写法是 /PERSONAL_TOOLBAR_FOLDER/ 命中就去猜 'body dl dl'(找书签栏),
        // 但 Firefox 导出里第一个嵌套 DL 是内置的「Mozilla Firefox」文件夹(仅 4 条),
        // 整份 2154 条只解析出 4 条(2026-10-16 用真实样本实测);改成根 DL + 容器层透传后修复。
        const rootDl = doc.querySelector('body dl') || doc.querySelector('dl');
        if (!rootDl) return null;
        const out = [];
        const usedDl = new Set();   // 防重复遍历(兄弟 DL 容错与透传可能走到同一个 DL)
        function handleDt(node, category, subcat) {
            const h3 = node.querySelector(':scope > h3');
            const a = node.querySelector(':scope > a');
            if (h3) {
                const name = (h3.textContent || '').trim();
                const childDl = bmChildDl(node);
                if (childDl) usedDl.add(childDl);
                if (bmIsToolbarFolder(h3)) {              // 容器层:透传,不占层级
                    if (childDl) walkList(childDl.children, category, subcat);
                    return;
                }
                if (!category) { if (childDl) walkList(childDl.children, name, ''); return; }          // 第 1 层文件夹 → 大类
                if (!subcat) { if (childDl) walkList(childDl.children, category, name); return; }      // 第 2 层 → 小分类
                if (childDl) { walkList(childDl.children, category, subcat + ' / ' + name); return; }  // 第 3 层及更深 → 拼进小分类
                return;
            }
            if (a) {
                // Netscape 书签的 <DD> 就是描述;老实现只读 <A> 的标题,导入后 description 全是空
                let desc = '';
                const dd = node.nextElementSibling;
                const holder = (dd && dd.nodeName === 'DD') ? dd : node.querySelector(':scope > dd');
                if (holder && !holder.querySelector('dl')) {
                    desc = (holder.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
                }
                out.push({name: (a.textContent || '').trim(), url: a.getAttribute('href'),
                          description: desc || (subcat || category ? ('书签分类:' + (subcat || category)) : ''),
                          category: category || '未分类', subcat: subcat || ''});
            }
        }
        // 遍历一层子元素:DT 按层级规则处理;DD 与"作为兄弟出现的 DL"是**透明容器**,内容按当前层级继续。
        // ⚠️ 老版 Firefox 导出会用 <DT><H3/></DT><DD><DL>…</DL></DD> 这种裹一层的写法(README 里的 DT>DD>A),
        // 旧实现遇到非 DT 节点直接 return → 整棵子树丢失(实测 338 条),所以这里必须下钻。
        function walkList(children, category, subcat) {
            Array.prototype.forEach.call(children, function(node) {
                if (node.nodeName === 'DT') { handleDt(node, category, subcat); return; }
                if (node.nodeName === 'DD' || node.nodeName === 'DL') {
                    if (node.nodeName === 'DL') {
                        if (usedDl.has(node)) return;
                        usedDl.add(node);
                    }
                    walkList(node.children, category, subcat);
                }
            });
        }
        walkList(rootDl.children, '', '');
        return out;
    }
    // 同域名归并键:去掉 www. 后取可注册域(常见双段后缀单独列,不建完整 eTLD 表)
    const BM_MULTI_SUFFIX = ['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'co.uk', 'org.uk',
                             'ac.uk', 'co.jp', 'ne.jp', 'co.kr', 'com.hk', 'com.tw', 'com.au',
                             'com.br', 'com.mx', 'com.sg', 'com.tr', 'com.ru'];
    function bmHostKey(u) {
        let host = '';
        try { host = new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
        host = host.replace(/^www\./, '');
        const parts = host.split('.');
        if (parts.length <= 2) return host;
        const tail2 = parts.slice(-2).join('.');
        return BM_MULTI_SUFFIX.indexOf(tail2) >= 0 ? parts.slice(-3).join('.') : tail2;
    }
    // 真简介 vs「书签分类:」兜底占位
    function bmRealDesc(d) {
        d = String(d || '').trim();
        return !!d && d.indexOf(BM_FALLBACK_DESC) !== 0;
    }
    // 这条要不要抓:书签里没真简介,且库里也没有(库里已有就跳过 —— 再次导入只补缺)
    function bmNeedMeta(s) {
        if (bmRealDesc(s.description)) return false;
        const hit = bmKnown[s.url];
        return !(hit && hit.d);
    }
    // 进度条分两段:抓简介 0~50、入库 50~100,抓完不会突然倒回 0
    function bmBar(pct) {
        pct = Math.max(0, Math.min(100, Math.round(pct)));
        $('#bmProgressBar').css('width', pct + '%').attr('aria-valuenow', pct);
    }
    // 抓简介:写回 bmItems 的同一个对象;失败只计数不中断(导入照常进行)
    function bmFetchMetaAll(list) {
        const targets = list.filter(bmNeedMeta);
        return new Promise(function(resolve) {
            const stats = {total: targets.length, ok: 0, fail: 0, stop: 'done', left: 0};
            if (!targets.length) { resolve(stats); return; }
            const started = Date.now();
            let cursor = 0, active = 0, done = 0, closed = false;
            function report() {
                if (closed) return;   // 取消后别再刷新文案,否则会把「已取消」冲掉
                bmBar(done * 50 / targets.length);
                $('#bmSummary').text('抓取简介 ' + done + '/' + targets.length
                    + '(成功 ' + stats.ok + ' · 失败 ' + stats.fail + ')');
            }
            function close(stop) {   // 抓完/取消/超预算都走这里,只 resolve 一次
                if (closed) return;
                closed = true;
                stats.stop = stop;
                stats.left = Math.max(0, targets.length - done);
                resolve(stats);
            }
            function next() {
                if (closed) return;
                if (bmMetaAbort) { close('abort'); return; }
                if (Date.now() - started > BM_META_BUDGET_MS) { close('budget'); return; }   // 预算用完,剩下不抓
                if (cursor >= targets.length) { if (!active) close('done'); return; }
                const s = targets[cursor++];
                active++;
                $.ajax({
                    url: IE_URLS.fetchMeta, type: 'POST', contentType: 'application/json',
                    data: JSON.stringify({url: s.url}), timeout: 12000,
                    beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                    success: function(data) {
                        const d = String((data && data.description) || '').trim();
                        if (d) { s.description = d.slice(0, 200); stats.ok++; } else { stats.fail++; }
                        bmPaintDesc(s);
                    },
                    error: function() { stats.fail++; },
                    complete: function() { active--; done++; report(); next(); }
                });
                if (active < BM_META_CONCURRENCY) next();
            }
            report();
            next();
        });
    }
    // 预览行的简介栏原地刷新(抓取过程中逐条更新)
    function bmPaintDesc(s) {
        const el = bmDescEls[s._i];
        if (!el) return;
        const real = bmRealDesc(s.description);
        $(el).text(real ? s.description : '（无简介）').toggleClass('bm-desc-ok', real);
    }
    // 同域名分组的规模:只用来决定「要不要问用户合并」
    function bmGroupStats() {
        const seen = {}, count = {}, order = [];
        bmRaw.forEach(function(it) {
            const url = navBmNormalize(it.url);
            if (!url || seen[url]) return;
            seen[url] = 1;
            const key = bmHostKey(url) || url;
            if (!count[key]) { count[key] = 1; order.push(key); } else count[key] += 1;
        });
        let groups = 0, kids = 0;
        order.forEach(function(k) { if (count[k] > 1) { groups++; kids += count[k]; } });
        return {groups: groups, kids: kids};
    }
    // 原始解析结果 → 预览数据(切换合并/独立都走这里,不重新解析文件)
    function bmBuild() {
        const seen = {}, groups = {}, items = [], ops = [];
        let added = 0, exists = 0, skipped = 0, dup = 0, mergedRows = 0, mergedKids = 0;
        bmRaw.forEach(function(it) {
            const raw = String(it.url || '').trim();
            const url = navBmNormalize(raw);
            // 无 href,或有协议但不是 http(s)(javascript:/ftp:/chrome:// 等)→ 跳过
            if (!raw || (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) && !/^https?:\/\//i.test(raw))) {
                skipped++;
                ops.push({skip: {name: it.name, url: raw || '(无链接)', cat: it.category, sub: it.subcat,
                                 badge: '跳过', cls: 'text-bg-secondary'}});
                return;
            }
            if (seen[url]) { dup++; return; }   // 同一份文件里重复的网址只留第一条
            seen[url] = 1;
            const hit = bmKnown[url];
            const rec = {name: it.name, url: url, description: it.description || '',
                         category: it.category, subcat: it.subcat};
            if (bmMergeOn) {
                const key = bmHostKey(url);
                const g = key ? groups[key] : null;
                if (g) {   // 同域:并进第一张卡当子网页,分类/小分类沿用第一条
                    if (!g.children) { g.children = []; mergedRows++; }
                    g.children.push({name: rec.name, url: rec.url});
                    mergedKids++;
                    return;
                }
                if (key) groups[key] = rec;
            }
            if (hit) exists++; else added++;
            rec._i = items.length;
            items.push(rec);
            ops.push({item: rec._i});
        });
        const rows = ops.map(function(op) {
            if (op.skip) return op.skip;
            const rec = items[op.item];
            const hit = bmKnown[rec.url];
            const n = (rec.children || []).length;
            return {name: rec.name, url: rec.url, cat: rec.category, sub: rec.subcat, idx: op.item,
                    badge: (hit ? '已存在' : '新增') + (n ? ' +' + n + ' 子页' : ''),
                    cls: hit ? 'text-bg-warning' : 'text-bg-success'};
        });
        return {items: items, rows: rows, added: added, exists: exists, skipped: skipped,
                dup: dup, mergedRows: mergedRows, mergedKids: mergedKids};
    }
    // 把当前模式渲染进预览(勾选状态随之重建)
    function bmApply() {
        const res = bmBuild();
        bmItems = res.items;
        bmExcluded.clear();
        bmMetaHits = bmItems.filter(bmNeedMeta).length;
        $('#bmSummary').html('共解析 ' + bmRaw.length + ' 条:入库 ' + bmItems.length + ' 个站点(新增 '
            + res.added + ' · 已存在 ' + res.exists + ')'
            + (res.dup ? ' · 去掉重复 ' + res.dup : '')
            + (res.mergedKids ? ' · 合并子页 ' + res.mergedKids + ' 条' : '')
            + (res.skipped ? ' · 跳过 ' + res.skipped : '')
            + (bmItems.length > BM_BATCH ? ' · 分 ' + Math.ceil(bmItems.length / BM_BATCH) + ' 批导入' : '')
            + ' (已选 <b id="bmSelCount">' + bmItems.length + '</b>)');
        bmRenderRows(res.rows);
        $('#bmImportConfirm').prop('disabled', bmItems.length === 0);
        $('#bmMetaWrap').toggleClass('d-none', bmItems.length === 0);
        $('#bmFetchMeta').prop('checked', localStorage.getItem('navBmFetchMeta') === '1');
        $('#bmMetaCount').text(bmMetaHits ? '本次将抓取 ' + bmMetaHits + ' 条的简介。'
                                          : '这批站点都已有简介,不用再抓。');
        $('#bmProgressWrap').addClass('d-none');
        bmBar(0);
    }
    function bmPaintMergeButtons() {
        $('#bmMergeGroup .btn').each(function() {
            const on = String($(this).data('merge')) === (bmMergeOn ? '1' : '0');
            $(this).toggleClass('btn-primary', on).toggleClass('btn-outline-secondary', !on);
        });
    }
    // 解析 → 预览(同域名合并/独立两种模式都由 bmApply 渲染)
    function navBmOpen(text) {
        bmJsonFile = null;
        bmExcluded.clear();
        $('#bmModalTitle').html('<i class="fas fa-bookmark me-2 acc-ico"></i>导入浏览器书签 <small class="text-muted fw-normal fs-6">解析收藏夹 HTML,预览后入库</small>');
        const parsed = bmParse(text);
        if (!parsed) { showToast('没找到书签结构'); return; }
        bmRaw = parsed;
        bmKnown = {};
        Object.keys(siteMap || {}).forEach(function(k) { bmKnown[navBmNormalize(k)] = siteMap[k]; });
        // 有同域名分组才问「要不要合并」;选择记在本机,下次沿用
        const g = bmGroupStats();
        bmMergeOn = g.groups ? localStorage.getItem('navBmMerge') !== '0' : true;
        $('#bmMergeWrap').toggleClass('d-none', g.groups === 0);
        if (g.groups) {
            $('#bmMergeText').html('检测到 <b>' + g.groups + '</b> 组同域名书签(涉及 ' + g.kids + ' 条):');
            bmPaintMergeButtons();
        }
        bmApply();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('bookmarkModal')).show();
    }
    // 预览行渲染:可导入条目带勾选框(默认全选)+ 简介栏;跳过行不可勾
    function bmRenderRows(rows) {
        const $p = $('#bmPreview').empty();
        bmDescEls = {};
        rows.forEach(function(r) {
            const checkable = typeof r.idx === 'number';
            const $line = $('<div class="d-flex gap-2 align-items-baseline">');
            if (checkable) {
                $('<input type="checkbox" class="form-check-input mt-0 bm-check" style="flex:0 0 auto" checked>')
                    .attr('data-idx', r.idx).appendTo($line);
            }
            // 列宽固定比例/固定像素:各行列边界对齐,不会因名字长短把分类列顶得前后不一
            $('<span class="text-truncate" style="flex:0 0 22%" title="' + (r.name || '') + '">').text(r.name || '(无名)').appendTo($line);
            $('<span class="text-truncate text-muted" style="flex:1 1 auto;min-width:0">').text(r.url).appendTo($line);
            $('<span class="text-truncate text-muted" style="flex:0 0 96px">')
                .text((r.cat || '') + (r.sub ? ' / ' + r.sub : ''))
                .attr('title', (r.cat || '') + (r.sub ? ' / ' + r.sub : '')).appendTo($line);
            if (checkable) {
                const rec = bmItems[r.idx] || {};
                const real = bmRealDesc(rec.description);
                const $d = $('<span class="text-truncate text-muted bm-desc" style="flex:0 1 24%">')
                    .attr('data-idx', r.idx)
                    .text(real ? rec.description : '（无简介）')
                    .toggleClass('bm-desc-ok', real);
                bmDescEls[r.idx] = $d[0];
                $d.appendTo($line);
            }
            $('<span class="badge ' + r.cls + '" style="flex:0 0 auto">').text(r.badge).appendTo($line);
            $line.appendTo($p);
        });
        $p.show();
    }
    // 同域名合并 / 分别导入(用户的选择记在本机)
    $('#bmMergeGroup').on('click', '.btn', function() {
        bmMergeOn = String($(this).data('merge')) === '1';
        localStorage.setItem('navBmMerge', bmMergeOn ? '1' : '0');
        bmPaintMergeButtons();
        bmApply();
    });
    $('#bmPreview').on('change', '.bm-check', function() {
        const idx = parseInt(this.getAttribute('data-idx'), 10);
        if (this.checked) bmExcluded.delete(idx); else bmExcluded.add(idx);
        const sel = bmItems.length - bmExcluded.size;
        $('#bmSelCount').text(sel);
        $('#bmImportConfirm').prop('disabled', sel === 0);
    });
    $('#bmPickFile').on('click', function() { $('#bmFileInput').val('').trigger('click'); });
    $('#bmFileInput').on('change', function() {
        const file = this.files[0];
        this.value = '';
        if (file) navBmReadFile(file);
    });
    // 抓简介开关:选择记在本机(默认关),条数提示就在下面
    $('#bmFetchMeta').on('change', function() {
        localStorage.setItem('navBmFetchMeta', this.checked ? '1' : '0');
    });
    // 预览框被关掉(取消/×/Esc)= 放弃这次导入:抓简介的循环和入库批次都看这两个标记
    $('#bookmarkModal').on('hidden.bs.modal', function() { bmMetaAbort = true; bmAbortAll = true; });
    // 确认导入:分批提交(每批 BM_BATCH 条,payload 与 JSON 导出同构)。
    // 大书签集(实测 Firefox 导出 2154 条)不再被 500 条单次上限截断;逐批落库 + 进度条。
    // 单批失败不中断后续(导入是 upsert 幂等,重跑安全),最后汇总失败批数。
    $('#bmImportConfirm').on('click', function() {
        // 覆盖是破坏性且不可撤销的:先走站内确认遮罩(navConfirm),确认后再进原流程
        if (bmMode === 'replace' && !bmWipeOK) {
            if (!window.navConfirm) return;
            window.navConfirm({
                title: '覆盖导入会先清空站点',
                body: '当前全部站点(含内置与休眠)会被删除,只保留这次导入的内容;分类顺序与快捷工具不受影响。',
                confirmLabel: '清空并导入', danger: true
            }).then(function (ok) {
                if (!ok) return;
                bmWipeOK = true;
                $('#bmImportConfirm').trigger('click');
            });
            return;
        }
        if (bmJsonFile) {   // JSON 导入:原文件原样上传(勾选只过滤站点展示,工具随文件走)
            const f = bmJsonFile;
            bmJsonFile = null;
            _legacy_json_import(f, bmMode === 'replace');
            return;
        }
        const bmBatch = bmItems.filter(function(s, i) { return !bmExcluded.has(i); });   // ⚠️ 别叫 bmItems:const 与外层 let 同名会形成 TDZ,上一行就会 ReferenceError
        if (!bmBatch.length) return;
        const $btn = $(this).prop('disabled', true);
        const total = bmBatch.length, batches = Math.ceil(total / BM_BATCH);
        bmMetaAbort = false;
        bmAbortAll = false;
        $('#bmProgressWrap').removeClass('d-none');
        bmBar(0);
        let created = 0, updated = 0, failed = 0, done = 0, metaInfo = '';
        function tick() {
            bmBar(50 + done * 50 / total);   // 后半段才是入库
            $('#bmSummary').text('导入中 ' + done + '/' + total
                + '(新增 ' + created + ' · 更新 ' + updated + (failed ? ' · 失败 ' + failed + ' 批' : '') + ')');
        }
        function upload() {
            (function nextBatch(k) {
                if (bmAbortAll) {   // 用户关掉预览框:剩下的批次不再发
                    $('#bmSummary').text('已取消导入(已写入的批次保留)');
                    $btn.prop('disabled', false);
                    return;
                }
                if (k >= batches) {
                    bmBar(100);
                    showToast('导入完成:新增 ' + created + ',更新 ' + updated
                        + metaInfo + (failed ? ',失败 ' + failed + ' 批' : ''));
                    setTimeout(() => location.reload(), 1200);
                    return;
                }
                const chunk = bmBatch.slice(k * BM_BATCH, (k + 1) * BM_BATCH);
                const payload = {format: 'pinsflora-nav', version: 10,
                                 sites: chunk.map(function(s) {
                                     const o = {name: s.name, url: s.url, category: s.category,
                                                subcat: s.subcat, description: s.description || ''};
                                     if (s.children && s.children.length) o.children = s.children;
                                     return o;
                                 })};
                const blob = new Blob([JSON.stringify(payload)], {type: 'application/json'});
                const fd = new FormData();
                fd.append('nav_file', new File([blob], 'bookmarks.json', {type: 'application/json'}));
                // 覆盖模式只让第一批清库,否则每批都会把上一批删掉
                if (bmMode === 'replace' && k === 0) fd.append('wipe', '1');
                $.ajax({
                    url: IE_URLS.import, type: 'POST', data: fd,
                    processData: false, contentType: false,
                    beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                    success: function(data) {
                        created += (data.created || 0);
                        updated += (data.updated || 0);
                        done += chunk.length;
                        tick();
                        nextBatch(k + 1);
                    },
                    error: function() {
                        failed++;
                        done += chunk.length;
                        tick();
                        nextBatch(k + 1);
                    }
                });
            })(0);
        }
        // 抓简介是可选项:勾了就先抓(带进度),抓完/到预算/用户取消再入库;
        // 不勾直接入库 —— 大书签集导入保持原来的一次到底。
        if (!$('#bmFetchMeta').prop('checked')) { tick(); upload(); return; }
        $('#bmSummary').text('准备抓取网站简介...');
        bmFetchMetaAll(bmBatch).then(function(st) {
            if (st.stop === 'abort') {   // 用户中途关掉预览框:一条都不写库
                $('#bmSummary').text('已取消,未导入任何站点');
                $btn.prop('disabled', false);
                showToast('已取消,未导入任何站点');   // 弹窗已经关了,只能靠 toast 说话
                return;
            }
            if (st.stop === 'budget' && st.left > 0) {   // 到预算就收工:说清还剩多少没抓
                metaInfo = '(简介 ' + st.ok + '/' + st.total + ',还有 ' + st.left + ' 条未抓)';
                showToast('抓取超时:还剩 ' + st.left + ' 条没抓,先导入已抓到的');
            } else {
                metaInfo = st.total ? '(简介抓到 ' + st.ok + '/' + st.total + ')' : '';
            }
            tick();
            upload();
        });
    });

    // 恢复内置站点
    $('#navResetBtn').on('click', function() {
        $.ajax({
            url: IE_URLS.reset, type: 'POST', data: '{}',
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function(data) { showToast(`内置站点已补齐,共 ${data.total} 个`); setTimeout(() => location.reload(), 900); },
            error: () => showToast('操作失败')
        });
    });
});
