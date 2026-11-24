/* 2026-11-24:通用「浮层可拖动 / 可缩放」共享模块。
 *
 * 背景:游客端「自带 Key·仅本机」面板(#navGuestAiPanel)和主人端 Bootstrap 弹窗
 * 原来都不能拖;两端各自造一套会更乱,所以抽这一份,两端共用。
 *
 * 用法:
 *   window.NavModalMove.enable(el, handle)        —— 按住 handle(通常是标题栏)拖动 el
 *   window.NavModalMove.resize(el, cornerEl)      —— 拖右下角改 el 尺寸
 *   所有 .modal 在 shown.bs.modal 时自动挂载;根节点带 data-no-resize 的不给缩放角。
 *
 * 约定:拖动/缩放都落 left/top/width/height 像素,清掉 transform 与居中 margin,
 * 结束后夹在视口内,不写全局配置、不发请求。
 */
(function () {
    'use strict';
    if (window.NavModalMove) return;

    var MIN_W = 280, MIN_H = 200, EDGE = 4, TITLE_KEEP = 56;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function pinToPixels(el) {
        var r = el.getBoundingClientRect();
        el.style.transform = 'none';
        el.style.margin = '0';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        return r;
    }

    function enable(el, handle) {
        if (!el || !handle || el.__navMoveBound) return;
        el.__navMoveBound = true;
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        handle.style.cursor = 'move';
        handle.style.touchAction = 'none';
        handle.style.userSelect = 'none';

        var sx = 0, sy = 0, ox = 0, oy = 0, on = false;

        handle.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            // 标题栏里的按钮/输入框照常点,不抢它们的交互
            if (e.target.closest('button, a, input, textarea, select, [role="button"]')) return;
            var r = pinToPixels(el);
            sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
            on = true;
            try { if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        handle.addEventListener('pointermove', function (e) {
            if (!on) return;
            var r = el.getBoundingClientRect();
            el.style.left = clamp(ox + (e.clientX - sx), EDGE, Math.max(EDGE, window.innerWidth - r.width - EDGE)) + 'px';
            el.style.top = clamp(oy + (e.clientY - sy), EDGE, Math.max(EDGE, window.innerHeight - TITLE_KEEP)) + 'px';
        });
        function stop() { on = false; }
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    }

    function resize(el, corner) {
        if (!el || !corner || corner.__navResizeBound) return;
        corner.__navResizeBound = true;
        corner.style.position = 'absolute';
        corner.style.right = '0';
        corner.style.bottom = '0';
        corner.style.width = '16px';
        corner.style.height = '16px';
        corner.style.cursor = 'nwse-resize';
        corner.style.zIndex = '6';
        corner.style.touchAction = 'none';

        var sx = 0, sy = 0, ow = 0, oh = 0, on = false;
        corner.addEventListener('pointerdown', function (e) {
            on = true; sx = e.clientX; sy = e.clientY;
            var r = el.getBoundingClientRect(); ow = r.width; oh = r.height;
            try { if (corner.setPointerCapture) corner.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault(); e.stopPropagation();
        });
        corner.addEventListener('pointermove', function (e) {
            if (!on) return;
            el.style.width = clamp(ow + (e.clientX - sx), MIN_W, window.innerWidth - 2 * EDGE) + 'px';
            el.style.height = clamp(oh + (e.clientY - sy), MIN_H, window.innerHeight - 2 * EDGE) + 'px';
            el.style.maxHeight = 'none';
        });
        function stop() { on = false; }
        corner.addEventListener('pointerup', stop);
        corner.addEventListener('pointercancel', stop);
    }

    function autoMountModals() {
        document.querySelectorAll('.modal').forEach(function (m) {
            var dlg = m.querySelector('.modal-dialog');
            var head = m.querySelector('.modal-header');
            if (!dlg || !head) return;
            m.addEventListener('shown.bs.modal', function () {
                enable(dlg, head);
                if (!m.hasAttribute('data-no-resize') && dlg.querySelector('.nav-resize-corner') === null) {
                    var c = document.createElement('span');
                    c.className = 'nav-resize-corner';
                    dlg.appendChild(c);
                    resize(dlg, c);
                }
                dlg.style.maxHeight = 'calc(100vh - 24px)';
            });
        });
    }

    window.NavModalMove = { enable: enable, resize: resize };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoMountModals);
    } else {
        autoMountModals();
    }
})();
