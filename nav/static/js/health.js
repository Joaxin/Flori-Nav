/* 死链篮(叼走死链)+ 保养总览 + 点击热力——2026-10-25 brainstorm 落地,同 pet.js 拆分模式。
   边界约定见 pet.js 文件头:宿主共享工具经 window 取用;
   - 死链来源:linktest.js 每轮体检结束调 window.navBasketFromResults(挂掉的 [{url,error}]);
     篮子存本机 localStorage(navDeadBasket),修/删复用既有 nav_edit(卡片编辑弹窗)与 nav_delete/nav_restore;
   - 保养总览(2026-10-30 由「健康总览」升级):体检 + 使用两轴,纯前端扫卡片 data-check-at/data-clicks/
     data-created,不新增后端;分档逻辑抽成纯函数 navMaintenanceBuckets 便于单独验证;
   - 休眠(2026-10-30):"删之前先收起来"。保养行末 💤 → POST api/nav/archive {id, on},
     状态落服务端 NavSite.archived_at(随导出 v10 一起走,换机不复活);休眠站不进分类但仍在库里,
     抽屉「🩺 保养」下方「休眠中」列表可唤醒(唤醒需刷新,卡片是服务端渲染回分类的);
   - 点击热力:卡片 data-clicks 越大背景越"暖"(color-mix 主题色),零新增控件;
   URL 走模板渲染的配置岛 #navHealthUrls(静态文件里禁模板标签)。
   对外暴露:window.navBasketFromResults / navBasketOpen / navBasketRefreshBadge /
   navApplyClickHeat / navMaintenanceBuckets。*/
jQuery(function ($) {
    'use strict';
    const csrf = window.navCsrf, showToast = window.navToast;
    const HEALTH_URLS = JSON.parse(document.getElementById('navHealthUrls').textContent);
    const LT_CHECK_URL = JSON.parse(document.getElementById('navLtUrls').textContent).check;   // 复用测活端点试备用
    const BASKET_KEY = 'navDeadBasket';
    const BASKET_MAX = 80;
    const STALE_DAYS = 30;

    function basketGet() {
        try { const v = JSON.parse(localStorage.getItem(BASKET_KEY)); return Array.isArray(v) ? v : []; }
        catch (e) { return []; }
    }
    function basketSet(list) { localStorage.setItem(BASKET_KEY, JSON.stringify(list.slice(0, BASKET_MAX))); }

    function navBasketRefreshBadge() {
        const n = basketGet().length;
        const badge = document.getElementById('navBasketCount');
        if (badge) { badge.textContent = n > 99 ? '99+' : n; badge.classList.toggle('d-none', n === 0); }
        const mi = document.getElementById('navPetBasketItem');
        if (mi) mi.textContent = n ? '死链篮(' + n + ')' : '死链篮(空)';
        return n;
    }

    // linktest.js 每轮体检完成时回调:叼走这批打不开的
    window.navBasketFromResults = function (deadList) {
        if (!deadList || !deadList.length) return 0;
        const list = basketGet();
        const known = {};
        list.forEach(function (it) { known[it.url] = 1; });
        let added = 0;
        deadList.forEach(function (d) {
            if (known[d.url]) return;
            known[d.url] = 1;
            const info = (window.siteMap || {})[d.url] || {};
            list.unshift({url: d.url, name: info.name || d.url, error: String(d.error || '').slice(0, 120), ts: Date.now()});
            added++;
        });
        basketSet(list);
        navBasketRefreshBadge();
        if (added && window.navPetState) {
            window.navPetState('fail');
            window.navPetSay('我把 ' + added + ' 个打不开的叼回篮子了,记得处理~', 4200);
        }
        return added;
    };

    function esc(s) {
        return $('<div>').text(s == null ? '' : String(s)).html().replace(/"/g, '&quot;');
    }

    /* 后端异常类名 → 人话(2026-11-14)。
       原来每行直接甩 ProxyError / ConnectionError,满屏黑字还看不懂;
       原文放进 Tooltip,标签只给"代理连接失败"这类结论。 */
    const ERR_LABELS = [
        [/ProxyError/i, '代理连接失败'],
        [/SSLError|CERTIFICATE_VERIFY/i, 'SSL 异常'],
        [/Timeout/i, '连接超时'],
        [/NameResolution|DNS|getaddrinfo/i, '域名解析失败'],
        [/ConnectionError|ConnectionReset|NewConnection/i, '无法访问'],
        [/HTTPError|status code/i, '页面异常'],
    ];
    function basketErrLabel(raw) {
        const s = String(raw || '');
        if (!s) return '';
        for (let i = 0; i < ERR_LABELS.length; i++) {
            if (ERR_LABELS[i][0].test(s)) return ERR_LABELS[i][1];
        }
        return '检测失败';
    }
    function basketHost(url) {
        return String(url || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    }

    function renderBasket() {
        const list = basketGet();
        const $box = $('#navBasketList').empty();
        if (!list.length) {
            $box.html('<div class="small text-muted p-2">篮子是空的。体检发现打不开的站会自动被小鲸鱼叼到这里。</div>');
            return;
        }

        // 顶部快捷操作:代理没通时一整片都是 ProxyError,逐条点"忽略"要点几十次
        const counts = {};
        list.forEach(function (it) {
            const label = basketErrLabel(it.error);
            if (label) counts[label] = (counts[label] || 0) + 1;
        });
        const $bar = $('<div class="bsk-bar">');
        $('<button type="button" class="bsk-act">').text('重测全部')
            .attr({ 'data-bsk': 'recheck', 'data-tip': '重新测活篮子里的 ' + list.length + ' 个地址\n通了的会自动移出篮子' })
            .appendTo($bar);
        Object.keys(counts).forEach(function (label) {
            $('<button type="button" class="bsk-act">')
                .text('一键忽略 ' + label + ' (' + counts[label] + ')')
                .attr({ 'data-bsk': 'ignore', 'data-label': label, 'data-tip': '把这一类的 ' + counts[label] + ' 条从篮子里移除,不动站点' })
                .appendTo($bar);
        });
        $bar.appendTo($box);

        list.forEach(function (it, idx) {
            const $row = $('<div class="basket-row">');
            const name = (it.name && it.name !== it.url) ? it.name : it.url;

            // 第一行:站点名(左) + 幽灵操作(右)
            const $head = $('<div class="bsk-head">');
            $('<b class="bsk-name">').text(name).attr('title', name + '\n' + it.url).appendTo($head);
            const $ops = $('<span class="bsk-ops">');
            $('<button type="button" class="bsk-act">').text('修改')
                .attr({ 'data-tip': '打开这张卡片的编辑弹窗,改完保存即可', 'aria-label': '修改地址' })
                .on('click', function () { basketFix(it); }).appendTo($ops);
            if ((window.siteMap || {})[it.url] && (window.siteMap || {})[it.url].id) {
                $('<button type="button" class="bsk-act bsk-alt">').text('试备用')
                    .attr({ 'data-tip': '自动试这张卡的备用地址,通了可一键设为主站', 'aria-label': '试备用地址' })
                    .on('click', function () { basketTryAlts(it, $ops); }).appendTo($ops);
            }
            $('<button type="button" class="bsk-act">').text('忽略')
                .attr({ 'data-tip': '只是从篮子里拿掉,不动站点', 'aria-label': '忽略' })
                .on('click', function () { basketIgnore(idx); }).appendTo($ops);
            $('<button type="button" class="bsk-act bsk-del">')
                .html('<i class="fas fa-trash-can" aria-hidden="true"></i>')
                .attr({ 'data-tip': '删除这个站点(可在提示条里撤销)', 'aria-label': '删除站点' })
                .on('click', function () { basketDelete(it, idx); }).appendTo($ops);
            $ops.appendTo($head);
            $head.appendTo($row);

            // 第二行:浅灰域名 + 柔和错误标签(原文在 Tooltip)
            const $sub = $('<div class="bsk-sub">');
            $('<span class="bsk-host">').text(basketHost(it.url)).appendTo($sub);
            const label = basketErrLabel(it.error);
            if (label) {
                $('<span class="bsk-tag">').text(label)
                    .attr('data-tip', label + '\n' + it.error)
                    .appendTo($sub);
            }
            $sub.appendTo($row);
            $row.appendTo($box);
        });
    }

    // 重测全部:通的移出篮子,没通的更新错误信息
    function basketRecheckAll() {
        const list = basketGet();
        if (!list.length) return;
        $('#navBasketList .bsk-act').prop('disabled', true);
        $.ajax({
            url: LT_CHECK_URL, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({ urls: list.map(i => i.url), timeout: 8, total_timeout: 45 }),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function (res) {
                const byUrl = {};
                (res.results || []).forEach(r => { byUrl[r.url] = r; });
                const keep = [];
                let alive = 0;
                list.forEach(function (it) {
                    const r = byUrl[it.url];
                    if (r && r.ok && !r.skipped) { alive += 1; return; }
                    if (r && r.error) it.error = r.error;
                    keep.push(it);
                });
                basketSet(keep);
                navBasketRefreshBadge();
                renderBasket();
                showToast(alive ? (alive + ' 个已恢复,移出篮子') : '还是没有通的,内容保持原样');
            },
            error: function () {
                $('#navBasketList .bsk-act').prop('disabled', false);
                showToast('重测失败,稍后再试');
            }
        });
    }

    function basketIgnoreByLabel(label) {
        const before = basketGet();
        const keep = before.filter(it => basketErrLabel(it.error) !== label);
        basketSet(keep);
        navBasketRefreshBadge();
        renderBasket();
        showToast('已忽略 ' + (before.length - keep.length) + ' 条「' + label + '」');
    }

    $('#navBasketList').on('click', '[data-bsk]', function () {
        const act = $(this).attr('data-bsk');
        if (act === 'recheck') basketRecheckAll();
        else if (act === 'ignore') basketIgnoreByLabel($(this).attr('data-label'));
    });

    function basketFindCard(url) {
        let card = null;
        $('.nav-hub [data-site-item][data-url]').each(function () {
            if (String(this.getAttribute('data-url')) === url) { card = this; return false; }
        });
        return card;
    }

    function basketFix(it) {
        const card = basketFindCard(it.url);
        const $edit = card ? $(card).find('.site-edit') : $();
        if (!$edit.length) { showToast('页面上没找到这张卡片(可能已改名),去分类里找找吧'); return; }
        $edit.trigger('click');   // 复用既有编辑弹窗(数据都在按钮 data 属性上)
        window.navBasketClose && window.navBasketClose();
    }

    function basketDelete(it, idx) {
        const info = (window.siteMap || {})[it.url] || {};
        if (!info.id) { showToast('没找到这条站点的 id,先去页面确认一下吧'); return; }
        $.ajax({
            url: HEALTH_URLS.delete, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({id: info.id}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function (data) {
                const deletedRow = data.site;   // nav_delete 返回整行,撤销时原样还给它
                const list = basketGet();
                list.splice(idx, 1);
                basketSet(list);
                navBasketRefreshBadge();
                renderBasket();
                const card = basketFindCard(it.url);
                if (card) card.remove();
                showToast('已删除「' + (it.name || it.url) + '」', {
                    label: '撤销',
                    fn: function () {
                        $.ajax({
                            url: HEALTH_URLS.restore, type: 'POST', contentType: 'application/json',
                            data: JSON.stringify({site: deletedRow}),
                            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                            success: function () { showToast('已恢复,刷新看看'); setTimeout(() => location.reload(), 800); },
                            error: () => showToast('恢复失败:该网址可能已重新添加')
                        });
                    }
                });
            },
            error: function (xhr) { showToast((xhr.responseJSON && xhr.responseJSON.message) || '删除失败'); }
        });
    }

    function basketIgnore(idx) {
        const list = basketGet();
        list.splice(idx, 1);
        basketSet(list);
        navBasketRefreshBadge();
        renderBasket();
    }

    // 试备用(2026-07 点单落地):查该站 alternates → 批量测活 → 通的给「设为主站」
    // 注意:$ops 在 renderBasket 重建后会失效,所以结果直接渲染进相邻的结果容器,不依赖 $ops 存活
    function basketTryAlts(it, $ops) {
        const info = (window.siteMap || {})[it.url] || {};
        if (!info.id) return;
        const $btn = $ops.find('.bsk-alt').prop('disabled', true).text('试备用中…');
        fetch(HEALTH_URLS.swap + '?id=' + info.id).then(r => r.json()).then(function (d) {
            const alts = (d.alternates || []).filter(a => a.url && a.url !== it.url);
            if (!alts.length) {
                showToast('这条没登记备用地址,只能修或删');
                $btn.prop('disabled', false).text('试备用');
                return;
            }
            $.ajax({
                url: LT_CHECK_URL, type: 'POST', contentType: 'application/json',
                data: JSON.stringify({urls: alts.map(a => a.url), timeout: 8, total_timeout: 30}),
                beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                success: function (res) {
                    const okUrls = {};
                    (res.results || []).forEach(r => { if (r.ok && !r.skipped) okUrls[r.url] = (r.status || 200); });
                    basketRenderAltResult(it, alts, okUrls);
                    const alive = Object.keys(okUrls).length;
                    if (alive && window.navPetState) {
                        window.navPetState('happy');
                        window.navPetSay(alive + ' 个备用还活着,挑一个设为主站吧!', 3600);
                    } else if (window.navPetState) {
                        window.navPetState('fail');
                        window.navPetSay('备用的也全挂了…只能修或删了', 3200);
                    }
                },
                error: function () {
                    showToast('备用地址检测失败');
                    $btn.prop('disabled', false).text('试备用');
                }
            });
        }).catch(function () {
            showToast('读取备用列表失败');
            $btn.prop('disabled', false).text('试备用');
        });
    }
    function basketRenderAltResult(it, alts, okUrls) {
        // 找到该篮条目所在行,把结果挂在行下方(重建列表后行会刷新,结果自然消失)
        const $rows = $('#navBasketList .basket-row');
        $rows.each(function () {
            if (!$(this).find('.basket-alt-result').length && $(this).text().indexOf(it.url) !== -1) {
                const $res = $('<div class="basket-alt-result mt-1 w-100">');
                alts.forEach(function (a) {
                    const ok = okUrls[a.url];
                    const $line = $('<div class="d-flex align-items-center gap-2 py-1">');
                    $('<span class="small text-truncate" style="flex:1 1 auto">').text(a.url)
                        .attr('title', a.url).appendTo($line);
                    if (ok) {
                        $('<span class="badge text-bg-success" style="flex:0 0 auto">').text('通 ' + ok).appendTo($line);
                        $('<button class="btn btn-sm btn-success py-0 px-2" style="flex:0 0 auto">').text('设为主站')
                            .on('click', function () { basketSwap(it, a.url); }).appendTo($line);
                    } else {
                        $('<span class="badge text-bg-secondary" style="flex:0 0 auto">').text('不通').appendTo($line);
                    }
                    $line.appendTo($res);
                });
                $res.appendTo($(this));
            }
        });
    }
    function basketSwap(it, newUrl) {
        const info = (window.siteMap || {})[it.url] || {};
        $.ajax({
            url: HEALTH_URLS.swap, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({id: info.id, new_url: newUrl}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function (d) {
                const list = basketGet().filter(x => x.url !== it.url);   // 死链已修,出篮
                basketSet(list);
                navBasketRefreshBadge();
                if (window.navPetState) {
                    window.navPetState('happy');
                    window.navPetSay('主站已换成「' + newUrl + '」,这条出篮了!', 3600);
                }
                showToast('主站已换成 ' + newUrl + ',刷新生效');
                setTimeout(() => location.reload(), 900);
            },
            error: function (xhr) { showToast((xhr.responseJSON && xhr.responseJSON.message) || '换主站失败'); }
        });
    }

    window.navBasketClose = function () {
        const el = document.getElementById('navBasketDrawer');
        if (el && window.bootstrap && bootstrap.Offcanvas) {
            const inst = bootstrap.Offcanvas.getInstance(el);
            if (inst) inst.hide();
        }
    };

    // ===== 保养总览(2026-10-30,健康总览升级):体检 + 使用两轴,纯前端扫卡片,零后端 =====
    // 边界:最近打开时间只存在浏览器(localStorage navRecent 只留 40 条),掉出这 40 条的站
    // 无法判断"多久没打开",单列成「判断不了」;点击统计是后加的,很早以前点过的站也可能显示 0。
    // 这两处都如实写在分组提示里,不猜、不把不确定说成结论。
    const SLEEP_DAYS = 90;         // 超过这么久没打开 = 沉睡
    const NEW_DAYS = 30;           // 收录不足这么久且没点过 = 先留着,别急着清
    const CHECK_STALE_DAYS = STALE_DAYS;   // 体检超过 30 天(与死链篮同口径)

    // 纯函数:入参全是普通对象(不带 DOM),便于用 Node 探针单独验分档。
    // 坏站只进 broken 一档,不重复出现在使用档;其余每站恰好落一个使用档 + 一个体检档。
    function navMaintenanceBuckets(entries, opts) {
        opts = opts || {};
        const now = opts.now || (Date.now() / 1000);
        const recentTs = {};
        (opts.recents || []).forEach(function (x) {
            if (x && x.url) recentTs[x.url] = Number(x.ts) || 0;
        });
        const basket = opts.basket || {};
        const out = {broken: [], sleeping: [], neverOld: [], neverNew: [], unknown: [],
                     neverChecked: [], staleCheck: [], freshCheck: [], active: 0};
        (entries || []).forEach(function (e) {
            if (basket[e.url] || e.bad) { out.broken.push(e); return; }
            const last = (recentTs[e.url] || 0) / 1000;
            if (last) {
                if (now - last > SLEEP_DAYS * 86400) { e.lastOpened = last; out.sleeping.push(e); }
                else out.active++;
            } else if (e.clicks > 0) {
                out.unknown.push(e);
            } else if (e.created && now - e.created > NEW_DAYS * 86400) {
                out.neverOld.push(e);
            } else {
                out.neverNew.push(e);
            }
            if (!e.checkAt) out.neverChecked.push(e);
            else if (now - e.checkAt > CHECK_STALE_DAYS * 86400) out.staleCheck.push(e);
            else out.freshCheck.push(e);
        });
        out.sleeping.sort(function (a, b) { return a.lastOpened - b.lastOpened; });
        const byCreated = function (a, b) { return (a.created || 0) - (b.created || 0); };
        out.neverOld.sort(byCreated);
        out.unknown.sort(byCreated);
        out.neverNew.sort(byCreated);
        out.neverChecked.sort(byCreated);
        out.staleCheck.sort(function (a, b) { return (a.checkAt || 0) - (b.checkAt || 0); });
        return out;
    }
    window.navMaintenanceBuckets = navMaintenanceBuckets;

    function mpEntries() {
        const list = [];
        $('.nav-hub [data-site-item][data-url]').each(function () {
            list.push({
                id: parseInt(this.getAttribute('data-id'), 10) || 0,
                name: this.getAttribute('data-name') || this.getAttribute('data-url'),
                url: this.getAttribute('data-url'),
                cat: this.getAttribute('data-cat') || '',
                clicks: parseInt(this.getAttribute('data-clicks'), 10) || 0,
                created: parseFloat(this.getAttribute('data-created')) || 0,
                checkAt: parseFloat(this.getAttribute('data-check-at')) || 0,
                ms: parseFloat(this.getAttribute('data-check-ms')) || 0,
                bad: $(this).find('.site-check-bad').length > 0,
                el: this
            });
        });
        return list;
    }

    function mpDate(sec) {
        const d = new Date(sec * 1000);
        if (isNaN(d.getTime())) return '';
        const p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1);
    }

    function mpJump(en) {
        window.navBasketClose && window.navBasketClose();
        if (!en.el) { showToast('页面上没找到这张卡片'); return; }
        en.el.scrollIntoView({behavior: 'smooth', block: 'center'});
        en.el.classList.add('flash-target');
        setTimeout(function () { en.el.classList.remove('flash-target'); }, 2400);
    }

    function mpOpen(en) {
        if (!en.url) return;
        window.open(en.url, '_blank', 'noopener');
        if (window.navTouchRecent) window.navTouchRecent(en.url);   // 记进最近使用,下次就不算沉睡
    }

    function mpFix(en) {
        const $edit = en.el ? $(en.el).find('.site-edit') : $();
        if (!$edit.length) { showToast('没找到编辑按钮'); return; }
        window.navBasketClose && window.navBasketClose();
        $edit.trigger('click');   // 复用卡片编辑弹窗(数据都挂在按钮属性上)
    }

    function mpStarred(url) {
        const arr = (window.navLsGet ? window.navLsGet('navStars') : []) || [];
        return arr.indexOf(url) >= 0;
    }

    function mpStarBtn(en) {
        // 星标也换成图标按钮:实心/线框通过 fa-solid / fa-regular 切换(2026-11-14)
        const paint = function ($btn) {
            const on = mpStarred(en.url);
            $btn.html('<i class="' + (on ? 'fas' : 'far') + ' fa-star" aria-hidden="true"></i>')
                .attr({
                    title: on ? '取消星标' : '加星标',
                    'data-tip': on ? '取消星标' : '加星标\n置顶显示在常用区',
                    'aria-label': on ? '取消星标' : '加星标'
                });
        };
        const $btn = $('<button type="button" class="btn btn-sm btn-outline-secondary mp-star mp-op">');
        paint($btn);
        $btn.on('click', function (e) {
            e.stopPropagation();
            const $cardStar = $(en.el).find('.site-star');
            if ($cardStar.length) $cardStar.trigger('click');   // 走既有星标处理器,同步置顶区
            paint($btn);
        });
        return $btn;
    }

    function mpRow(en, kind) {
        const $row = $('<div class="basket-row mp-row">');
        const $main = $('<div class="mp-main">');
        $('<button type="button" class="mp-name">').text(en.name)
            .attr('title', en.url + '\n点击定位到卡片')
            .on('click', function () { mpJump(en); }).appendTo($main);
        const meta = [];
        if (en.cat) meta.push(en.cat);
        if (kind === 'sleep' && en.lastOpened) meta.push('上次打开 ' + mpDate(en.lastOpened));
        meta.push(en.clicks ? '点过 ' + en.clicks + ' 次' : '从没点过');
        if (en.created) meta.push('收录 ' + mpDate(en.created));
        $('<div class="mp-meta text-truncate">').text(meta.join(' · ')).appendTo($main);
        $main.appendTo($row);
        if (kind !== 'check') {
            const $ops = $('<div class="mp-ops">');
            // 统一成同尺寸的图标按钮(2026-11-14):原来「修」被压成一个字的小圆,
            // 「↗」「💤」是字符,三者大小/基线都不一致。
            if (kind === 'broken') {
                $('<button type="button" class="btn btn-sm btn-outline-primary mp-op">')
                    .html('<i class="fas fa-pen" aria-hidden="true"></i>')
                    .attr({ title: '改地址', 'data-tip': '改地址\n打开这张卡片的编辑弹窗改 URL', 'aria-label': '改地址' })
                    .on('click', function (e) { e.stopPropagation(); mpFix(en); }).appendTo($ops);
            } else {
                $('<button type="button" class="btn btn-sm btn-outline-secondary mp-op">')
                    .html('<i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>')
                    .attr({ title: '打开一次', 'data-tip': '打开一次\n会记入最近使用,下次就不算沉睡', 'aria-label': '打开一次' })
                    .on('click', function (e) { e.stopPropagation(); mpOpen(en); }).appendTo($ops);
                $ops.append(mpStarBtn(en));
            }
            // 休眠:删之前先收起来。只写 archived_at,数据一条不动,保养页下方可唤醒
            $('<button type="button" class="btn btn-sm btn-outline-secondary mp-arch mp-op">')
                .html('<i class="fas fa-moon" aria-hidden="true"></i>')
                .attr({
                    title: '先收起来(不是删除)',
                    'data-tip': '先收起来(不是删除)\n不再出现在分类里,名称/网址/子页/星标/体检记录全留着\n保养页下方「休眠中」可随时唤醒',
                    'aria-label': '先收起来'
                })
                .on('click', function (e) { e.stopPropagation(); mpArchive(en, $(this)); }).appendTo($ops);
            $ops.appendTo($row);
        }
        return $row;
    }

    /* 分组小图标(2026-11-14):原来靠 emoji 当图标,不同系统字形宽度不一,
       🩺 这类还是双码点组合,和标题挤在一起会叠字。改成 14px 线框 SVG,尺寸恒定。 */
    const MP_ICONS = {
        broken: '<path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6"/>',
        sleep: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
        never: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
        unknown: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5 14.5 14.5M14.5 9.5 9.5 14.5"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        stale: '<path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5"/><circle cx="12" cy="12" r="3"/>'
    };

    function mpIconSvg(kind) {
        const path = MP_ICONS[kind] || MP_ICONS.never;
        return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + path + '</svg>';
    }

    function mpSection($box, title, list, cls, tip, kind, limit) {
        if (!list.length) return;
        const $sec = $('<div class="mp-sec mb-3">');
        // 标题里的 emoji 不再当图标用,统一换成左边的 SVG
        const label = String(title).replace(/^\S+\s*/, '') + '(' + list.length + ')';
        $('<div class="mp-h small fw-bold ' + cls + '">')
            .html(mpIconSvg(kind))
            .append($('<span>').text(label))
            .appendTo($sec);
        if (tip) $('<div class="small text-muted mb-1">').text(tip).appendTo($sec);
        limit = limit || 15;
        const add = function (en) { $sec.append(mpRow(en, kind)); };
        list.slice(0, limit).forEach(add);
        if (list.length > limit) {
            $('<button type="button" class="btn btn-sm btn-outline-secondary w-100 mt-1">')
                .text('显示全部 ' + list.length + ' 条')
                .on('click', function () {
                    $(this).remove();
                    list.slice(limit).forEach(add);
                }).appendTo($sec);
        }
        $box.append($sec);
    }

    function renderHealth() {
        const entries = mpEntries();
        const recents = (window.navLsGet ? window.navLsGet('navRecent') : []) || [];
        const basketUrls = {};
        basketGet().forEach(function (it) { basketUrls[it.url] = 1; });
        const b = navMaintenanceBuckets(entries, {
            now: Date.now() / 1000, recents: recents, basket: basketUrls
        });
        const $box = $('#navHealthList').empty();
        // 健康比例条(2026-11-18):正常/响应慢/打不开/没体检 的占比一眼可读。
        // 口径与下方分组一致:bad=打不开;没体检=checkAt 为空;响应慢=体检过但 ms>1500
        // (与状态点 dot-warn 同阈值);正常=其余。颜色沿用 .site-dot 四色,内联样式免重编译
        if (entries.length) {
            let nBad = 0, nSlow = 0, nUnchecked = 0, nOk = 0;
            entries.forEach(function (e) {
                if (e.bad) nBad++;
                else if (!e.checkAt) nUnchecked++;
                else if (e.ms > 1500) nSlow++;
                else nOk++;
            });
            const pct = function (n) { return Math.round(n * 100 / entries.length) + '%'; };
            const $bar = $('<div class="d-flex rounded overflow-hidden mb-2" style="height:8px" role="img" aria-label="站点健康比例">');
            [
                { n: nOk, c: '#22c55e', t: '正常' },
                { n: nSlow, c: '#f59e0b', t: '响应慢(>1.5s)' },
                { n: nBad, c: '#ef4444', t: '打不开' },
                { n: nUnchecked, c: '#adb5bd', t: '没体检' },
            ].forEach(function (seg) {
                if (!seg.n) return;
                $('<div style="background:' + seg.c + '">').css('width', pct(seg.n))
                    .attr('title', seg.t + ' ' + seg.n + ' 站(' + pct(seg.n) + ')')
                    .appendTo($bar);
            });
            $bar.appendTo($box);
        }
        // 统计只列"非 0"的项:原来满屏都是 0,读起来像日志(2026-11-14)
        const chips = [entries.length + ' 站'];
        if (b.broken.length) chips.push('打不开 ' + b.broken.length);
        if (b.sleeping.length) chips.push(SLEEP_DAYS + ' 天没开 ' + b.sleeping.length);
        if (b.neverOld.length) chips.push('从没点过 ' + b.neverOld.length);
        if (b.unknown.length) chips.push('判断不了 ' + b.unknown.length);
        if (b.neverChecked.length) chips.push('没体检 ' + b.neverChecked.length);
        $('<div class="mp-sum small text-muted mb-1">').text(chips.join(' · ')).appendTo($box);
        // 说明只写行内真实存在的两个按钮(原来写的 ↗ / ☆ / 💤 在行内根本没有,越看越困惑)
        $('<div class="small text-muted mb-2">').text(
            '点名字定位到卡片;行末「修」改地址,「篮」先收起来(不是删)。'
        ).appendTo($box);
        mpSection($box, '🚨 打不开', b.broken, 'text-danger',
            '体检记录说它打不开;点「修」改地址,或去「死链篮」页签删除/试备用。', 'broken');
        mpSection($box, '💤 超过 ' + SLEEP_DAYS + ' 天没打开', b.sleeping, 'text-warning-emphasis',
            '上次打开时间来自浏览器本地记录(只留最近 40 条)。不想看见就点行末「篮」收起来,下方「休眠中」随时唤醒。', 'sleep');
        mpSection($box, '🫥 收录超 ' + NEW_DAYS + ' 天,从没记录到点击', b.neverOld, 'text-body',
            '点击统计是后来才加的,很早以前点过的站也可能落在这里;点一次「↗」就能把它移出去。', 'never');
        mpSection($box, '🕳 点过,但最近记录里已经没有它', b.unknown, 'text-secondary',
            '浏览器只留 40 条最近记录,掉出去的站没法判断多久没打开,只能算「不知道」。', 'unknown');
        mpSection($box, '🩺 从没体检', b.neverChecked, 'text-body',
            '点「链接测活 → 全部填入并检测」跑一轮,这里就会空。', 'check');
        mpSection($box, '🍂 体检超过 ' + CHECK_STALE_DAYS + ' 天', b.staleCheck, 'text-warning-emphasis',
            '体检结论在慢慢变旧;重跑一次测活会刷新。', 'check');
        const quiet = [];
        if (b.neverNew.length) quiet.push('🌱 新收录不到 ' + NEW_DAYS + ' 天、还没点过 ' + b.neverNew.length + ' 个(先留着)');
        if (b.active) quiet.push('✅ 近 ' + SLEEP_DAYS + ' 天打开过 ' + b.active + ' 个');
        if (b.freshCheck.length) quiet.push('🩺 近 ' + CHECK_STALE_DAYS + ' 天体检过 ' + b.freshCheck.length + ' 个');
        if (quiet.length) $('<div class="small text-muted mt-1">').text(quiet.join(' · ')).appendTo($box);
        if (!b.broken.length && !b.sleeping.length && !b.neverOld.length && !b.unknown.length &&
            !b.neverChecked.length && !b.staleCheck.length) {
            $('<div class="small text-success-emphasis mt-2">').text('✨ 没有要保养的站。').appendTo($box);
        }
        // 链接检测 / AI 提示词面板入口(2026-11-20):按钮点击由 link-ai.js 委托打开 #navAiLinkModal;
        // 这里只挂按钮,不触碰既有死链篮 / 体检 / URL 卫生逻辑。
        $('<button type="button" class="btn btn-sm btn-outline-primary mt-2" id="navHealthLinkEntry">')
            .html('<i class="fas fa-link me-1"></i>链接检测 / AI 提示词')
            .appendTo($box);
    }

    // ===== 休眠(2026-10-30 点单):"删之前先收起来"。状态落服务端 archived_at,换机带走 =====
    // 口径(与 views/api_nav_archive 一致):休眠站不进分类(nav_sites 已排除),但仍在库里、
    // 仍计入顶栏「共 N 个站点」;名称/网址/子页/备用/标签/星标/点击数/体检记录一律不碰。
    function archiveReq(id, on, done) {
        $.ajax({
            url: HEALTH_URLS.archive, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({id: id, on: on}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function (d) { done(null, d); },
            error: function (xhr) { done((xhr.responseJSON && xhr.responseJSON.message) || '操作失败'); }
        });
    }

    function archRows() { return $('#navArchiveList .arch-row'); }

    // 休眠列表自带小过滤:只影响显示,不动数据(与主搜索框互不相干——休眠站本来就不在主列表里)
    function archiveFilterApply() {
        const q = ($('#navArchiveQ').val() || '').toLowerCase().trim();
        archRows().each(function () {
            const hay = (this.getAttribute('data-arch-search') || '').toLowerCase();
            this.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
        });
    }

    function archiveCountPaint() {
        const n = archRows().length;
        $('#navArchiveTitle').text('休眠中(' + n + ')');
        if (n) $('#navArchiveList .arch-empty').remove();
        else if (!$('#navArchiveList .arch-empty').length) {
            $('#navArchiveList').append('<div class="small text-muted py-1 arch-empty">还没有休眠的站。在上方保养列表里点 💤 就能把不想看见的站先收起来,不用删。</div>');
        }
        archiveFilterApply();
    }

    function archiveAddRow(en) {
        const $row = $('<div class="basket-row mp-row arch-row">')
            .attr('data-arch-search', (en.name + ' ' + en.url + ' ' + (en.cat || '')).toLowerCase());
        const $main = $('<div class="mp-main">');
        $('<div class="small fw-bold text-truncate">').text(en.name).attr('title', en.url).appendTo($main);
        const meta = [];
        if (en.cat) meta.push(en.cat);
        meta.push('休眠于 今天');
        if (en.clicks) meta.push('点过 ' + en.clicks + ' 次');
        $('<div class="mp-meta text-truncate">').text(meta.join(' · ')).appendTo($main);
        $main.appendTo($row);
        const $ops = $('<div class="mp-ops">');
        $('<a class="btn btn-sm btn-outline-secondary">').attr({href: en.url, target: '_blank', rel: 'noopener noreferrer', title: '直接打开看看它还在不在'}).text('↗').appendTo($ops);
        $('<button type="button" class="btn btn-sm btn-outline-primary arch-wake">')
            .attr({'data-id': en.id, title: '取消休眠,放回原来的分类'}).text('唤醒').appendTo($ops);
        $ops.appendTo($row);
        $row.prependTo('#navArchiveList');
    }

    function mpArchive(en, $btn) {
        if (!en.id) { showToast('页面上没拿到这条的 id,刷新一下再试'); return; }
        $btn.prop('disabled', true);
        archiveReq(en.id, true, function (err) {
            if (err) { $btn.prop('disabled', false); showToast(err); return; }
            if (en.el) en.el.remove();            // 卡片当场收起,不等刷新
            $btn.closest('.basket-row').remove();
            archiveAddRow(en);
            archiveCountPaint();
            showToast('「' + en.name + '」已休眠,不再出现在分类里', {
                label: '撤销',
                fn: function () {
                    archiveReq(en.id, false, function (e2) {
                        if (e2) { showToast(e2); return; }
                        showToast('已唤醒,正在把它放回分类');
                        setTimeout(() => location.reload(), 700);
                    });
                }
            });
        });
    }

    // 唤醒要刷新:卡片是服务端渲染进分类的,不刷新它回不到原来的位置
    $(document).on('click', '.arch-wake', function () {
        const $btn = $(this);
        const id = parseInt($btn.attr('data-id'), 10);
        if (!id) return;
        $btn.prop('disabled', true);
        archiveReq(id, false, function (err) {
            if (err) { $btn.prop('disabled', false); showToast(err); return; }
            $btn.closest('.arch-row').remove();
            archiveCountPaint();
            showToast('已唤醒,刷新生效');
            setTimeout(() => location.reload(), 800);
        });
    });
    $(document).on('input', '#navArchiveQ', archiveFilterApply);

    window.navBasketOpen = function (tab) {
        const el = document.getElementById('navBasketDrawer');
        if (el && window.bootstrap && bootstrap.Offcanvas) bootstrap.Offcanvas.getOrCreateInstance(el).show();
        navSwitchTab(tab || 'basket');
    };

    let navBasketCurTab = 'basket';
    let hygieneLoaded = false;
    $(document).on('show.bs.offcanvas', '#navBasketDrawer', function () {
        navSwitchTab(navBasketCurTab);   // 顶栏按钮直接开抽屉(不经 navBasketOpen)也要渲染
    });
    function navSwitchTab(tab) {
        navBasketCurTab = tab;
        const map = {basket: '#navBasketTabBtn', health: '#navHealthTabBtn', hygiene: '#navHygieneTabBtn'};
        Object.keys(map).forEach(function (k) {
            $(map[k]).toggleClass('btn-primary', k === tab).toggleClass('btn-outline-secondary', k !== tab);
        });
        $('#navBasketList').toggleClass('d-none', tab !== 'basket');
        $('#navHealthList').toggleClass('d-none', tab !== 'health');
        // 休眠区跟着「🩺 保养」一起显示(不新开第四个页签)
        $('#navArchiveWrap').toggleClass('d-none', tab !== 'health');
        $('#navHygieneList').toggleClass('d-none', tab !== 'hygiene');
        if (tab === 'basket') renderBasket();
        else if (tab === 'health') { renderHealth(); archiveCountPaint(); }
        else hygieneLoad();
    }

    // URL 卫生(2026-10-26 点单 2):扫描跟踪参数/尾斜杠/大写 host,确认后批量规范化
    function hygieneLoad() {
        const $box = $('#navHygieneList');
        if (hygieneLoaded) return;
        hygieneLoaded = true;
        $box.html('<div class="small text-muted p-2">扫描中…</div>');
        fetch(HEALTH_URLS.hygieneScan).then(r => r.json()).then(function (d) {
            const items = (d.items || []).filter(x => !x.conflict);
            const conflicts = (d.items || []).length - items.length;
            if (!items.length) {
                $box.html('<div class="small text-muted p-2">✨ 全库很干净,没有可清理的 URL(跟踪参数/尾斜杠/大写域名)。' +
                    (conflicts ? '(另有 ' + conflicts + ' 条因清理后会和其他站重复,已跳过)' : '') + '</div>');
                return;
            }
            $box.empty();
            items.forEach(function (it) {
                const $row = $('<div class="py-1 border-bottom d-flex gap-2 align-items-start">');
                $('<input type="checkbox" class="form-check-input mt-1 hygiene-ck" checked>').attr('data-id', it.id).attr('data-from', it.old).appendTo($row);
                const $txt = $('<div style="min-width:0;flex:1 1 auto">');
                $('<div class="small fw-bold text-truncate">').text(it.name).appendTo($txt);
                $('<div class="text-danger small text-truncate" style="direction:rtl;text-align:left">').text(it.old).appendTo($txt);
                $('<div class="text-success small text-truncate" style="direction:rtl;text-align:left">').text(it.new).appendTo($txt);
                $txt.appendTo($row);
                $row.appendTo($box);
            });
            $('<button class="btn btn-sm btn-primary w-100 mt-2" id="navHygieneGo">清理选中的 ' + items.length + ' 条</button>')
                .on('click', function () {
                    const picks = [];
                    $box.find('.hygiene-ck:checked').each(function () {
                        picks.push({id: parseInt(this.getAttribute('data-id'), 10), from: this.getAttribute('data-from')});
                    });
                    if (!picks.length) { showToast('先勾选要清理的条目'); return; }
                    $.ajax({
                        url: HEALTH_URLS.hygieneApply, type: 'POST', contentType: 'application/json',
                        data: JSON.stringify({items: picks}),
                        beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                        success: function (r) {
                            if (window.navPetState) {
                                window.navPetState('happy');
                                window.navPetSay('🧹 清理了 ' + r.applied + ' 条 URL,导航干净多了!', 3400);
                            }
                            showToast('已清理 ' + r.applied + ' 条');
                            setTimeout(() => location.reload(), 900);
                        },
                        error: function (xhr) { showToast((xhr.responseJSON && xhr.responseJSON.message) || '清理失败'); }
                    });
                }).appendTo($box);
            if (conflicts) $box.append('<div class="small text-muted mt-1">另有 ' + conflicts + ' 条清理后会和其他站重复,已跳过</div>');
        }).catch(function () { $box.html('<div class="small text-danger p-2">扫描失败</div>'); });
    }
    $(document).on('click', '#navHygieneTabBtn', function () { navSwitchTab('hygiene'); });

    // 点击热力:data-clicks 越大,卡片背景越偏主题色(封顶 12%,足够隐又不抢眼)
    // 大图标布局不铺底色:它靠「透明卡片 + 图标」呼吸,给外层栅格列刷热力色会变成
    // 大小不一的深色/白色方块,正好破坏大图标的留白。其它布局照旧。
    window.navApplyClickHeat = function () {
        const iconLayout = $('.nav-hub').hasClass('lyr-icon');
        $('.nav-hub [data-site-item][data-clicks]').each(function () {
            if (iconLayout) {
                this.style.backgroundColor = '';
                return;
            }
            const clicks = parseInt(this.getAttribute('data-clicks'), 10) || 0;
            if (clicks > 0) {
                const pct = Math.min(12, clicks * 2);
                this.style.backgroundColor = 'color-mix(in srgb, var(--accent) ' + pct + '%, var(--bs-body-bg))';
            } else {
                this.style.backgroundColor = '';
            }
        });
    };

    $(document).on('click', '#navBasketTabBtn', function () { navSwitchTab('basket'); });
    $(document).on('click', '#navHealthTabBtn', function () { navSwitchTab('health'); });

    navBasketRefreshBadge();
    navApplyClickHeat();
});
