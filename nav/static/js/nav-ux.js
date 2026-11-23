/* nav-ux.js — 目录滚动高亮 / 回到顶部 / 新站标记(2026-11-12)
 *
 * 参考 Nav Hub 的几处体验细节,独立成文件避免动 nav-sites.js 的大闭包:
 *   1. 目录里的当前分类/子类跟着滚动高亮(参考它的 .sub-item.active + 左竖条)
 *   2. 右下角回到顶部(滚动 400px 后出现)
 *   3. 最近 7 天新增的站点在名字前打一个红点(参考它的 .new-dot)
 *
 * 纯 DOM,不依赖 jQuery,也不发任何请求。
 */
(function () {
    'use strict';

    function each(list, fn) { Array.prototype.forEach.call(list, fn); }

    /* ---------- 1. 目录滚动高亮 ---------- */
    var tocLinks = [];
    function collectToc() {
        tocLinks = [];
        each(document.querySelectorAll('#navToc .toc-scroll a[href^="#"]'), function (a) {
            var id = a.getAttribute('href').slice(1);
            var el = id && document.getElementById(id);
            if (el) tocLinks.push({ link: a, target: el });
        });
    }

    var spyTick = false;
    var lastActiveLink = null;

    // 当前项滑出目录可视区时,把它滚回来(只滚 .toc-scroll,不动整页)
    function revealInToc(link) {
        var box = link.closest ? link.closest('.toc-scroll') : null;
        if (!box) return;
        var lb = link.getBoundingClientRect();
        var bb = box.getBoundingClientRect();
        if (lb.top >= bb.top + 4 && lb.bottom <= bb.bottom - 4) return;   // 已经看得见
        box.scrollTop += (lb.top - bb.top) - (bb.height - lb.height) / 2;
    }

    function updateSpy() {
        spyTick = false;
        if (!tocLinks.length) return;
        var current = null;
        var bestTop = -Infinity;
        each(tocLinks, function (item) {
            var top = item.target.getBoundingClientRect().top - 120;   // 顶栏遮住的部分算"已过"
            if (top <= 0 && top > bestTop) { bestTop = top; current = item; }
        });
        each(tocLinks, function (item) {
            var on = item === current;
            item.link.classList.toggle('active', on);
            if (on && item.link.parentNode) {
                var subs = item.link.parentNode.querySelector('.toc-subs');
                if (subs && subs.classList.contains('d-none')) subs.classList.remove('d-none');
            }
        });
        // 只在"当前项变了"时滚目录,否则每次滚动都会抖
        if (current && current.link !== lastActiveLink) {
            lastActiveLink = current.link;
            revealInToc(current.link);
        }
    }

    function queueSpy() {
        if (spyTick) return;
        spyTick = true;
        window.requestAnimationFrame(updateSpy);
    }

    /* ---------- 2. 回到顶部 ---------- */
    function bindBackTop() {
        var btn = document.getElementById('navBackTop');
        if (!btn) return;
        function sync() { btn.classList.toggle('show', (window.pageYOffset || 0) > 400); }
        window.addEventListener('scroll', sync, { passive: true });
        sync();
        btn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    /* ---------- 3. 新站红点 ---------- */
    function markNewSites() {
        var now = Date.now() / 1000;
        each(document.querySelectorAll('[data-site-item][data-created]'), function (el) {
            var ts = Number(el.getAttribute('data-created') || 0);
            if (!ts || now - ts > 7 * 86400) return;
            var title = el.querySelector('.site-title');
            if (!title || el.querySelector('.site-new-dot')) return;
            var dot = document.createElement('span');
            dot.className = 'site-new-dot';
            dot.title = '最近 7 天新增';
            title.appendChild(dot);
        });
    }

    function boot() {
        collectToc();
        bindBackTop();
        markNewSites();
        updateSpy();
        window.addEventListener('scroll', queueSpy, { passive: true });
        window.addEventListener('resize', function () { collectToc(); queueSpy(); });
        // 目录是服务端渲染的,但折叠/展开会改 DOM 高度,操作后再算一次
        document.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('#navToc')) queueSpy();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
