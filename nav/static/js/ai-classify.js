/* AI 分类 + 标签(2026-11-12):给库里已有站点重判大类/小分类,顺手补标签。
   产品约定(用户明确要求):
   - 结果只列"建议调整"的条目 —— 分类和标签本来就对的直接藏掉,不刷屏;
   - 每行右边一个「采纳 / 已忽略」开关,默认全采纳,可以逐条否掉;
   - 没配 AI 接口时不报错卡住,自动展开「复制提示词」模式:生成提示词 → 外部 AI 跑 → 粘回来解析;
   - 应用只写被采纳的条目,空大类一律跳过(别把站点丢进「未分类」)。
   与 find-ai.js 同款边界:自带 csrf/post,toast 走 window.navToast,URL 走 JSON 配置岛。*/
jQuery(function ($) {
    'use strict';
    const NAC_URLS = JSON.parse(document.getElementById('navAiClassifyUrls').textContent);
    const csrf = () => (document.cookie.split('; ').find(r => r.startsWith('csrftoken=')) || '').split('=')[1];
    const post = (url, data) => fetch(url, {method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf()},
        body: JSON.stringify(data || {})}).then(r => r.json());

    const NAC_BATCH = 40;        // 与后端 NAV_AI_CLASSIFY_BATCH 对齐
    let nacItems = [];           // 本次选中的站点(带 id/原分类/原标签)
    let nacRows = [];            // 需要调整的建议(已过滤掉"本来就对"的)
    let nacAdopt = [];           // 与 nacRows 一一对应:是否采纳

    const tagKey = tags => (tags || []).map(t => String(t).trim()).filter(Boolean).sort().join('|');
    const splitTags = raw => {
        const out = [], seen = new Set();
        String(raw || '').split(/[,，、;；\s]+/).forEach(t => {
            t = t.trim().slice(0, 10);
            if (t && !seen.has(t)) { seen.add(t); out.push(t); }
        });
        return out.slice(0, 8);
    };
    // 分类/小分类/标签任一不同才算"建议调整"
    const isChanged = r => (r.category || '') !== (r.old_category || '')
        || (r.subcat || '') !== (r.old_subcat || '')
        || tagKey(r.tags) !== tagKey(r.old_tags);

    function say(msg, cls) {
        $('#nacSummary').text(msg || '').removeClass('text-muted text-danger text-success')
            .addClass('text-' + (cls || 'muted'));
    }
    function toast(msg) {
        const t = window.navToast;
        if (typeof t === 'function') t(msg); else if (window.console) console.warn('[nac] ' + msg);
    }

    window.navAiClassifyOpen = function () {
        $('#nacScope').val('all');
        $('#nacCatWrap').addClass('d-none');
        $('#nacSummary').empty();
        $('#nacResult').empty();
        $('#nacPrompt, #nacPaste').val('');
        $('#nacStatus').empty();
        $('#nacManual').addClass('d-none');
        nacItems = []; nacRows = []; nacAdopt = [];
        bootstrap.Modal.getOrCreateInstance(document.getElementById('navAiClassifyModal')).show();
    };
    $('#nacScope').on('change', function () {
        $('#nacCatWrap').toggleClass('d-none', this.value !== 'category');
    });

    // 取本次要处理的站点(范围 + 条数)
    function fetchItems() {
        return post(NAC_URLS.items, {scope: $('#nacScope').val(), category: $('#nacCat').val(),
                                     limit: $('#nacLimit').val()})
            .then(d => {
                if (d.status !== 'ok') throw new Error(d.message || '取站点失败');
                nacItems = d.items || [];
                return d;
            });
    }

    // 只保留有变化的行 → 渲染
    function applyRows(rows, total, note) {
        nacRows = (rows || []).filter(isChanged);
        nacAdopt = nacRows.map(() => true);
        render(total || (rows || []).length, note);
    }

    function render(total, note) {
        const hidden = Math.max(0, total - nacRows.length);
        $('#nacResult').empty();
        say('AI 返回 ' + total + ' 条：其中 ' + hidden + ' 条分类和标签本来就对（已隐藏），'
            + nacRows.length + ' 条建议调整。');
        // 中途某批失败时,已拿到的建议照样列出来,别让用户白等
        if (note) {
            $('#nacResult').append($('<div class="alert alert-warning py-1 px-2 small mt-2"></div>').text(note));
        }
        if (!nacRows.length) {
            $('#nacResult').append($('<div class="alert alert-success mb-0"></div>')
                .text('这批站点的分类和标签都没问题，不用改。'));
            return;
        }
        const $tools = $('<div class="nac-toolbar d-flex align-items-center gap-2 mb-1"></div>');
        $('<span class="small text-muted me-auto nac-count"></span>').appendTo($tools);
        $('<button type="button" class="btn btn-sm btn-outline-secondary" data-adopt="all">全选</button>').appendTo($tools);
        $('<button type="button" class="btn btn-sm btn-outline-secondary" data-adopt="none">全部忽略</button>').appendTo($tools);
        $('#nacResult').append($tools);

        const $wrap = $('<div class="table-responsive nac-tablewrap"></div>');
        const $t = $('<table class="table table-sm align-middle mb-0 w-100 nac-table"><thead>'
            + '<tr><th style="width:17%">站点</th><th style="width:41%">现分类 → 建议</th>'
            + '<th style="width:26%">标签（逗号分隔）</th><th class="text-end" style="width:16%">是否采纳</th>'
            + '</tr></thead><tbody></tbody></table>');
        const $tb = $t.find('tbody');
        nacRows.forEach(function (r, i) {
            const sameCat = (r.category || '') === (r.old_category || '')
                && (r.subcat || '') === (r.old_subcat || '');
            const $tr = $('<tr>').attr('data-i', i).toggleClass('nac-row-off', !nacAdopt[i]);
            $('<td class="nac-site-name">').text(r.name).attr('title', r.url).appendTo($tr);

            // 一行读完:现分类 → [新大类][新小分类];分类没变时整行弱化并标「分类不变」
            const $line = $('<div class="d-flex align-items-center gap-1 nac-catline"></div>')
                .toggleClass('nac-same', sameCat);
            $('<span class="text-muted small text-truncate nac-old">')
                .text((r.old_category || '未分类') + (r.old_subcat ? ' / ' + r.old_subcat : ''))
                .attr('title', (r.old_category || '未分类') + (r.old_subcat ? ' / ' + r.old_subcat : ''))
                .appendTo($line);
            $('<span class="text-muted small nac-arrow">→</span>').appendTo($line);
            $('<input class="form-control form-control-sm nac-cat" aria-label="新大类">')
                .val(r.category).appendTo($line);
            $('<input class="form-control form-control-sm nac-sub" placeholder="小分类(可空)" aria-label="新小分类">')
                .val(r.subcat).appendTo($line);
            if (sameCat) $('<span class="badge nac-same-badge">分类不变</span>').appendTo($line);
            const $catTd = $('<td>').append($line);
            if (r.reason) {
                $('<div class="small text-muted nac-reason">').text(r.reason).attr('title', r.reason).appendTo($catTd);
            }
            $catTd.appendTo($tr);

            // 标签 diff:标签有变化时,输入框下方挂一行原标签,Review 时不用凭记忆对
            const $tagsTd = $('<td>');
            $tagsTd.append($('<input class="form-control form-control-sm nac-tags" aria-label="标签">')
                .val((r.tags || []).join(', ')));
            if (tagKey(r.tags) !== tagKey(r.old_tags)) {
                $tagsTd.append($('<div class="small text-muted text-truncate nac-diff">')
                    .text('原：' + ((r.old_tags || []).join(', ') || '（无）'))
                    .attr('title', '原标签：' + ((r.old_tags || []).join(', ') || '（无）')));
            }
            $tagsTd.appendTo($tr);

            const $adopt = $('<label class="form-check form-switch nac-adopt-wrap mb-0">');
            $('<input type="checkbox" class="form-check-input nac-adopt" role="switch">')
                .prop('checked', !!nacAdopt[i]).appendTo($adopt);
            $('<span class="nac-adopt-txt"></span>').text(nacAdopt[i] ? '已采纳' : '已忽略').appendTo($adopt);
            $('<td class="text-end">').append($adopt).appendTo($tr);
            $tr.appendTo($tb);
        });
        $wrap.append($t).appendTo('#nacResult');

        const $bar = $('<div class="nac-applybar d-flex align-items-center gap-2 mt-2"></div>');
        $('<span class="small text-muted me-auto" id="nacApplyCount"></span>').appendTo($bar);
        $('<button type="button" class="btn btn-sm btn-success nav-modal-primary" id="nacApply"></button>')
            .on('click', applyAdopted).appendTo($bar);
        $bar.appendTo('#nacResult');
        paintApply();
    }

    function paintAdopt() {
        $('#nacResult tbody tr').each(function () {
            const i = +$(this).attr('data-i');
            const on = !!nacAdopt[i];
            $(this).toggleClass('nac-row-off', !on);
            $(this).find('.nac-adopt').prop('checked', on);
            $(this).find('.nac-adopt-txt').text(on ? '已采纳' : '已忽略');
        });
        paintApply();
    }

    function paintApply() {
        const n = nacAdopt.filter(Boolean).length;
        const total = nacAdopt.length;
        $('#nacApplyCount').text('已采纳 ' + n + ' / 共 ' + total + ' 条');
        $('#nacResult .nac-count').text('共 ' + total + ' 条建议，默认全采纳');
        $('#nacApply').text('应用已采纳的 ' + n + ' 条').prop('disabled', n === 0);
    }

    $('#nacResult').on('change', '.nac-adopt', function () {
        const i = +$(this).closest('tr').attr('data-i');
        nacAdopt[i] = this.checked;
        $(this).closest('tr').toggleClass('nac-row-off', !this.checked);
        $(this).closest('.nac-adopt-wrap').find('.nac-adopt-txt').text(this.checked ? '已采纳' : '已忽略');
        paintApply();
    });
    $('#nacResult').on('click', '[data-adopt]', function () {
        const on = $(this).attr('data-adopt') === 'all';
        nacAdopt = nacAdopt.map(() => on);
        paintAdopt();
    });

    function applyAdopted() {
        const rows = [];
        $('#nacResult tbody tr').each(function () {
            const i = +$(this).attr('data-i');
            if (!nacAdopt[i]) return;
            const cat = String($(this).find('.nac-cat').val() || '').trim();
            if (!cat) return;                       // 空大类跳过:不接受"丢进未分类"
            rows.push({id: nacRows[i].id, category: cat,
                       subcat: String($(this).find('.nac-sub').val() || '').trim(),
                       tags: splitTags($(this).find('.nac-tags').val())});
        });
        if (!rows.length) { toast('没有勾选任何变更'); return; }
        const $btn = $('#nacApply').prop('disabled', true).text('正在应用…');
        post(NAC_URLS.apply, {rows: rows}).then(d => {
            if (d.status !== 'ok') {
                $btn.prop('disabled', false).text('重试');
                say(d.message || '应用失败', 'danger');
                return;
            }
            toast('已更新 ' + d.updated + ' 个站点,正在刷新…');
            setTimeout(() => location.reload(), 900);
        }).catch(() => {
            $btn.prop('disabled', false).text('重试');
            say('请求失败,请重试', 'danger');
        });
    }

    // ==== 接口模式:分批送模型,只把"有变化"的留下 ====
    window.nacRun = function () {
        const $btn = $('#nacGo').prop('disabled', true);
        $('#nacResult').empty();
        say('正在取站点…');
        fetchItems().then(function () {
            if (!nacItems.length) { say('没有符合条件的站点'); $btn.prop('disabled', false); return; }
            const chunks = [];
            for (let i = 0; i < nacItems.length; i += NAC_BATCH) chunks.push(nacItems.slice(i, i + NAC_BATCH));
            const acc = [];
            let done = 0;
            const step = function (k) {
                if (k >= chunks.length) {
                    $btn.prop('disabled', false);
                    applyRows(acc, done);
                    return;
                }
                say('AI 正在分类:' + done + '/' + nacItems.length
                    + '(第 ' + (k + 1) + '/' + chunks.length + ' 批)…');
                post(NAC_URLS.batch, {items: chunks[k]}).then(function (d) {
                    if (d.status !== 'ok') {
                        $btn.prop('disabled', false);
                        const note = '第 ' + (k + 1) + '/' + chunks.length + ' 批失败:'
                            + (d.message || '未知错误');
                        if (d.code === 'ai_not_configured') {
                            // 没配接口不是错误路径:直接把手动模式摊开
                            $('#nacManual').removeClass('d-none');
                            $('#nacStatus').empty().append(
                                $('<span class="text-danger"></span>').text(d.message));
                            say('未配置 AI 接口 —— 用下面的提示词模式,一样能跑。');
                        } else if (acc.length) {
                            // 已经跑出来的几批照样摆出来,标注哪一批断的
                            applyRows(acc, acc.length, note + ';前面的 ' + acc.length + ' 条建议已保留');
                        } else {
                            say(d.message || '分类失败', 'danger');
                        }
                        return;
                    }
                    (d.rows || []).forEach(r => acc.push(r));
                    done += (d.requested || 0);
                    step(k + 1);
                }).catch(function () {
                    $btn.prop('disabled', false);
                    const note = '第 ' + (k + 1) + '/' + chunks.length + ' 批请求失败(网络/超时)';
                    if (acc.length) {
                        applyRows(acc, acc.length, note + ';前面的 ' + acc.length + ' 条建议已保留');
                    } else {
                        say('请求失败,请重试', 'danger');
                    }
                });
            };
            step(0);
        }).catch(function (e) {
            $btn.prop('disabled', false);
            say(e.message || '取站点失败', 'danger');
        });
    };

    // ==== 无 API 手动模式:提示词复制出去跑,回复粘回来解析 ====
    window.nacPrompt = function () {
        const $btn = $('#nacPromptGo').prop('disabled', true);
        $('#nacStatus').empty().append($('<span class="text-muted"></span>').text('正在生成提示词…'));
        (nacItems.length ? Promise.resolve() : fetchItems())
            .then(function () {
                if (!nacItems.length) throw new Error('没有符合条件的站点');
                return post(NAC_URLS.prompt, {items: nacItems});
            })
            .then(function (d) {
                $btn.prop('disabled', false);
                if (d.status !== 'ok') throw new Error(d.message || '生成失败');
                $('#nacPrompt').val(d.prompt);
                const copy = window.navCopyText ? window.navCopyText(d.prompt) : Promise.reject();
                copy.then(() => {
                    $('#nacStatus').empty().append($('<span class="text-success"></span>')
                        .text('✓ 提示词已复制(共 ' + d.count + ' 个站点)——去任意 AI 粘贴发送,再把回复整段粘回来。'));
                }).catch(() => {
                    $('#nacStatus').empty().append($('<span class="text-warning"></span>')
                        .text('已生成,但自动复制失败:请手动全选复制上方提示词。'));
                });
            })
            .catch(function (e) {
                $btn.prop('disabled', false);
                $('#nacStatus').empty().append($('<span class="text-danger"></span>').text(e.message || '生成失败'));
            });
    };

    window.nacParse = function () {
        const text = $('#nacPaste').val();
        if (!text || !text.trim()) {
            $('#nacStatus').empty().append($('<span class="text-danger"></span>').text('请先粘贴 AI 的回复'));
            return;
        }
        const $btn = $('#nacParseGo').prop('disabled', true);
        (nacItems.length ? Promise.resolve() : fetchItems())
            .then(function () {
                if (!nacItems.length) throw new Error('没有符合条件的站点');
                return post(NAC_URLS.parse, {text: text, items: nacItems});
            })
            .then(function (d) {
                $btn.prop('disabled', false);
                if (d.status !== 'ok') throw new Error(d.message || '解析失败');
                $('#nacStatus').empty().append($('<span class="text-success"></span>')
                    .text('✓ 解析到 ' + (d.rows || []).length + ' 条结果,下面只列需要调整的。'));
                applyRows(d.rows || [], nacItems.length);
            })
            .catch(function (e) {
                $btn.prop('disabled', false);
                $('#nacStatus').empty().append($('<span class="text-danger"></span>').text(e.message || '解析失败'));
            });
    };
});
