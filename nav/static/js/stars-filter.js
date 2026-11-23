/* 星标 / 最近使用 / 站内过滤索引 / 键盘导航 / 拖拽排序——从 nav_sites.html 拆出的第五刀(2026-10-25,渐进拆分,同 pet.js 模式)。
   边界约定见 pet.js 文件头。特别注意:
   - navLsGet/navLsSet/navCardInfo/renderNavStars/navTouchRecent 的定义**在本文件**,并在此挂 window
     (主脚本原有挂载线随定义一起迁入)——本文件必须先于 pet.js 加载(pet.js ready 里取 window.navLsGet);
   - UI 模式等主脚本对 renderNavRecent 的调用走 window 守卫;
   - URL 走模板渲染的配置岛 #navStarsUrls(静态文件里禁模板标签)。
   对外暴露:window.navLsGet/navLsSet/navCardInfo/renderNavStars/navTouchRecent/navApplyFilter/navFilterHits/
   renderNavStars/renderNavRecent。*/
jQuery(function ($) {
    'use strict';
    const csrf = window.navCsrf, showToast = window.navToast;
    const SF_URLS = JSON.parse(document.getElementById('navStarsUrls').textContent);
    // ===== 星标 / 最近使用 / 键盘导航 / 拖拽排序 =====
    // 星标和最近全部只存本机 localStorage;只有"卡片顺序"提交服务端(NavSite.order)
    function navLsGet(k) { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    // 写也兜一层:隐私模式/配额满时 setItem 会抛,不接住会中断调用它的点击处理
    function navLsSet(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); return true; }
        catch (e) { return false; }
    }
    window.navLsGet = navLsGet; window.navLsSet = navLsSet;   // pet.js 取用
    const NAV_RECENT_MAX = 12;
    function navCardInfo(url) {
        let info = null;
        $('.nav-hub [data-site-item][data-url]').each(function() {
            if (String(this.getAttribute('data-url')) === url) {
                info = { name: String(this.getAttribute('data-name') || url), url: url,
                         fav: $(this).find('.site-fav').attr('src') || '' };
                return false;
            }
        });
        return info;
    }
    function navRenderMini($sec, $row, urls, kind) {
        const items = [];
        urls.forEach(function(u) { const info = navCardInfo(u); if (info) items.push(info); });
        $row.empty();
        if (!items.length) { $sec.addClass('d-none'); return; }
        $sec.removeClass('d-none');
        items.forEach(function(en) {
            const $a = $('<a class="nav-chip">').attr('href', en.url)
                .attr('target', '_blank').attr('rel', 'noopener noreferrer').attr('title', en.url);
            if (en.fav) $('<img>').attr('src', en.fav).attr('loading', 'lazy').attr('alt', '').appendTo($a);
            else $(en.url.indexOf('/nav/tools/') === 0 ? '<i class="fas fa-wrench acc-ico"></i>' : '<i class="fas fa-globe"></i>').appendTo($a);
            $('<span class="chip-name">').text(en.name).appendTo($a);
            $('<button type="button" class="chip-x">×</button>')
                .attr('title', kind === 'star' ? '取消星标' : '从列表移除')
                .attr('data-kind', kind).attr('data-url', en.url).appendTo($a);
            $row.append($a);
        });
    }
    function renderNavStars() { navRenderMini($('#navStarSec'), $('#navStarRow'), navLsGet('navStars'), 'star'); }
    window.navCardInfo = navCardInfo; window.renderNavStars = renderNavStars; window.navTouchRecent = navTouchRecent;   // pet.js 取用
    window.syncStarButtons = syncStarButtons;   // 批量收藏后刷新星标状态(函数声明已提升,此处赋值即可)
    function renderNavRecent() {
        if (localStorage.getItem('navShowRecent') === '0') { $('#navRecentSec').addClass('d-none'); return; }
        navRenderMini($('#navRecentSec'), $('#navRecentRow'),
                      navLsGet('navRecent').slice(0, NAV_RECENT_MAX).map(x => x.url), 'recent');
    }
    function navTouchRecent(url) {
        const prev = navLsGet('navRecent');
        const hit = prev.find(x => x && x.url === url);
        const list = prev.filter(x => x && x.url !== url);
        list.unshift({ url: url, ts: Date.now(), n: ((hit && hit.n) || 0) + 1 });
        navLsSet('navRecent', list.slice(0, 40));
        renderNavRecent();
    }
    // 点卡片记一次"最近使用"(星标/编辑/删除按钮都 stopPropagation,不会误记)
    $('.nav-hub').on('click', '[data-site-item] a.site-card', function() {
        const u = $(this).closest('[data-site-item]').attr('data-url');
        if (u) navTouchRecent(String(u));
    });
    $('.nav-mini-row').on('click', 'a.nav-chip', function() {
        const u = $(this).attr('href');
        if (u) navTouchRecent(u);
    });
    $('.nav-mini-row').on('click', '.chip-x', function(e) {
        e.preventDefault(); e.stopPropagation();
        const url = String($(this).attr('data-url') || '');
        if ($(this).attr('data-kind') === 'star') {
            navLsSet('navStars', navLsGet('navStars').filter(u => u !== url));
            syncStarButtons(); renderNavStars();
        } else {
            navLsSet('navRecent', navLsGet('navRecent').filter(x => x && x.url !== url));
            renderNavRecent();
        }
    });
    function syncStarButtons() {
        const s = new Set(navLsGet('navStars'));
        $('.site-star').each(function() {
            const on = s.has(String($(this).attr('data-url') || ''));
            $(this).toggleClass('on', on);
            $(this).children('i').attr('class', on ? 'fas fa-star' : 'far fa-star');
            // 悬停提示跟着状态走:没收藏时「加入」,收藏后「取消」
            $(this).attr('data-tip', on ? '取消收藏' : '加入常用收藏')
                   .attr('aria-label', on ? '取消收藏' : '加入常用收藏');
        });
    }
    $('.nav-hub').on('click', '.site-star', function(e) {
        e.preventDefault(); e.stopPropagation();
        const url = String($(this).attr('data-url') || '');
        if (!url) return;
        const stars = navLsGet('navStars');
        const on = stars.indexOf(url) >= 0;
        navLsSet('navStars', on ? stars.filter(u => u !== url) : stars.concat([url]));
        syncStarButtons(); renderNavStars();
        showToast(on ? '已取消星标' : '已星标,置顶显示');
    });
    // 设置:「最近使用」行显隐(默认可见)
    const recentVisOn = localStorage.getItem('navShowRecent') !== '0';
    $('#setShowRecent').prop('checked', recentVisOn);
    $('#setShowRecent').on('change', function() {
        localStorage.setItem('navShowRecent', this.checked ? '1' : '0');
        renderNavRecent();
    });

    // 键盘:Ctrl/Cmd+K 或 / 聚焦搜索(大框为主入口);搜索框内 ↑↓ 在结果间移动,Enter 打开
    let navKbIdx = -1;
    function navVisibleCards() { return $('.nav-hub [data-site-item]:visible').children('a.site-card'); }
    function navKbMove(step) {
        const $cards = navVisibleCards();
        if (!$cards.length) return;
        $('.site-card.kb-sel').removeClass('kb-sel');
        navKbIdx = (navKbIdx + step + $cards.length) % $cards.length;
        const el = $cards[navKbIdx];
        el.classList.add('kb-sel');
        el.scrollIntoView({ block: 'nearest' });
    }
    $(document).on('keydown', function(e) {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
        if (e.key === 'Escape') { $('.site-card.kb-sel').removeClass('kb-sel'); navKbIdx = -1; return; }
        if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault(); $('#navEngineQ').trigger('focus').select();
        } else if (e.key === '/' && !typing) {
            e.preventDefault(); $('#navEngineQ').trigger('focus');
        }
    });
    // ↑↓ 选卡 / Enter 打开(2026-11-14 清理):
    //   · 删掉 `#navSearch` 上的 keydown —— 它在模板里是 type="hidden",永远拿不到焦点,是顶栏搜索框的遗留;
    //   · `#navEngineQ` 的 input 处理器原来注册了两遍,内容完全一样,保留一份。
    $('#navEngineQ').on('keydown', function(e) {
        // 输入法候选窗开着时 ↑↓ 是选字、Enter 是确认候选词,不能被这里抢走
        if (e.isComposing || e.keyCode === 229) return;
        navFlushFilter();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!navVisibleCards().length) return;   // 无站内匹配,让光标自由移动
            e.preventDefault(); navKbMove(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter' && navKbIdx >= 0) {
            const $cards = navVisibleCards();
            if (!$cards.length) return;
            e.preventDefault();   // 已选中站内卡片:打开它,不做全网搜索
            ($cards[navKbIdx] || $cards[0]).click();
        }
    });
    $('#navEngineQ').on('input', function() {
        navKbIdx = -1; $('.site-card.kb-sel').removeClass('kb-sel');
    });

    // 拖拽排序:开关打开才能拖;拖完出现保存条,点保存才提交(与分类排序同款交互)
    function setNavDrag(on) {
        $('.nav-hub').toggleClass('drag-on', on);
        // 拖拽句柄必须是卡片本体(.site-card-box),不能是外层栅格列:
        // 列里包着 <a>,链接默认可拖,先起的是"拖链接"而不是"拖卡片",于是拖不动(2026-11-12)。
        $('[data-site-item][data-id]').each(function () {
            const box = this.querySelector('.site-card-box');
            if (box) box.setAttribute('draggable', on ? 'true' : 'false');
            else this.setAttribute('draggable', on ? 'true' : 'false');
        });
    }
    // 卡片拖拽已退役(2026-11-12):3000 站点时整页重排成本过高,改用右键菜单的单条排序。
    // 代码保留但不再启用;分类拖拽(设置 → 分类)不受影响。
    setNavDrag(false);
    let $dragSrc = null;
    let navTocMoved = false;   // 本次拖拽落在了目录上(换分类),跳过排序保存条
    // 拖拽即存(2026-11-10):拖完松手自动保存,不再要求点「保存排序」。
    // 快照 + 定时器放在外面:连续拖动只发一次请求,失败了按快照把 DOM 顺序还原。
    let navOrderSnapshot = [];
    let navOrderTimer = 0;
    function navCollectOrderIds() {
        const ids = [];
        $('.nav-hub [data-site-item][data-id]').each(function() {
            const n = parseInt(this.getAttribute('data-id'), 10);
            if (n) ids.push(n);
        });
        return ids;
    }
    function navApplyOrderIds(ids) {   // 只在自己的父节点内重排,不跨分类搬卡片
        const byId = {};
        $('.nav-hub [data-site-item][data-id]').each(function() {
            byId[String(this.getAttribute('data-id'))] = this;
        });
        ids.forEach(function(id) {
            const el = byId[String(id)];
            if (el && el.parentNode) el.parentNode.appendChild(el);
        });
    }
    function navSaveSiteOrder(opts) {
        opts = opts || {};
        // 「按常用度/名称/最近添加」是用 appendChild 改的真 DOM 顺序,存下去会把当前视图顺序当手工顺序
        if (navSortModeGet() !== 'default') {
            if (!opts.silent) showToast('当前按常用度显示，先关掉这个开关再保存顺序');
            return;
        }
        const ids = navCollectOrderIds();
        if (!ids.length) return;
        $.ajax({
            url: SF_URLS.siteOrder, method: 'POST', contentType: 'application/json',
            headers: { 'X-CSRFToken': csrf() },
            data: JSON.stringify({ order: ids }),
            success: function() {
                if (!opts.silent) showToast('顺序已保存');
            },
            error: function() {
                if (opts.snapshot && opts.snapshot.length) {
                    navApplyOrderIds(opts.snapshot);
                    showToast('保存失败，顺序已恢复');
                } else {
                    showToast('保存失败，请重试');
                }
            }
        });
    }
    $('.nav-hub').on('dragstart', '[data-site-item][data-id]', function(e) {
        if (!$('.nav-hub').hasClass('drag-on')) { e.preventDefault(); return; }
        navOrderSnapshot = navCollectOrderIds();   // 拖之前的样子,保存失败要能退回去
        // pet.js 要把卡片拖到桌宠上星标,但它够不到这里的闭包变量(之前直接写 $dragSrc,
        // 每次拖拽都抛 ReferenceError,功能从上线起就是坏的)。这里挂一个显式句柄给它。
        window.navDragSrcEl = this;
        $dragSrc = $(this).addClass('drag-src');
        $('#navToc').addClass('drag-armed');   // 目录进入"可接卡片换分类"状态
        try {
            e.originalEvent.dataTransfer.effectAllowed = 'move';
            e.originalEvent.dataTransfer.setData('text/plain', String(this.getAttribute('data-id')));
        } catch (err) { /* IE 兜底,拖拽本身不依赖 */ }
    });
    // dragover 每秒会触发几十上百次,每次都搬 DOM 会强制重排 —— 卡片一多就"拖起来很卡"。
    // 改成每帧最多搬一次,并把最后一次位置记下来在 rAF 里执行。
    let navDragRaf = 0;
    let navDragLast = null;
    $('.nav-hub').on('dragover', '[data-site-item][data-id]', function(e) {
        if (!$dragSrc || $dragSrc[0] === this) return;
        e.preventDefault();
        navDragLast = { target: this, x: e.originalEvent.clientX };
        if (navDragRaf) return;
        navDragRaf = window.requestAnimationFrame(function() {
            navDragRaf = 0;
            if (!navDragLast || !$dragSrc) return;
            const target = navDragLast.target;
            const r = target.getBoundingClientRect();
            const after = (navDragLast.x - r.left) > r.width / 2;
            if (after) target.after($dragSrc[0]); else target.before($dragSrc[0]);
        });
    });
    $('.nav-hub').on('drop', '[data-site-item]', function(e) { e.preventDefault(); });
    // 拖拽卡片到左侧目录 = 换分类/小分类(立即生效);小分类取自对应内容区的 data-collapse-id
    $('#navToc').on('dragover', 'a[href^="#"]', function(e) {
        if (!$dragSrc) return;
        e.preventDefault();
        if (e.originalEvent.dataTransfer) e.originalEvent.dataTransfer.dropEffect = 'move';
        $(this).addClass('drop-target');
    });
    $('#navToc').on('dragleave', 'a[href^="#"]', function() {
        $(this).removeClass('drop-target');
    });
    $('#navToc').on('drop', 'a[href^="#"]', function(e) {
        if (!$dragSrc) return;
        e.preventDefault(); e.stopPropagation();
        $('#navToc .drop-target').removeClass('drop-target');
        const section = document.querySelector(this.getAttribute('href'));
        if (!section) return;
        let category = section.getAttribute('data-category') || '';
        let subcat = '';
        if (!category) {
            // 小分类区:分类名/小分类名 编在 data-collapse-id 里
            const pair = String(section.getAttribute('data-collapse-id') || '').split('/');
            category = pair[0] || '';
            subcat = pair.slice(1).join('/') || '';
        }
        if (!category) return;   // HTML 工具区等非站点分类
        const id = parseInt($dragSrc.data('id'), 10);
        if (!id) return;
        navTocMoved = true;
        const targetHref = this.getAttribute('href');
        $.ajax({
            url: SF_URLS.move, method: 'POST', contentType: 'application/json',
            headers: { 'X-CSRFToken': csrf() },
            data: JSON.stringify({id: id, category: category, subcat: subcat}),
            success: function() {
                // 刷新后自动滚到新分类位置(B4)
                try { sessionStorage.setItem('navScrollTo', targetHref); } catch (err) {}
                location.reload();
            },
            error: function() { showToast('换分类失败'); }
        });
    });
    $('.nav-hub').on('dragend', '[data-site-item]', function() {
        if (!$dragSrc) return;
        $('.drag-src').removeClass('drag-src');
        $('#navToc').removeClass('drag-armed');
        $('#navToc .drop-target').removeClass('drop-target');
        $dragSrc = null;
        window.navDragSrcEl = null;
        if (navTocMoved) { navTocMoved = false; return; }   // 换分类会整页刷新,不需要保存顺序
        // 松手即存:600ms 内继续拖只保留最后一次,不会一边拖一边发请求
        clearTimeout(navOrderTimer);
        navOrderTimer = setTimeout(function() {
            navSaveSiteOrder({ snapshot: navOrderSnapshot });
        }, 600);
    });
    // 2026-11-14:原来的「保存排序 / 放弃」浮动条已删(从未显示过,拖拽早已松手即存)
    // pet.js 拖到桌宠星标后要告诉这里"这次拖拽已处理,别弹保存条"
    window.navDragMarkMoved = function() { navTocMoved = true; };

    syncStarButtons(); renderNavStars(); renderNavRecent();

    // 设置:分类排序与显隐(先只改列表,点"保存排序"才提交)
    const $catSave = $('#catOrderSave');
    function markCatDirty() { $catSave.prop('disabled', false); }
    $('#catOrderList').on('click', '.cat-toggle', function() {
        const $li = $(this).closest('li').toggleClass('cat-hidden');
        $(this).find('> i').toggleClass('fa-eye fa-eye-slash');
        markCatDirty();
    });
    $('#catOrderList').on('click', '.cat-move-top', function() {
        const $li = $(this).closest('li');
        if (!$li.parent().children().first().is($li)) { $li.parent().prepend($li); markCatDirty(); }
    });
    $('#catOrderList').on('click', '.cat-move-up', function() {
        const $li = $(this).closest('li'), $prev = $li.prev('li');
        if ($prev.length) { $li.insertBefore($prev); markCatDirty(); }
    });
    $('#catOrderList').on('click', '.cat-move-down', function() {
        const $li = $(this).closest('li'), $next = $li.next('li');
        if ($next.length) { $li.insertAfter($next); markCatDirty(); }
    });
    $('#catOrderList').on('click', '.cat-move-bottom', function() {
        const $li = $(this).closest('li');
        if (!$li.parent().children().last().is($li)) { $li.parent().append($li); markCatDirty(); }
    });
    $catSave.on('click', function() {
        const order = $('#catOrderList li').map(function() {
            return {name: String($(this).data('cat')), hidden: $(this).hasClass('cat-hidden')};
        }).get();
        $catSave.prop('disabled', true);
        $.ajax({
            url: SF_URLS.categoryOrder, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({order: order}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function() { location.reload(); },
            error: function() { $catSave.prop('disabled', false); showToast('排序保存失败'); }
        });
    });
    $('#catOrderReset').on('click', function() {
        $.ajax({
            url: SF_URLS.categoryOrder, type: 'POST', contentType: 'application/json',
            data: JSON.stringify({order: []}),
            beforeSend: xhr => xhr.setRequestHeader('X-CSRFToken', csrf()),
            success: function() { location.reload(); },
            error: () => showToast('操作失败')
        });
    });

    // 站内实时过滤(独立站内搜索框 + 顶部小搜索框共用):输入即在页面内筛卡片,空分类/小分类隐藏
    // ⚠️ 清空恢复不能靠 :visible 判断——过滤期留在容器上的 display:none 会让里面的卡片"看不见",
    //    恢复判断永远为 0,造成清空后全页空白的 bug(2026-10-04 用户实测);改为过滤前拍内联样式快照,清空原样还原
    // 2000 站量级预备(2026-10-16):卡片 haystack 与"小分类/大类 → 所含卡片"层级建成一次内存索引,
    // 之后每次输入只做纯字符串匹配 + 差异写 DOM,不再整树 jQuery 遍历 + 全量 getAttribute。
    function navFilterQuery() {
        return String($('#navSearch').val() || '');
    }
    // 拼音/首字母检索:首字母由服务端随卡片渲染写入 data-initial,本机只控制是否启用与最小长度。
    const PINYIN_SEARCH_KEY = 'navPinyinSearch';
    const PINYIN_MIN_LEN = 3;
    function navPinyinEnabled() { return localStorage.getItem(PINYIN_SEARCH_KEY) !== '0'; }
    function navPinyinEligible(q) {
        return /^[a-z0-9]+$/.test(q) && q.length >= PINYIN_MIN_LEN;
    }
    $('#setPinyinSearch').prop('checked', navPinyinEnabled());
    $('#setPinyinSearch').on('change', function() {
        localStorage.setItem(PINYIN_SEARCH_KEY, this.checked ? '1' : '0');
        navApplyFilter();
    });
    // 纯函数:索引条目 + 查询词 → 命中布尔数组(不碰 DOM,便于 node 单测)
    function navFilterHits(items, q, opts) {
        const useInitial = Boolean(opts && opts.useInitial);
        const hits = new Array(items.length);
        for (let i = 0; i < items.length; i++) {
            hits[i] = items[i].hay.indexOf(q) >= 0 || (useInitial && items[i].initial && items[i].initial.indexOf(q) >= 0);
        }
        return hits;
    }
    // 建索引:items(卡片+haystack+标签)/subs/cats(容器 → 所含卡片序号)/nodes(元素身份指纹)。
    // 卡片数变化(删除/撤销)自动重建;数量不变但节点被替换(删1增1/编辑换新节点)靠身份比对抓到
    let navIdx = null;
    function navBuildIndex() {
        const pos = new Map();
        const items = [];
        const nodes = [];
        $('[data-site-item]').each(function() {
            pos.set(this, items.length);
            let tags = [];
            try { tags = JSON.parse(this.getAttribute('data-tags') || '[]'); } catch (e) { tags = []; }
            if (!Array.isArray(tags)) tags = [];
            const name = String(this.getAttribute('data-name') || '');
            items.push({el: this, hay: String(this.getAttribute('data-search') || '').toLowerCase(),
                        tags: tags.map(t => String(t)),
                        name: name,
                        initial: String(this.getAttribute('data-initial') || '').toLowerCase(),
                        clicks: Number(this.getAttribute('data-clicks')) || 0,
                        created: Number(this.getAttribute('data-created')) || 0,
                        originalIndex: items.length});
            nodes.push(this);
        });
        function group(sel) {
            const out = [];
            $(sel).each(function() {
                const idx = [];
                $(this).find('[data-site-item]').each(function() {
                    const p = pos.get(this);
                    if (p !== undefined) idx.push(p);
                });
                out.push({el: this, items: idx});
            });
            return out;
        }
        navIdx = {items: items, subs: group('.nav-sub, .nav-sub2'), cats: group('[data-category]'), nodes: nodes};
    }
    function navFilterIndex() {
        // 原生计数 + 元素身份双重失效判断:删卡片/撤销/删1增1/编辑换节点后索引自动重建,
        // 不依赖调用方手动刷新(数量不变但节点全换的场景,只比数量会漏)
        const cur = document.querySelectorAll('[data-site-item]');
        if (navIdx && navIdx.nodes.length === cur.length) {
            let same = true;
            for (let i = 0; i < cur.length && same; i++) {
                if (navIdx.nodes[i] !== cur[i]) same = false;
            }
            if (same) return navIdx;
        }
        navBuildIndex();
        return navIdx;
    }
    // 给 nav-search.js 的搜索建议面板复用(2026-11-14):
    // 不然它每次按键都要自己全量扫一遍 [data-site-item] + getAttribute。
    window.navFilterIndex = navFilterIndex;
    window.navPinyinSearchEnabled = navPinyinEnabled;
    window.navPinyinInitialEligible = navPinyinEligible;

    // ===== 卡片排序:默认顺序 / 常用度 / 名称 / 最近添加(只在各自父分组内重排) =====
    const NAV_SORT_KEY = 'navSortMode';
    const SORT_ROW_SEL = '.cat-body.row, .nav-cat > .row.g-2, .cat-body > .row.g-2';
    function navSortModeGet() {
        const v = localStorage.getItem(NAV_SORT_KEY);
        return ['usage', 'name', 'created'].includes(v) ? v : 'default';
    }
    function navSortCards(a, b, mode) {
        const ia = navIdxItem(a), ib = navIdxItem(b);
        if (mode === 'usage') return (ib.clicks - ia.clicks) || ia.originalIndex - ib.originalIndex;
        if (mode === 'created') return (ib.created - ia.created) || ia.originalIndex - ib.originalIndex;
        if (mode === 'name') return ia.name.localeCompare(ib.name, 'zh-Hans-CN') || ia.originalIndex - ib.originalIndex;
        return ia.originalIndex - ib.originalIndex;
    }
    function navIdxItem(el) {
        const idx = navFilterIndex();
        const hit = idx.items.find(it => it.el === el);
        return hit || {name: '', clicks: 0, created: 0, originalIndex: 0};
    }
    window.navApplySiteSort = function(mode) {
        mode = mode || navSortModeGet();
        $(SORT_ROW_SEL).each(function() {
            const cards = Array.from(this.querySelectorAll(':scope > [data-site-item]'));
            if (cards.length < 2) return;
            cards.sort((a, b) => navSortCards(a, b, mode));
            cards.forEach(c => this.appendChild(c));
        });
    };
    window.navSetSortMode = function(mode) {
        mode = ['usage', 'name', 'created'].includes(mode) ? mode : 'default';
        localStorage.setItem(NAV_SORT_KEY, mode);
        window.navApplySiteSort(mode);
        const sel = document.getElementById('navSortMode');
        if (sel) sel.value = mode;
    };
    if (navSortModeGet() !== 'default') window.navApplySiteSort(navSortModeGet());
    $(document).on('change', '#navSortMode', function() {
        window.navSetSortMode(this.value);
        if (this.value === 'usage') showToast('已按常用度排序');
        else if (this.value === 'default') showToast('已恢复默认顺序');
    });

    // ===== 搜索高亮:缓存原始文本,清空搜索时原样还原 =====
    const navTextCache = new WeakMap();
    function navHighlightTargets(el) {
        return ['.site-title', '.site-meta', '.site-desc', '.site-url', '.site-tagchip']
            .map(sel => el.querySelector(sel)).filter(Boolean);
    }
    function navTextOriginal(el) {
        if (!navTextCache.has(el)) navTextCache.set(el, el.textContent || '');
        return navTextCache.get(el);
    }
    function navEscapeReg(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function navResetHighlights(root) {
        const cards = root && root.matches && root.matches('[data-site-item]')
            ? [root]
            : (root || document).querySelectorAll('.nav-hub [data-site-item]');
        cards.forEach(card => {
            navHighlightTargets(card).forEach(el => {
                if (navTextCache.has(el)) el.textContent = navTextCache.get(el);
            });
        });
    }
    function navHighlightCard(card, re) {
        navHighlightTargets(card).forEach(el => {
            const original = navTextOriginal(el);
            if (!original || !re) return;
            el.textContent = original;
            const hay = original.toLowerCase();
            if (!re.test(hay)) return;
            el.textContent = '';
            let last = 0, match;
            re.lastIndex = 0;
            while ((match = re.exec(original)) !== null) {
                if (match.index > last) el.append(original.slice(last, match.index));
                const mark = document.createElement('mark');
                mark.className = 'nav-search-mark';
                mark.textContent = match[0];
                el.appendChild(mark);
                last = match.index + match[0].length;
                if (match[0].length === 0) re.lastIndex++;
            }
            if (last < original.length) el.append(original.slice(last));
        });
    }
    function navClearAllHighlights() { navResetHighlights(document); }

    // ===== 空结果推荐:最近使用 → 星标 → 高频 → 新站 =====
    function navEmptyRecs() {
        const idx = navFilterIndex();
        const byUrl = new Map();
        idx.items.forEach(it => {
            const url = it.el.getAttribute('data-url') || '';
            if (url && !byUrl.has(url)) byUrl.set(url, it);
        });
        const out = [], seen = new Set();
        const push = it => {
            const url = it.el.getAttribute('data-url') || '';
            if (!url || seen.has(url)) return;
            seen.add(url); out.push(it);
        };
        navLsGet('navRecent').slice(0, 8).forEach(x => {
            const url = x && x.url;
            if (url && byUrl.has(url)) push(byUrl.get(url));
        });
        navLsGet('navStars').slice(0, 8).forEach(url => { if (byUrl.has(url)) push(byUrl.get(url)); });
        idx.items.slice().sort((a, b) => b.clicks - a.clicks || b.created - a.created)
            .slice(0, 6).forEach(push);
        return out.slice(0, 6);
    }
    function navRenderEmptyRecs(show) {
        const box = document.getElementById('navNoResultRecs');
        if (!box) return;
        box.textContent = '';
        if (!show) return;
        navEmptyRecs().forEach(it => {
            const url = it.el.getAttribute('data-url') || '';
            const a = document.createElement('a');
            a.className = 'nav-empty-rec';
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = it.name || url;
            a.dataset.url = url;
            box.appendChild(a);
        });
        box.classList.toggle('d-none', !box.children.length);
    }
    // 已选标签(多选,AND 语义):与顶栏搜索框组合过滤。点标签云/chips 增删,不写进搜索框
    const navSelectedTags = new Set();
    function navTagToggle(t) {
        t = String(t || '').trim();
        if (!t) return;
        if (navSelectedTags.has(t)) navSelectedTags.delete(t); else navSelectedTags.add(t);
        navTagCloudSync();
        navApplyFilter();
    }
    function navTagClear() {
        if (!navSelectedTags.size) return;
        navSelectedTags.clear();
        navTagCloudSync();
        navApplyFilter();
    }
    // 连续打字时按帧合并过滤:同一帧内多次 input 只跑最后一次,避免逐字符重复遍历索引/写 DOM。
    let navFilterRaf = 0;
    function navScheduleFilter() {
        if (navFilterRaf) return;
        navFilterRaf = window.requestAnimationFrame(function() {
            navFilterRaf = 0;
            navApplyFilter();
        });
    }
    function navFlushFilter() {
        if (!navFilterRaf) return;
        window.cancelAnimationFrame(navFilterRaf);
        navFilterRaf = 0;
        navApplyFilter();
    }
    window.navFlushFilter = navFlushFilter;
    function navApplyFilter() {
        if (navFilterRaf) { window.cancelAnimationFrame(navFilterRaf); navFilterRaf = 0; }
        const q = navFilterQuery().trim().toLowerCase();
        // 搜索框多词 AND:"设计 素材"不再要求连续子串,两词都出现即命中(中文搜索更直觉);
        // 纯函数 navFilterHits 仍按单词跑,多词合并放在编排层,纯函数契约不动
        const words = q ? q.split(/\s+/).filter(Boolean) : [];
        const sel = [];
        navSelectedTags.forEach(function(t) { sel.push(t); });
        const filtering = words.length > 0 || sel.length > 0;
        $('.nav-hub').toggleClass('searching', filtering);
        const SELS = ['[data-site-item]', '.nav-sub', '.nav-sub2', '[data-category]'];
        const idx = navFilterIndex();
        let visible = 0;
        if (filtering) {
            // 快照按元素本身记录(Map)而非序号:过滤期间删了卡片再清空,按序号还原会错位
            if (!navApplyFilter.snap) {
                navApplyFilter.snap = new Map();
                SELS.forEach(function(s2) {
                    $(s2).each(function() { navApplyFilter.snap.set(this, this.style.display || ''); });
                });
            }
            // 搜索词 AND:逐词跑纯函数再合并;拼音开关只读取一次,避免每个词/每张卡重复读本机存储
            const pinyinOn = navPinyinEnabled();
            const wordsRe = words.length ? new RegExp('(' + words.map(navEscapeReg).join('|') + ')', 'ig') : null;
            let hits = null;
            for (let w = 0; w < words.length; w++) {
                const h = navFilterHits(idx.items, words[w], {useInitial: pinyinOn && navPinyinEligible(words[w])});
                if (!hits) { hits = h; continue; }
                for (let i = 0; i < h.length; i++) hits[i] = hits[i] && h[i];
            }
            // 标签 AND:数组成员精确匹配(整词,不受搜索框拆词影响)
            if (sel.length) {
                if (!hits) hits = new Array(idx.items.length).fill(true);
                for (let s = 0; s < sel.length; s++) {
                    const tag = sel[s];
                    for (let i = 0; i < idx.items.length; i++) {
                        if (hits[i] && idx.items[i].tags.indexOf(tag) < 0) hits[i] = false;
                    }
                }
            }
            for (let i = 0; i < idx.items.length; i++) {
                const it = idx.items[i];
                const want = hits[i] ? '' : 'none';
                if (it.el.style.display !== want) it.el.style.display = want;   // 只写变化项
                if (hits[i]) {
                    visible++;
                    if (words.length) navHighlightCard(it.el, wordsRe); else navResetHighlights(it.el);
                } else {
                    navResetHighlights(it.el);
                }
            }
            function applyGroup(list) {
                for (let g = 0; g < list.length; g++) {
                    const grp = list[g];
                    let hit = false;
                    for (let k = 0; k < grp.items.length && !hit; k++) {
                        if (hits[grp.items[k]]) hit = true;
                    }
                    const want = hit ? '' : 'none';
                    if (grp.el.style.display !== want) grp.el.style.display = want;
                }
            }
            applyGroup(idx.subs);
            applyGroup(idx.cats);
        } else if (navApplyFilter.snap) {
            navApplyFilter.snap.forEach(function(val, el) { el.style.display = val; });
            navApplyFilter.snap = null;
            navClearAllHighlights();
        }
        const noHit = filtering && visible === 0;
        $('#navNoResult').toggleClass('d-none', !noHit);
        navRenderEmptyRecs(noHit);
    }
    $('#navSearch').on('input', function() {
        navKbIdx = -1; $('.site-card.kb-sel').removeClass('kb-sel');
        navScheduleFilter();
    });

    // 标签云面板:汇总全部标签(带站点计数,按热度降序),点击 = 多选 AND 过滤(与搜索框组合)。
    // 数据源走内存索引 items[].tags(2000 站零 DOM 扫描);每次打开面板重渲染(懒加载),删卡后计数自动新鲜
    function navTagCloudData() {
        const seen = new Map();
        navFilterIndex().items.forEach(function(it) {
            it.tags.forEach(function(t) { seen.set(t, (seen.get(t) || 0) + 1); });
        });
        const out = [];
        seen.forEach(function(c, t) { out.push({tag: t, count: c}); });
        out.sort(function(a, b) { return b.count - a.count || (a.tag < b.tag ? -1 : 1); });
        return out;
    }
    function navTagCloudRender() {
        const data = navTagCloudData();
        // 自洁:选中的标签若已随卡片删除而绝迹,剪掉,免得留下永远 0 命中的幽灵筛选
        let pruned = false;
        const alive = new Set();
        data.forEach(function(d) { alive.add(d.tag); });
        navSelectedTags.forEach(function(t) { if (!alive.has(t)) { navSelectedTags.delete(t); pruned = true; } });
        const $m = $('#navTagCloudList').empty();
        if (!data.length) { $m.append('<span class="small text-muted">还没有标签</span>'); }
        else {
            data.forEach(function(d) {
                const on = navSelectedTags.has(d.tag);
                const size = d.count >= 10 ? 'lg' : (d.count >= 5 ? 'md' : 'sm');
                $('<button type="button" class="tagcloud-item tz-' + size + (on ? ' on' : '') + '">')
                    .attr('data-tag', d.tag).attr('aria-pressed', on ? 'true' : 'false')
                    .append($('<span>').text(d.tag), $('<span class="tagcloud-n">').text(d.count))
                    .on('click', function() { navTagToggle(d.tag); })
                    .appendTo($m);
            });
        }
        navTagCloudSync();
        if (pruned) navApplyFilter();
    }
    // 选中态同步:不全量重渲染,只切 class + 计数 + 顶栏按钮徽章(保住面板滚动位置)
    function navTagCloudSync() {
        $('#navTagCloudList .tagcloud-item').each(function() {
            const on = navSelectedTags.has($(this).attr('data-tag'));
            $(this).toggleClass('on', on).attr('aria-pressed', on ? 'true' : 'false');
        });
        const n = navSelectedTags.size;
        $('#navTagSelCount').text(n ? ('已选 ' + n + ' 个') : '');
        $('#navTagClearBtn').toggleClass('d-none', !n);
        // 顶栏 🏷 按钮:有选中时亮成 primary,关掉面板也一眼看得出过滤生效中
        $('#navTagFilterBtn').toggleClass('btn-primary', !!n).toggleClass('btn-outline-secondary', !n);
    }
    $('#navTagFilterMenu').on('show.bs.dropdown', navTagCloudRender);
    $('#navTagClearBtn').on('click', function(e) { e.stopPropagation(); navTagClear(); });
    navTagCloudSync();
    // 卡片上的标签 chips:点击 = 加入/移出多选(阻止冒泡,避免点开卡片链接)
    $('.nav-hub').on('click', '.site-tagchip', function(e) {
        e.preventDefault();
        e.stopPropagation();
        navTagToggle($(this).attr('data-tag') || $(this).text());
    });
    $(document).on('click', '.nav-empty-rec', function(e) {
        const url = String(this.dataset.url || '');
        if (!url) return;
        const $card = $('.nav-hub [data-site-item][data-url="' + CSS.escape(url) + '"]').first();
        if ($card.length) {
            e.preventDefault();
            $card.find('a.site-card').first().trigger('click');
        }
    });

    // 标签防过载(2026-11-18):每卡最多平铺 3 个 tagchip,其余折进「+N」,点一下就地展开。
    // 用独立类 site-tag-more(不带 site-tagchip),免得被上面的筛选委托当成标签名
    $('.nav-hub .site-tags').each(function() {
        const $chips = $(this).find('.site-tagchip');
        if ($chips.length <= 3) return;
        $chips.slice(3).addClass('d-none');
        $('<button type="button" class="site-tag-more">').text('+' + ($chips.length - 3))
            .on('click', function(e) {
                e.stopPropagation();
                $chips.removeClass('d-none');
                $(this).remove();
            })
            .appendTo($(this));
    });

    // 换分类刷新后(B4):自动展开并滚到目标分类,高亮 2 秒
    (function() {
        let target = null;
        try { target = sessionStorage.getItem('navScrollTo'); } catch (e) {}
        if (!target) return;
        sessionStorage.removeItem('navScrollTo');
        const el = document.querySelector(target);
        if (!el) return;
        el.classList.remove('is-collapsed');
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('flash-target');
        setTimeout(() => el.classList.remove('flash-target'), 2400);
    })();

    // favicon 两个源(favicon.im → Google s2)都失败:换成首字母色块,不留白
    window.navFavFail = function(el) {
        const name = String($(el).closest('[data-site-item]').data('name') || '?').trim();
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
        const span = document.createElement('span');
        span.className = 'site-fav fav-letter';
        span.style.background = 'hsl(' + h + ',55%,45%)';
        span.textContent = name.charAt(0).toUpperCase();
        el.replaceWith(span);
    };

    // 目录跟随滚动高亮:视口上沿(84px 补偿)之上的最后一个可见分组/小分类置 active
    (function navTocSpy() {
        const $links = $('#navToc a[href^="#"]');
        const targets = [];
        $links.each(function() {
            const el = document.getElementById(this.getAttribute('href').slice(1));
            if (el) targets.push([el, this]);
        });
        if (!targets.length) return;
        let ticking = false;
        function mark() {
            ticking = false;
            let cur = null;
            for (const [el, a] of targets) {
                if (!el.offsetParent) continue;
                if (el.getBoundingClientRect().top <= 100) cur = a; else break;
            }
            if (!cur) {
                const first = targets.find(function(t) { return t[0].offsetParent; });
                cur = first ? first[1] : null;
            } else {
                const last = targets[targets.length - 1];
                if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && last[0].offsetParent) cur = last[1];
            }
            const $a = cur ? $(cur) : null;
            if ($a && !$a.hasClass('active')) { $links.removeClass('active'); $a.addClass('active'); }
            else if (!$a) $links.removeClass('active');
        }
        $(window).on('scroll resize', function() { if (!ticking) { ticking = true; requestAnimationFrame(mark); } });
        mark();
    })();

    // 折叠/展开(大类与小分类两级,状态存本机 localStorage)
    const collapsedKey = 'navCollapsed';
    function collapsedSet() {
        try { return new Set(JSON.parse(localStorage.getItem(collapsedKey) || '[]')); }
        catch (e) { return new Set(); }
    }
    (function applyCollapsed() {
        const s = collapsedSet();
        $('[data-collapse-id]').each(function() {
            if (!s.has(String($(this).data('collapse-id')))) return;
            $(this).addClass('is-collapsed');
            $(this).children('.collapsible').children('.cheve').addClass('rot');
        });
    })();
    $('.nav-hub').on('click', '.collapsible', function(e) {
        // 分类头的「···」菜单就长在折叠标题里,点它只开菜单,别把分类折起来(2026-11-10)
        if ($(e.target).closest('.nav-cat-menu').length) return;
        const $w = $(this).closest('[data-collapse-id]');
        const id = String($w.data('collapse-id'));
        const s = collapsedSet();
        if (s.has(id)) s.delete(id); else s.add(id);
        localStorage.setItem(collapsedKey, JSON.stringify([...s]));
        $w.toggleClass('is-collapsed');
        $(this).children('.cheve').toggleClass('rot');
    });
    $('#navExpandAll').on('click', function() {
        localStorage.setItem(collapsedKey, '[]');
        $('[data-collapse-id]').removeClass('is-collapsed');
        $('[data-collapse-id] .collapsible .cheve').removeClass('rot');
    });
    $('#navCollapseAll').on('click', function() {
        const $w = $('[data-collapse-id]');
        localStorage.setItem(collapsedKey, JSON.stringify($w.map(function() {
            return String($(this).data('collapse-id'));
        }).get()));
        $w.addClass('is-collapsed');
        $w.children('.collapsible').children('.cheve').addClass('rot');
    });

    // 含子网页的站点:点击卡片弹窗选择(主站 + 各子页);30 秒未选择自动打开主站
    let subAutoTimer = null;
    function cancelSubAuto() { if (subAutoTimer) { clearTimeout(subAutoTimer); subAutoTimer = null; } }
    $('#subModal').on('hidden.bs.modal', cancelSubAuto);
    $('#subModalBody').on('click', 'a', cancelSubAuto);
    $('.nav-hub').on('click', '.site-card[data-has-sub]', function(e) {
        if ($(e.target).closest('.site-edit, .site-del').length) return;
        e.preventDefault();
        const $card = $(this);
        const name = String($card.data('name') || '');
        $('#subModalTitle').text(name);
        const $body = $('#subModalBody').empty();
        const mainUrl = String($card.data('main-url') || '');
        const favSrc = $card.closest('[data-site-item]').find('img.site-fav').attr('src') || '';
        // 富行:图标 + 名称 + 网址小字 + 类型徽章(借鉴发现导航 web-more-menu)
        function subItem(tag, name, url, ico) {
            const $a = $('<a class="list-group-item list-group-item-action sub-item-row" target="_blank" rel="noopener noreferrer">')
                .attr('href', url);
            const $ico = $('<span class="sub-ico">');
            if (favSrc) $ico.append($('<img class="sub-ico-img">').attr('src', favSrc));
            else $ico.append($('<i class="fas ' + ico + '">'));
            const $txt = $('<div class="min-w-0 flex-grow-1">');
            $txt.append($('<div class="sub-item-name text-truncate">').text(name));
            $txt.append($('<div class="sub-item-url text-truncate">').text(url));
            $a.append($ico, $txt, $('<span class="sub-tag">').text(tag));
            return $a;
        }
        if (mainUrl) {
            $body.append(subItem('主站', name, mainUrl, 'fa-house'));
        }
        $card.closest('[data-site-item]').find('.site-sub').each(function() {
            const url = $(this).attr('href');
            if (!url) return;
            $body.append(subItem('子页', String($(this).data('name') || url), url, 'fa-link'));
        });
        $card.closest('[data-site-item]').find('.site-alt').each(function() {
            const url = $(this).attr('href');
            if (!url) return;
            $body.append(subItem('备用', String($(this).data('name') || url), url, 'fa-shield-halved'));
        });
        const autoTip = (window.NavI18n && NavI18n.getLang && NavI18n.getLang() === 'en')
            ? 'Opens the main site automatically if nothing is picked in 30 s'
            : '30 秒内未选择,将自动打开主站';
        $body.append($('<div class="small text-muted px-2 pt-1 pb-0">').text(autoTip));
        bootstrap.Modal.getOrCreateInstance($('#subModal')[0]).show();
        cancelSubAuto();
        if (mainUrl) {
            subAutoTimer = setTimeout(function() {
                subAutoTimer = null;
                bootstrap.Modal.getOrCreateInstance($('#subModal')[0]).hide();
                window.open(mainUrl, '_blank', 'noopener');
            }, 30000);
        }
    });

    // ===== 快捷键直达:Alt+1~9 打开前九个常用站(读 navRecent;2026-10-25 brainstorm 落地) =====
    // ⚠️ Chrome 把 Ctrl+1~9 保留给"切标签页",页面拦不到,所以主键位是 Alt;Ctrl 也试着拦(Firefox 可用)
    document.addEventListener('keydown', function(e) {
        if (!(e.altKey || e.ctrlKey) || e.shiftKey || e.metaKey) return;
        const tag = (e.target && e.target.tagName) || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
        const num = parseInt(e.key, 10);
        if (!(num >= 1 && num <= 9)) return;
        if (!e.altKey && !e.ctrlKey) return;
        const recents = navLsGet('navRecent').filter(Boolean);
        const hit = recents[num - 1];
        if (!hit || !hit.url) return;
        e.preventDefault();
        window.open(hit.url, '_blank', 'noopener');
        navTouchRecent(hit.url);
        if (window.navPetSay) window.navPetSay('Alt+' + num + ':「' + (hit.name || hit.url) + '」!', 2200);
    });

    // ===== 键盘流(2026-10-25 brainstorm):数字切大类 → 字母选卡 → 回车打开,手不离键盘 =====
    // 与 Alt+1~9(直达常用站)、Ctrl+K(聚焦搜索)拼成完整键盘流;输入框聚焦时不抢键
    let kbdCatIdx = 0, kbdCardEl = null;   // 当前大类上下文 / 当前高亮的卡
    function kbdClearCand() {
        if (kbdCardEl) { kbdCardEl.style.outline = ''; kbdCardEl = null; }
    }
    function kbdCardsOfCat(idx) {
        const item = document.querySelectorAll('#navToc .toc-item')[idx];
        if (!item) return [];
        const a = item.querySelector('a');
        if (!a) return [];
        const target = document.querySelector(a.getAttribute('href') || '');
        if (!target) return [];
        return Array.prototype.slice.call(target.querySelectorAll('[data-site-item][data-url]'));
    }
    document.addEventListener('keydown', function(e) {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const tag = (e.target && e.target.tagName) || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
        // 1) 数字 1-9:切到第 N 个大类(目录点击 = 滚动+展开),并建立"字母选卡"上下文
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
            const items = document.querySelectorAll('#navToc .toc-item');
            if (num > items.length) return;
            kbdClearCand();
            kbdCatIdx = num - 1;
            const a = items[kbdCatIdx].querySelector('a');
            if (a) a.click();
            const catName = (items[kbdCatIdx].textContent || '').trim().split('\\n')[0];
            if (window.navPetSay) window.navPetSay('⌨️ 第 ' + num + ' 类「' + catName + '」:字母选卡,回车打开', 3200);
            return;
        }
        // 2) 字母 a-z:在当前大类里选中第 N 张卡(超过 26 张的尾部用数字 8/9/0 键?先只支持前 26)
        if (/^[a-z]$/i.test(e.key) && kbdCatIdx >= 0) {
            const cards = kbdCardsOfCat(kbdCatIdx);
            const pos = e.key.toLowerCase().charCodeAt(0) - 97;
            if (pos >= cards.length) return;
            kbdClearCand();
            kbdCardEl = cards[pos];
            kbdCardEl.style.outline = '2px solid var(--accent)';
            kbdCardEl.scrollIntoView({block: 'center', behavior: 'smooth'});
            return;
        }
        // 3) 回车:打开当前高亮的卡;Esc:取消高亮
        if (e.key === 'Enter' && kbdCardEl) {
            e.preventDefault();
            const url = kbdCardEl.getAttribute('data-url');
            window.open(url, '_blank', 'noopener');
            if (typeof navTouchRecent === 'function') navTouchRecent(url);
            kbdClearCand();
            return;
        }
        if (e.key === 'Escape') kbdClearCand();
    });
});
