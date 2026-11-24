/* 主题皮肤 + 自定义背景 + 壁纸(取色/图源/遮罩模糊)+ 图标本地化 + 时钟问候/日历/倒计时
   ——从 nav_sites.html 拆出的第六刀(2026-10-25,渐进拆分,同 pet.js 模式)。
   边界约定见 pet.js 文件头:主脚本挂 window 的共享工具(csrf/showToast)与主题色系统
   (navAccentKey/applyNavAccent,主脚本定义处挂 window)在此取用;
   URL 走模板渲染的 JSON 配置岛 #navThemeUrls(静态文件里禁模板标签)。
   对外暴露 window.navApplyTheme/navApplyBgSource/navExtractAndStore/navExtractPalette/
   navApplyWallTweaks/navTickClock/navRenderCal/navRenderCountdowns/navRenderCdManager,
   主脚本(时钟开关/UI 模式/壁纸滑杆/取色按钮)与第二脚本经 window 调用。
   本文件随导航页加载,不依赖 searchapp/content_engine(模块移植规则)。*/
jQuery(function ($) {
    'use strict';
    const csrf = window.navCsrf, showToast = window.navToast;
    const navAccentKey = window.navAccentKey, applyNavAccent = window.applyNavAccent;   // 主闭包的主题色系统
    const THEME_URLS = JSON.parse(document.getElementById('navThemeUrls').textContent);

    // 自定义背景图是大对象(base64 dataURL),存 IndexedDB(navStore),不占 localStorage 配额;
    // 本次会话留一份内存副本,免得 IDB 异步回填前背景闪空。旧 localStorage 镜像作为读取兜底。
    var memCustomBg = null;
    function customBgNow() { return memCustomBg || localStorage.getItem('navCustomBg') || null; }
    function clearCustomBg() {
        memCustomBg = null;
        if (window.navStore) window.navStore.remove('navCustomBg').catch(function () {});
        try { localStorage.removeItem('navCustomBg'); } catch (e) {}
    }

    // 浏览器原生 alert 已全站下线(2026-10-30)。提示经 window 现取 + 判存(闭包里的 showToast
    // 是加载期快照,别拿它当"存在性证明");同时写进壁纸 tab 已有那行提示 #navBgSourceHint——
    // 设置面板本身是个下拉菜单,光靠页面底部的 toast 用户容易看不出是对刚才那张图说的。
    function wallSay(msg) {
        const $hint = $('#navBgSourceHint');
        if ($hint.length) $hint.text(msg);
        if (window.navToast) { window.navToast(msg); }
        else if (window.console) { console.warn('[nav] ' + msg); }   // 兜底也不恢复原生弹窗
    }

    // ===== 壁纸取色(壁纸主题色):canvas 量化出 5 个主色,喂进主题色系统 =====
    // 可取色源:本机上传(dataURL)/picsum(带 CORS)/必应(走同源代理端点);跨域无 CORS 的图会 onerror 静默跳过
    const WALL_PALETTE_KEY = 'navWallPalette';
    function navWallSrc() {
        const last = localStorage.getItem('navBgLast');
        if (last === 'custom') return customBgNow();
        return last;
    }
    function navExtractPalette(src, cb) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
            try {
                const N = 72;
                const cv = document.createElement('canvas');
                cv.width = N; cv.height = N;
                const cx = cv.getContext('2d', { willReadFrequently: true });
                cx.drawImage(img, 0, 0, N, N);
                const data = cx.getImageData(0, 0, N, N).data;
                const buckets = {};
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 128) continue;
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
                    const bk = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
                    bk.n++; bk.r += r; bk.g += g; bk.b += b;
                }
                const list = Object.values(buckets).sort(function(a, b) { return b.n - a.n; });
                const colors = [];
                list.forEach(function(bk) {
                    if (colors.length >= 5) return;
                    const r = Math.round(bk.r / bk.n), g = Math.round(bk.g / bk.n), b = Math.round(bk.b / bk.n);
                    if (Math.max(r, g, b) > 250 && Math.min(r, g, b) > 235) return;   // 跳过纯白噪点
                    if (Math.max(r, g, b) < 18) return;                               // 跳过纯黑
                    if (colors.some(function(c) {
                        return Math.abs(c[0] - r) + Math.abs(c[1] - g) + Math.abs(c[2] - b) < 90;
                    })) return;                                                       // 与已选色太近的跳过
                    colors.push([r, g, b]);
                });
                cb(colors.map(function(c) {
                    return '#' + c.map(function(x) { return ('0' + x.toString(16)).slice(-2); }).join('');
                }));
            } catch (e) { cb([]); }   // canvas 被跨域污染等:静默放弃
        };
        img.onerror = function() { cb([]); };
        img.src = src;
    }
    function navRenderWallSwatches(hexes) {
        const $box = $('#navWallSwatches').empty();
        hexes.forEach(function(hex, i) {
            $('<button type="button" class="nav-swatch" title="壁纸色 ' + (i + 1) + '">')
                .attr('data-accent', hex).css('background', hex).appendTo($box);
        });
        $box.css('display', hexes.length ? 'inline-flex' : 'none');
    }
    function navExtractAndStore(force) {
        const src = navWallSrc();
        if (!src) { navRenderWallSwatches([]); return; }
        const key = src.length + ':' + src.slice(-48);
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(WALL_PALETTE_KEY) || 'null'); } catch (e) { saved = null; }
        if (!force && saved && saved.key === key && saved.colors && saved.colors.length) {
            navRenderWallSwatches(saved.colors);
            return;
        }
        navExtractPalette(src, function(hexes) {
            if (!hexes.length) { navRenderWallSwatches([]); return; }
            try { localStorage.setItem(WALL_PALETTE_KEY, JSON.stringify({ key: key, colors: hexes })); } catch (e) {}
            navRenderWallSwatches(hexes);
            if (localStorage.getItem('navWallAccentAuto') === '1') {
                localStorage.setItem(navAccentKey, hexes[0]);
                applyNavAccent(hexes[0]);   // 自动跟随:壁纸换色主题色跟着换
            }
        });
    }
    // 遮罩浓度/模糊度/壁纸预览同步(壁纸 tab;蒸馏 Edge 壁纸设置)
    function navApplyWallTweaks() {
        const mask = Math.min(90, Math.max(0, parseInt(localStorage.getItem('navWallMask'), 10) || 0));
        const blur = Math.min(30, Math.max(0, parseInt(localStorage.getItem('navWallBlur'), 10) || 0));
        document.documentElement.style.setProperty('--nav-wall-mask', String(mask / 100));
        document.documentElement.style.setProperty('--nav-wall-blur', blur + 'px');
        const src = navWallSrc();
        if (src) {
            $('#navWallPreview').attr('src', src).css('display', 'block');
            $('#navWallPreviewEmpty').css('display', 'none');
            $('#navWallDownload').attr('href', src).css('display', '');
        } else {
            $('#navWallPreview').css('display', 'none');
            $('#navWallPreviewEmpty').css('display', 'block');
            $('#navWallDownload').css('display', 'none');
        }
        $('#navWallMaskR').val(mask); $('#navWallMaskV').text(mask + '%');
        $('#navWallBlurR').val(blur); $('#navWallBlurV').text(blur + 'px');
    }
    // 图片壁纸会盖住主题底色与背景特效层:原来把「明暗 / 皮肤 / 特效」一起锁死,
    // 用户明确要求「壁纸模式下也要能设主题」——现在只锁背景特效(它和壁纸叠在一起没有意义),
    // 明暗与皮肤照常可切:壁纸上换配色仍然生效。只在 data-nav-wall=1 时锁。
    function navApplyWallLocks() {
        const locked = !!(document.body && document.body.dataset.navWall === '1');
        const $groups = $('#navColorModeGroup, #navThemeMenu, #navThemeGroup');
        $groups.toggleClass('nav-wall-locked', false)
            .find('.btn').prop('disabled', false)
            .attr('aria-disabled', 'false');
        $('#navFxToggle').prop('disabled', locked).toggleClass('nav-wall-locked', locked)
            .attr('aria-disabled', locked ? 'true' : 'false');
        $('#setNavFx').prop('disabled', locked)
            .attr('aria-disabled', locked ? 'true' : 'false')
            .closest('.form-check').toggleClass('nav-wall-locked', locked);
        $('#navFxStrengthR').prop('disabled', locked)
            .attr('aria-disabled', locked ? 'true' : 'false')
            .closest('.nav-fx-strength-box').toggleClass('nav-wall-locked', locked);
        $('#navWallLockHintQuick, #navWallLockHintFull').toggleClass('d-none', !locked);
    }
    function navApplyTheme(t) {
        if (t && t !== 'default') document.body.dataset.navTheme = t;
        else delete document.body.dataset.navTheme;
        // 极光是暗色系:在 body 上声明 data-bs-theme 让 Bootstrap 变量整体转暗;其余皮肤跟随站点明暗
        if (t === 'aurora') document.body.dataset.bsTheme = 'dark';
        else delete document.body.dataset.bsTheme;
        // 背景画布:自定义上传 > 背景图源(随机/必应) > 主题默认;全部 !important 内联压过主题声明
        let custom = null, bgSource = null;
        try {
            custom = customBgNow();
            bgSource = JSON.parse(localStorage.getItem('navBgSource') || 'null');
        } catch (e) {}
        const bgExtract = custom ? 'custom'
            : (bgSource && bgSource.type === 'random') ? 'https://picsum.photos/seed/' + Date.now() + '/1920/1080'
            : (bgSource && bgSource.type === 'bing' && bgSource.url) ? THEME_URLS.bingRaw : '';
        const bgUrl = custom ? 'url("' + custom + '")'
            : (bgSource && bgSource.type === 'random') ? 'url("' + bgExtract + '")'
            : (bgSource && bgSource.type === 'bing' && bgSource.url) ? 'url("' + bgSource.url + '")' : '';
        ['background-image', 'background-size', 'background-position', 'background-attachment'].forEach(function(prop) {
            document.body.style.removeProperty(prop);
        });
        if (bgUrl) {
            document.body.style.setProperty('background-image', bgUrl, 'important');
            document.body.style.setProperty('background-size', 'cover', 'important');
            document.body.style.setProperty('background-position', 'center', 'important');
            document.body.style.setProperty('background-attachment', 'fixed', 'important');
            document.body.dataset.navWall = '1';   // 壁纸激活:CSS 据此给目录/时钟加可读性处理
            try { localStorage.setItem('navBgLast', bgExtract); } catch (e) {}
        } else {
            delete document.body.dataset.navWall;
            try { localStorage.removeItem('navBgLast'); } catch (e) {}
        }
        $('#navWallLayer').css('background-image', bgUrl || 'none').toggle(!!bgUrl);   // 可模糊壁纸层同步
        navApplyWallTweaks();   // 遮罩浓度/模糊度/预览同步(蒸馏 Edge 壁纸设置)
        $('#navThemeGroup .btn').each(function() {
            const on = String($(this).data('nav-theme')) === (t || 'default');
            $(this).toggleClass('btn-secondary', on).toggleClass('btn-outline-secondary', !on);
        });
        // 快捷设置「外观」里的皮肤按钮与设置面板同步(2026-11-19:皮肤入口并入齿轮)
        $('#navThemeMenu [data-nav-theme]').each(function() {
            const on = String(this.dataset.navTheme) === (t || 'default');
            $(this).toggleClass('btn-secondary', on).toggleClass('btn-outline-secondary', !on)
                   .attr('aria-pressed', on ? 'true' : 'false');
        });
        navApplyWallLocks();   // 壁纸模式:明暗/皮肤/特效置灰并禁用
        navExtractAndStore(false);   // 壁纸变了就重取色(同壁纸命中缓存不重复算)
    }
    // 2026-11-18 主题收敛 11→7:退役主题一次性迁移(本机存过退役名的,加载时改名)
    const THEME_RETIRED = { ocean: 'aurora', candy: 'sunset', glass: 'sunset', editorial: 'paper' };
    const storedTheme = localStorage.getItem('navTheme');
    if (storedTheme && THEME_RETIRED[storedTheme]) {
        localStorage.setItem('navTheme', THEME_RETIRED[storedTheme]);
    }
    navApplyTheme(localStorage.getItem('navTheme') || 'default');
    // IDB 里的自定义背景异步回填:旧 localStorage 镜像没有时,拿到后再应用一次,避免刷新后首屏缺背景。
    if (window.navStore) {
        window.navStore.get('navCustomBg', null).then(function (v) {
            if (v && !memCustomBg) { memCustomBg = v; navApplyTheme(localStorage.getItem('navTheme') || 'default'); }
        });
    }
    $('#navThemeGroup').on('click', '.btn', function() {
        const t = String($(this).data('nav-theme'));
        localStorage.setItem('navTheme', t);
        navApplyTheme(t);
    });
    // 快捷设置「外观」里的皮肤按钮:与设置面板共用 navApplyTheme(按钮不是 .dropdown-item,点了菜单不收起)
    $('#navThemeMenu').on('click', '[data-nav-theme]', function() {
        const t = String(this.dataset.navTheme);
        if (!t || t === 'undefined') return;
        localStorage.setItem('navTheme', t);
        navApplyTheme(t);
    });
    // 背景特效开关(2026-11-10):一层 .nav-fx 的显隐,跟主题解耦,换肤不影响开关
    function navApplyFx(on) {
        document.body.classList.toggle('nav-fx-off', !on);
        try { localStorage.setItem('navFx', on ? '1' : '0'); } catch (e) {}
        $('#setNavFx').prop('checked', on);
        $('#navFxToggle').find('i').toggleClass('d-none', !on);
        $('#navFxToggle').attr('aria-pressed', on ? 'true' : 'false');
    }
    navApplyFx(localStorage.getItem('navFx') !== '0');
    $('#setNavFx').on('change', function() { navApplyFx(this.checked); });
    $('#navFxToggle').on('click', function() {
        navApplyFx(document.body.classList.contains('nav-fx-off'));
    });
    // 背景强度(2026-11-20 P2):背景特效层只有开/关,想要"淡一点"只能整层关掉。
    // 这里给 .nav-fx 加 opacity(0~100%),只影响下层光斑/纹理,文字与卡片不受影响。
    function navApplyFxStrength(pct) {
        var v = Math.min(100, Math.max(0, parseInt(pct, 10)));
        if (isNaN(v)) v = 100;
        document.documentElement.style.setProperty('--nav-fx-strength', String(v / 100));
        try { localStorage.setItem('navFxStrength', String(v)); } catch (e) {}
        $('#navFxStrengthR').val(v);
        $('#navFxStrengthV').text(v + '%');
    }
    navApplyFxStrength(localStorage.getItem('navFxStrength') || '100');
    $('#navFxStrengthR').on('input', function() { navApplyFxStrength(this.value); });
    // 点击波纹(2026-11-20 P2):纯外观层,默认关;开了以后每次点击在落点画一圈扩散。
    // 只画不拦事件(pointer-events:none),系统"减少动态"时自动跳过。
    var rippleBound = false;
    function navSpawnRipple(x, y) {
        if (document.body.classList.contains('nav-ripple-off')) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var el = document.createElement('span');
        el.className = 'nav-ripple';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 620);
    }
    function navApplyRipple(on) {
        document.body.classList.toggle('nav-ripple-on', !!on);
        try { localStorage.setItem('navRipple', on ? '1' : '0'); } catch (e) {}
        $('#setNavRipple').prop('checked', !!on);
        if (on && !rippleBound) {
            rippleBound = true;
            document.addEventListener('click', function (ev) {
                if (!document.body.classList.contains('nav-ripple-on')) return;
                navSpawnRipple(ev.clientX, ev.clientY);
            }, true);
        }
    }
    navApplyRipple(localStorage.getItem('navRipple') === '1');
    $('#setNavRipple').on('change', function() { navApplyRipple(this.checked); });
    // 供命令面板 / 其它模块调用(不直接把内部函数挂得到处都是)。
    // D4:wall 子组只提供只读状态 API ——「不可用背景/特效折叠」需要知道壁纸是否激活、
    // 明暗/皮肤/特效是否被锁住;折叠动作本身不改弹层几何,由样式流按状态类收口。
    window.navAppearance = {
        fx: function (on) { navApplyFx(!!on); },
        toggleFx: function () { navApplyFx(document.body.classList.contains('nav-fx-off')); },
        strength: function (v) { navApplyFxStrength(v); },
        ripple: function (on) { navApplyRipple(!!on); },
        toggleRipple: function () { navApplyRipple(!document.body.classList.contains('nav-ripple-on')); },
        wall: {
            active: function () { return !!(document.body && document.body.dataset.navWall === '1'); },
            locked: function () { return !!(document.body && document.body.dataset.navWall === '1'); }
        }
    };
    // D4:壁纸收口入口(清除 + 状态查询),与 #navBgClear 同一套逻辑,不绕开锁态恢复流程。
    window.navWallpaper = {
        clear: navClearWallpaper,
        isActive: function () { return !!(document.body && document.body.dataset.navWall === '1'); },
        isLocked: function () { return !!(document.body && document.body.dataset.navWall === '1'); }
    };
    $('#navBgUpload').on('change', function() {
        const file = this.files && this.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) { wallSay('图片请小于 3MB(只存本机浏览器)'); this.value = ''; return; }
        const reader = new FileReader();
        reader.onload = () => {
            memCustomBg = reader.result;
            navApplyTheme(localStorage.getItem('navTheme') || 'default');
            function persistLocalBg() {
                try { localStorage.setItem('navCustomBg', reader.result); }
                catch (e) { wallSay('图片太大,本机存不下,请换小图'); }
            }
            if (window.navStore) {
                window.navStore.set('navCustomBg', reader.result).then(function (ok) {
                    if (!ok) persistLocalBg();
                }).catch(function () { persistLocalBg(); });
            } else {
                persistLocalBg();
            }
            showToast('背景已应用');
        };
        reader.readAsDataURL(file);
        this.value = '';
    });
    // D4:「清除壁纸」抽成可被外部安全调用的函数(命令面板/其它模块/未来主页面入口均可经
    // window.navClearWallpaper 调用)。按标题语义清掉所有壁纸来源(自定义/随机/必应);
    // 否则只删自定义,随机/必应图源还在,页面看起来没反应,壁纸模式的控件锁也不会解除。
    // 清完 navApplyTheme 会重跑 navApplyWallLocks:body[data-nav-wall] 锁解除,
    // 明暗 / 皮肤 / 特效按钮的禁用态一并恢复。
    function navClearWallpaper() {
        clearCustomBg();
        localStorage.removeItem('navBgSource');
        navApplyTheme(localStorage.getItem('navTheme') || 'default');
        $('#navBgSourceHint').text('已恢复主题默认背景');
        showToast('已恢复主题默认背景');
    }
    $('#navBgClear').on('click', navClearWallpaper);
    window.navClearWallpaper = navClearWallpaper;

    // ===== 背景图源:随机图片 / 必应今日 / 无背景 =====
    function navApplyBgSource(type, url, copyright) {
        localStorage.setItem('navBgSource', JSON.stringify({type: type, url: url || '', copyright: copyright || ''}));
        navApplyTheme(localStorage.getItem('navTheme') || 'default');
        const hint = $('#navBgSourceHint');
        if (type === 'bing') hint.text('已应用必应今日壁纸' + (copyright ? ' · ' + copyright : ''));
        else if (type === 'random') hint.text('已应用随机图片(每次刷新换一张)');
        else hint.text('已恢复主题默认背景');
    }
    $('#navBgRandom').on('click', function() { navApplyBgSource('random'); });
    $('#navBgBing').on('click', function() {
        const $btn = $(this).prop('disabled', true);
        $('#navBgSourceHint').text('获取必应壁纸中…');
        fetch(THEME_URLS.bing).then(r => r.json()).then(d => {
            $btn.prop('disabled', false);
            if (d.status !== 'ok') { $('#navBgSourceHint').text((d && d.message) || '获取失败,请稍后再试'); return; }
            navApplyBgSource('bing', d.url, d.copyright);
        }).catch(() => { $btn.prop('disabled', false); $('#navBgSourceHint').text('获取失败,请检查网络'); });
    });
    $('#navBgNone').on('click', navClearWallpaper);

    // ===== 图标本地化(默认不本地化;点击批量下载热链图标到本机)=====
    $('#navFavLocalBtn').on('click', function() {
        const $btn = $(this).prop('disabled', true);
        $('#navFavLocalResult').text('下载中…(每张 6 秒超时,请稍候)');
        $.ajax({
            url: THEME_URLS.faviconLocalize, method: 'POST', contentType: 'application/json',
            headers: { 'X-CSRFToken': csrf() },
            // 代理与链接测活共用一份本机配置:被墙站的图标直连抓不到
            data: JSON.stringify({proxy: localStorage.getItem('navTestProxy') || ''}),
            success: function(d) {
                $btn.prop('disabled', false);
                $('#navFavLocalResult').text('✓ 已本地化 ' + d.done + ' 个' +
                    (d.failed ? ',失败 ' + d.failed + ' 个(保持热链)' : ''));
                if (d.done) setTimeout(() => location.reload(), 1200);
            },
            error: function() { $btn.prop('disabled', false); $('#navFavLocalResult').text('请求失败'); }
        });
    });
    // 时钟问候(默认显示,设置里可关)
    // 2026-11-13 重排:原来一行灰小字里塞了「问候 + 月日 + 星期 + 时间」,下面紧跟的日历行
    // 又把月日星期说了一遍,两行同级同色同字号 —— 像系统日志,没有节奏。
    // 现在一行大号时间(唯一主视觉)+ 一行小号辅助信息(日期 / 第几天 / 距下班),字号拉开对比。
    // 壁纸态问候语整块是一枚半透明药丸底板:时钟/问候/日期全关掉时会剩一个空胶囊,
    // 看起来像页面上莫名其妙的一个小灰条。三个子项都没内容时整块隐藏(2026-11-24)
    function navSyncGreet() {
        const box = document.querySelector('.nav-greet');
        if (!box) return;
        const parts = ['navGreetHi', 'navClockLine', 'navClockExtra'].map(function (id) { return document.getElementById(id); });
        const any = parts.some(function (s) { return s && !s.classList.contains('d-none') && s.textContent.trim(); });
        box.classList.toggle('d-none', !any);
    }
    function navTickClock() {
        const el = document.getElementById('navClockLine');
        if (!el || el.classList.contains('d-none')) { navSyncGreet(); return; }
        const now = new Date();
        const h = now.getHours();
        // 2026-11-23 多语言：问候语随 nav_lang 走，英文模式下不再出现中文时段词
        const en = !!(window.NavI18n && window.NavI18n.getLang() === 'en');
        const greet = en
            ? (h < 6 ? 'Late night' : h < 11 ? 'Good morning' : h < 14 ? 'Good noon' : h < 18 ? 'Good afternoon' : 'Good evening')
            : (h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好');
        const hi = document.getElementById('navGreetHi');
        if (hi) hi.textContent = greet;
        el.textContent = String(h).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        navRenderCal();
        navRenderCountdowns();
        navSyncGreet();
    }
    // 辅助信息行(本地时间,不用 toISOString——UTC 坑):
    // 11月13日 星期五 · 今年第 317 天 · 距下班 3 小时 11 分钟(仅工作日 9~18 点)
    function navRenderCal() {
        const el = document.getElementById('navCalBox');
        if (!el) return;
        const now = new Date();
        const week = '日一二三四五六'.charAt(now.getDay());
        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        // 2026-11-23 多语言：英文用 "Nov 23, Monday · Day 327 of 2026"，不机翻中文日期串
        const en = !!(window.NavI18n && window.NavI18n.getLang() === 'en');
        const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let line = en
            ? MONTHS_EN[now.getMonth()] + ' ' + now.getDate() + ', ' + DAYS_EN[now.getDay()] +
              ' · Day ' + dayOfYear + ' of ' + now.getFullYear()
            : (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + week +
              ' · 今年第 ' + dayOfYear + ' 天';
        const h = now.getHours();
        // 下班倒计时(off-work 思路):工作日 9~18 点显示距 18:00 的剩余时间
        if (h >= 9 && h < 18 && now.getDay() >= 1 && now.getDay() <= 5) {
            const mins = (18 - h) * 60 - now.getMinutes();
            line += en
                ? ' · ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm to off work'
                : ' · 距下班 ' + Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分';
        }
        el.textContent = line;
    }
    // 自定义倒计时(localStorage navCountdowns:[{id,title,date:'YYYY-MM-DD'}])
    const navCdKey = 'navCountdowns';
    function navCdLoad() { try { return JSON.parse(localStorage.getItem(navCdKey)) || []; } catch (e) { return []; } }
    function navCdSave(list) { localStorage.setItem(navCdKey, JSON.stringify(list)); }
    function navRenderCountdowns() {
        const box = document.getElementById('navCdBox');
        if (!box) return;
        const list = navCdLoad().filter(c => c && c.date);
        if (!list.length) { box.textContent = ''; box.classList.add('d-none'); return; }
        const today = new Date(); today.setHours(0, 0, 0, 0);
        box.classList.remove('d-none');
        box.innerHTML = '';
        list.forEach(function(c) {
            const t = new Date(c.date + 'T00:00:00');
            if (isNaN(t.getTime())) return;
            const diff = Math.round((t - today) / 86400000);
            const label = diff > 0 ? ('距' + c.title + ' ' + diff + ' 天')
                : diff === 0 ? (c.title + ' 就是今天')
                    : (c.title + ' 已到期 ' + (-diff) + ' 天');
            $('<span class="nav-cd-item">').text(label).appendTo(box);
        });
    }
    // 倒计时管理(设置 → 显示 tab,挂时钟开关)
    function navRenderCdManager() {
        const $l = $('#navCdList').empty();
        const list = navCdLoad();
        if (!list.length) { $l.append('<span class="text-muted">还没有倒计时</span>'); return; }
        list.forEach(function(c) {
            const $row = $('<div class="d-flex justify-content-between align-items-center gap-2 mb-1">');
            $('<span class="text-truncate">').text(c.title + ' · ' + c.date).appendTo($row);
            $('<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" title="删除"><i class="fas fa-times"></i>')
                .on('click', function() { navCdSave(navCdLoad().filter(x => x.id !== c.id)); navRenderCdManager(); navRenderCountdowns(); })
                .appendTo($row);
            $row.appendTo($l);
        });
    }
    $('#navCdAdd').on('click', function() {
        const title = $('#navCdTitle').val().trim();
        const date = $('#navCdDate').val();
        if (!title || !date) { showToast('名称和目标日期都要填'); return; }
        const list = navCdLoad();
        if (list.length >= 8) { showToast('最多 8 个倒计时'); return; }
        if (list.some(c => c.date === date)) { showToast('该日期已有倒计时'); return; }
        list.push({id: Date.now(), title: title.slice(0, 20), date: date});
        navCdSave(list);
        $('#navCdTitle').val('');
        navRenderCdManager();
        navRenderCountdowns();
    });
    navRenderCdManager();
    navRenderCountdowns();
    const showClockOn = localStorage.getItem('navShowClock') !== '0';
    $('#setShowClock').prop('checked', showClockOn);
    $('#navClockLine').toggleClass('d-none', !showClockOn);
    $('#navClockExtra').toggleClass('d-none', !showClockOn);
    $('#navGreetHi').toggleClass('d-none', !showClockOn);
    $('#setShowClock').on('change', function() {
        $('#navClockLine').toggleClass('d-none', !this.checked);
        $('#navClockExtra').toggleClass('d-none', !this.checked);
        $('#navGreetHi').toggleClass('d-none', !this.checked);
        localStorage.setItem('navShowClock', this.checked ? '1' : '0');
        navSyncGreet();
        navTickClock();
    });
    navTickClock();
    setInterval(navTickClock, 30000);

    // 对外暴露(主脚本调用点:时钟开关 apply/UI 模式/壁纸滑杆/取色按钮——见文件头)
    window.navApplyTheme = navApplyTheme;
    window.navApplyBgSource = navApplyBgSource;
    window.navExtractAndStore = navExtractAndStore;
    window.navExtractPalette = navExtractPalette;
    window.navApplyWallTweaks = navApplyWallTweaks;
    window.navTickClock = navTickClock;
    window.navRenderCal = navRenderCal;
    window.navRenderCountdowns = navRenderCountdowns;
    window.navRenderCdManager = navRenderCdManager;
});
