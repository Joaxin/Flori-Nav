/* ==========================================================================
   nav-skins.js — R-25 全屏背景皮肤(纯视觉层,2026-11-22)

   边界约定:
   · 只做最底层背景叠加;不改 body 背景色,不改写壁纸(navWall*)、
     主题(navTheme)、配色模式(navColorMode)的存储键与既有规则。
   · 访客零写库:本文件全流程不发任何 /api/nav/ 请求,只读写 localStorage
     (try/catch 包裹);无图片资源、无第三方库。
   · 背景层 #navSkinLayer 由本脚本在启动时创建;控件(.nav-skin-*)经注册表
     window.NavWidgets.register 挂入;注册表尚不存在时推入
     window.__navWidgetQueue 兜底队列,由注册表落地后统一 drain,不自造
     第二套挂载系统。

   存储键(本机):
   · navBgSkin    none | aurora | grid   默认 none;非法值归 none
   · navBgSkinFollow  1 | 0              默认 1(跟随明暗调整深浅)

   对外调试句柄:window.navSkins = { readSkin, setSkin, setFollow, apply }
   ========================================================================== */
(function () {
    'use strict';

    var SKIN_KEY = 'navBgSkin';
    var FOLLOW_KEY = 'navBgSkinFollow';
    var SKINS = ['none', 'aurora', 'grid'];

    function readSkin() {
        try {
            var v = localStorage.getItem(SKIN_KEY);
            return SKINS.indexOf(v) >= 0 ? v : 'none';
        } catch (e) { return 'none'; }
    }
    function readFollow() {
        try { return localStorage.getItem(FOLLOW_KEY) === '0' ? '0' : '1'; }
        catch (e) { return '1'; }
    }
    function writeKey(key, val) {
        try { localStorage.setItem(key, val); } catch (e) { /* 配额/隐私模式静默 */ }
    }

    var layer = null;
    var box = null;

    // ---- 视觉层:启动即按本机设置落盘状态应用,不依赖注册表 ----
    function ensureLayer() {
        if (layer) return layer;
        layer = document.createElement('div');
        layer.id = 'navSkinLayer';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
        return layer;
    }

    function paintControl(skin, follow) {
        if (!box) return;
        box.querySelectorAll('.nav-skin-btn').forEach(function (btn) {
            var on = btn.dataset.navSkin === skin;
            btn.classList.toggle('btn-secondary', on);
            btn.classList.toggle('btn-outline-secondary', !on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        var input = box.querySelector('.nav-skin-follow-input');
        if (input) input.checked = follow === '1';
    }

    // 壁纸激活态只读镜像:与既有明暗/皮肤/特效锁同进同出,不改 theme.js 的锁逻辑
    function syncWallLock() {
        var locked = document.body && document.body.dataset.navWall === '1';
        if (!box) return;
        box.classList.toggle('nav-skin-locked', locked);
        box.querySelectorAll('.nav-skin-btn, .nav-skin-follow-input').forEach(function (el) {
            el.disabled = locked;
        });
    }

    function apply() {
        var skin = readSkin();
        var follow = readFollow();
        ensureLayer();
        if (skin === 'none') delete document.body.dataset.navSkin;
        else document.body.dataset.navSkin = skin;
        if (follow === '0') document.body.dataset.navSkinFollow = 'off';
        else delete document.body.dataset.navSkinFollow;
        paintControl(skin, follow);
        syncWallLock();
    }

    function setSkin(skin) {
        if (SKINS.indexOf(skin) < 0) skin = 'none';
        writeKey(SKIN_KEY, skin);
        apply();
    }
    function setFollow(on) {
        writeKey(FOLLOW_KEY, on ? '1' : '0');
        apply();
    }

    // ---- 控件:注册表挂载;控件节点首次 mount 时构建并绑定一次 ----
    function buildBox() {
        if (box) return box;
        box = document.createElement('div');
        box.className = 'nav-skin-box';
        box.innerHTML =
            '<div class="form-text small mb-1 text-muted">背景皮肤</div>' +
            '<div class="btn-group btn-group-sm w-100 mb-2 nav-skin-group" role="group" aria-label="背景皮肤">' +
                '<button type="button" class="btn btn-outline-secondary nav-skin-btn" data-nav-skin="none">无</button>' +
                '<button type="button" class="btn btn-outline-secondary nav-skin-btn" data-nav-skin="aurora">极光</button>' +
                '<button type="button" class="btn btn-outline-secondary nav-skin-btn" data-nav-skin="grid">网格</button>' +
            '</div>' +
            '<label class="form-check form-switch nav-skin-follow">' +
                '<input type="checkbox" class="form-check-input nav-skin-follow-input">' +
                '<span class="form-check-label small">跟随明暗调整深浅</span>' +
            '</label>';
        box.addEventListener('click', function (ev) {
            var btn = ev.target.closest ? ev.target.closest('.nav-skin-btn') : null;
            if (btn) setSkin(btn.dataset.navSkin);
        });
        var followInput = box.querySelector('.nav-skin-follow-input');
        followInput.addEventListener('change', function () { setFollow(this.checked); });
        return box;
    }

    function resolveTarget(container) {
        if (container && container.appendChild) return container;
        var themeMenu = document.getElementById('navThemeMenu');
        if (themeMenu && themeMenu.closest) {
            var sec = themeMenu.closest('.nav-quick-sec');
            if (sec) return sec;
        }
        var secs = document.querySelectorAll('#navQuickSettingsMenu .nav-quick-sec');
        return secs.length ? secs[0] : null;
    }

    function mount(container) {
        buildBox();
        var target = resolveTarget(container);
        if (target) target.appendChild(box);
        apply();
    }
    function unmount() {
        if (box && box.parentNode) box.parentNode.removeChild(box);
    }

    // ---- 注册表协议:有 NavWidgets 就 register;没有就进兜底队列,不另造挂载系统 ----
    var widget = {
        id: 'nav-skin',
        name: '背景皮肤',
        selector: '#navQuickSettingsMenu .nav-quick-sec',
        priority: 30,
        mount: mount,
        unmount: unmount
    };
    if (window.NavWidgets && typeof window.NavWidgets.register === 'function') {
        window.NavWidgets.register(widget);
    } else {
        (window.__navWidgetQueue = window.__navWidgetQueue || []).push(widget);
    }

    // body 上 data-nav-wall / data-bs-theme / data-nav-theme 变化后,同步锁态与配方
    if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(syncWallLock).observe(document.body, {
            attributes: true,
            attributeFilter: ['data-nav-wall', 'data-bs-theme', 'data-nav-theme']
        });
    }

    function boot() { apply(); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.navSkins = { apply: apply, setSkin: setSkin, setFollow: setFollow, readSkin: readSkin };
})();
