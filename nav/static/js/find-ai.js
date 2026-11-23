/* AI 找网站 + 无 API 手动模式 + 点击统计/按常用度排序——从 nav_sites.html 拆出的第二刀(2026-10-25,渐进拆分,同 pet.js 模式)。
   与主脚本(nav_sites.html 内联)的边界约定:
   - 本块自带 csrf()/post()/esc() 小工具(原块即自包含,逐行照搬;post 取 cookie 里的 csrftoken,
     esc 连引号一起转——结果要拼进 value="..."/onclick 属性,见下方原注释);
   - showToast 由主脚本挂的 window.navToast 取用(pet.js 同款);
   - AI 相关 URL 走模板渲染的 JSON 配置岛 #navAiUrls(静态文件里禁模板标签);
   - 桌宠联动只经 window.navPetState/navPetSay/petNotify 判存调用;对外暴露
     window.navAiOpen/navAiRenderDrafts/navAiGenerate/navCopyText/navManualPrompt/
     navManualParse/navAiImport/navApplyUsageSort/navToggleUsageSort(原样保留)。
   本文件随导航页加载,不依赖 searchapp/content_engine(模块移植规则)。*/
jQuery(function ($) {
    'use strict';
    const showToast = window.navToast;
    const AI_URLS = JSON.parse(document.getElementById('navAiUrls').textContent);
    const csrf = () => (document.cookie.split('; ').find(r => r.startsWith('csrftoken=')) || '').split('=')[1];
    const post = (url, data) => fetch(url, {method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf()},
        body: JSON.stringify(data || {})});
    // jQuery 的 .html() 只转 & < >,不转引号——而这些结果要拼进 value="..." / onclick 里,
    // 站点名或 AI 候选名带一个 " 就把属性剪断了,引号必须一起转
    const esc = s => $('<div>').text(s == null ? '' : String(s)).html().replace(/"/g, '&quot;');

    // 浏览器原生 alert 已全站下线(2026-10-30)。提示走主脚本挂的 window.navToast,而且必须
    // 经 window 现取 + 判存(裸引用闭包里的 showToast 一旦不在就静默失效——本模块反复踩过);
    // toast 是页面底部浮层,AI 弹窗内容很长时用户正盯着中间,所以同一句话再落进弹窗内已有的
    // 状态行/预览区顶部,两处一起给。where: 'manual'=手动模式状态行 / 'preview'=预览区顶部。
    function aiSay(msg, where) {
        if (where === 'manual') {
            const $s = $('#navManualStatus');
            if ($s.length) { $s.empty(); $('<span class="text-danger"></span>').text(msg).appendTo($s); }
        } else if (where === 'preview') {
            const $p = $('#navAiPreview');
            if ($p.length) {
                // prepend 一条临时红条:不重绘预览,已填的名称/URL/简介和勾选一个都不动
                const $b = $('<div class="alert alert-danger py-2 small mb-2"></div>').text(msg);
                $p.prepend($b);
                setTimeout(function () { $b.remove(); }, 4000);
            }
        }
        if (window.navToast) { window.navToast(msg); }
        else if (window.console) { console.warn('[nav] ' + msg); }   // 兜底也不恢复原生弹窗
    }

    // ===== AI 找网站 =====
    // 接口配置只在顶栏「AI 接口」弹窗一处,这里不再重复展示/拉取配置状态(2026-10-29 用户要求)
    window.navAiOpen = function() {
        $('#navAiProxy').val(localStorage.getItem('navAiProxy') || '');
        navAiSyncSubs();
        navAiFootState(navAiDrafts.length);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('navAiModal')).show();
    };
    function navAiFootState(n) {
        const btn = document.getElementById('navAiImportBtn');
        const hint = document.getElementById('navAiFootHint');
        if (btn) {
            btn.disabled = !n;
            btn.textContent = n ? ('测活并导入所选（' + n + '）') : '测活并导入所选';
        }
        if (hint) hint.textContent = n ? ('已生成 ' + n + ' 个候选，可改字段后导入') : '生成候选后在这里测活并导入';
    }
    function navAiSyncSubs() {
        let subs = {};
        try { subs = JSON.parse(document.getElementById('navCatSubs').textContent) || {}; } catch (e) {}
        const cat = $('#navAiCat').val();
        const $sub = $('#navAiSub').html('<option value="">(不指定,大类直属)</option>');
        (subs[cat] || []).forEach(s => $sub.append('<option value="' + esc(s) + '">' + esc(s) + '</option>'));
    }
    $('#navAiCat').on('change', navAiSyncSubs);


    let navAiDrafts = [];
    // 候选预览渲染:接口模式与「无 API 手动模式」共用;入库入口只有 navAiImport 一个
    window.navAiRenderDrafts = function(drafts, skipped, meta) {
        navAiDrafts = drafts;
        if (window.navPetState) { navPetState('happy'); navPetSay('找到 ' + drafts.length + ' 个候选,测活后就能入住啦', 3000); }   // 任务联动
        let html = '';
        // 本次调用的模型/耗时(2026-11-19):换过模型或接的是网关时,不标出来就不知道谁在干活
        if (meta && (meta.model || meta.elapsed_ms != null)) {
            const bits = [];
            if (meta.model) bits.push(meta.model);
            if (meta.elapsed_ms != null) {
                bits.push(meta.elapsed_ms >= 1000
                    ? (meta.elapsed_ms / 1000).toFixed(1) + 's'
                    : meta.elapsed_ms + 'ms');
            }
            if (meta.repaired) bits.push('格式已自动修复');
            html += '<div class="small text-muted mb-2" id="navAiMeta">本次：' + esc(bits.join(' · ')) + '</div>';
        }
        if (skipped && skipped.length) {
            html += '<div class="nav-ai-note py-2 small mb-2"><i class="fas fa-circle-info me-1"></i>已自动剔除 ' + skipped.length
                 + ' 条同域名候选：' + esc(skipped.map(s => s.name + '（' + s.skipped_reason + '）').join('、')) + '</div>';
        }
        html += drafts.map((dr, i) => `
            <div class="border rounded p-2 mb-2 nav-ai-card" data-i="${i}">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <input class="form-check-input nav-ai-check m-0" type="checkbox" checked id="nav-ai-ck-${i}" aria-label="选择该候选">
                    <input class="form-control form-control-sm fw-bold nav-ai-name" value="${esc(dr.name)}" aria-label="网站名称">
                </div>
                <div class="row g-1">
                    <div class="col-8">
                        <label class="nav-ai-label d-block" for="nav-ai-url-${i}">URL</label>
                        <input id="nav-ai-url-${i}" class="form-control form-control-sm font-monospace nav-ai-url" value="${esc(dr.url)}">
                    </div>
                    <div class="col-4">
                        <label class="nav-ai-label d-block" for="nav-ai-sub-${i}">小分类</label>
                        <input id="nav-ai-sub-${i}" class="form-control form-control-sm nav-ai-subcat" value="${esc(dr.subcat || $('#navAiSub').val() || '')}" placeholder="可空">
                    </div>
                </div>
                <label class="nav-ai-label d-block mt-1" for="nav-ai-desc-${i}">简介</label>
                <textarea id="nav-ai-desc-${i}" class="form-control form-control-sm nav-ai-desc" rows="2" placeholder="一句话介绍">${esc(dr.description)}</textarea>
            </div>`).join('');
        $('#navAiPreview').html(html);
        navAiFootState(drafts.length);
    };
    window.navAiGenerate = function() {
        localStorage.setItem('navAiProxy', $('#navAiProxy').val());
        const $btn = $('#navAiGo').prop('disabled', true);
        if (window.navPetState) { navPetState('work'); navPetSay('我去找网站了,挑好回来汇报~', 2800); }   // 任务联动
        $('#navAiPreview').html('<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div> AI 正在挑选网站,约 10~60 秒…</div>');
        navAiFootState(0);
        const footHint = document.getElementById('navAiFootHint');
        if (footHint) footHint.textContent = '正在生成候选…';
        post(AI_URLS.generate, {category: $('#navAiCat').val(), subcat: $('#navAiSub').val(),
                                scene: $('#navAiScene').val(), count: $('#navAiCount').val()})
            .then(r => r.json()).then(d => {
                $btn.prop('disabled', false);
                if (d.status !== 'ok') {
                    $('#navAiPreview').html('<div class="alert alert-danger mb-0">' + esc(d.message) + '</div>');
                    navAiFootState(0);
                    const footHint = document.getElementById('navAiFootHint');
                    if (footHint) footHint.textContent = '生成失败，可修改条件后重试';
                    return;
                }
                navAiRenderDrafts(d.drafts, d.skipped,
                                  {model: d.model, elapsed_ms: d.elapsed_ms, repaired: d.repaired});
            })
            .catch(() => { $btn.prop('disabled', false);
                           $('#navAiPreview').html('<div class="alert alert-danger mb-0">请求失败,请重试</div>');
                           navAiFootState(0);
                           const footHint = document.getElementById('navAiFootHint');
                           if (footHint) footHint.textContent = '生成失败，请检查网络后重试'; });
    };

    // ===== 无 API 手动模式:提示词复制到任意 AI,回复粘贴回来解析进同一套预览 =====
    window.navCopyText = function(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text || '');
        }
        const ta = document.createElement('textarea');   // 非安全上下文的兜底
        ta.value = text || '';
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        return Promise.resolve();
    };
    window.navManualPrompt = function() {
        const $btn = $('#navManualGo').prop('disabled', true);
        post(AI_URLS.prompt, {category: $('#navAiCat').val(), subcat: $('#navAiSub').val(),
                              scene: $('#navAiScene').val(), count: $('#navAiCount').val()})
            .then(r => r.json()).then(d => {
                $btn.prop('disabled', false);
                if (d.status !== 'ok') {
                    $('#navManualStatus').html('<span class="text-danger">' + esc(d.message) + '</span>');
                    return;
                }
                $('#navManualPrompt').val(d.prompt);
                navCopyText(d.prompt).then(() => {
                    $('#navManualStatus').html('<span class="text-success">✓ 提示词已复制到剪贴板——去任意 AI 粘贴发送,再把回复完整复制回来粘到下方。</span>');
                }).catch(() => {
                    $('#navManualStatus').html('<span class="text-warning">已生成,但自动复制失败:请手动全选复制上方提示词。</span>');
                });
            })
            .catch(() => { $btn.prop('disabled', false);
                           $('#navManualStatus').html('<span class="text-danger">请求失败,请重试</span>'); });
    };
    window.navManualParse = function() {
        const text = $('#navManualPaste').val();
        if (!text || !text.trim()) { aiSay('请先粘贴 AI 的回复', 'manual'); return; }
        const $btn = $('#navManualParse').prop('disabled', true);
        post(AI_URLS.parse, {text: text, count: $('#navAiCount').val()})
            .then(r => r.json()).then(d => {
                $btn.prop('disabled', false);
                if (d.status !== 'ok') {
                    $('#navAiPreview').html('<div class="alert alert-danger mb-0">' + esc(d.message) + '</div>');
                    navAiFootState(0);
                    return;
                }
                navAiRenderDrafts(d.drafts, []);
            })
            .catch(() => { $btn.prop('disabled', false);
                           $('#navAiPreview').html('<div class="alert alert-danger mb-0">请求失败,请重试</div>');
                           navAiFootState(0); });
    };
    window.navAiImport = function() {
        const picked = [];
        $('#navAiPreview [data-i]').each(function() {
            if (!$(this).find('.nav-ai-check').is(':checked')) return;
            picked.push({name: $(this).find('.nav-ai-name').val(),
                         url: $(this).find('.nav-ai-url').val(),
                         description: $(this).find('.nav-ai-desc').val(),
                         subcat: $(this).find('.nav-ai-subcat').val()});
        });
        if (!picked.length) { aiSay('未勾选任何候选', 'preview'); return; }
        const proxy = $('#navAiProxy').val();
        $('#navAiPreview').prepend('<div class="alert alert-info py-2 small" id="navAiImporting"><span class="spinner-border spinner-border-sm me-1"></span>正在测活并导入(每条 8 秒超时,请稍候)…</div>');
        post(AI_URLS.importUrl, {category: $('#navAiCat').val(), subcat: $('#navAiSub').val(),
                                 proxy: proxy, sites: picked})
            .then(r => r.json()).then(d => {
                $('#navAiImporting').remove();
                if (d.status !== 'ok') { aiSay(d.message || '导入失败', 'preview'); navAiFootState(picked.length); return; }
                let html = '<div class="alert alert-success py-2 mb-2">✅ 成功入库 ' + d.imported.length + ' 条(已自动抓取标题与图标)。'
                         + '<span class="ms-1 text-muted" id="navAiReloadHint">4 秒后自动刷新,</span>'
                         + '<a href="javascript:location.reload()" class="alert-link">立即刷新</a></div>';
                if (d.dead.length) {
                    html += '<div class="alert alert-warning py-2 small mb-2">⛔ 以下 ' + d.dead.length
                         + ' 条测活失败,未导入(可能是 AI 记错或需代理):<br>'
                         + d.dead.map(x => esc(x.name) + ' — ' + esc(x.reason)).join('<br>') + '</div>';
                }
                if (d.duplicates.length) {
                    html += '<div class="alert alert-secondary py-2 small mb-2">♻ 以下 ' + d.duplicates.length
                         + ' 条与已有站点同域名,已跳过:' + esc(d.duplicates.map(x => x.name).join('、')) + '</div>';
                }
                if (d.truncated) {
                    html += '<div class="alert alert-warning py-2 small mb-2">✂ 另有 ' + d.truncated
                         + ' 条超出单次 20 条上限未处理(' + esc((d.truncated_names || []).join('、'))
                         + '),可分批导入。</div>';
                }
                $('#navAiPreview').html(html);
                navAiFootState(0);
                const importBtn = document.getElementById('navAiImportBtn');
                if (importBtn) importBtn.textContent = '已导入 ' + d.imported.length + ' 条';
                const footHint = document.getElementById('navAiFootHint');
                if (footHint) footHint.textContent = '导入完成，页面即将刷新…';
                if (window.navPetState && d.imported.length) { navPetState('happy'); navPetSay('新住进来 ' + d.imported.length + ' 个伙伴!', 3000); petNotify('新住进来 ' + d.imported.length + ' 个伙伴!'); }   // 任务联动
                // 倒计时自动刷新(结果清单保留几秒可看清,急用可点"立即刷新")
                let secs = 4;
                const timer = setInterval(() => {
                    const hint = document.getElementById('navAiReloadHint');
                    if (!hint) { clearInterval(timer); return; }
                    secs -= 1;
                    if (secs <= 0) { clearInterval(timer); location.reload(); return; }
                    hint.textContent = secs + ' 秒后自动刷新,';
                }, 1000);
            })
            .catch(() => { $('#navAiImporting').remove(); aiSay('导入请求失败', 'preview'); navAiFootState(picked.length); });
    };

    // ===== 点击统计:卡片被打开时埋点(星标/编辑/删除按钮除外) =====
    // ⚠️ 委托与卡片包装(_nav_site_card.html)的属性名必须一致:旧代码找的属性
    //    卡片上根本没有,埋点端点从未被调用、click_count 恒 0(2026-10-06 修复)
    //    回归测试盯着这一行,改属性名要两边同步(nav/tests.py NavClickStatTests)
    document.addEventListener('click', function(ev) {
        const a = ev.target.closest('a.site-card');
        if (!a) return;
        if (ev.target.closest('.site-star, .site-edit, .site-del')) return;
        const href = a.getAttribute('href');
        if (!href || href === '#') return;   // 弹子页选择器的卡片不计
        const wrap = a.closest('[data-site-item]');
        if (!wrap) return;
        const sid = Number(wrap.getAttribute('data-id'));
        if (!sid) return;                    // HTML 工具卡无 data-id,不计数
        wrap.dataset.clicks = (Number(wrap.dataset.clicks) || 0) + 1;
        post(AI_URLS.click, {id: sid});
        if (window.navApplyClickHeat) navApplyClickHeat();   // 点击热力跟着点亮
        if (localStorage.getItem('navSortMode') === 'usage') navApplyUsageSort();
    }, true);

    // ===== 卡片排序(设置 → 排序里的下拉,本机生效) =====
    // ⚠️ 行有三种标记(小分类 .cat-body.row / 大类直属 .nav-cat > .row.g-2 / 嵌套 .cat-body > .row.g-2),
    //    排序实现落在 stars-filter.js,这里只保留旧全局名给点击埋点与兼容代码调用。
    window.navApplyUsageSort = function() {
        if (window.navApplySiteSort) window.navApplySiteSort('usage');
    };
    window.navToggleUsageSort = function(chk) {
        const mode = chk && chk.checked ? 'usage' : 'default';
        if (window.navSetSortMode) window.navSetSortMode(mode);
        if (chk && chk.checked) showToast('已按常用度排序');
        else showToast('已恢复默认排序');
    };
    $(function() {
        const legacy = localStorage.getItem('navSortByUsage') === '1';
        const mode = localStorage.getItem('navSortMode');
        if (legacy && mode !== 'usage') localStorage.setItem('navSortMode', 'usage');
        if (window.navApplySiteSort) window.navApplySiteSort();
    });
});
