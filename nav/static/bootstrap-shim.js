/* Bootstrap JS 兼容垫片(2026-09-30,弃用 BS5 改用 Tailwind):
   模拟 nav 页面用到的 Bootstrap JS API(Modal/Dropdown/Offcanvas/Tooltip/Tabs/Alert),
   全部 vanilla 实现,CSS 由 Tailwind 兼容层(nav/base.html 的 text/tailwindcss 块)提供。 */
(function () {
    'use strict';

    /* ---------- 通用 ---------- */
    function getTarget(el, attr) {
        const sel = el.getAttribute(attr);
        return sel ? document.querySelector(sel) : null;
    }
    function findModal(el) { return el.closest('.modal'); }
    function findOffcanvas(el) { return el.closest('.offcanvas-md, .offcanvas'); }

    let backdropEl = null, backdropCount = 0, modalOpenCount = 0;
    function showBackdrop() {
        if (!backdropEl) {
            backdropEl = document.createElement('div');
            backdropEl.className = 'ui-backdrop fade';
            // 点遮罩 = 关闭最上层浮层。缺这一条时:点外部抽屉不关,但透明遮罩留在页面上,
            // 之后所有点击都被它吃掉 —— 表现就是"设置打不开/页面点不动"(2026-11-12 实测)。
            backdropEl.addEventListener('click', function () {
                const modal = document.querySelector('.modal.show');
                if (modal && typeof Modal !== 'undefined' && Modal.getOrCreateInstance) {
                    Modal.getOrCreateInstance(modal).hide();
                    return;
                }
                const off = document.querySelector('.offcanvas.showing, .offcanvas-md.showing');
                if (off) Offcanvas.getOrCreateInstance(off).hide();
            });
            document.body.appendChild(backdropEl);
            lockScroll();
            // 捕获当前遮罩:on/off 连续切换时 backdropEl 会在下一帧前被置空,
            // 直接闭包引用模块变量会抛 null.classList(2026-11-14 实测踩到)
            const back = backdropEl;
            requestAnimationFrame(() => { if (back) back.classList.add('show'); });
        }
        backdropCount += 1;
    }
    /* 锁定页面滚动时把滚动条占的宽度补回 body(2026-11-12)。
       不补的话:一开弹窗 overflow:hidden 让滚动条消失,整页内容向右跳 15px,
       关掉再跳回来 —— 就是"每次弹窗页面晃一下"。CSS 的 scrollbar-gutter:stable
       是主手段,这里是给不支持该属性/浮层嵌套时的兜底,用计数器避免嵌套时提前解锁。 */
    let scrollLocks = 0;
    function lockScroll() {
        scrollLocks += 1;
        if (scrollLocks > 1) return;
        const gap = Math.round(window.innerWidth - document.documentElement.clientWidth);
        document.body.style.overflow = 'hidden';
        if (gap > 0) {
            document.body.style.paddingRight = gap + 'px';
            document.body.dataset.navScrollPad = String(gap);
        }
    }
    function unlockScroll() {
        scrollLocks = Math.max(0, scrollLocks - 1);
        if (scrollLocks > 0) return;
        document.body.style.overflow = '';
        if (document.body.dataset.navScrollPad) {
            document.body.style.paddingRight = '';
            delete document.body.dataset.navScrollPad;
        }
    }

    function hideBackdrop() {
        backdropCount = Math.max(0, backdropCount - 1);
        if (backdropCount === 0 && backdropEl) {
            const b = backdropEl; backdropEl = null;
            unlockScroll();
            b.classList.remove('show');
            setTimeout(() => b.remove(), 200);
        }
    }
    // ESC 逐层出栈:旧实现只有单个全局处理器,后开的弹窗会覆盖前一个的,
    // 关掉第二个后第一个弹窗按 ESC 失灵(2026-10-06 修复)
    const escStack = [];
    function onEsc(cb) { escStack.push(cb); return cb; }
    function offEsc(cb) {
        const i = escStack.lastIndexOf(cb);
        if (i >= 0) escStack.splice(i, 1);
    }
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !escStack.length) return;
        const cb = escStack[escStack.length - 1];
        cb();
    }, true);

    // 弹窗进出场动画(animate skill 规范:occasional 档,200ms 强 ease-out,只动 transform+opacity;
    // 动画挂 .modal-content——拖拽用的 transform 在 .modal-dialog 上,互不打架;减少动态时退化为纯淡入)
    (function () {
        const st = document.createElement('style');
        st.textContent =
            '@media (prefers-reduced-motion: no-preference) {' +
            '  .modal.show .modal-content { animation: uiModalIn .2s cubic-bezier(0.23, 1, 0.32, 1); }' +
            '}' +
            '@media (prefers-reduced-motion: reduce) {' +
            '  .modal.show .modal-content { animation: uiModalFade .15s ease; }' +
            '}' +
            '@keyframes uiModalIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }' +
            '@keyframes uiModalFade { from { opacity: 0; } to { opacity: 1; } }';
        document.head.appendChild(st);
    })();

    // 界面开合音效钩子(2026-10-25):实现在 pet.js(开关 navPetUiSound),这里只负责喊一嗓子
    function uiSound(kind) {
        try { if (window.petUiSound) window.petUiSound(kind); } catch (e) {}
    }
    /* ---------- Modal ---------- */
    // 事件桥接:页面 JS 用 jQuery .on('show.bs.modal') 监听,原生 CustomEvent 到不了 jQuery 处理器,
    // 必须双发(原生给非 jQuery 监听者,jQuery trigger 给 .on 监听者)——缺了它"添加站点"的表单重置从不执行
    function uiFire(el, type) {
        el.dispatchEvent(new CustomEvent(type, { bubbles: true }));
        if (window.jQuery) window.jQuery(el).trigger(type);
    }
    // 弹窗可拖拽/可缩放(全局增强,用户要求"窗口不要一直一个大小"):
    // 标题栏拖拽移动(双击标题栏复位),右下角拉拽缩放。只在首次 show 时装配一次。
    // ⚠️ 尺寸来源:兼容层里 .modal-dialog 是 w-auto,宽窄全靠 max-width(max-w-lg / modal-lg)。
    // 直接把 max-width 置 none,width:auto 就会退回"铺满整屏"——先把上限量成显式宽度再放开,
    // 初始尺寸不变、缩放又有余量。窄屏用 min() 让它在视口内收窄。
    function uiMakeMovable(modalEl) {
        if (modalEl._uiMovable) return;
        modalEl._uiMovable = true;
        const dialog = modalEl.querySelector('.modal-dialog');
        if (!dialog) return;
        const cap = parseFloat(getComputedStyle(dialog).maxWidth);
        if (cap > 0) {
            dialog._uiBaseWidth = 'min(' + Math.round(cap) + 'px, calc(100vw - 2rem))';
            dialog.style.width = dialog._uiBaseWidth;
            dialog.style.maxWidth = 'none';
        }
        dialog.style.resize = 'both';
        dialog.style.overflow = 'auto';
        // ⚠️ 缩放抓手的命门:tailwind 里 `.modal-dialog{pointer-events:none}`(点击透传给
        // .modal-content),而原生 resize 抓手属于 dialog 本身 —— 不改成 auto,右下角
        // 能看见斜纹却怎么也拖不动(2026-11-18 用户实测"拖拽大小没反应")。
        dialog.style.pointerEvents = 'auto';
        let dx = 0, dy = 0, sx = 0, sy = 0, dragging = false;
        const header = dialog.querySelector('.modal-header');
        if (header) {
            header.style.cursor = 'move';
            header.style.userSelect = 'none';
            header.addEventListener('mousedown', function (ev) {
                if (ev.button !== 0) return;
                if (ev.target.closest('.btn, .btn-close, input, select, textarea, a, label')) return;
                dragging = true; sx = ev.clientX - dx; sy = ev.clientY - dy;
                ev.preventDefault();
            });
            header.addEventListener('dblclick', function (ev) {
                if (ev.target.closest('.btn, .btn-close, input, select, textarea, a, label')) return;
                dx = 0; dy = 0; dialog.style.transform = '';
                if (dialog._uiBaseWidth) dialog.style.width = dialog._uiBaseWidth;  // 尺寸一并复位
            });
        }
        document.addEventListener('mousemove', function (ev) {
            if (!dragging) return;
            const r = dialog.getBoundingClientRect();
            dx = Math.min(Math.max(ev.clientX - sx, -r.left - r.width + 80), Math.max(0, window.innerWidth - r.left - 80));
            dy = Math.min(Math.max(ev.clientY - sy, 52 - r.top), Math.max(0, window.innerHeight - r.top - 40));
            dialog.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        });
        document.addEventListener('mouseup', function () { dragging = false; });
    }
    const Modal = function (el, config) {
        this._el = typeof el === 'string' ? document.querySelector(el) : el;
        this._static = !!(config && config.backdrop === 'static');
    };
    Modal.prototype.show = function () {
        const el = this._el;
        if (el.classList.contains('show')) return;   // 已显示:重复 show 不重复计数/不加遮罩
        uiSound('open');
        uiFire(el, 'show.bs.modal');
        uiMakeMovable(el);
        el.classList.add('show');
        el.style.display = 'block';
        modalOpenCount += 1;
        // 2026-11-27:叠开弹窗(添加站点 → 选择图标)时后开的必须压在上面。
        // 原来所有 .modal.show 同一层,z-index 相同、DOM 靠后的反而盖住后开的,
        // 图标选择器就被「添加站点」整块挡住、点不到。
        el.style.zIndex = String(1050 + modalOpenCount * 10);
        document.body.classList.add('ui-modal-open');
        if (!this._static) showBackdrop();
        const self = this;
        this._escCb = onEsc(function () { if (!self._static) self.hide(); });
        uiFire(el, 'shown.bs.modal');
    };
    Modal.prototype.hide = function () {
        const el = this._el;
        if (!el.classList.contains('show')) { offEsc(this._escCb); return; }   // 未显示只摘 ESC,不误减计数
        uiSound('close');
        uiFire(el, 'hide.bs.modal');
        el.classList.remove('show');
        el.style.display = 'none';
        modalOpenCount = Math.max(0, modalOpenCount - 1);   // 叠开的另一个弹窗还在时不能解锁 body 滚动
        if (modalOpenCount === 0) document.body.classList.remove('ui-modal-open');
        if (!this._static) hideBackdrop();
        offEsc(this._escCb);
        uiFire(el, 'hidden.bs.modal');
    };
    Modal.getInstance = function (el) {
        const el2 = typeof el === 'string' ? document.querySelector(el) : el;
        return el2 && el2._uiModal ? el2._uiModal : null;
    };
    Modal.getOrCreateInstance = function (el, config) {
        const el2 = typeof el === 'string' ? document.querySelector(el) : el;
        if (!el2) return { show() {}, hide() {} };
        if (!el2._uiModal) el2._uiModal = new Modal(el2, config);
        return el2._uiModal;
    };
    Modal.prototype.dispose = function () {};

    /* ---------- Dropdown ---------- */
    /* 关闭单个菜单:统一走事件 + aria(2026-11-14)。
       旧实现直接 remove('show'),于是"点空白关闭"这条路径上:
         - hide.bs.dropdown 从不派发 → 靠它收尾的逻辑(标签云、tooltip)收不到通知;
         - 没有 _uiToggle 的菜单会留下 aria-expanded="true"。 */
    function closeMenu(menu) {
        if (!menu || !menu.classList.contains('show')) return;
        uiFire(menu, 'hide.bs.dropdown');
        menu.classList.remove('show');
        const toggle = menu._uiToggle ||
            (menu.parentElement && menu.parentElement.querySelector('[data-bs-toggle="dropdown"]'));
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        uiFire(menu, 'hidden.bs.dropdown');
    }
    function closeOpenMenus(except) {
        document.querySelectorAll('.dropdown-menu.show').forEach(function (m) {
            if (m === except) return;
            // auto-close=false:点外面也不收(Bootstrap 同义)
            if ((m._uiAutoClose || 'true') === 'false') return;
            closeMenu(m);
        });
    }
    function toggleDropdown(toggle) {
        // 优先取紧邻的下一个兄弟(工具栏同排多组下拉),否则在父元素内找
        let menu = null;
        const next = toggle.nextElementSibling;
        if (next && next.classList.contains('dropdown-menu')) menu = next;
        else menu = toggle.parentElement.querySelector('.dropdown-menu') ||
                   getTarget(toggle, 'data-bs-target');
        if (!menu) return;
        const opening = !menu.classList.contains('show');
        // auto-close 语义:true(默认)/ outside / false —— 旧实现完全忽略这个属性,
        // 于是"点条目菜单不收"只能由各调用点自己补(nav-sites.js 里就有两处补丁)。
        menu._uiAutoClose = (toggle.getAttribute('data-bs-auto-close') || 'true').toLowerCase();
        closeOpenMenus(opening ? menu : null);
        // ⚠️ 事件必须派发(与 Modal/Offcanvas 一致):页面用 'show.bs.dropdown' 做面板懒渲染,
        // 少这一句会让监听者永远收不到事件、面板静默空白(2026-10-16 标签云面板实测踩到)。
        // 目标取 menu(页面监听的正是 #navTagFilterMenu),bubbles 让 .dropdown 容器上的监听也能收到。
        uiSound(opening ? 'open' : 'close');
        if (opening) uiFire(menu, 'show.bs.dropdown'); else uiFire(menu, 'hide.bs.dropdown');
        menu.classList.toggle('show', opening);
        toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
        menu._uiToggle = toggle;
        if (opening) uiFire(menu, 'shown.bs.dropdown'); else uiFire(menu, 'hidden.bs.dropdown');
    }

    /* ---------- Offcanvas ---------- */
    const Offcanvas = function (el) { this._el = typeof el === 'string' ? document.querySelector(el) : el; };
    Offcanvas.prototype.show = function () {
        const el = this._el;
        if (el.classList.contains('showing')) return;   // 幂等:重复 show 不重复计数
        uiSound('open');
        uiFire(el, 'show.bs.offcanvas');
        // Bootstrap 的约定是 showing(过渡中) + show(已打开) 两个类都要有;
        // 这里原来只加 showing,而样式层只给 .show 写了 transform:none ——
        // 于是抽屉一直停在 translateX(100%),完全在视口外(2026-11-14 实测)。
        el.classList.add('showing');
        el.classList.add('show');
        showBackdrop();
        const self = this;
        this._escCb = onEsc(function () { self.hide(); });
        uiFire(el, 'shown.bs.offcanvas');
    };
    Offcanvas.prototype.hide = function () {
        const el = this._el;
        if (!el.classList.contains('showing')) { offEsc(this._escCb); return; }
        uiSound('close');
        uiFire(el, 'hide.bs.offcanvas');
        el.classList.remove('showing');
        el.classList.remove('show');
        hideBackdrop();
        offEsc(this._escCb);
        uiFire(el, 'hidden.bs.offcanvas');
    };
    Offcanvas.getInstance = function (el) {
        const el2 = typeof el === 'string' ? document.querySelector(el) : el;
        return el2 && el2._uiOff ? el2._uiOff : null;
    };
    Offcanvas.getOrCreateInstance = function (el) {
        const el2 = typeof el === 'string' ? document.querySelector(el) : el;
        if (!el2) return { show() {}, hide() {} };
        if (!el2._uiOff) el2._uiOff = new Offcanvas(el2);
        return el2._uiOff;
    };

    /* ---------- Tooltip(原生 title 兜底,无需真实现) ---------- */
    const Tooltip = function () {};
    Tooltip.prototype.dispose = function () {};

    /* ---------- Tab(点击即激活,委托层处理 pane 切换) ---------- */
    const Tab = function (el) { this._el = typeof el === 'string' ? document.querySelector(el) : el; };
    Tab.prototype.show = function () {
        this._el.dispatchEvent(new Event('click', { bubbles: true }));
    };
    Tab.getOrCreateInstance = function (el) {
        return new Tab(typeof el === 'string' ? document.querySelector(el) : el);
    };

    /* ---------- 全局事件委托 ---------- */
    document.addEventListener('click', function (e) {
        const toggle = e.target.closest('[data-bs-toggle]');
        const dismiss = e.target.closest('[data-bs-dismiss]');
        // 数据开关
        if (toggle) {
            const type = toggle.getAttribute('data-bs-toggle');
            if (type === 'dropdown') toggleDropdown(toggle);
            else if (type === 'modal') {
                e.preventDefault();
                bootstrap.Modal.getOrCreateInstance(getTarget(toggle, 'data-bs-target')).show();
            }
            else if (type === 'offcanvas') {
                e.preventDefault();
                Offcanvas.getOrCreateInstance(getTarget(toggle, 'data-bs-target')).show();
            }
            else if (type === 'tab') {
                e.preventDefault();
                const pane = getTarget(toggle, 'data-bs-target');
                if (pane) {
                    const nav = toggle.closest('[role="tablist"]') || toggle.parentElement;
                    nav.querySelectorAll('[data-bs-toggle="tab"]').forEach(function (t) {
                        t.classList.remove('active');
                        const p = getTarget(t, 'data-bs-target');
                        if (p) { p.classList.remove('active', 'show'); }
                    });
                    toggle.classList.add('active');
                    pane.classList.add('active', 'show');
                    // 页面靠这个事件记「上次所在 tab」,不发就等于读得到、写不进
                    uiFire(toggle, 'shown.bs.tab');
                }
            }
            else if (type === 'collapse') {
                // 2026-11-24:垫片原先没实现 collapse,任何 data-bs-toggle="collapse"
                // (访客 AI「手动粘贴 AI 回复」)点了完全没反应,面板永久 display:none。
                e.preventDefault();
                const pane = getTarget(toggle, 'data-bs-target');
                if (pane) {
                    const opening = !pane.classList.contains('show');
                    pane.classList.toggle('show', opening);
                    toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
                    uiFire(pane, opening ? 'shown.bs.collapse' : 'hidden.bs.collapse');
                }
            }
            /* type === 'tooltip':原生 title 兜底,忽略 */
        }
        // 关闭按钮(data-bs-dismiss)
        if (dismiss) {
            const type = dismiss.getAttribute('data-bs-dismiss');
            if (type === 'modal') { const m = findModal(dismiss); if (m && m._uiModal) m._uiModal.hide(); }
            else if (type === 'offcanvas') { const o = findOffcanvas(dismiss); if (o && o._uiOff) o._uiOff.hide(); }
            else if (type === 'alert') { const a = dismiss.closest('.alert'); if (a) a.remove(); }
        }
        // 点条目后按 auto-close 决定收不收:true(默认)收了,outside / false 留着
        const item = e.target.closest('.dropdown-menu .dropdown-item');
        if (item) {
            const m = item.closest('.dropdown-menu');
            if (m && m.classList.contains('show') && (m._uiAutoClose || 'true') === 'true') closeMenu(m);
        }
        // 点击菜单外关闭下拉(auto-close=false 的除外)
        if (!e.target.closest('.dropdown-menu') && !e.target.closest('[data-bs-toggle="dropdown"]')) {
            closeOpenMenus(null);
        }
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeOpenMenus(null);
    });

    window.bootstrap = { Modal: Modal, Dropdown: function () {}, Offcanvas: Offcanvas, Tooltip: Tooltip, Tab: Tab };
})();
