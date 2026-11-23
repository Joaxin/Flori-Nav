/* 多选批量操作(2026-10-26 brainstorm 点单 1)——从 nav_sites.html 拆分模式新建的独立模块,零 jQuery。
   用法:Ctrl+点卡片 = 选中/取消(不打开会话);选中后底部浮出操作条:换分类/加标签/删除。
   边界约定同 pet.js:csrf 走 window.navCsrf,toast 走 window.navToast;URL 走配置岛 #navBatchUrls。*/
jQuery(function ($) {
    'use strict';
    const BATCH_URLS = JSON.parse(document.getElementById('navBatchUrls').textContent);
    const showToast = window.navToast;   // csrf 不在这取快照,两个请求各自经 window.navCsrf() 现取现判存
    const sel = new Set();          // 选中卡元素(按 DOM 引用,防 URL 重复)
    let msBar = null, bulkMode = false;
    let msMoreOpen = false;         // 「更多」浮层展开态(重新渲染时保留,不然每次勾选都缩回去)

    function ensureCheckboxes() {
        document.querySelectorAll('.nav-hub [data-site-item][data-id]').forEach(function (card) {
            if (card.querySelector('.site-bulk-check')) return;
            const box = card.querySelector('.site-card-box');
            if (!box) return;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'site-bulk-check';
            cb.setAttribute('aria-label', '选择站点');
            box.prepend(cb);
        });
    }

    function syncCheckboxes() {
        document.querySelectorAll('.nav-hub .site-bulk-check').forEach(function (cb) {
            const card = cb.closest('[data-site-item][data-id]');
            cb.checked = card ? sel.has(card) : false;
        });
    }

    function toggleCard(card) {
        if (sel.has(card)) { sel.delete(card); card.classList.remove('ms-sel'); }
        else { sel.add(card); card.classList.add('ms-sel'); }
        syncCheckboxes();
        msBarRender();
    }

    function setBulkMode(on) {
        bulkMode = !!on;
        document.body.classList.toggle('bulk-mode', bulkMode);
        const btn = document.getElementById('navBulkToggle');
        if (btn) {
            btn.classList.toggle('active', bulkMode);
            btn.setAttribute('aria-pressed', bulkMode ? 'true' : 'false');
            btn.setAttribute('aria-label', bulkMode ? '退出多选模式' : '批量选择');
        }
        if (bulkMode) { ensureCheckboxes(); syncCheckboxes(); } else { msClear(); }
        msBarRender();
    }
    function toggleBulkMode() { setBulkMode(!bulkMode); }

    function postBatch(payload) {
        // 拆分模块的边界铁律:主闭包里的 csrf 是加载期快照,必须经 window 现取 + 判存
        // (裸引用闭包局部名会恒 false 静默失效)。取不到就没有 X-CSRFToken 头 → 后端 403,
        // 所以宁可明着报错也不发一个注定被拒的请求。
        if (typeof window.navCsrf !== 'function') {
            if (window.navToast) { window.navToast('页面脚本没加载完,请刷新后重试'); }
            return Promise.reject(new Error('navCsrf unavailable'));
        }
        return fetch(BATCH_URLS.batch, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': window.navCsrf()},
            body: JSON.stringify(payload)
        }).then(r => r.json());
    }

    function msBarRender() {
        const n = sel.size;
        // #11:进入多选即显示工具条;0 项时保留工具条,计数显示「已选 0 项」,操作按钮由
        // nav-sites.js 的 initBulkBehavior 按计数禁用;退出多选才整条隐藏。
        if (!bulkMode) {
            if (msBar) msBar.style.display = 'none';
            return;
        }
        if (!msBar) {
            msBar = document.createElement('div');
            msBar.id = 'navMsBar';
            msBar.setAttribute('data-bulk-bar', '');
            msBar.style.cssText = 'position:fixed;bottom:max(14px, env(safe-area-inset-bottom, 0px));left:50%;transform:translateX(-50%);z-index:1055;' +
                'display:none;align-items:center;gap:8px;background:var(--bs-body-bg);color:var(--bs-body-color);' +
                'border:1px solid var(--bs-border-color);border-radius:14px;padding:8px 12px;' +
                'box-shadow:0 8px 26px rgba(0,0,0,.22);flex-wrap:wrap;justify-content:center;max-width:min(94vw, 760px)';
            document.body.appendChild(msBar);
        }
        const cats = Array.from(document.querySelectorAll('#navCategoryList option')).map(o => o.value);
        let subs = {};
        try { subs = JSON.parse(document.getElementById('navCatSubs').textContent) || {}; } catch (e) {}
        const selCat = msBar.querySelector('#navMsCat');
        const curCat = selCat ? selCat.value : '';
        msBar.innerHTML = '<b class="small" id="navBulkCount" data-bulk-count>已选 ' + n + ' 项</b>' +
            '<button class="btn btn-sm btn-primary" id="navMsGoOpen" data-bulk-act="open">打开</button>' +
            '<button class="btn btn-sm btn-outline-primary" id="navMsGoStar" data-bulk-act="star">收藏</button>' +
            '<button class="btn btn-sm btn-outline-danger" id="navMsGoDel" data-bulk-act="del">删除</button>' +
            '<button class="btn btn-sm btn-outline-secondary" id="navMsMoreBtn" aria-expanded="' + (msMoreOpen ? 'true' : 'false') + '" title="其余批量动作:复制链接 / 全选 / 换分类 / 加标签 / 休眠">' +
                '更多<i class="fas fa-chevron-' + (msMoreOpen ? 'down' : 'up') + ' ms-1" style="font-size:.7em"></i></button>' +
            '<button class="btn btn-sm btn-outline-secondary" id="navMsCancel" data-bulk-act="exit" data-bulk-exit>退出</button>' +
            // 2026-11-19 二级收纳:常用(打开/收藏/删除/退出)外露,其余收进浮层,免得 10 个按钮挤成一条
            '<div class="ms-more-panel' + (msMoreOpen ? '' : ' d-none') + '" id="navMsMore">' +
                '<div class="ms-more-row">' +
                    '<button class="btn btn-sm btn-outline-secondary" id="navMsGoCopy" data-bulk-act="copy">复制链接</button>' +
                    '<button class="btn btn-sm btn-outline-secondary" id="navMsGoAll" data-bulk-act="all">全选当前可见</button>' +
                '</div>' +
                '<div class="ms-more-row">' +
                    '<select id="navMsCat" class="form-select form-select-sm" style="width:auto">' +
                        '<option value="">换分类到…</option>' +
                        cats.map(c => '<option' + (c === curCat ? ' selected' : '') + '>' + c + '</option>').join('') +
                    '</select>' +
                    '<select id="navMsSub" class="form-select form-select-sm" style="width:auto"><option value="">(清空小分类)</option></select>' +
                    '<button class="btn btn-sm btn-outline-primary" id="navMsGoCat" data-bulk-act="cat">换分类</button>' +
                '</div>' +
                '<div class="ms-more-row">' +
                    '<input id="navMsTags" class="form-control form-control-sm" style="width:150px" placeholder="追加标签,逗号分隔">' +
                    '<button class="btn btn-sm btn-outline-primary" id="navMsGoTags" data-bulk-act="tags">加标签</button>' +
                '</div>' +
                '<div class="ms-more-row">' +
                    '<button class="btn btn-sm btn-outline-secondary" id="navMsGoArch" data-bulk-act="arch" title="收起来,不进分类;数据一条不动,体检篮 → 🩺 保养 页下方可唤醒">💤 休眠</button>' +
                '</div>' +
            '</div>';
        msBar.style.display = 'flex';
        function syncSubs() {
            const cat = msBar.querySelector('#navMsCat').value;
            const sub = msBar.querySelector('#navMsSub');
            sub.innerHTML = '<option value="">(清空小分类)</option>' +
                (subs[cat] || []).map(s => '<option>' + escAttr(s) + '</option>').join('');
        }
        msBar.querySelector('#navMsCat').addEventListener('change', syncSubs);
        syncSubs();
        // 「更多」只切浮层显隐,不重画整条(重画会丢刚填的分类/标签)
        msBar.querySelector('#navMsMoreBtn').addEventListener('click', function() {
            msMoreOpen = !msMoreOpen;
            this.setAttribute('aria-expanded', msMoreOpen ? 'true' : 'false');
            this.querySelector('i').className = 'fas fa-chevron-' + (msMoreOpen ? 'down' : 'up') + ' ms-1';
            msBar.querySelector('#navMsMore').classList.toggle('d-none', !msMoreOpen);
        });
        msBar.querySelector('#navMsGoOpen').addEventListener('click', openSelected);
        msBar.querySelector('#navMsGoStar').addEventListener('click', starSelected);
        msBar.querySelector('#navMsGoCopy').addEventListener('click', copySelectedLinks);
        msBar.querySelector('#navMsGoAll').addEventListener('click', selectVisible);
        msBar.querySelector('#navMsGoCat').addEventListener('click', function () {
            const cat = msBar.querySelector('#navMsCat').value;
            if (!cat) { showToast('先选目标大类'); return; }
            runBatch({action: 'category', ids: selIds(), category: cat, subcat: msBar.querySelector('#navMsSub').value});
        });
        msBar.querySelector('#navMsGoTags').addEventListener('click', function () {
            const tags = (msBar.querySelector('#navMsTags').value || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
            if (!tags.length) { showToast('先填标签'); return; }
            runBatch({action: 'tags', ids: selIds(), tags: tags});
        });
        msBar.querySelector('#navMsGoArch').addEventListener('click', function () {
            runBatch({action: 'archive', ids: selIds()});
        });
        msBar.querySelector('#navMsGoDel').addEventListener('click', function () {
            // 不问,直接删(2026-10-30 全站下线原生 confirm):批量删除本来就是可撤销的——
            // runBatch 的 delete 分支拿到整行 rows,「全部撤销」逐条 POST /api/nav/restore/ 建回。
            // 反悔的机会放在做完之后,比弹窗少一次点击。
            runBatch({action: 'delete', ids: selIds()});
        });
        msBar.querySelector('#navMsCancel').addEventListener('click', function () { setBulkMode(false); });
    }

    function escAttr(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function selIds() {
        return Array.from(sel).map(el => parseInt(el.getAttribute('data-id'), 10)).filter(Boolean);
    }
    function selectedLinks() {
        return Array.from(sel).map(function (card) {
            return {
                id: parseInt(card.getAttribute('data-id'), 10),
                name: card.getAttribute('data-name') || '',
                url: card.getAttribute('data-url') || ''
            };
        }).filter(function (x) { return x.url; });
    }
    function openSelected() {
        selectedLinks().forEach(function (item) {
            window.open(item.url, '_blank', 'noopener');
        });
        showToast('已打开 ' + sel.size + ' 个站点');
    }
    function starSelected() {
        const urls = selectedLinks().map(function (x) { return x.url; });
        const old = typeof window.navLsGet === 'function' ? window.navLsGet('navStars') : [];
        const merged = Array.from(new Set((Array.isArray(old) ? old : []).concat(urls)));
        if (typeof window.navLsSet === 'function') window.navLsSet('navStars', merged);
        if (typeof window.syncStarButtons === 'function') window.syncStarButtons();
        if (typeof window.renderNavStars === 'function') window.renderNavStars();
        showToast('已收藏 ' + urls.length + ' 个站点');
    }
    function copySelectedLinks() {
        const text = selectedLinks().map(function (x) {
            return x.name ? x.name + ' - ' + x.url : x.url;
        }).join('\n');
        if (!text) { showToast('先选择站点'); return; }
        const done = function () { showToast('已复制 ' + sel.size + ' 条链接'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
        } else {
            fallbackCopy(text); done();
        }
    }
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
    }
    function selectVisible() {
        document.querySelectorAll('.nav-hub [data-site-item]').forEach(function (card) {
            if (card.offsetParent === null) return;
            sel.add(card); card.classList.add('ms-sel');
        });
        syncCheckboxes(); msBarRender();
    }
    function msClear() {
        sel.forEach(el => el.classList.remove('ms-sel'));
        sel.clear();
        msMoreOpen = false;   // 全部取消后浮层也收起,下次从干净状态开始
        syncCheckboxes();
        msBarRender();
    }
    function runBatch(payload) {
        postBatch(payload).then(function (d) {
            if (d.status !== 'ok') { showToast(d.message || '批量操作失败'); return; }
            if (payload.action === 'delete') {
                // 撤销窗口必须真的看得见：改前 900ms 就整页刷新，那条「全部撤销」刚冒头
                // 就被冲掉——确认框下线之后它就是唯一退路，退路只有 0.9 秒等于没有退路。
                // 所以刷新推到提示条收起之后；点了撤销就取消这次刷新（恢复完自己会刷）。
                const reloadTimer = setTimeout(() => location.reload(), 9000);
                showToast('已删除 ' + d.deleted + ' 个站点', {
                    ms: 8500,
                    label: '全部撤销',
                    fn: function () {
                        clearTimeout(reloadTimer);
                        (d.rows || []).forEach(function (row) {
                            if (typeof window.navCsrf !== 'function') return;   // 同 postBatch:经 window 现取 + 判存
                            fetch(BATCH_URLS.batch.replace(/\/batch\/$/, '/restore/'), {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json', 'X-CSRFToken': window.navCsrf()},
                                body: JSON.stringify({site: row})
                            }).catch(function () {});
                        });
                        showToast('已批量恢复,刷新看看');
                        setTimeout(() => location.reload(), 900);
                    }
                });
                msClear();
                return;
            }
            if (payload.action === 'archive') {
                // 休眠不删数据,所以不必等刷新:卡片当场收起,唤醒在「🩺 保养」下方(那里要刷新才回分类)
                showToast('已休眠 ' + d.updated + ' 个站点(名称/网址/星标/体检记录都没动,体检篮 → 🩺 保养 页下方可唤醒)');
                sel.forEach(el => el.remove());
                msClear();
                return;
            }
            showToast(payload.action === 'category' ? ('已换分类 ' + d.updated + ' 个') : ('已加标签 ' + d.updated + ' 个'));
            msClear();
            setTimeout(() => location.reload(), 700);
        }).catch(function () { showToast('批量操作失败'); });
    }
    // 多选模式下点卡片即选中;Ctrl/Cmd 点卡片仍是备用多选(capture 阶段拦下,不让打开会话)
    document.addEventListener('click', function (e) {
        if (e.target.closest('.site-bulk-check')) return;
        const card = e.target.closest('.nav-hub [data-site-item][data-id]');
        if (!card) return;
        if (!bulkMode && !e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        toggleCard(card);
    }, true);
    document.addEventListener('change', function (e) {
        const cb = e.target.closest('.site-bulk-check');
        if (!cb) return;
        const card = cb.closest('[data-site-item][data-id]');
        if (card) toggleCard(card);
    });
    const bulkBtn = document.getElementById('navBulkToggle');
    if (bulkBtn) bulkBtn.addEventListener('click', toggleBulkMode);
    ensureCheckboxes();
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sel.size) msClear();
    });
    // ===== #11 统一多选 API(window.navBulk) =====
    // 主人侧状态在本闭包;访客侧 nav-guest-batch.js 以同形方法挂到同一对象。动作钮两端共用
    // [data-bulk-act];主人条保留旧 id #navMsBar / #navMsCancel(既有 CSS 规则按旧 id 命中),
    // 访客条走新契约钩子 #navBulkBar / #navBulkCount / #navBulkExit。
    window.navBulk = Object.assign(window.navBulk || {}, {
        enter: function () { setBulkMode(true); },
        exit: function () { setBulkMode(false); },
        isActive: function () { return bulkMode; },
        count: function () { return sel.size; },
        setCount: function () { /* 主人侧计数由选中集合派生;保留适配位,不接受外部直写 */ },
        render: function () { msBarRender(); },
        selectAll: function () { selectVisible(); }
    });
    window.navMsClear = msClear;
});
