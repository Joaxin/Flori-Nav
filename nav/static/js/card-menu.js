/* card-menu.js — 卡片右键 / 长按菜单(2026-11-12,2026-11-13 收口)
 *
 * 为什么取代拖拽:3000 站点时"拖动 → 整页 DOM 重排 → 逐条 UPDATE"是 O(n) 写库;
 * 菜单里的置顶/上移是稀疏 order,只写 1-2 行。触屏上 HTML5 拖放本来就不可用,
 * 长按菜单也是移动端唯一的排序入口。
 *
 * 2026-11-13 收口(都是"隐形"的那类问题):
 *   1. 全站只留这一套卡片菜单。nav-sites.js 里旧的 .nav-ctx 同样绑了 contextmenu,
 *      右键会同时弹出两层菜单(z-index 1080 / 1085 叠在同一位置),看着像"菜单打架"。旧的那套已删除。
 *   2. 补回「打开链接」入口(旧菜单有,新菜单漏了)。
 *   3. 长按弹菜单后,手指抬起浏览器还会补发一次 click,原来会顺手把站点打开;现在吃掉这一下。
 *   4. 菜单比视口高时改成内部滚动,不再顶出屏幕;靠近右/下边缘时整块翻到另一侧。
 *   5. 打开时接管焦点,↑↓ 切换、Esc 关闭并把焦点还回卡片;内层滚动容器滚动也会收起。
 */
(function () {
    'use strict';

    // 主客共用同一套卡片菜单(2026-11-21):容器/定位翻边/键盘 ↑↓·Esc/长按防误触全复用。
    // 主人端动作走服务端写库;访客端动作只碰本机(localStorage / navStore / 内存书签),
    // 不调任何 owner 写接口、不写服务器 DB。访客本机书签卡(#navGuestImports)由模板内联
    // gMenu 自有菜单接管,这里不再重复弹层,避免双层菜单打架。
    var GUEST = !!window.NAV_GUEST_MODE;

    var MENU_ID = 'navCardMenu';
    var menu = null;
    var current = null;      // 当前右键的 [data-site-item] 列
    var pressTimer = null;
    var pressStart = null;
    var swallowClick = false;   // 长按松手后那一次 click 要吃掉
    var focusBack = null;

    function csrf() {
        var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function api(path, body) {
        return fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); });
    }

    function toast(msg) {
        if (window.showToast) window.showToast(msg);
    }

    function hide(returnFocus) {
        if (menu) menu.classList.remove('show');
        current = null;
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        pressStart = null;
        if (returnFocus && focusBack && focusBack.isConnected) {
            try { focusBack.focus({ preventScroll: true }); } catch (e) { try { focusBack.focus(); } catch (e2) {} }
        }
        focusBack = null;
    }

    function build() {
        if (menu) return menu;
        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'card-menu';
        menu.setAttribute('role', 'menu');
        var items;
        if (GUEST) {
            // 访客态:只保留本机可落地的五项;快照数据没有书签级排序持久化,
            // 不提供置顶/置底/上移/下移(见 docs/并行改造/09-访客卡片菜单.md §4)。
            items = [
                '<button type="button" role="menuitem" data-act="open"><i class="fas fa-up-right-from-square"></i>打开链接</button>',
                '<button type="button" role="menuitem" data-act="edit"><i class="fas fa-pen"></i>编辑</button>',
                '<button type="button" role="menuitem" data-act="star"><i class="fas fa-star"></i>星标</button>',
                '<button type="button" role="menuitem" data-act="copy"><i class="fas fa-link"></i>复制链接</button>',
                '<hr>',
                '<button type="button" role="menuitem" data-act="del" class="text-danger"><i class="fas fa-trash"></i>删除本机书签</button>'
            ];
        } else {
            items = [
                '<button type="button" role="menuitem" data-act="open"><i class="fas fa-up-right-from-square"></i>打开链接</button>',
                '<button type="button" role="menuitem" data-act="edit"><i class="fas fa-pen"></i>编辑</button>',
                '<button type="button" role="menuitem" data-act="star"><i class="fas fa-star"></i>星标</button>',
                '<button type="button" role="menuitem" data-act="copy"><i class="fas fa-link"></i>复制链接</button>',
                '<hr>',
                '<button type="button" role="menuitem" data-act="pin-top"><i class="fas fa-arrow-up-long"></i>置顶</button>',
                '<button type="button" role="menuitem" data-act="pin-bottom"><i class="fas fa-arrow-down-long"></i>置底</button>',
                '<button type="button" role="menuitem" data-act="up"><i class="fas fa-chevron-up"></i>上移</button>',
                '<button type="button" role="menuitem" data-act="down"><i class="fas fa-chevron-down"></i>下移</button>',
                '<hr>',
                '<button type="button" role="menuitem" data-act="del" class="text-danger"><i class="fas fa-trash"></i>删除</button>'
            ];
        }
        menu.innerHTML = items.join('');
        document.body.appendChild(menu);
        menu.addEventListener('click', onAct);
        return menu;
    }

    function cardUrl(col) {
        var a = col ? col.querySelector('a.site-card') : null;
        return a ? a.href : '';
    }

    // 访客态可挂菜单的卡片:快照书签卡。本机导入书签卡(#navGuestImports)由模板内联
    // gMenu 自有菜单接管;HTML 工具卡(#toolsSection)有自己的工具钮,不进书签菜单。
    function guestCard(col) {
        if (!col) return null;
        if (col.closest('#navGuestImports')) return null;
        if (col.closest('#toolsSection')) return null;
        if (!col.querySelector('a.site-card')) return null;
        return col;
    }

    function toggleStar(col) {
        var btn = col.querySelector('.site-star');
        if (btn) btn.click();
    }

    /* 复制:clipboard API 在 http/file 下会被拒,退回 textarea + execCommand */
    function copyText(text) {
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                toast('已复制链接');
            }).catch(function () { legacyCopy(text); });
            return;
        }
        legacyCopy(text);
    }

    function legacyCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        var ok = false;
        try {
            ta.select();
            ok = document.execCommand('copy');
        } catch (e) { ok = false; }
        document.body.removeChild(ta);
        toast(ok ? '已复制链接' : '复制失败,请手动复制');
    }

    function moveNode(col, act) {
        var parent = col.parentElement;
        if (!parent) return;
        if (act === 'pin-top') parent.insertBefore(col, parent.firstElementChild);
        else if (act === 'pin-bottom') parent.appendChild(col);
        else if (act === 'up' && col.previousElementSibling) parent.insertBefore(col, col.previousElementSibling);
        else if (act === 'down' && col.nextElementSibling) parent.insertBefore(col.nextElementSibling, col);
        col.classList.add('site-moved');
        setTimeout(function () { col.classList.remove('site-moved'); }, 900);
    }

    function reorder(act, col) {
        if (!col) return;
        var id = Number(col.getAttribute('data-id'));
        var path, body;
        if (act === 'pin-top' || act === 'pin-bottom') {
            path = '/api/nav/site-order/pin/';
            body = { id: id, where: act === 'pin-top' ? 'top' : 'bottom' };
        } else {
            path = '/api/nav/site-order/swap/';
            body = { id: id, dir: act };
        }
        api(path, body).then(function (res) {
            if (res && res.status === 'success') moveNode(col, act);
        }).catch(function () { /* 网络失败就保持原样,不做假动画 */ });
    }

    /* 访客态动作:全部只碰本机;快照覆盖表写 IDB/localStorage,星标写 localStorage。
       不调用 /api/nav/ 任何写接口,也不碰主人库。 */
    function guestAct(act, col) {
        var url = cardUrl(col);
        if (act === 'open') {
            if (url) window.open(url, '_blank', 'noopener');
            return;
        }
        if (act === 'copy') { copyText(url); return; }
        if (act === 'star') {
            var s = col.querySelector('.site-star');
            if (s) s.click();
            return;
        }
        if (act === 'edit') {
            // 快照卡:走访客编辑组件(navGuestEdit,{snapshot,data});兜底点卡片自带编辑钮
            if (window.navGuestSnapshot && typeof window.navGuestSnapshot.editSite === 'function') {
                window.navGuestSnapshot.editSite(col);
            } else {
                var eBtn = col.querySelector('.site-edit');
                if (eBtn) eBtn.click();
            }
            return;
        }
        if (act === 'del') {
            // 快照卡:本机隐藏覆盖表(deleteSnapshot),确认框走 navConfirm;兜底点删除钮
            if (window.navGuestSnapshot && typeof window.navGuestSnapshot.hideSite === 'function') {
                window.navGuestSnapshot.hideSite(col);
            } else {
                var dBtn = col.querySelector('.site-del');
                if (dBtn) dBtn.click();
            }
        }
    }

    function onAct(e) {
        var btn = e.target.closest('button[data-act]');
        if (!btn || !current) return;
        var act = btn.getAttribute('data-act');
        var col = current;
        hide();
        if (GUEST) { guestAct(act, col); return; }
        if (act === 'open') {
            var url = cardUrl(col);
            if (url) window.open(url, '_blank', 'noopener');
            return;
        }
        if (act === 'edit') { var e1 = col.querySelector('.site-edit'); if (e1) e1.click(); return; }
        if (act === 'del') { var d = col.querySelector('.site-del'); if (d) d.click(); return; }
        if (act === 'star') { toggleStar(col); return; }
        if (act === 'copy') { copyText(cardUrl(col)); return; }
        reorder(act, col);
    }

    function show(x, y, col) {
        current = col;
        focusBack = document.activeElement;
        var el = build();
        // 气泡是 fixed + 高层级,先让位,免得盖住菜单第一行
        if (window.navTip && window.navTip.hide) window.navTip.hide();
        el.classList.add('show');
        el.style.left = '0px';
        el.style.top = '0px';
        var w = el.offsetWidth, h = el.offsetHeight;
        var vw = window.innerWidth, vh = window.innerHeight;
        var left = (x + w > vw - 8) ? x - w : x;      // 右边界:整块翻到左侧
        var top = (y + h > vh - 8) ? y - h : y;       // 下边界:整块翻到上方
        left = Math.max(8, Math.min(left, Math.max(8, vw - w - 8)));
        top = Math.max(8, Math.min(top, Math.max(8, vh - h - 8)));
        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';

        var first = el.querySelector('button[data-act]');
        if (first) { try { first.focus({ preventScroll: true }); } catch (e) { try { first.focus(); } catch (e2) {} } }
    }

    /* ---------- 右键 ---------- */
    document.addEventListener('contextmenu', function (e) {
        var col = e.target.closest ? e.target.closest('[data-site-item]') : null;
        if (GUEST) col = guestCard(col);
        if (!col) { hide(); return; }
        if (e.ctrlKey || e.metaKey) return;   // 组合键留给浏览器原菜单
        e.preventDefault();
        show(e.clientX, e.clientY, col);
    });

    /* ---------- 触屏长按:按住 550ms 弹菜单;移动超过 10px 取消(避免和滚动冲突) ---------- */
    document.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'touch') return;
        var col = e.target.closest ? e.target.closest('[data-site-item]') : null;
        if (GUEST) col = guestCard(col);
        if (!col) return;
        pressStart = { x: e.clientX, y: e.clientY, col: col };
        clearTimeout(pressTimer);
        pressTimer = setTimeout(function () {
            pressTimer = null;
            if (!pressStart) return;
            show(pressStart.x, pressStart.y, pressStart.col);
            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
        }, 550);
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
        if (!pressStart) return;
        if (Math.abs(e.clientX - pressStart.x) > 10 || Math.abs(e.clientY - pressStart.y) > 10) {
            clearTimeout(pressTimer);
            pressTimer = null;
            pressStart = null;
        }
    }, { passive: true });

    document.addEventListener('pointerup', function (e) {
        var wasLongPress = !!(pressStart && menu && menu.classList.contains('show'));
        clearTimeout(pressTimer);
        pressTimer = null;
        pressStart = null;
        // 长按之后浏览器会补发一次 click 到卡片上 —— 不拦就会在弹菜单的同时打开站点
        if (wasLongPress && e.pointerType === 'touch') {
            swallowClick = true;
            window.setTimeout(function () { swallowClick = false; }, 400);
        }
    }, { passive: true });

    document.addEventListener('pointercancel', function () {
        clearTimeout(pressTimer);
        pressTimer = null;
        pressStart = null;
    }, { passive: true });

    // 吃掉长按松手补发的那一次 click(捕获阶段,先于卡片链接的默认行为)
    document.addEventListener('click', function (e) {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    document.addEventListener('click', function (e) {
        if (menu && menu.classList.contains('show') && !e.target.closest('#' + MENU_ID)) hide();
    });

    document.addEventListener('keydown', function (e) {
        if (!menu || !menu.classList.contains('show')) return;
        var items = Array.prototype.slice.call(menu.querySelectorAll('button[data-act]'));
        if (!items.length) return;
        var at = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); hide(true); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[at <= 0 ? items.length - 1 : at - 1].focus(); }
        else if (e.key === 'Tab') { hide(); }
    });

    // 滚动就收起:内层滚动容器(scroll 不冒泡)也要管,所以走 capture
    document.addEventListener('scroll', function (e) {
        if (!menu || !menu.classList.contains('show')) return;
        if (e.target === menu) return;   // 菜单自己滚动不算
        hide();
    }, { passive: true, capture: true });

    window.addEventListener('resize', function () { hide(); });
})();
