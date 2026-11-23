/* 链接测活(单条+分批体检队列)——从 nav_sites.html 拆出的第三刀(2026-10-25,渐进拆分,同 pet.js 模式)。
   边界约定见 pet.js 文件头:主脚本挂 window 的共享工具在此取用;
   站点数据(catUrls/catChildUrls/siteMap)由主脚本解析 JSON 岛后挂 window;
   URL 走模板渲染的配置岛 #navLtUrls(静态文件里禁模板标签)。
   对外:无(window 上只有事件绑定,外部不直接调用)。*/
jQuery(function ($) {
    'use strict';
    const csrf = window.navCsrf, showToast = window.navToast;
    const siteMap = window.siteMap;
    const LT_URLS = JSON.parse(document.getElementById('navLtUrls').textContent);
    const ltProxyKey = 'navTestProxy';
    $('#ltProxy').val(localStorage.getItem(ltProxyKey) || '');
    $('#ltProxy').on('change', function() { localStorage.setItem(ltProxyKey, this.value.trim()); });
    const ltTimeoutKey = 'navLinkTimeout', ltTotalKey = 'navLinkTotal';
    $('#ltTimeout').val(localStorage.getItem(ltTimeoutKey) || '');
    $('#ltTotalTimeout').val(localStorage.getItem(ltTotalKey) || '');
    $('#ltTimeout').on('change', function() { localStorage.setItem(ltTimeoutKey, this.value.trim()); });
    $('#ltTotalTimeout').on('change', function() { localStorage.setItem(ltTotalKey, this.value.trim()); });
    function ltFill(cat) {
        // 默认只测主站;勾"含子网页"才把子页 URL 一并填入
        let urls = cat ? (catUrls[cat] || []) : Object.values(catUrls).flat();
        if ($('#ltIncludeSub').prop('checked')) {
            urls = urls.concat(cat ? (catChildUrls[cat] || []) : Object.values(catChildUrls).flat());
        }
        $('#ltUrls').val(urls.join('\n'));
        showToast(urls.length ? `已填入 ${urls.length} 条网址` : '没有可填入的网址');
    }
    $('#ltFillCat').on('click', function() {
        const c = $('#ltCategory').val();
        if (!c) { showToast('先选择一个大类'); return; }
        ltFill(c);
    });
    // 「全部填入并检测」:填入全库(尊重「含子网页」勾选)→ 分批检测(2026-09-30 合并三按钮,2026-10-16 起分批)
    $('#ltFillAllRun').on('click', function() {
        ltFill('');
        const urls = ltExtractUrls($('#ltUrls').val() || '');
        if (!urls.length) { showToast('导航里没有可检测的网址'); return; }
        ltRunQueued(urls);
    });
    // 「最旧 50 条」(2026-10-26 点单 3):增量体检——从未体检/超 90 天没测的优先,预算紧张也能让老站先被查到
    $('#ltOldest').on('click', function() {
        const cards = [];
        $('.nav-hub [data-site-item][data-url]').each(function() {
            cards.push({url: String(this.getAttribute('data-url') || ''),
                        at: Number(this.getAttribute('data-check-at') || 0)});
        });
        cards.sort(function(a, b) { return a.at - b.at; });   // 从未体检(0)排最前,其后按最旧
        const urls = [];
        const seen = new Set();
        cards.forEach(function(c) {
            if (!c.url || seen.has(c.url) || urls.length >= 50) return;
            seen.add(c.url);
            urls.push(c.url);
        });
        if (!urls.length) { showToast('导航里没有可检测的网址'); return; }
        $('#ltUrls').val(urls.join('\n'));
        ltRunQueued(urls);
    });
    // 结果行拼 HTML 串:分批体检时一次插一整批,比逐行 append jQuery 对象快一个量级
    function ltEsc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function ltRowHtml(url, badgeText, badgeCls, msg, extra) {
        const href = /^https?:\/\//i.test(url) ? ' href="' + ltEsc(url) + '"' : '';
        const okAttr = badgeCls === 'text-bg-success' ? ' data-lt-ok="1"' : '';
        // data-url 给「本机复测」用:行里只有渲染后的链接文本,不方便再解析
        let h = '<div class="lt-row" data-url="' + ltEsc(url) + '"' + okAttr + '><a target="_blank" rel="noopener noreferrer"' + href + '>' + ltEsc(url) + '</a>';
        if (badgeText) h += '<span class="badge ' + ltEsc(badgeCls) + '">' + ltEsc(badgeText) + '</span>';
        if (msg) h += '<span class="lt-msg">' + ltEsc(msg) + '</span>';
        return h + (extra || '') + '</div>';
    }
    // 迁移新地址候选:展示来源 + 已知主站可一键"加入备用"(点击委托在 #ltResults 上,插 HTML 后照样可点)
    const LT_REASON_LABELS = {canonical: 'canonical 指向', 'og:url': 'og:url 指向',
                              redirect: '页面声明跳转', hint: '迁移提示文字', link: '页面高频外链'};
    function ltMovedHtml(r) {
        const moved = r.moved || [];
        if (!moved.length) return '';
        const site = siteMap[r.url];
        let h = '<div class="lt-moved small ms-3 w-100"><div class="fw-semibold text-warning-emphasis">'
            + ltEsc(moved.length > 1 ? '发现 ' + moved.length + ' 个可能的新地址,请逐个确认:' : '页面内容指向新地址:')
            + '</div>';
        moved.forEach(function(c) {
            h += '<div class="d-flex align-items-center gap-2 flex-wrap">'
                + '<a target="_blank" rel="noopener noreferrer" href="' + ltEsc(c.url) + '">' + ltEsc(c.url) + '</a>'
                + '<span class="text-muted">' + ltEsc(LT_REASON_LABELS[c.reason] || c.reason) + '</span>';
            if (site) {
                h += '<button class="btn btn-sm btn-outline-primary py-0 px-1 lt-adopt" type="button"'
                    + ' data-id="' + ltEsc(site.id) + '" data-site="' + ltEsc(site.name) + '"'
                    + ' data-url="' + ltEsc(c.url) + '">加入备用</button>';
            }
            h += '</div>';
        });
        return h + '</div>';
    }
    $('#ltFailOnly').on('change', function() {
        $('#ltResults .lt-row[data-lt-ok="1"]').toggle(!this.checked);
    });
    $('#ltResults').on('click', '.lt-adopt', function() {
        const $b = $(this).prop('disabled', true);
        $.ajax({
            url: LT_URLS.adopt, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({id: Number($b.data('id')), url: String($b.data('url') || '')}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function() {
                $b.text('已加入');
                showToast(`已加入「${$b.data('site')}」的备用网址,刷新页面后生效`);
            },
            error: function(xhr) {
                $b.prop('disabled', false);
                showToast((xhr.responseJSON && xhr.responseJSON.message) || '加入失败');
            }
        });
    });
    // 从任意文本提取网址:http(s) 完整链接 + 裸域名(带路径),去重保序
    function ltExtractUrls(text) {
        const re = /https?:\/\/[^\s"'<>，。；、）)】\]《》]+|[a-zA-Z0-9_][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)*\.[a-zA-Z]{2,}(?:\/[a-zA-Z0-9\/?=&%#:;@.,\-~_]*)?/g;
        const out = [], seen = new Set();
        let m;
        while ((m = re.exec(text)) !== null) {
            let u = m[0].replace(/[.,;:!?，。；、：！？]+$/, '');
            if (/^https?:\/\//i.test(u)) {
                // 结尾右括号多于左括号说明是正文标点,去掉多余的
                while (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1);
            } else if (/^[\d.]+$/.test(u)) {
                continue; // 1.2.3 之类版本号不是域名
            }
            const key = u.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(u);
        }
        return out;
    }
    // ===== 分批体检队列(2000 站量级):32 条一批顺序跑,逐批落库、进度实时、可中断可续测 =====
    const LT_BATCH = 32;                             // 8 并发 × 4 轮,最坏 4×单条超时,稳稳落在默认总预算内
    const LT_RESUME_KEY = 'navLinkCheckStartedAt';   // 上次体检开始时间(ms),续测靠它跳过已测
    const LT_RESUME_WINDOW = 3600 * 1000;            // 续测只认 1 小时内启动的那次,更旧的当"新体检"
    let ltRunToken = 0;                              // 每次运行自增:旧运行的迟到回调一律作废(防交叉写 DOM)
    function ltSetRunning(on) {
        $('#ltRun, #ltFillAllRun').prop('disabled', on);
        $('#ltStop').toggleClass('d-none', !on);
    }
    // 收集全库主站网址:onlyFresh=true 时只留"上次体检开始后还没测过的"(判据是卡片 data-check-at)。
    // 子页没有时间戳,续测只覆盖主站——这与"全库体检"的语义一致。
    function ltCollectedUrls(onlyFresh) {
        let startedAt = 0;
        try { startedAt = Number(localStorage.getItem(LT_RESUME_KEY) || 0); } catch (e) {}
        const out = [], seen = new Set();
        $('.nav-hub [data-site-item][data-url]').each(function() {
            const u = String(this.getAttribute('data-url') || '');
            if (!u || seen.has(u)) return;
            if (onlyFresh && Number(this.getAttribute('data-check-at') || 0) * 1000 >= startedAt) return;
            seen.add(u);
            out.push(u);
        });
        return out;
    }
    // 续测按钮:只有存在 1 小时内的未完成体检才亮,并显示还剩多少条
    function ltRefreshResume() {
        let startedAt = 0;
        try { startedAt = Number(localStorage.getItem(LT_RESUME_KEY) || 0); } catch (e) {}
        const fresh = startedAt && (Date.now() - startedAt) < LT_RESUME_WINDOW;
        const left = fresh ? ltCollectedUrls(true).length : 0;
        $('#ltResumeHint').text(left ? '(剩 ' + left + ' 条)' : '');
        $('#ltResume').toggleClass('d-none', !left);
    }
    function ltRunQueued(urls) {
        if (!urls.length) { showToast('没有要检测的网址'); return; }
        const token = ++ltRunToken;
        ltSetRunning(true);
        try { localStorage.setItem(LT_RESUME_KEY, String(Date.now())); } catch (e) {}
        const total = urls.length, chunkCount = Math.ceil(total / LT_BATCH);
        const $res = $('#ltResults');
        // 一次拼好全部占位行(每批一个 chunk 容器,批完成只换这一块 innerHTML,不做逐行更新)
        let html = '';
        for (let k = 0; k < chunkCount; k++) {
            html += '<div class="lt-chunk" data-chunk="' + k + '">';
            for (let i = k * LT_BATCH; i < Math.min(total, (k + 1) * LT_BATCH); i++) {
                html += ltRowHtml(urls[i], '…', 'text-bg-secondary', '');
            }
            html += '</div>';
        }
        $res.html(html);
        $('#ltProgressWrap').removeClass('d-none');
        let ok = 0, fail = 0, skipped = 0, moved = 0, done = 0;
        const deadFound = [];   // 体检篮:本轮打不开的(体检篮功能接驳点)
        function tick() {
            const pct = total ? Math.round(done * 100 / total) : 100;
            $('#ltProgressBar').css('width', pct + '%').attr('aria-valuenow', pct);
            $('#ltSummary').text('检测中 ' + done + '/' + total
                + '(通 ' + ok + ' · 挂 ' + fail + (skipped ? ' · 未测 ' + skipped : '') + ')');
        }
        tick();
        if (window.navPetState) { navPetState('work'); navPetSay('我去检查 ' + total + ' 条链接,分批来~', 2600); }
        function finish() {
            ltSetRunning(false);
            $('#ltProgressBar').css('width', '100%').attr('aria-valuenow', 100);
            $('#ltSummary').text('✔ ' + ok + ' / 共 ' + total
                + (skipped ? ',未测 ' + skipped + '(预算不足)' : '')
                + (moved ? ',' + moved + ' 条内容里发现新地址' : ''));
            if (window.navPetState) {
                navPetState(fail === 0 ? 'happy' : 'fail');
                navPetSay('测活完毕:通 ' + ok + ' / 挂 ' + fail, 3200);
                petNotify('测活完毕:通 ' + ok + ' / 挂 ' + fail);
            }
            if (deadFound.length && window.navBasketFromResults) window.navBasketFromResults(deadFound.splice(0));   // 叼进体检篮
            ltRefreshResume();
        }
        (function step(k) {
            if (token !== ltRunToken) return;          // 被停止/新运行作废
            if (k >= chunkCount) { finish(); return; }
            const batch = urls.slice(k * LT_BATCH, (k + 1) * LT_BATCH);
            $.ajax({
                url: LT_URLS.check, type: 'POST', contentType: 'application/json',
                data: JSON.stringify({urls: batch, proxy: $('#ltProxy').val().trim(),
                                      timeout: $('#ltTimeout').val(), total_timeout: $('#ltTotalTimeout').val()}),
                beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
                success: function(data) {
                    if (token !== ltRunToken) return;
                    let h = '';
                    (data.results || []).forEach(function(r) {
                        const extra = ltMovedHtml(r);
                        // skipped = 预算不足没跑到,不是"打不开":单独黄色标注,也不落库(后端已保证)
                        if (r.skipped) { skipped++; h += ltRowHtml(r.url, '未测', 'text-bg-warning', '预算不足,这轮没跑到', extra); }
                        else if (r.ok) { ok++; h += ltRowHtml(r.url, String(r.status || 200), 'text-bg-success', '', extra); }
                        else { fail++; deadFound.push({url: r.url, error: r.error || ''}); h += ltRowHtml(r.url, '打不开', 'text-bg-danger', r.error || '', extra); }
                        if ((r.moved || []).length) moved++;
                    });
                    $res.find('.lt-chunk[data-chunk="' + k + '"]').html(h);
                    done += (data.results || []).length;
                    tick();
                    step(k + 1);
                },
                error: function(xhr) {
                    if (token !== ltRunToken) return;
                    ltSetRunning(false);
                    $('#ltSummary').text('第 ' + (k + 1) + ' 批失败,已测 ' + done + '/' + total
                        + ' —— 可点「继续上次体检」接着跑');
                    if (window.navPetState) { navPetState('fail'); navPetSay('测活中断了,已测的都在', 2600); }
                    showToast((xhr.responseJSON && xhr.responseJSON.message) || '检测中断');
                    ltRefreshResume();
                }
            });
        })(0);
    }
    $('#ltRun').on('click', function() {
        const urls = ltExtractUrls($('#ltUrls').val() || '');
        if (!urls.length) { showToast('没找到网址,粘贴内容或点"填入该大类网址"'); return; }
        ltRunQueued(urls);
    });
    // 续测:跳过上次体检开始后已测过的,只补剩下的(中断/关页面后接着跑)
    $('#ltResume').on('click', function() {
        const urls = ltCollectedUrls(true);
        if (!urls.length) { showToast('上次体检已跑完,没有要续的'); ltRefreshResume(); return; }
        $('#ltUrls').val(urls.join('\n'));
        showToast('续测 ' + urls.length + ' 条(已跳过刚测过的)');
        ltRunQueued(urls);
    });
    $('#ltStop').on('click', function() {
        ltRunToken++;              // 作废当前运行:迟到回调全忽略,已测的都已落库
        ltSetRunning(false);
        $('#ltSummary').append(' —— 已停止,可点「继续上次体检」接着跑');
        ltRefreshResume();
    });
    // ===== 本机复测(2026-11-12)=====
    // 服务端测活是从机房发出的:香港节点能通、你本机被墙的站会显示"可访问"。
    // 这里用 no-cors fetch 从浏览器再探一次,只判断"请求有没有到达"(DNS/TCP/TLS),
    // 拿不到状态码也读不到内容 —— 用来发现"服务器 OK / 本机不通"的差异,不替代服务端结论。
    const LT_LOCAL_TIMEOUT = 6000;
    const LT_LOCAL_CONC = 4;
    let ltLocalToken = 0;
    function ltLocalOne(url) {
        // HTTPS 页面里 fetch http:// 会被浏览器按混合内容直接拦掉,那不是"站点不通"
        if (location.protocol === 'https:' && /^http:\/\//i.test(url)) return Promise.resolve('mixed');
        return new Promise(function(resolve) {
            const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            const timer = setTimeout(function() {
                if (ctrl) ctrl.abort();
                resolve('timeout');
            }, LT_LOCAL_TIMEOUT);
            fetch(url, {mode: 'no-cors', cache: 'no-store', credentials: 'omit',
                        signal: ctrl ? ctrl.signal : undefined})
                .then(function() { clearTimeout(timer); resolve('ok'); })
                .catch(function() { clearTimeout(timer); resolve('fail'); });
        });
    }
    function ltLocalMarkRow(row, url, bad) {
        const $row = $(row);
        $row.toggleClass('lt-local-bad', bad).find('.lt-local').remove();
        if (bad) {
            $row.append('<span class="lt-local badge text-bg-warning ms-1">本机不通</span>');
            $('.nav-hub [data-site-item][data-url="' + String(url).replace(/"/g, '\\"') + '"]')
                .addClass('site-local-bad')
                .attr('title', '服务器可访问,但本机复测连不上(可能是网络/地区限制)');
        }
    }
    function ltLocalProbe() {
        const rows = $('#ltResults .lt-row[data-lt-ok="1"]').toArray();
        if (!rows.length) { showToast('先跑一轮服务端检测,或这轮没有可访问的站点'); return; }
        const token = ++ltLocalToken;
        const $btn = $('#ltLocalRun').prop('disabled', true);
        $('#ltLocalHint').removeClass('text-danger').text('0/' + rows.length);
        let next = 0, done = 0, bad = 0;
        function worker() {
            if (token !== ltLocalToken) return Promise.resolve();
            if (next >= rows.length) return Promise.resolve();
            const row = rows[next++];
            const url = String($(row).attr('data-url') || '');
            return ltLocalOne(url).then(function(res) {
                if (token !== ltLocalToken) return;
                done++;
                if (res === 'mixed') {
                    $(row).find('.lt-local').remove();
                    $(row).append('<span class="lt-local badge text-bg-secondary ms-1">混合内容,无法本机测</span>');
                } else {
                    const isBad = res !== 'ok';
                    if (isBad) bad++;
                    ltLocalMarkRow(row, url, isBad);
                }
                $('#ltLocalHint').text(done + '/' + rows.length + (bad ? ' · 本机不通 ' + bad : ''));
                return worker();
            });
        }
        const pool = [];
        for (let i = 0; i < LT_LOCAL_CONC; i++) pool.push(worker());
        Promise.all(pool).then(function() {
            if (token !== ltLocalToken) return;
            $btn.prop('disabled', false);
            $('#ltLocalHint').toggleClass('text-danger', bad > 0);
            showToast(bad
                ? '本机复测完成:' + bad + ' 条在你这台机器上连不上(服务器判为可访问)'
                : '本机复测完成:全部可连');
            if (window.navPetSay && bad) navPetSay('有 ' + bad + ' 条只有机房能打开…', 3000);
        });
    }
    $('#ltLocalRun').on('click', ltLocalProbe);

    $('#linkTestModal').on('show.bs.modal', ltRefreshResume);
    ltRefreshResume();
});
