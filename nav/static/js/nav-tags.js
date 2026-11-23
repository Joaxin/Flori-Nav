/* ==========================================================================
   R-23 标签前端词表 + 稳定哈希配色(独立组件,档位 A 零迁移方案)

   职责只做两件,不碰其它:
     1. 词表补全:从已渲染卡片收集标签词(去空 / 去重 / 按频次排序 / 上限封顶),
        运行时注入一个 <datalist>,给添加 / 编辑弹窗的标签输入挂 list= 建议;
        不在模板里硬写 datalist,重复注入幂等。
     2. 稳定配色:标签名 → 稳定哈希 → 固定调色板下标 → 同一字符串恒等同一色;
        以 data-nav-tag-color 属性 + 内联 CSS 变量 --nav-tag-c 落到 chip 上。
        主人页与访客页按同一规则前端计算,同名标签两端同色。

   边界约束(契约,与 nav-widgets.js 注册表同口径):
     - 零网络:无 fetch / XMLHttpRequest / sendBeacon / $.ajax / axios / 后端接口;
     - 零存储:不读写 localStorage / sessionStorage / cookie;
     - 不写库、不加后端字段、不改 data-layout 三值白名单;访客态零写请求;
     - 注册表协议:window.NavWidgets 存在则 register;否则推入 __navWidgetQueue
       兜底队列,等注册表 drain。不自造第二套注册机制。
   ========================================================================== */
(function () {
    'use strict';

    // --- 集中常量:公开键名 / 词表上限 / 调色板 ---

    // datalist 注入节点 id;标签输入 list= 指向它。
    var TAG_DATALIST_ID = 'navTagWordList';

    // 词表上限:只取当前页出现过的标签,频次降序、同频按词名稳定排序;
    // 上限封顶避免 datalist 过长影响建议下拉体验(60 条足够覆盖常用标签)。
    var MAX_SUGGEST_WORDS = 60;

    // 固定调色板:12 个色相(HSL hue)。哈希只决定下标,色相表本身不变,
    // 保证同一标签在主人页 / 访客页、不同会话里恒等同一色。
    var PALETTE_HUES = [265, 210, 176, 152, 96, 46, 16, 346, 318, 288, 204, 24];

    var root = null;
    var mounted = false;
    var observer = null;
    var datalist = null;
    var raf = 0;

    /* ---------- 稳定哈希:FNV-1a 32-bit,纯字符串确定性映射 ---------- */

    function hashTag(name) {
        var hash = 0x811c9dc5;
        var str = String(name == null ? '' : name);
        for (var i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return hash >>> 0;
    }

    // 标签名 → 调色板下标;同一字符串恒等同一下标。
    function colorKeyFor(name) {
        var idx = hashTag(name) % PALETTE_HUES.length;
        return PALETTE_HUES[idx];
    }

    function colorHsl(hue) {
        return 'hsl(' + hue + ' 70% 45%)';
    }

    /* ---------- 词表收集:扫描卡片 data-tags JSON,兜底扫 chip 文本 ---------- */

    function collectWords() {
        var counts = new Map();
        var cards = document.querySelectorAll('[data-tags]');
        Array.prototype.forEach.call(cards, function (card) {
            var raw = card.getAttribute('data-tags');
            var parsed = [];
            try {
                parsed = JSON.parse(raw || '[]');
            } catch (e) {
                parsed = [];
            }
            if (!Array.isArray(parsed)) parsed = [];
            parsed.forEach(function (t) {
                var word = String(t == null ? '' : t).trim();
                if (word) counts.set(word, (counts.get(word) || 0) + 1);
            });
        });
        // 兜底:JSON 缺失时从 chip 文本补扫,避免漏词。
        var chips = document.querySelectorAll('.site-tagchip[data-tag]');
        Array.prototype.forEach.call(chips, function (chip) {
            var word = String(chip.getAttribute('data-tag') || '').trim();
            if (word) counts.set(word, (counts.get(word) || 0) + 1);
        });
        return counts;
    }

    function suggestWords() {
        var counts = collectWords();
        var words = Array.from(counts.keys());
        // 频次降序;同频按词名排序,结果稳定可复现。
        words.sort(function (a, b) {
            var ca = counts.get(b) - counts.get(a);
            return ca !== 0 ? ca : a.localeCompare(b, 'zh-Hans-CN');
        });
        return words.slice(0, MAX_SUGGEST_WORDS);
    }

    /* ---------- 配色:给 chip 写属性与 CSS 变量 ---------- */

    function paintChip(chip) {
        var name = String(chip.getAttribute('data-tag') || '').trim();
        if (!name) return;
        var hue = colorKeyFor(name);
        var hueText = String(hue);
        var color = colorHsl(hue);
        // 值未变时不写:本文件在 body 上挂了 childList/attribute 观察器,
        // 重复写同一属性会制造无意义的 mutation,极端时形成每帧自激。
        if (chip.getAttribute('data-nav-tag-color') !== hueText) {
            chip.setAttribute('data-nav-tag-color', hueText);
        }
        if (chip.style.getPropertyValue('--nav-tag-c') !== color) {
            chip.style.setProperty('--nav-tag-c', color);
        }
    }

    function paintAllChips() {
        var chips = document.querySelectorAll('.site-tagchip[data-tag]');
        Array.prototype.forEach.call(chips, paintChip);
    }

    /* ---------- datalist 注入(幂等) ---------- */

    function ensureDatalist() {
        if (!datalistExists()) {
            datalist = document.createElement('datalist');
            datalist.id = TAG_DATALIST_ID;
            datalist.setAttribute('aria-label', '常用标签建议');
            document.body.appendChild(datalist);
        } else {
            datalist = document.getElementById(TAG_DATALIST_ID);
        }
        refreshDatalist();
    }

    function datalistExists() {
        return !!document.getElementById(TAG_DATALIST_ID);
    }

    function refreshDatalist() {
        if (!datalist) return;
        var words = suggestWords();
        // 关键:观察器监听 body 子树 childList;若每次清空重填,清空/追加本身
        // 会产生 mutation → 再排一次 rAF → 再清空,形成 60fps 自激。
        // 词表未变时直接返回,仅在真正增删词时重写 DOM。
        var existing = Array.prototype.map.call(datalist.options, function (opt) {
            return opt.value;
        });
        if (existing.length === words.length && existing.every(function (word, i) {
            return word === words[i];
        })) return;
        while (datalist.firstChild) datalist.removeChild(datalist.firstChild);
        words.forEach(function (word) {
            var opt = document.createElement('option');
            opt.value = word;
            datalist.appendChild(opt);
        });
    }

    /* ---------- 给标签输入挂 list= 建议 ---------- */

    function bindTagInputs() {
        var inputs = document.querySelectorAll('.f-tags');
        Array.prototype.forEach.call(inputs, function (input) {
            if (input.getAttribute('list') !== TAG_DATALIST_ID) {
                input.setAttribute('list', TAG_DATALIST_ID);
            }
        });
    }

    /* ---------- 懒渲染兜底:观察卡片子树变化,重刷配色与词表 ---------- */

    function scheduleRefresh() {
        if (raf) return;
        raf = window.requestAnimationFrame(function () {
            raf = 0;
            paintAllChips();
            refreshDatalist();
            bindTagInputs();
        });
    }

    function startObserver() {
        if (typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver(function () {
            scheduleRefresh();
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-tag', 'data-tags']
        });
    }

    function stopObserver() {
        if (observer) { observer.disconnect(); observer = null; }
        if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    }

    /* ---------- 挂载 / 卸载 ---------- */

    function mount() {
        if (mounted) return;
        paintAllChips();
        ensureDatalist();
        bindTagInputs();
        startObserver();
        mounted = true;
    }

    function unmount() {
        if (!mounted) return;
        stopObserver();
        if (datalist && datalist.parentNode) datalist.parentNode.removeChild(datalist);
        datalist = null;
        var inputs = document.querySelectorAll('.f-tags');
        Array.prototype.forEach.call(inputs, function (input) {
            input.removeAttribute('list');
        });
        var chips = document.querySelectorAll('.site-tagchip[data-nav-tag-color]');
        Array.prototype.forEach.call(chips, function (chip) {
            chip.removeAttribute('data-nav-tag-color');
            chip.style.removeProperty('--nav-tag-c');
        });
        mounted = false;
    }

    var descriptor = {
        id: 'nav-tags',
        name: 'R-23 标签词表与稳定配色',
        // 落点挂主容器;本组件不向该容器插入自有节点,只借选择器避开注册表
        // 对 body 的 el-busy 占用判定(与 fixbar / nav-skin 互不抢落点)。
        selector: '.nav-container',
        priority: 40,
        mount: mount,
        unmount: unmount
    };

    /* 注册表协议:有注册表就 register;没有就进兜底队列,等注册表 drain。
       不实现第二套注册表;mount 本身幂等,重复调用不会挂出第二份 DOM。 */
    if (window.NavWidgets && typeof window.NavWidgets.register === 'function') {
        window.NavWidgets.register(descriptor);
    } else {
        window.__navWidgetQueue = window.__navWidgetQueue || [];
        window.__navWidgetQueue.push(descriptor);
    }

    // 暴露描述符供测试 / 集成层 drain 与核对;不做网络请求。
    window.__navTagsDescriptor = descriptor;
})();
