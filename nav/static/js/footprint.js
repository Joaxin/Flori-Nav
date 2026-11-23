/* 足迹热力图(2026-11-20 P1)
   ----------------------------------------------------------------------------
   纯本机功能:只记"哪天点开了哪个站",数据放 IndexedDB(navStore 的 navFootprintsV1),
   不上报、不进服务端、不跟随账号;换浏览器/清站点数据就归零。
   计数口径:真实卡片 click(含 Ctrl/中键新标签打开)—— 子页选择弹窗也只会算主站一次。
   面板里的热力图固定 12 周(周一为行首),格子深浅按当天打开次数分 5 档;
   下方是累计打开次数最多的站点。全部是只读展示,唯一写操作是"清空本机足迹"(需确认)。
*/
(function () {
    'use strict';

    var KEY = 'navFootprintsV1';
    var KEEP_DAYS = 180;     // 超过半年的日子直接裁掉,IDB 里不会无限长
    var MAX_SITES = 200;     // 单站清单上限,超出按最后访问时间淘汰
    var data = null;         // {v:1, days:{...}, sites:{...}, total, updated}
    var loading = null;
    var saveTimer = null;

    function todayStr(d) {
        d = d || new Date();
        var m = d.getMonth() + 1, day = d.getDate();
        return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }
    function dayKeyOf(url, name) { return url; }
    function emptyData() { return {v: 1, days: {}, sites: {}, total: 0, updated: 0}; }
    function normalize(raw) {
        var d = (raw && typeof raw === 'object') ? raw : emptyData();
        if (!d.days || typeof d.days !== 'object') d.days = {};
        if (!d.sites || typeof d.sites !== 'object') d.sites = {};
        d.v = 1;
        d.total = Number(d.total) || 0;
        d.updated = Number(d.updated) || 0;
        return d;
    }
    function lsRead() {
        try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
    }
    function storeGet() {
        if (window.navStore && window.navStore.get) {
            return window.navStore.get(KEY, null).then(function (v) {
                return normalize(v == null ? lsRead() : v);
            }).catch(function () { return normalize(lsRead()); });
        }
        return Promise.resolve(normalize(lsRead()));
    }
    function storeSet(val) {
        if (window.navStore && window.navStore.set) return window.navStore.set(KEY, val);
        try { localStorage.setItem(KEY, JSON.stringify(val)); return Promise.resolve(true); }
        catch (e) { return Promise.resolve(false); }
    }
    function load() {
        if (!loading) loading = storeGet().then(function (d) { data = d; return d; });
        return loading;
    }
    function prune(d) {
        var limit = new Date();
        limit.setDate(limit.getDate() - KEEP_DAYS);
        var limitStr = todayStr(limit);
        Object.keys(d.days).forEach(function (k) { if (k < limitStr) delete d.days[k]; });
        var urls = Object.keys(d.sites);
        if (urls.length > MAX_SITES) {
            urls.sort(function (a, b) { return (d.sites[a].last || 0) - (d.sites[b].last || 0); });
            urls.slice(0, urls.length - MAX_SITES).forEach(function (u) { delete d.sites[u]; });
        }
    }
    function persist() {
        if (!data) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            data.updated = Date.now();
            prune(data);
            storeSet(data);
        }, 900);
    }

    // 记一次打开:成功/失败都不影响点站本身,所有异常就地吞掉
    function record(url, name) {
        url = String(url || '').trim();
        if (!url) return;
        Promise.resolve(load()).then(function (d) {
            var day = todayStr();
            var bucket = d.days[day] || (d.days[day] = {});
            bucket[dayKeyOf(url, name)] = (Number(bucket[dayKeyOf(url, name)]) || 0) + 1;
            var site = d.sites[url] || (d.sites[url] = {name: '', n: 0, last: 0});
            site.name = String(name || site.name || url).slice(0, 80);
            site.n = (Number(site.n) || 0) + 1;
            site.last = Date.now();
            d.total = (Number(d.total) || 0) + 1;
            persist();
        }).catch(function () { /* 本机存储坏了不影响上网 */ });
    }

    // ---------- 统计 ----------
    function stats() {
        var d = data || emptyData();
        var days = Object.keys(d.days).filter(function (k) {
            var sum = 0;
            Object.keys(d.days[k] || {}).forEach(function (u) { sum += Number(d.days[k][u]) || 0; });
            return sum > 0;
        });
        var active = days.length;
        // 连续天数:从今天往回数,断一天就停(今天还没开站就从昨天起算,避免早上打开面板显示 0)
        var streak = 0;
        var probe = new Date();
        if (!days.length) return {total: 0, active: 0, streak: 0, sites: 0};
        if (days.indexOf(todayStr(probe)) < 0) probe.setDate(probe.getDate() - 1);
        while (days.indexOf(todayStr(probe)) >= 0) { streak++; probe.setDate(probe.getDate() - 1); }
        return {total: Number(d.total) || 0, active: active, streak: streak,
                sites: Object.keys(d.sites).length};
    }
    function topSites(n) {
        var d = data || emptyData();
        return Object.keys(d.sites).map(function (url) {
            var s = d.sites[url] || {};
            return {url: url, name: s.name || url, n: Number(s.n) || 0};
        }).sort(function (a, b) { return b.n - a.n; }).slice(0, n || 8);
    }

    // ---------- 面板 ----------
    var panel = null, listBox = null, statsBox = null, topBox = null;

    function levelOf(count) {
        if (!count) return 0;
        if (count <= 1) return 1;
        if (count <= 3) return 2;
        if (count <= 7) return 3;
        return 4;
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
        });
    }
    function render() {
        if (!panel) return;
        var st = stats();
        statsBox.innerHTML =
            '<span><b>' + st.total + '</b> 次打开</span>' +
            '<span><b>' + st.active + '</b> 天有记录</span>' +
            '<span><b>' + st.streak + '</b> 天连续</span>' +
            '<span><b>' + st.sites + '</b> 个站</span>';

        // 12 周 × 7 天,周一为每列第一格;末尾对齐到今天所在的周
        var today = new Date();
        var mondayOffset = (today.getDay() + 6) % 7;        // 0=周一
        var lastMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset);
        var start = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() - 11 * 7);
        var cells = [];
        for (var i = 0; i < 84; i++) {
            var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            var key = todayStr(d);
            var count = 0;
            if (data && data.days[key]) {
                Object.keys(data.days[key]).forEach(function (u) { count += Number(data.days[key][u]) || 0; });
            }
            var future = d > today;
            cells.push({date: key, md: (d.getMonth() + 1) + '-' + d.getDate(), count: count,
                        future: future, level: future ? -1 : levelOf(count)});
        }
        listBox.innerHTML = cells.map(function (c) {
            var cls = c.future ? 'nav-foot__cell is-future' : 'nav-foot__cell l' + c.level;
            var tip = c.date + ' · ' + (c.future ? '还没到' : (c.count ? c.count + ' 次' : '没打开'));
            return '<span class="' + cls + '" title="' + esc(tip) + '" data-date="' + c.date + '"></span>';
        }).join('');
        listBox.setAttribute('data-days', String(cells.length));

        var top = topSites(8);
        if (!top.length) {
            topBox.innerHTML = '<div class="nav-foot__empty">还没有记录:点开任意站点卡片就会开始记。</div>';
        } else {
            var max = top[0].n || 1;
            topBox.innerHTML = top.map(function (s) {
                var pct = Math.max(4, Math.round((s.n / max) * 100));
                return '<div class="nav-foot__site"><span class="nav-foot__sname" title="' + esc(s.name) + '">' +
                    esc(s.name) + '</span><span class="nav-foot__bar"><i style="width:' + pct + '%"></i></span>' +
                    '<span class="nav-foot__sn">' + s.n + '</span></div>';
        }).join('');
        }
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.id = 'navFootPanel';
        panel.className = 'nav-foot';
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML =
            '<div class="nav-foot__backdrop" data-foot-close></div>' +
            '<div class="nav-foot__box" role="dialog" aria-modal="true" aria-label="足迹热力图">' +
            '  <div class="nav-foot__head"><i class="fas fa-fire"></i><b>足迹热力图</b>' +
            '    <span class="nav-foot__tag">仅本机</span>' +
            '    <button type="button" class="btn-close ms-auto" aria-label="关闭" data-foot-close></button></div>' +
            '  <div class="nav-foot__stats" id="navFootStats"></div>' +
            '  <div class="nav-foot__heat" id="navFootHeat" aria-label="最近 12 周每日打开次数"></div>' +
            '  <div class="nav-foot__legend"><span>少</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>多</span></div>' +
            '  <div class="nav-foot__sub">最常打开的站</div>' +
            '  <div class="nav-foot__top" id="navFootTop"></div>' +
            '  <div class="nav-foot__foot"><span>记录只存在这台浏览器,换设备/清缓存即归零。</span>' +
            '    <button type="button" class="btn btn-sm btn-link text-danger p-0 ms-auto" id="navFootClear">清空本机足迹</button></div>' +
            '</div>';
        document.body.appendChild(panel);
        statsBox = panel.querySelector('#navFootStats');
        listBox = panel.querySelector('#navFootHeat');
        topBox = panel.querySelector('#navFootTop');

        panel.addEventListener('click', function (e) {
            if (e.target.closest('[data-foot-close]')) { closePanel(); return; }
            if (e.target.closest('#navFootClear')) clearAll();
        });
        document.addEventListener('keydown', function (e) {
            if (!panel.classList.contains('show')) return;
            if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); closePanel(); }
        });
    }

    function openPanel() {
        if (!panel) buildPanel();
        panel.classList.add('show');
        panel.setAttribute('aria-hidden', 'false');
        document.body.classList.add('nav-foot-open');
        load().then(render);
    }
    function closePanel() {
        if (!panel) return;
        panel.classList.remove('show');
        panel.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('nav-foot-open');
    }
    function clearAll() {
        var done = function () {
            clearTimeout(saveTimer);   // 清空前还没落盘的写入不能再把旧数据写回去
            data = emptyData();
            storeSet(data);
            loading = Promise.resolve(data);
            render();
            if (window.navToast) window.navToast('本机足迹已清空');
        };
        if (window.navConfirm) {
            window.navConfirm({title: '清空本机足迹', body: '只删这台浏览器里的打开记录,不影响站点与书签。',
                               confirmLabel: '清空', danger: true}).then(function (ok) { if (ok) done(); });
        } else {
            done();
        }
    }

    // ---------- 采集:真实卡片 click(捕获阶段,子页弹窗也照记) ----------
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        var a = e.target.closest('[data-site-item] a.site-card');
        if (!a) return;
        var item = a.closest('[data-site-item]');
        record(item.getAttribute('data-url') || a.getAttribute('href'),
               item.getAttribute('data-name') || (a.textContent || '').trim());
    }, true);

    // 入口:导出菜单 / 更多菜单里的「足迹热力图」(两套菜单可能同时渲染,用 data 属性委托)
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-nav-foot]')) openPanel();
    });

    // 打开面板时把计数先读出来(异步 IDB);提示别的模块可以随时调用
    window.navFootprint = {record: record, openPanel: openPanel, closePanel: closePanel,
                           clear: clearAll, _load: load, _data: function () { return data; }};
})();
