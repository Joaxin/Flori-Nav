/* 命令面板(2026-11-20 P1)
   ----------------------------------------------------------------------------
   为什么单独做:站内搜索框在页面中部,想快速找站还得先滚上去点一下。命令面板
   用 Ctrl/Cmd+K 在任意位置唤起,输入同时镜像进 #navSearch —— 站内过滤、多词 AND、
   拼音首字母、空分类隐藏全部还是 stars-filter.js 那一条管道,不再重写一套匹配。
   结果面板只是同一份索引的可视化:先列命令(足迹/备份/外观开关),再列命中的站点;
   回车打开站点走真实卡片 click(点击埋点、子页选择弹窗都跟着生效),不另开 window.open。

   键盘约定与 nav-search.js 一致:↑↓ 选、Enter 执行、Esc 关闭;输入法组合期间
   (isComposing / keyCode 229)整段跳过,避免把候选词操作抢走。
*/
(function () {
    'use strict';

    var MAX_SITES = 8;
    var pal = null, input = null, list = null, open = false;
    var rows = [];              // [{kind, cmd?, url?, name?, label?}]
    var sel = 0;
    var savedSearch = null;     // 打开面板前的 #navSearch 值,关闭时还原
    var composing = false;

    function hostOf(url) {
        try { return String(url || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, ''); }
        catch (e) { return ''; }
    }
    function pinyinOn() {
        return window.navPinyinSearchEnabled ? window.navPinyinSearchEnabled()
            : localStorage.getItem('navPinyinSearch') !== '0';
    }
    function pinyinEligible(w) {
        return window.navPinyinInitialEligible ? window.navPinyinInitialEligible(w)
            : /^[a-z0-9]+$/.test(w) && w.length >= 3;
    }
    // 与 stars-filter.js / nav-search.js 同口径:小写、多词 AND;首字母只在开关打开且 ≥3 字母时参与
    function hits(hay, initial, words) {
        var on = pinyinOn();
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (hay.indexOf(w) < 0 && !(on && pinyinEligible(w) && initial && initial.indexOf(w) >= 0)) return false;
        }
        return true;
    }

    function commands() {
        return [
            {id: 'focus', icon: 'fa-magnifying-glass', title: '聚焦搜索框', hint: '/',
             run: function () { var q = document.getElementById('navEngineQ'); if (q) { q.focus(); q.select(); } }},
            {id: 'footprints', icon: 'fa-fire', title: '足迹热力图', hint: '本机',
             run: function () { if (window.navFootprint) window.navFootprint.openPanel(); }},
            {id: 'backup', icon: 'fa-file-export', title: '整包备份', hint: '本机',
             run: function () { if (window.navBackup) window.navBackup.exportPack(); }},
            {id: 'restore', icon: 'fa-file-import', title: '整包恢复(本机)', hint: '本机',
             run: function () { if (window.navBackup) window.navBackup.restorePack(); }},
            {id: 'settings', icon: 'fa-gear', title: '打开快捷设置', hint: '',
             run: function () { var b = document.getElementById('navSettingsToggle'); if (b) b.click(); }},
            {id: 'fx', icon: 'fa-wand-magic-sparkles', title: '切换背景特效', hint: '外观',
             run: function () { if (window.navAppearance) window.navAppearance.toggleFx(); }},
            {id: 'ripple', icon: 'fa-hand-pointer', title: '切换点击波纹', hint: '外观',
             run: function () { if (window.navAppearance) window.navAppearance.toggleRipple(); }},
            {id: 'top', icon: 'fa-arrow-up', title: '回到顶部', hint: '',
             run: function () { window.scrollTo({top: 0, behavior: 'smooth'}); }}
        ];
    }

    function siteMatches(q) {
        var words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        var idx = window.navFilterIndex && window.navFilterIndex();
        var pool = (idx && idx.items) || [];
        var out = [], seen = {};
        for (var i = 0; i < pool.length && out.length < MAX_SITES; i++) {
            var it = pool[i];
            if (!hits(it.hay || '', it.initial || '', words)) continue;
            var el = it.el;
            var url = el.getAttribute('data-url') || '';
            if (!url || seen[url]) continue;   // 同一网址重复收录时只留第一条
            seen[url] = 1;
            out.push({kind: 'site', url: url, name: el.getAttribute('data-name') || url});
        }
        return out;
    }

    function matchCommands(q) {
        var words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        return commands().filter(function (c) {
            if (!words.length) return true;
            var hay = (c.title + ' ' + (c.hint || '') + ' ' + c.id).toLowerCase();
            for (var i = 0; i < words.length; i++) { if (hay.indexOf(words[i]) < 0) return false; }
            return true;
        });
    }

    function buildRows(q) {
        var out = [];
        var cmds = matchCommands(q);
        cmds.forEach(function (c) { out.push({kind: 'cmd', cmd: c}); });
        if (String(q || '').trim()) {
            out.push({kind: 'web', label: '用 ' + (($('#navEngineLabel').text() || 'Google').trim()) + ' 搜索「' + q + '」'});
            siteMatches(q).forEach(function (s) { out.push(s); });
        }
        return out;
    }

    function rowEl(r, i) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'nav-cmd__row';
        d.setAttribute('data-row', String(i));
        var ico = document.createElement('i');
        ico.className = 'fas ' + (r.kind === 'cmd' ? r.cmd.icon
            : r.kind === 'web' ? 'fa-earth-asia' : 'fa-globe');
        d.appendChild(ico);
        var t = document.createElement('span');
        t.className = 'nav-cmd__t';
        t.textContent = r.kind === 'cmd' ? r.cmd.title : (r.kind === 'web' ? r.label : r.name);
        d.appendChild(t);
        var h = document.createElement('span');
        h.className = 'nav-cmd__h';
        h.textContent = r.kind === 'cmd' ? (r.cmd.hint || '') : (r.kind === 'web' ? 'Enter' : hostOf(r.url));
        d.appendChild(h);
        return d;
    }

    function render(q) {
        rows = buildRows(q);
        sel = 0;
        list.textContent = '';
        if (!rows.length) {
            var empty = document.createElement('div');
            empty.className = 'nav-cmd__empty';
            empty.textContent = '没有匹配的命令或站点';
            list.appendChild(empty);
            return;
        }
        rows.forEach(function (r, i) { list.appendChild(rowEl(r, i)); });
        paint();
        list.scrollTop = 0;
    }

    function paint() {
        var nodes = list.querySelectorAll('[data-row]');
        for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('on', i === sel);
        var cur = nodes[sel];
        if (cur && cur.scrollIntoView) cur.scrollIntoView({block: 'nearest'});
    }

    function close(restore) {
        if (!open) return;
        open = false;
        if (input) input.blur();   // 先还焦点,再 aria-hidden(否则 Chrome 报"焦点藏在隐藏层里")
        pal.classList.remove('show');
        pal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('nav-cmd-open');
        if (restore !== false && savedSearch != null) {
            $('#navSearch').val(savedSearch).trigger('input');
        }
        savedSearch = null;
    }

    function openPanel() {
        if (open) { input.focus(); input.select(); return; }
        open = true;
        savedSearch = $('#navSearch').val() || '';
        pal.classList.add('show');
        pal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('nav-cmd-open');
        input.value = '';
        render('');
        // 输入框拿焦点要在下一帧:否则同一个 Ctrl+K 的 keyup 还会落在原节点上
        setTimeout(function () { input.focus(); }, 0);
    }

    function execute(i) {
        var r = rows[i];
        if (!r) return;
        if (r.kind === 'cmd') { close(); if (r.cmd.run) r.cmd.run(); return; }
        if (r.kind === 'web') {
            var q = input.value.trim();
            close();
            var $q = $('#navEngineQ'), old = $q.val();
            $q.val(q);
            $('#navWebSearch').trigger('submit');
            $q.val(old);
            return;
        }
        // 站点:走真实卡片 click,点击埋点/子页弹窗都生效
        var card = null;
        $('[data-site-item]').each(function () {
            if (this.getAttribute('data-url') === r.url) {
                card = $(this).find('a.site-card').first();
                return false;
            }
        });
        close();
        if (card && card.length) card.trigger('click');
        else if (r.url) window.open(r.url, '_blank', 'noopener');
    }

    function syncMirror() {
        $('#navSearch').val(input.value).trigger('input');
    }

    function init() {
        pal = document.createElement('div');
        pal.id = 'navCmdPal';
        pal.className = 'nav-cmd';
        pal.setAttribute('aria-hidden', 'true');
        pal.innerHTML =
            '<div class="nav-cmd__backdrop" data-cmd-close></div>' +
            '<div class="nav-cmd__box" role="dialog" aria-modal="true" aria-label="命令面板">' +
            '  <div class="nav-cmd__bar"><i class="fas fa-terminal"></i>' +
            '    <input id="navCmdInput" type="text" autocomplete="off" spellcheck="false" ' +
            '           placeholder="搜站点、跑命令…(Ctrl/Cmd+K)" aria-label="命令面板输入">' +
            '    <kbd>Esc</kbd></div>' +
            '  <div class="nav-cmd__list" id="navCmdList" role="listbox"></div>' +
            '  <div class="nav-cmd__foot">↑↓ 选择 · Enter 执行 · Esc 关闭</div>' +
            '</div>';
        document.body.appendChild(pal);
        input = document.getElementById('navCmdInput');
        list = document.getElementById('navCmdList');

        input.addEventListener('compositionstart', function () { composing = true; });
        input.addEventListener('compositionend', function () { composing = false; syncMirror(); render(this.value); });
        input.addEventListener('input', function (e) {
            if (composing || (e.originalEvent && e.originalEvent.isComposing)) return;
            syncMirror();
            render(this.value);
        });

        pal.addEventListener('click', function (e) {
            if (e.target.closest('[data-cmd-close]')) { close(); return; }
            var row = e.target.closest('[data-row]');
            if (row) execute(parseInt(row.getAttribute('data-row'), 10));
        });

        document.addEventListener('keydown', function (e) {
            if (e.isComposing || e.keyCode === 229) return;
            var mod = e.ctrlKey || e.metaKey;
            if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                e.stopPropagation();
                if (open) close(); else openPanel();
                return;
            }
            if (!open) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                if (!rows.length) return;
                sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
                paint();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                execute(sel);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        }, true);

        // 面板开着时点页面其它位置直接关(浏览器后退/切页不需要额外处理)
        document.addEventListener('click', function (e) {
            if (!open) return;
            if (!e.target.closest('#navCmdPal')) close();
        }, true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.navCmdPal = {open: openPanel, close: close};
})();
