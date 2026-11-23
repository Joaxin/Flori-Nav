/* 超级搜索框(2026-11-13)
   ----------------------------------------------------------------------------
   背景:页面里原本两个搜索入口 —— 顶栏一个「过滤名称 / 域名 / 简介」、中间一个
   「Enter 全网搜索」,占位符长到被截断,还得在提示语里教用户站内过滤该用哪个框。
   现在只剩中间这一个:打字即筛站内卡片(沿用 stars-filter.js 已有的索引管道,
   不重写一套匹配逻辑),同时就地弹出匹配面板;不选结果直接 Enter 才走全网搜索。

   分工:
     · 站内过滤的真身仍是 stars-filter.js 的 #navSearch 管道 —— 这里只把输入值镜像进去,
       所以「多词 AND、标签组合、空分类隐藏、无结果提示」全都原样复用。
     · 面板只是同一个匹配结果的可视化:第一行永远是「用 X 搜索」,下面最多 6 个站内命中。
     · 打开站点走真实卡片 click(点击埋点、子页选择弹窗、最近使用都跟着生效),
       不是另开一个 window.open —— 否则右键菜单里那套行为会对不上。
*/
(function () {
    'use strict';

    var MAX_ROWS = 6;
    var sel = -1;          // 当前高亮行:-1 = 第一行「用 X 搜索」
    var rows = [];         // [{url, name}]
    var rafId = 0;         // 面板重绘的合并帧
    var pendingValue = null;

    var $q = null, $form = null, $panel = null, $mirror = null;

    function hostOf(url) {
        try { return String(url || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, ''); }
        catch (e) { return ''; }
    }

    function pinyinOn() { return window.navPinyinSearchEnabled ? window.navPinyinSearchEnabled() : localStorage.getItem('navPinyinSearch') !== '0'; }
    function pinyinEligible(w) { return window.navPinyinInitialEligible ? window.navPinyinInitialEligible(w) : /^[a-z0-9]+$/.test(w) && w.length >= 3; }

    // 与 stars-filter.js 的 navFilterHits 同口径:小写、多词 AND;首字母只在开关打开且 ≥3 个字母时参与
    function hitsOf(hay, initial, words) {
        var on = pinyinOn();
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            var hayHit = hay.indexOf(w) >= 0;
            var initialHit = on && pinyinEligible(w) && initial && initial.indexOf(w) >= 0;
            if (!hayHit && !initialHit) return false;
        }
        return true;
    }

    /* 卡片 → {el, hay} 的清单:优先借用 stars-filter.js 已经建好的内存索引
       (2026-11-14)。原来这里每次按键都 $('.nav-hub [data-site-item]').each + getAttribute
       全量扫一遍 DOM,3000 站时单次按键就是几千次属性读取;而索引里的 hay 就是同一份
       data-search,直接拿来做纯字符串匹配即可。索引缺失时退回 DOM 扫描(永不为空)。 */
    function cardPool() {
        var idx = window.navFilterIndex && window.navFilterIndex();
        if (idx && idx.items && idx.items.length) return idx.items;
        var out = [];
        $('.nav-hub [data-site-item]').each(function () {
            out.push({el: this, hay: String(this.getAttribute('data-search') || '').toLowerCase(),
                      initial: String(this.getAttribute('data-initial') || '')});
        });
        return out;
    }

    function findMatches(raw) {
        var words = String(raw || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        var out = [];
        var seen = {};
        var pool = cardPool();
        for (var i = 0; i < pool.length && out.length < MAX_ROWS; i++) {
            var it = pool[i];
            var el = it.el;
            if (!hitsOf(it.hay, it.initial, words)) continue;
            var url = el.getAttribute('data-url') || '';
            // 同一个网址常被重复收录(手动加一次 + 内置种子里又一次),面板里并排三条一模一样的
            // 「Gemini / gemini.google.com」看着像 bug —— 这里按 URL 去重,保留库里第一条
            if (seen[url]) continue;
            seen[url] = 1;
            out.push({name: el.getAttribute('data-name') || '', url: url});
        }
        return out;
    }

    function rowEl(icon, title, meta, idx, extra) {
        var $row = $('<button type="button" class="nav-suggest__row">').attr('data-row', idx);
        if (extra) $row.addClass(extra);
        $('<i>').addClass(icon).appendTo($row);
        $('<span class="nav-suggest__t">').text(title).appendTo($row);
        if (meta) $('<span class="nav-suggest__u">').text(meta).appendTo($row);
        return $row;
    }

    function hide() {
        // 收起时取消还没画的那一帧:否则 blur 之后它会把面板又画出来
        if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; pendingValue = null; }
        rows = [];
        sel = -1;
        $panel.prop('hidden', true).empty();
        if ($q) $q.attr('aria-expanded', 'false');
    }

    function render(raw) {
        var q = String(raw || '').trim();
        if (!q) { hide(); return; }
        var list = findMatches(q);
        var eng = ($('#navEngineLabel').text() || 'Google').trim();
        rows = list;
        sel = -1;

        var $frag = $('<div>');
        rowEl('fas fa-earth-asia', '用 ' + eng + ' 搜索「' + q + '」', 'Enter', -1, 'nav-suggest__row--web').appendTo($frag);
        if (list.length) $('<div class="nav-suggest__sep">').appendTo($frag);   // 全网搜索 / 站内命中 之间留一条分界
        list.forEach(function (it, i) {
            rowEl('fas fa-globe', it.name, hostOf(it.url), i).appendTo($frag);
        });
        $('<div class="nav-suggest__hint">')
            .text(list.length ? '↑↓ 选择 · Enter 打开 · Esc 关闭' : '站内没有匹配,Enter 直接全网搜索')
            .appendTo($frag);

        $panel.empty().append($frag.children()).prop('hidden', false);
        $q.attr('aria-expanded', 'true');
    }

    function highlight(next) {
        var n = rows.length;
        // 循环:-1(全网搜索) → 0 .. n-1 → 回到 -1
        if (next > n - 1) sel = -1;
        else if (next < -1) sel = n - 1;
        else sel = next;
        $panel.find('[data-row]').removeClass('on');
        $panel.find('[data-row="' + sel + '"]').addClass('on');
    }

    function openSite(url) {
        var $card = null;
        $('.nav-hub [data-site-item]').each(function () {
            if (this.getAttribute('data-url') === url) {
                $card = $(this).find('a.site-card').first();
                return false;
            }
        });
        hide();
        if ($card && $card.length) $card.trigger('click');
        else if (url) window.open(url, '_blank', 'noopener');
    }

    $(function () {
        $q = $('#navEngineQ');
        $form = $('#navWebSearch');
        $panel = $('#navSuggest');
        $mirror = $('#navSearch');
        if (!$q.length || !$panel.length) return;

        /* 打字 → 镜像进站内过滤管道 + 弹面板。
           ⚠️ 输入法(拼音等)在组合期间也会不断触发 input:此时的值是拼音字母,
           既不该过滤站内卡片、也不该弹"没有匹配"。所以组合期间整个跳过,
           等 compositionend 再同步一次(2026-11-14 修)。 */
        var composing = false;

        function sync(v) {
            if ($mirror.length) $mirror.val(v).trigger('input');
            scheduleRender(v);
        }
        // 面板重绘按帧合并:连打多个字符只画最后一帧,不会每个字符都重建一遍 DOM
        function scheduleRender(v) {
            pendingValue = v;
            if (rafId) return;
            rafId = window.requestAnimationFrame(function () {
                rafId = 0;
                var val = pendingValue;
                pendingValue = null;
                render(val == null ? $q.val() : val);
            });
        }
        // 键盘动作前先把还没画的这帧补上,避免 ↑↓/Enter 用到旧 rows
        function flushRender() {
            if (!rafId) return;
            window.cancelAnimationFrame(rafId);
            rafId = 0;
            var val = pendingValue;
            pendingValue = null;
            render(val == null ? $q.val() : val);
        }

        $q.on('compositionstart', function () { composing = true; });
        $q.on('compositionend', function () {
            composing = false;
            sync(this.value);
        });
        $q.on('input', function (e) {
            if (composing || (e.originalEvent && e.originalEvent.isComposing)) return;
            sync(this.value);
        });
        // 重新聚焦已有内容时把面板叫回来(和普通搜索引擎一致)
        $q.on('focus', function () {
            if (this.value.trim()) render(this.value);
        });
        $q.on('blur', function () { setTimeout(hide, 140); });

        // 按下行时不能先失焦,否则 blur → hide 抢在 click 前面
        $panel.on('mousedown', function (e) { e.preventDefault(); });

        $panel.on('click', '[data-row]', function () {
            var idx = parseInt(this.getAttribute('data-row'), 10);
            if (idx < 0) {   // 「用 X 搜索」= 走表单默认动作
                hide();
                $form.trigger('submit');
                return;
            }
            if (rows[idx]) openSite(rows[idx].url);
        });

        // 键盘导航必须抢在 stars-filter.js 的「↑↓ 选卡」之前:它在目标节点上冒泡处理,
        // 这里用 document 捕获阶段 + stopPropagation,避免两套高亮同时动。
        document.addEventListener('keydown', function (e) {
            // 输入法候选窗开着时,↑↓ 是"选字"、Esc 是"取消这次输入"、Enter 是"确认候选词"。
            // 不判断就会把候选操作抢走(Esc 甚至会清空整个搜索框)。
            if (e.isComposing || e.keyCode === 229) return;
            if ($panel.prop('hidden') || document.activeElement !== $q[0]) return;
            flushRender();
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                highlight(sel + (e.key === 'ArrowDown' ? 1 : -1));
            } else if (e.key === 'Enter') {
                if (sel >= 0 && rows[sel]) {
                    e.preventDefault();
                    e.stopPropagation();
                    openSite(rows[sel].url);
                } else {
                    hide();   // 不选结果:交给表单,按当前引擎走全网搜索
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                $q.val('');
                sync('');   // 站内过滤同步清空(走同一条镜像管道)
                hide();
            }
        }, true);

        document.addEventListener('click', function (e) {
            if (!$(e.target).closest('.nav-search-wrap').length) hide();
        });

        // 表单提交(点箭头 / 回车不选结果)→ 面板收起
        $form.on('submit', function () { hide(); });
    });
})();
