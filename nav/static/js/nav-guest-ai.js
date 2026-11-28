/* 访客本机 AI 套件(2026-11-20):
   找站 / 分类 / 对话 / 快捷问答 / 碎碎念 / 余额,全部用访客自己填的 OpenAI 兼容接口,
   浏览器直连,不经过本站服务端、不落库。候选与分类结果只写这台浏览器的书签。
   边界:
   - 配置/对话记忆走 navStore(IndexedDB),不写 localStorage 大对象;
   - 上游没开 CORS 时给明确提示,不伪装成"AI 没配置";
   - 不调用任何本站写接口,也不依赖服务端 AI 配置。
   对外:window.navGuestAi / window.openGuestLocalAiPanel / window.navGuestProbeUrl。 */
(function () {
    'use strict';
    if (!window.NAV_GUEST_MODE) return;

    var CFG_KEY = 'navGuestAiCfgV1';
    var HIST_KEY = 'navGuestAiHistoryV1';
    var LOG_KEY = 'navGuestAiLogV1';
    var HIST_MAX = 40;
    var LOG_MAX = 100;
    var DRAFT_MAX = 15;
    var CLASSIFY_BATCH = 40;
    var CLASSIFY_MAX = 200;
    var TAG_SEED = ['免费', '开源', '需代理', '免登录', '需订阅'];
    var MEME_NAMES = ['Ciallo', 'token给妈妈保管', '假如给我三天多模态', '先养着吧', '厉害了我的鲸',
        '压力一只大肥鱼', '可爱', '吃白饭的大肥鱼', '吃饱饱摸肚子', '哦鲸鲸', '哪来的电脑病毒',
        '大师这个区是什么意思', '大烧货', '大的药来了', '大的要来啦', '完蛋了把黄油删了',
        '就一碗', '就骚了怎么滴吧', '我不更新你们用什么', '死掉了', '深度睡眠', '电死你',
        '要不直接骂他', '誓死践行开源精神', '除了调情没啥用', '鱼片有资源吗', '黎曼猜想没证明喵'];

    var PET_DEFAULT_PERSONA =
        '你是主人浏览器里的Q版蓝发小女仆(小鲸鱼),会时不时碎碎念一句。' +
        '说话要自然随意、短短一句(20字以内),温柔乖巧带点俏皮,说人话不啰嗦,' +
        '不要解释你自己,不要提你是AI。';

    // 与 nav/ai.py 的 SYSTEM_PROMPT 保持同文:两条路径(接口/手动)拿到的约束一致。
    var SITE_SYSTEM_PROMPT =
        '你是导航站的选站编辑,熟悉各类互联网站点(AI 工具/开发者工具/设计素材/学习文档/' +
        '效率服务/资讯社区等),按用户给定的分类和场景推荐真实存在、长期稳定、业内常用的网站。\n' +
        '硬性要求:\n' +
        '1. 只推荐你非常确定真实存在的网站;url 填该站点真实的首页地址(https:// 开头,' +
        '到域名或一级目录为止),多域名/多分站的用主域名;绝不编造、绝不猜测域名;\n' +
        '2. 宁缺毋滥:不确定的站不要输出,输出条数可以少于用户要的条数;\n' +
        '3. description 用中文一句话(≤40 字)说明"它是干什么的、对访客有什么用";\n' +
        '4. name 用站点的通用叫法(中文或英文名,不用完整域名,除非没有更好叫法);\n' +
        '5. subcat 优先对齐用户给出的已有小分类命名;没有合适的就留空字符串;\n' +
        '6. 只输出 JSON 数组,不要输出任何其他文字。';

    var CLASSIFY_SYSTEM_PROMPT =
        '你是导航站的分类编辑。用户会给一批已有站点(名称、网址、现在的分类),' +
        '请判断每个站点最合适的大类和小分类。\n' +
        '硬性要求:\n' +
        '1. 优先复用用户给出的大类清单;清单里确实没有合适的才新建,新大类要短(≤8 字)、通用、' +
        '能装下多个同类站点,别为单个站造分类;\n' +
        '2. 小分类 ≤10 字,同一大类下命名保持一致(同类东西用同一个词);拿不准就留空字符串;\n' +
        '3. 同类服务必须归到同一个分类:同域名、同产品线、同用途的站点不要拆开,更不要一条一个分类;\n' +
        '4. 判断依据是"这个站是干什么用的",不是名字里碰巧出现的字;\n' +
        '5. 标签只描述「跨分类的属性」——获取成本(免费/需订阅)、可达性(需代理/免登录)、' +
        '能力(多模态/长文本/语音/编程);不要描述主题,主题交给分类,更不要重复分类名;\n' +
        '6. 标签只能从用户给出的标签词表里选,词表里没有合适的就输出空数组 —— 宁缺毋滥,' +
        '禁止自造词(自造词会让标签系统碎片化);每条最多 3 个;\n' +
        '7. 只输出 JSON 数组,不要任何解释文字。';

    var cfgCache = null;
    var cfgReady = null;
    var findDrafts = [];
    var findMeta = {};
    var classifyItems = [];
    var classifyRows = [];
    var classifyAdopt = [];
    var saveTimer = null;

    function storeGet(key, fallback) {
        if (window.navStore && window.navStore.get) {
            return window.navStore.get(key, null).then(function (v) { return v == null ? fallback() : v; })
                .catch(fallback);
        }
        try { var raw = localStorage.getItem(key); return Promise.resolve(raw ? JSON.parse(raw) : fallback()); }
        catch (e) { return Promise.resolve(fallback()); }
    }
    function storeSet(key, val) {
        if (window.navStore && window.navStore.set) return window.navStore.set(key, val);
        try { localStorage.setItem(key, JSON.stringify(val)); return Promise.resolve(true); }
        catch (e) { return Promise.resolve(false); }
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(msg) {
        if (window.navToast) window.navToast(msg);
        else if (window.console) console.warn('[nav-guest-ai] ' + msg);
    }
    function cleanCfg(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        return {
            baseUrl: String(raw.baseUrl || '').trim().replace(/\/+$/, ''),
            apiKey: String(raw.apiKey || '').trim(),
            model: String(raw.model || '').trim(),
            modelClassify: String(raw.modelClassify || '').trim(),
            modelPet: String(raw.modelPet || '').trim(),
            persona: String(raw.persona || '').slice(0, 2000),
            memoryRounds: Math.max(0, Math.min(20, Number(raw.memoryRounds) || 5))
        };
    }
    function loadCfg() {
        if (cfgReady) return cfgReady;
        cfgReady = storeGet(CFG_KEY, function () { return {}; }).then(function (raw) {
            cfgCache = cleanCfg(raw);
            return cfgCache;
        });
        return cfgReady;
    }
    function cfg() { return cfgCache || cleanCfg({}); }
    function configured() { var c = cfg(); return !!(c.baseUrl && c.model); }
    function modelFor(task) {
        var c = cfg();
        if (task === 'classify') return c.modelClassify || c.model;
        // 桌宠聊天 / 碎碎念优先 modelPet,留空回落默认模型;找站仍走默认模型。
        if (task === 'pet' || task === 'whisper') return c.modelPet || c.model;
        return c.model;
    }
    function saveCfg(next) {
        cfgCache = cleanCfg(next);
        cfgReady = Promise.resolve(cfgCache);
        return storeSet(CFG_KEY, cfgCache).then(function (ok) {
            window.dispatchEvent(new CustomEvent('nav-guest-ai-config', { detail: cfgCache }));
            return ok;
        });
    }
    // 桌宠设置页(人设/记忆轮数/桌宠模型)只改这三项,不碰接口地址和 Key
    function savePetConfig(patch) {
        patch = patch && typeof patch === 'object' ? patch : {};
        var current = cfg();
        return saveCfg({
            baseUrl: current.baseUrl,
            apiKey: current.apiKey,
            model: current.model,
            modelClassify: current.modelClassify,
            modelPet: patch.modelPet != null ? patch.modelPet : current.modelPet,
            persona: patch.persona != null ? patch.persona : current.persona,
            memoryRounds: patch.memoryRounds != null ? patch.memoryRounds : current.memoryRounds
        });
    }

    // ===== 本机调用日志(环形缓冲;只记任务/模型/成败/耗时/错误/时间,不存 Key 与报文) =====
    function appendLog(entry) {
        var clean = {
            task: String(entry.task || '').slice(0, 12),
            model: String(entry.model || '').slice(0, 100),
            ok: !!entry.ok,
            elapsed_ms: Math.max(0, Number(entry.elapsed_ms) || 0),
            error: String(entry.error || '').slice(0, 200),
            at: Date.now()
        };
        return storeGet(LOG_KEY, function () { return []; }).then(function (list) {
            if (!Array.isArray(list)) list = [];
            list.push(clean);
            if (list.length > LOG_MAX) list = list.slice(list.length - LOG_MAX);
            return storeSet(LOG_KEY, list);
        }).catch(function () {});
    }
    function readLogs() {
        return storeGet(LOG_KEY, function () { return []; }).then(function (list) {
            return Array.isArray(list) ? list.slice() : [];
        }).catch(function () { return []; });
    }
    function clearLogsStore() {
        if (window.navStore && window.navStore.remove) return window.navStore.remove(LOG_KEY);
        try { localStorage.removeItem(LOG_KEY); } catch (e) {}
        return Promise.resolve();
    }

    // ===== 通用接口调用 =====
    function AiError(message, kind) {
        this.name = 'AiError';
        this.message = message;
        this.kind = kind || '';
    }
    AiError.prototype = Object.create(Error.prototype);

    function fetchChat(messages, opts) {
        opts = opts || {};
        var logTask = opts.task || 'chat';
        var modelTask = opts.modelTask || logTask;
        var started = Date.now();
        var resolvedModel = '';
        return loadCfg().then(function (c) {
            if (!c.baseUrl || !c.model) {
                var cfgErr = new AiError('还没填接口地址和模型:点「AI 接口」填好再试(只存本机)。', 'config');
                appendLog({ task: logTask, model: modelFor(modelTask), ok: false,
                    elapsed_ms: Date.now() - started, error: cfgErr.message });
                throw cfgErr;
            }
            var url = c.baseUrl + '/chat/completions';
            resolvedModel = opts.model || modelFor(modelTask);
            var body = {
                model: resolvedModel,
                messages: messages,
                temperature: opts.temperature == null ? 0.6 : opts.temperature
            };
            if (opts.maxTokens) body.max_tokens = opts.maxTokens;
            var headers = { 'Content-Type': 'application/json' };
            if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey;
            var timeout = opts.timeout || 90;

            function once() {
                var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout * 1000) : null;
                return fetch(url, {
                    method: 'POST', headers: headers, body: JSON.stringify(body),
                    signal: ctrl ? ctrl.signal : undefined
                }).then(function (resp) {
                    if (timer) clearTimeout(timer);
                    if (resp.status === 200) return resp.json();
                    return resp.text().then(function (txt) {
                        var e = new AiError('接口返回 ' + resp.status + '(模型 ' + body.model + '):'
                            + String(txt || '').slice(0, 180), 'http');
                        e.httpStatus = resp.status;
                        throw e;
                    });
                }).catch(function (err) {
                    if (timer) clearTimeout(timer);
                    if (err && err.name === 'AbortError') throw new AiError('请求超时(' + timeout + 's 没响应)', 'timeout');
                    if (err instanceof AiError) throw err;
                    // TypeError = 浏览器网络层拒绝:最常见的是上游没开 CORS
                    throw new AiError('连不上接口:可能是上游没开放跨域(CORS),或地址/网络不通。'
                        + '本机网关(Ollama / one-api)一般可在设置里放行跨域。', 'cors');
                });
            }
            return once().catch(function (err) {
                var retry = err && err.httpStatus && [429, 500, 502, 503, 504].indexOf(err.httpStatus) !== -1;
                if (!retry) throw err;
                return new Promise(function (res) { setTimeout(res, 500); }).then(once);
            }).then(function (data) {
                var msg = data && data.choices && data.choices[0] && data.choices[0].message;
                var content = msg && (msg.content || msg.reasoning_content || msg.reasoning);
                if (!content) throw new AiError('接口返回内容为空');
                appendLog({ task: logTask, model: resolvedModel, ok: true,
                    elapsed_ms: Date.now() - started, error: '' });
                return { content: String(content).trim(), model: resolvedModel, elapsed_ms: Date.now() - started };
            }, function (err) {
                appendLog({ task: logTask, model: resolvedModel, ok: false,
                    elapsed_ms: Date.now() - started, error: err && err.message ? err.message : String(err) });
                throw err;
            });
        });
    }

    function extractJsonArray(text) {
        var raw = String(text || '').replace(/```(?:json)?/g, '').trim();
        var start = raw.indexOf('['), end = raw.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) throw new Error('回复中没有 JSON 数组');
        return JSON.parse(raw.slice(start, end + 1));
    }
    function cleanDraft(d) {
        if (!d || typeof d !== 'object') return null;
        var name = String(d.name || '').trim().slice(0, 100);
        var url = String(d.url || '').trim();
        if (!name || !/^https?:\/\//i.test(url)) return null;
        return {
            name: name, url: url.slice(0, 300),
            description: String(d.description || '').trim().slice(0, 200),
            subcat: String(d.subcat || '').trim().slice(0, 50)
        };
    }
    function parseSiteDrafts(text, count) {
        var raw = extractJsonArray(text);
        var out = [];
        for (var i = 0; i < raw.length && out.length < Math.min(count || 8, DRAFT_MAX); i++) {
            var d = cleanDraft(raw[i]);
            if (d) out.push(d);
        }
        if (!out.length) throw new Error('AI 返回的候选为空或格式不符');
        return out;
    }
    function parseClassify(text, count) {
        var raw = extractJsonArray(text);
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var d = raw[i];
            if (!d || typeof d !== 'object') continue;
            var idx = parseInt(d.i, 10);
            if (!idx || idx < 1 || idx > count) continue;
            var cat = String(d.category || '').trim().slice(0, 50);
            if (!cat) continue;
            var tags = [];
            if (Array.isArray(d.tags)) {
                d.tags.slice(0, 4).forEach(function (t) {
                    if (t && typeof t === 'object') t = t.name;
                    t = String(t || '').trim().slice(0, 10);
                    if (t && tags.indexOf(t) < 0) tags.push(t);
                });
            }
            out.push({ i: idx, category: cat, subcat: String(d.subcat || '').trim().slice(0, 50),
                       tags: tags, reason: String(d.reason || '').trim().slice(0, 100) });
        }
        if (!out.length) throw new Error('回复里没有可用的分类结果');
        return out;
    }
    function chatJson(system, user, parse, opts) {
        opts = opts || {};
        var messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
        return fetchChat(messages, opts).then(function (meta) {
            try {
                return { value: parse(meta.content, opts.count), meta: { model: meta.model, elapsed_ms: meta.elapsed_ms } };
            } catch (first) {
                var repair = messages.concat([
                    { role: 'assistant', content: String(meta.content).slice(0, 3000) },
                    { role: 'user', content: '上一次回复无法解析:' + String(first.message || first).slice(0, 150)
                        + '。\n请只输出一个 JSON 数组,不要任何解释文字,不要 ```json 代码围栏,'
                        + '字段与类型必须与上面要求完全一致。' }
                ]);
                return fetchChat(repair, { temperature: 0, timeout: 90, task: 'repair',
                    modelTask: opts.modelTask || opts.task, model: opts.model })
                    .then(function (m2) {
                        return { value: parse(m2.content, opts.count),
                                 meta: { model: meta.model, elapsed_ms: meta.elapsed_ms + m2.elapsed_ms, repaired: true } };
                    });
            }
        });
    }

    // ===== AI 推荐分类/标签/图标文字(与主人端 /api/nav/ai/suggest/ 同口径,只是走本机 Key 直连) =====
    function localCatList() {
        var cats = (window.navGuestLocal && window.navGuestLocal.categories()) || [];
        return cats.length ? cats : ['我的导入'];
    }
    function localTagVocab() {
        try {
            return (window.navGuestLocal && window.navGuestLocal.tagVocab()) || [];
        } catch (e) { return []; }
    }
    function parseSuggest(text) {
        var arr = extractJsonArray(text);
        var d = arr && arr[0];
        if (!d || typeof d !== 'object') throw new Error('AI 没给出建议');
        var cats = localCatList();
        var cat = String(d.category || '').trim().slice(0, 50);
        if (cat && cats.indexOf(cat) < 0) cat = '';       // 只从库里现有大类里挑,不自造
        var tags = [];
        if (Array.isArray(d.tags)) {
            d.tags.slice(0, 5).forEach(function (t) {
                if (t && typeof t === 'object') t = t.name;
                t = String(t || '').trim().slice(0, 10);
                if (t && tags.indexOf(t) < 0) tags.push(t);
            });
        }
        function links(arr, needName) {
            var out = [];
            (Array.isArray(arr) ? arr : []).slice(0, 6).forEach(function (x) {
                if (!x || typeof x !== 'object') return;
                var u = String(x.url || '').trim().slice(0, 300);
                if (!/^https?:\/\//i.test(u)) return;
                var item = { url: u, description: String(x.description || '').trim().slice(0, 200) };
                item.name = String(x.name || '').trim().slice(0, 80);
                if (needName && !item.name) item.name = '子页面';
                out.push(item);
            });
            return out;
        }
        return {
            category: cat,
            subcat: String(d.subcat || '').trim().slice(0, 50),
            tags: tags,
            icon_text: String(d.icon_text || '').trim().slice(0, 2),
            children: links(d.children, true),
            alternates: links(d.alternates, false),
            new_category: !!d.new_category
        };
    }
    function suggestSite(info) {
        info = info || {};
        var name = String(info.name || '').trim().slice(0, 80);
        var url = String(info.url || '').trim().slice(0, 300);
        var desc = String(info.description || '').trim().slice(0, 200);
        if (!name && !url) return Promise.reject(new AiError('先填名称或网址', 'input'));
        var cats = localCatList();
        var vocab = localTagVocab().slice(0, 80);
        var wantLinks = !!info.links;
        var system = '你是网址导航站的书签归类助手。只输出一个 JSON 数组,数组里只有一个对象,'
            + '字段: category(大类,必须从给定清单里选), subcat(小分类,可空), tags(字符串数组,最多 5 个),'
            + 'icon_text(1-2 个字的图标文字)'
            + (wantLinks ? ', children(子网页数组,可空), alternates(备用网址数组,可空)' : '')
            + '。不要解释,不要代码围栏。';
        var user = '现有大类:' + cats.join('、') + '\n'
            + (vocab.length ? '现有标签词表(优先复用):' + vocab.join('、') + '\n' : '')
            + '约束: category 必须是现有大类之一;tags 优先用词表里的词;icon_text 中文取前两字、英文取首字母。\n'
            + '站点: 名称「' + name + '」 网址 ' + url + (desc ? ' 简介「' + desc + '」' : '') + '\n'
            + (wantLinks
                ? 'children/alternates 里每项 {"name":"名称","url":"https://...","description":"一句话"};'
                    + '只给该站确定存在、可直接打开的地址,不确定就留空数组,绝不要猜路径。'
                : '不要输出 children 或 alternates 字段。');
        return chatJson(system, user, parseSuggest, { task: 'suggest', temperature: 0.2, timeout: wantLinks ? 60 : 45, maxTokens: wantLinks ? 600 : 200 })
            .then(function (r) { return r.value; });
    }

    // ===== 提示词构造(与 nav/ai.py 同构) =====
    function localSites() {
        return window.navGuestLocal ? window.navGuestLocal.list() : [];
    }
    function buildSiteUser(category, sub, scene, count, existing, subOptions) {
        existing = existing || [];
        var rows = existing.slice(0, 50).map(function (s) { return '- ' + (s.name || '') + ' | ' + (s.url || ''); }).join('\n') || '(暂无)';
        var subs = (subOptions || []).filter(Boolean).map(String).join('、') || '(暂无)';
        return '导航大类:' + category + '\n'
            + '小分类:' + (sub || '(未指定)') + '\n'
            + '场景与要求:' + (scene || '(按分类补齐常用站点)') + '\n'
            + '推荐条数:' + count + '(可以少于这个数:不确定的站不要给,宁缺毋滥)\n'
            + '该分类下已有的站点(不要重复推荐,也不要推荐同一域名的不同页面):\n' + rows + '\n'
            + '该分类下已有的小分类命名(subcat 尽量对齐):' + subs + '\n\n'
            + '输出 JSON 数组,每个元素形如:\n'
            + '{"name": "站点通用名", "url": "https://真实首页地址", '
            + '"description": "中文一句话简介", "subcat": "适合的小分类名(≤10字,拿不准就留空)"}';
    }
    function buildSitePrompt(category, sub, scene, count) {
        var sites = localSites();
        var existing = sites.filter(function (s) { return s.category === category; })
            .map(function (s) { return { name: s.name, url: s.url }; });
        var subs = [];
        sites.forEach(function (s) {
            if (s.category === category && s.subcat) {
                s.subcat.split(/\s+[/>]\s+/).forEach(function (x) {
                    x = x.trim();
                    if (x && subs.indexOf(x) < 0) subs.push(x);
                });
            }
        });
        return SITE_SYSTEM_PROMPT + '\n\n---\n\n' + buildSiteUser(category, sub, scene, count, existing, subs);
    }
    function classifyCatalog() {
        var map = {};
        localSites().forEach(function (s) {
            if (s.archived || !s.category) return;
            map[s.category] = map[s.category] || [];
            String(s.subcat || '').split(/\s+[/>]\s+/).forEach(function (x) {
                x = x.trim();
                if (x && map[s.category].indexOf(x) < 0) map[s.category].push(x);
            });
        });
        return map;
    }
    function classifyTags() {
        var vocab = [], seen = {};
        (window.navGuestLocal ? window.navGuestLocal.tagVocab() : []).forEach(function (t) {
            if (!seen[t]) { seen[t] = 1; vocab.push(t); }
        });
        TAG_SEED.forEach(function (t) { if (!seen[t]) { seen[t] = 1; vocab.push(t); } });
        return vocab;
    }
    function buildClassifyUser(items, catalog, tags) {
        var cats = Object.keys(catalog || {});
        var catLine = cats.join(' / ') || '(暂无)';
        var subLines = [];
        cats.slice(0, 40).forEach(function (c) {
            var subs = (catalog[c] || []).slice(0, 8);
            if (subs.length) subLines.push('- ' + c + ':' + subs.join('、'));
        });
        var tagLine = (tags || []).join('、') || '(暂无)';
        var rows = items.map(function (it, i) {
            return (i + 1) + ' | ' + String(it.name || '').slice(0, 60) + ' | ' + String(it.url || '').slice(0, 120)
                + ' | 现分类:' + (String(it.category || '').slice(0, 30) || '(未分类)')
                + ' | 现标签:' + ((it.tags || []).join('、') || '无')
                + ' | 简介:' + (String(it.description || '').slice(0, 80) || '无');
        }).join('\n');
        return '可用的大类(优先复用):' + catLine + '\n'
            + '各大类下已有小分类(命名尽量对齐):\n' + (subLines.join('\n') || '(暂无)') + '\n'
            + '标签词表(封闭,只能从中选,禁止自造词;没有合适的就输出空数组):' + tagLine + '\n\n'
            + '待分类站点(共 ' + items.length + ' 条,序号 | 名称 | 网址 | 现分类 | 现标签 | 简介):\n' + rows
            + '\n\n输出 JSON 数组,每条站一个元素:'
            + '{"i": 序号(整数), "category": "大类", "subcat": "小分类,可为空字符串", '
            + '"tags": ["标签1", "标签2"], "reason": "一句话说明改动原因,分类和标签未变可留空"},'
            + 'tags 可以为空数组。'
            + '必须覆盖全部 ' + items.length + ' 条,不要遗漏,不要输出解释。';
    }
    function buildClassifyPrompt(items) {
        var catalog = classifyCatalog();
        return CLASSIFY_SYSTEM_PROMPT + '\n\n---\n\n' + buildClassifyUser(items, catalog, classifyTags());
    }

    // ===== 站点候选去重 / 测活 =====
    function hostKey(host) {
        host = String(host || '').toLowerCase().replace(/^\.+|\.+$/g, '');
        return host.indexOf('www.') === 0 ? host.slice(4) : host;
    }
    function sameSite(a, b) {
        a = hostKey(a); b = hostKey(b);
        return !!(a && b && (a === b || a.slice(-(b.length + 1)) === '.' + b || b.slice(-(a.length + 1)) === '.' + a));
    }
    function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }
    function filterDrafts(drafts) {
        var existingHosts = localSites().map(function (s) { return hostKey(hostOf(s.url)); }).filter(Boolean);
        var kept = [], skipped = [], batchHosts = [];
        drafts.forEach(function (d) {
            var h = hostKey(hostOf(d.url));
            var dup = existingHosts.some(function (x) { return sameSite(h, x); })
                || batchHosts.some(function (x) { return sameSite(h, x); });
            if (dup) { d.skipped_reason = '本机已有同域名站点'; skipped.push(d); return; }
            batchHosts.push(h);
            kept.push(d);
        });
        return { kept: kept, skipped: skipped };
    }
    function probeUrl(url, timeoutMs) {
        var timeout = timeoutMs || 7000;
        function attempt(method) {
            return new Promise(function (resolve, reject) {
                var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;
                fetch(url, {
                    method: method, mode: 'no-cors', redirect: 'follow', cache: 'no-store',
                    signal: ctrl ? ctrl.signal : undefined
                }).then(function () {
                    if (timer) clearTimeout(timer);
                    resolve(true);
                }).catch(function (err) {
                    if (timer) clearTimeout(timer);
                    reject(err);
                });
            });
        }
        return attempt('HEAD').catch(function () { return attempt('GET'); })
            .then(function () { return { ok: true, error: '' }; })
            .catch(function (err) {
                var msg = err && err.name === 'AbortError' ? '超时' : '连不上(域名/网络/浏览器拦截)';
                return { ok: false, error: msg };
            });
    }
    window.navGuestProbeUrl = probeUrl;

    // ===== 模型列表直连 / 最小探测(纯浏览器直连,不伪装服务端代理) =====
    function fetchModels() {
        var c = cfg();
        if (!c.baseUrl) return Promise.resolve({ ok: false, models: [], error: '还没填接口地址' });
        var headers = {};
        if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey;
        var started = Date.now();
        return fetch(c.baseUrl + '/models', { headers: headers, cache: 'no-store' })
            .then(function (r) {
                if (!r.ok) throw new AiError('模型列表返回 ' + r.status, 'http');
                return r.json();
            }).then(function (d) {
                var arr = (d && d.data) || [];
                var models = arr.map(function (m) {
                    return typeof m === 'string' ? m : String((m && m.id) || '');
                }).filter(Boolean);
                return { ok: true, models: models, error: '', elapsed_ms: Date.now() - started };
            }).catch(function (err) {
                var msg = modelsCorsMessage(err, '模型列表读取失败');
                return { ok: false, models: [], error: msg, elapsed_ms: Date.now() - started };
            });
    }
    function modelsCorsMessage(err, fallback) {
        if (err instanceof AiError) return err.message;
        if (err && err.name === 'TypeError') {
            return '连不上:浏览器直连受 CORS 限制,上游未开放跨域时列表/探测都会失败,本站不做服务端代理,也读不到跨域详情。';
        }
        return fallback + ':' + (err && err.message ? err.message : '未知错误');
    }
    function testModel(model) {
        var c = cfg();
        var started = Date.now();
        var target = String(model || '').trim() || c.model;
        if (!c.baseUrl) return Promise.resolve({ ok: false, model: target, elapsed_ms: 0, error: '还没填接口地址' });
        var headers = { 'Content-Type': 'application/json' };
        if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey;
        var body = { model: target, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 };
        return fetch(c.baseUrl + '/chat/completions', {
            method: 'POST', headers: headers, body: JSON.stringify(body)
        }).then(function (r) {
            if (r.ok) return { ok: true, model: target, elapsed_ms: Date.now() - started, error: '' };
            return r.text().then(function (txt) {
                throw new AiError('返回 ' + r.status + ':' + String(txt || '').slice(0, 120), 'http');
            });
        }).catch(function (err) {
            return { ok: false, model: target, elapsed_ms: Date.now() - started, error: modelsCorsMessage(err, '探测失败') };
        });
    }
    function testAllModels() {
        return fetchModels().then(function (list) {
            if (!list.ok) return { ok: false, models: [], error: list.error };
            var chain = list.models.reduce(function (p, m) {
                return p.then(function (out) { return testModel(m).then(function (r) { out.push(r); return out; }); });
            }, Promise.resolve([]));
            return chain.then(function (results) { return { ok: true, models: results, error: '' }; });
        });
    }

    // ===== 配置 + 对话面板 =====
    var panel = null, msgsBox = null, inputEl = null, busy = false;
    function loadHistory() {
        return storeGet(HIST_KEY, function () { return []; }).then(function (h) { return Array.isArray(h) ? h : []; });
    }
    function saveHistory(h) { return storeSet(HIST_KEY, h.slice(-HIST_MAX)); }
    function renderHistory(history) {
        if (!msgsBox) return;
        msgsBox.textContent = '';
        if (!history.length) {
            var empty = document.createElement('div');
            empty.className = 'nav-pet-msg system';
            empty.textContent = '填好接口地址 / Key / 模型后直接聊;记录与记忆只存本机。';
            msgsBox.appendChild(empty);
            return;
        }
        history.forEach(function (m) {
            var div = document.createElement('div');
            div.className = 'nav-pet-msg ' + (m.role === 'user' ? 'user' : 'pet');
            div.textContent = m.text || '';
            msgsBox.appendChild(div);
        });
        msgsBox.scrollTop = msgsBox.scrollHeight;
    }
    function modelStatusLine(msg, kind) {
        var el = document.getElementById('gaiModelStatus');
        if (!el) return;
        el.className = 'small text-' + (kind || 'muted');
        el.textContent = msg;
    }
    function renderLogs() {
        var box = document.getElementById('gaiLogBox');
        if (!box) return;
        readLogs().then(function (list) {
            box.textContent = '';
            if (!list.length) {
                var empty = document.createElement('div');
                empty.className = 'small text-muted';
                empty.textContent = '还没有调用记录。';
                box.appendChild(empty);
                return;
            }
            list.slice(-30).reverse().forEach(function (e) {
                var row = document.createElement('div');
                row.className = 'd-flex flex-column gap-0 border-bottom py-1';
                var line1 = document.createElement('div');
                line1.className = 'small d-flex gap-2 align-items-center';
                var task = document.createElement('span'); task.textContent = e.task;
                var model = document.createElement('span');
                model.className = 'text-muted'; model.textContent = e.model || '—';
                var ok = document.createElement('span');
                ok.textContent = e.ok ? '✓ 成功' : '✗ 失败';
                ok.className = e.ok ? 'text-success' : 'text-danger';
                var ms = document.createElement('span');
                ms.className = 'text-muted ms-auto';
                ms.textContent = (e.elapsed_ms / 1000).toFixed(1) + 's';
                var t = document.createElement('span');
                t.className = 'text-muted';
                try { t.textContent = new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false }); }
                catch (err) { t.textContent = ''; }
                line1.appendChild(task); line1.appendChild(model); line1.appendChild(ok);
                line1.appendChild(ms); line1.appendChild(t);
                row.appendChild(line1);
                if (!e.ok && e.error) {
                    var line2 = document.createElement('div');
                    line2.className = 'small text-danger';
                    line2.textContent = e.error;
                    row.appendChild(line2);
                }
                box.appendChild(row);
            });
        });
    }
    function syncPanelSwitches() {
        var map = [
            ['gaiSwWhisper', 'navPetWhisper', function (v) { return v !== '0'; }],
            ['gaiSwReasoning', 'navPetChatReasoning', function (v) { return v !== '0'; }],
            ['gaiSwCopy', 'navPetChatCopy', function (v) { return v === '1'; }]
        ];
        map.forEach(function (s) {
            var ck = document.getElementById(s[0]);
            if (ck) ck.checked = s[2](localStorage.getItem(s[1]));
        });
    }
    function field(ph, type, id) {
        var el = document.createElement('input');
        el.type = type || 'text';
        el.className = 'form-control form-control-sm';
        el.placeholder = ph;
        el.id = id;
        return el;
    }
    // 关闭统一走 Bootstrap(与主人端 .modal 一致);取不到实例时退回原手写显隐
    function hidePanel() {
        var m = (window.bootstrap && bootstrap.Modal) ? bootstrap.Modal.getInstance(panel) : null;
        if (m) m.hide(); else if (panel) panel.classList.remove('show');
    }
    function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
    function openPanel() {
        if (!panel) buildPanel();
        bootstrap.Modal.getOrCreateInstance(panel).show();
        loadCfg().then(function (c) {
            setVal('gaiBase', c.baseUrl);
            setVal('gaiKey', c.apiKey);
            setVal('gaiModel', c.model);
            setVal('gaiClassifyModel', c.modelClassify);
        });
        renderLogs();
    }
    function panelStatus(text, kind) {
        // 与主人同壳:不再往面板里加诊断行(会把窗撑高),详情挂到状态徽章的 title 上
        var el = document.getElementById('gaiAiStatus');
        if (!el) return;
        el.title = text || '';
        if (kind === 'danger') el.dataset.diag = text || '';
    }
    function panelBadge(text, kind) {
        var el = document.getElementById('gaiAiStatus');
        if (!el) return;
        el.className = 'badge ms-1 bg-' + (kind || 'secondary');
        el.textContent = text;
    }
    function fillModelMenu(menuId, targetId, models) {
        var menu = document.getElementById(menuId);
        if (!menu) return;
        menu.innerHTML = '';
        (models || []).forEach(function (m) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'dropdown-item small';
            item.textContent = m;
            item.addEventListener('click', function () { setVal(targetId, m); });
            menu.appendChild(item);
        });
        if (!menu.children.length) {
            var none = document.createElement('span');
            none.className = 'dropdown-item small text-muted disabled';
            none.textContent = '还没检测到模型';
            menu.appendChild(none);
        }
    }
    function detectModels(silent) {
        if (!silent) panelStatus('正在拉取模型列表…', 'muted');
        return fetchModels().then(function (res) {
            if (!res.ok) {
                panelBadge('连不上', 'danger');
                panelStatus('✗ ' + res.error, 'danger');
                return;
            }
            var models = res.models || [];
            fillModelMenu('gaiModelMenu', 'gaiModel', models);
            fillModelMenu('gaiClassifyModelMenu', 'gaiClassifyModel', models);
            panelBadge('已连上', 'success');
            panelStatus('✓ 读到 ' + models.length + ' 个模型（浏览器直连，跨域受限时不保证全量）', 'success');
        });
    }
    // 接口面板与主人端 #petAiModal 同一套骨架：状态行 → 地址/Key 两列 → 模型 + ▾ → 检测/测试 → 高级 → 保存 → 调用日志
    function buildPanel() {
        panel = document.createElement('div');
        panel.id = 'navGuestAiPanel';
        panel.className = 'modal fade';
        panel.tabIndex = -1;
        panel.setAttribute('data-no-resize', '1');
        panel.innerHTML =
            '<div class="modal-dialog"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title"><i class="fas fa-robot me-2"></i>AI 接口 ' +
            '<small class="text-muted fw-normal fs-6">仅本机：Key 不出浏览器</small></h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="small mb-2">填一份 OpenAI 兼容接口（DeepSeek 只是最常见的例子）。「AI 找网站」和桌宠的聊天、AI 碎碎念、查余额都用这一份。不接也完全不影响——找网站有手动模式，桌宠本地碎碎念、动画、互动一切照旧。</div>' +
            '<div class="mb-2"><span class="small fw-bold">接口状态</span> <span id="gaiAiStatus" class="badge bg-secondary ms-1">未检测</span>' +
            '<button class="btn btn-sm btn-link p-0 text-decoration-none ms-2" id="gaiBalanceBtn" type="button">💰 查余额</button>' +
            '</div>' +
            '<div class="d-flex gap-2 flex-wrap nav-ai-config-row">' +
            '<div class="nav-ai-field nav-ai-field-base"><label class="small text-muted mb-1" for="gaiBase">接口地址（Base URL）</label>' +
            '<input id="gaiBase" class="form-control form-control-sm" placeholder="https://api.deepseek.com" aria-label="AI 接口地址"></div>' +
            '<div class="nav-ai-field nav-ai-field-key"><label class="small text-muted mb-1" for="gaiKey">API Key</label>' +
            '<input id="gaiKey" type="password" class="form-control form-control-sm" placeholder="只存本机" autocomplete="off" aria-label="AI API Key"></div></div>' +
            '<div class="mt-2"><label class="small text-muted mb-1" for="gaiModel">模型</label>' +
            '<div class="input-group input-group-sm" style="position:relative">' +
            '<input id="gaiModel" class="form-control form-control-sm" placeholder="如 deepseek-chat，或点 ▾ 从检测结果里选" aria-label="AI 模型名">' +
            '<button class="btn btn-outline-secondary" type="button" id="gaiModelBtn" data-bs-toggle="dropdown" aria-expanded="false" title="从检测到的模型里选">▾</button>' +
            '<div class="dropdown-menu" id="gaiModelMenu" style="top:100%;right:0;left:auto;min-width:100%;width:max-content;max-width:min(520px,92vw);max-height:260px;overflow:auto"></div></div></div>' +
            '<div class="d-flex align-items-center gap-2 mt-2 flex-wrap">' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="gaiModelsBtn">检测模型</button>' +
            '<span id="gaiTestBadge" class="badge bg-secondary d-none">可用 0/0</span>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="gaiTestAllBtn" title="逐个真发一次最小请求，标出哪些模型能用">测试全部</button>' +
            '<span id="gaiModelsHint" class="small text-muted">填好接口地址后自动检测（本机网关如 Magpie：http://127.0.0.1:3425/v1）</span></div>' +
            '<details class="nav-ai-adv mt-2"><summary class="small text-muted">高级：按任务分配模型（可选，空 = 跟随默认模型）</summary>' +
            '<div class="d-flex gap-2 flex-wrap mt-2"><div class="nav-ai-field">' +
            '<label class="small text-muted mb-1" for="gaiClassifyModel">分类模型</label>' +
            '<div class="input-group input-group-sm" style="position:relative">' +
            '<input id="gaiClassifyModel" class="form-control form-control-sm" placeholder="默认（跟随主模型）" autocomplete="off">' +
            '<button class="btn btn-outline-secondary" type="button" id="gaiClassifyModelBtn" data-bs-toggle="dropdown" aria-expanded="false" title="从检测到的模型里选">▾</button>' +
            '<div class="dropdown-menu" id="gaiClassifyModelMenu" style="top:100%;right:0;left:auto;min-width:100%;width:max-content;max-width:min(520px,92vw);max-height:260px;overflow:auto"></div></div></div></div>' +
            '<div class="small text-muted mt-1">找网站固定用上面的默认模型；这里只覆盖分类，建议选低温、稳定的模型。桌宠模型在「宠物设置 → 💬 聊天」里改。</div></details>' +
            '<div class="small text-muted mt-3">「AI 找网站」弹窗里的接口设置是同一份，两边改都生效；桌宠人设、记忆轮数、桌宠模型、碎碎念开关在「宠物设置 → 💬 聊天」里改。</div>' +
            '<div class="d-flex align-items-center justify-content-between gap-2 mt-2">' +
            '<button class="btn btn-sm btn-link text-danger p-0 text-decoration-none" id="gaiClearChatBtn" type="button" title="清空桌宠的对话记忆">清除记忆（不可恢复）</button>' +
            '<div class="d-flex gap-2"><button class="btn btn-sm btn-outline-secondary" id="gaiTestCurrentBtn" type="button">测当前模型</button>' +
            '<button class="btn btn-sm btn-success px-4" id="gaiSaveBtn">保存</button></div></div>' +
            '<div class="small mt-1" id="gaiSaveHint" aria-live="polite"></div>' +
            '<details class="nav-ai-adv mt-2"><summary class="small text-muted">最近 AI 调用（排查用，只留摘要）</summary>' +
            '<div class="d-flex align-items-center gap-2 mt-2">' +
            '<button class="btn btn-sm btn-outline-secondary" id="gaiLogBtn" type="button">刷新记录</button>' +
            '<button class="btn btn-sm btn-outline-danger" id="gaiLogClearBtn" type="button">清空日志</button>' +
            '<span class="small text-muted">接口挂了 / 模型拒答 / 解析失败，这里能看出是哪一步</span></div>' +
            '<div id="gaiLogBox" class="nav-ai-log-list mt-2"></div></details>' +
            '</div></div></div>';
        document.body.appendChild(panel);
        var hint = document.getElementById('gaiSaveHint');
        function say(text, cls) { if (hint) { hint.className = 'small mt-1 text-' + (cls || 'muted'); hint.textContent = text || ''; } }
        document.getElementById('gaiSaveBtn').addEventListener('click', function () {
            var cur = cfg();
            saveCfg({
                baseUrl: document.getElementById('gaiBase').value,
                apiKey: document.getElementById('gaiKey').value,
                model: document.getElementById('gaiModel').value,
                modelClassify: document.getElementById('gaiClassifyModel').value,
                modelPet: cur.modelPet, memoryRounds: cur.memoryRounds, persona: cur.persona
            }).then(function (ok) {
                say(ok ? '✓ 已保存本机配置' : '✗ 本机存储失败，配置没有保存', ok ? 'success' : 'danger');
                if (ok) panelBadge('已保存', 'success');
            });
        });
        document.getElementById('gaiModelsBtn').addEventListener('click', function () { detectModels(); });
        document.getElementById('gaiTestAllBtn').addEventListener('click', function () {
            panelStatus('正在逐个测试模型…', 'muted');
            var tb = document.getElementById('gaiTestBadge');
            testAllModels().then(function (res) {
                if (!res.ok) { panelStatus('✗ ' + res.error, 'danger'); return; }
                var oks = res.models.filter(function (r) { return r.ok; });
                var fails = res.models.filter(function (r) { return !r.ok; });
                if (tb) { tb.classList.remove('d-none'); tb.textContent = '可用 ' + oks.length + '/' + res.models.length; }
                var line = '✓ ' + oks.length + ' 个可用' + (fails.length ? '；✗ ' + fails.length + ' 个失败：' + fails.map(function (r) { return r.model + '(' + r.error + ')'; }).join(';').slice(0, 180) : '');
                panelStatus(line, fails.length ? 'warning' : 'success');
            });
        });
        document.getElementById('gaiTestCurrentBtn').addEventListener('click', function () {
            var model = document.getElementById('gaiModel').value || cfg().model;
            panelStatus('正在测试当前模型…', 'muted');
            testModel(model).then(function (r) {
                panelStatus((r.ok ? '✓ ' : '✗ ') + r.model + ' · ' + (r.elapsed_ms / 1000).toFixed(1) + 's' + (r.ok ? '' : ' · ' + r.error), r.ok ? 'success' : 'danger');
            });
        });
        document.getElementById('gaiBalanceBtn').addEventListener('click', function () {
            toast('查询余额中…');
            balance().then(function (r) {
                toast(r.status === 'ok'
                    ? ('💰 余额 ' + (r.total_balance || '—') + ' ' + (r.currency || '') + (r.is_available ? '' : '（账号不可用）'))
                    : ('✗ ' + (r.message || '查询失败')));
                renderLogs();
            });
        });
        document.getElementById('gaiClearChatBtn').addEventListener('click', function () {
            function doClear() {
                saveHistory([]).then(function () { say('✓ 本机对话记忆已清空', 'success'); toast('本机对话记忆已清空'); });
            }
            if (window.navConfirm) {
                window.navConfirm({ title: '清空对话记忆', body: '只清这台浏览器里的对话记录，不动书签与配置。', danger: true, confirmLabel: '清空' })
                    .then(function (ok) { if (ok) doClear(); });
            } else { doClear(); }
        });
        document.getElementById('gaiLogBtn').addEventListener('click', renderLogs);
        document.getElementById('gaiLogClearBtn').addEventListener('click', function () {
            function doClear() { clearLogsStore().then(function () { renderLogs(); toast('调用日志已清空'); }); }
            if (window.navConfirm) {
                window.navConfirm({ title: '清空调用日志', body: '只清这台浏览器里的 AI 调用记录，不动配置与书签。', danger: true, confirmLabel: '清空' })
                    .then(function (ok) { if (ok) doClear(); });
            } else { doClear(); }
        });
        panel.addEventListener('shown.bs.modal', function () {
            if (configured()) detectModels(true);
            else panelBadge('未配置', 'secondary');
        });
    }
    window.openGuestLocalAiPanel = openPanel;

    // ===== 对话 / 碎碎念 / 余额 / 快捷问答 =====
    function petTimeContext() {
        var now = new Date();
        var hour = now.getHours();
        var period = hour < 5 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午'
            : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜';
        var week = '星期' + '日一二三四五六'.charAt(now.getDay());
        return '现在是' + now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + week + ' ' + period + '。';
    }
    function petSystem() {
        var c = cfg();
        return (String(c.persona || '').trim() || PET_DEFAULT_PERSONA)
            + '\n你的名字是"小鲸鱼"。\n' + petTimeContext();
    }
    function chat(text, history) {
        text = String(text || '').trim().slice(0, 4000);
        if (!text) return Promise.resolve({ status: 'error', message: '想跟我说点什么?' });
        var c = cfg();
        var messages = [{ role: 'system', content: petSystem() }];
        (history || []).slice(-40).forEach(function (m) {
            if (!m || m.role === 'system') return;
            var role = m.role === 'user' ? 'user' : 'assistant';
            var body = m.text != null ? m.text : m.content;
            if (body) messages.push({ role: role, content: String(body).slice(0, 2000) });
        });
        messages.push({ role: 'user', content: text });
        if (!c.memoryRounds) messages = [messages[0], messages[messages.length - 1]];
        return fetchChat(messages, { task: 'chat', modelTask: 'pet', temperature: 1.0, timeout: 60, maxTokens: 800 })
            .then(function (m) { return { status: 'ok', reply: m.content.slice(0, 2000), model: m.model, elapsed_ms: m.elapsed_ms, source: 'local' }; })
            .catch(function (err) {
                return { status: 'error', configured: err.kind !== 'config', message: err.message || '对话失败' };
            });
    }
    function whisper() {
        var messages = [
            { role: 'system', content: petSystem() },
            { role: 'user', content: '随便说一句日常碎碎念,一句就好,20字以内。' }
        ];
        return fetchChat(messages, { task: 'whisper', modelTask: 'pet', temperature: 1.0, timeout: 30, maxTokens: 120 })
            .then(function (m) { return { status: 'ok', text: m.content.slice(0, 100) }; })
            .catch(function (err) { return { status: 'error', message: err.message || '碎碎念失败' }; });
    }
    function balance() {
        var c = cfg();
        var started = Date.now();
        if (!c.baseUrl) {
            appendLog({ task: 'balance', model: '', ok: false, elapsed_ms: 0, error: '还没填接口地址' });
            return Promise.resolve({ status: 'error', message: '还没填接口地址' });
        }
        if (!c.apiKey) {
            appendLog({ task: 'balance', model: '', ok: false, elapsed_ms: 0, error: '余额查询需要 API Key' });
            return Promise.resolve({ status: 'error', message: '余额查询需要 API Key' });
        }
        return fetch(c.baseUrl + '/user/balance', { headers: { Authorization: 'Bearer ' + c.apiKey } })
            .then(function (r) {
                if (r.status !== 200) throw new AiError('余额查询返回 ' + r.status + '(仅 DeepSeek 官方支持 /user/balance)');
                return r.json();
            }).then(function (d) {
                var infos = d.balance_infos || [];
                var cny = infos.filter(function (x) { return x.currency === 'CNY'; })[0] || infos[0] || {};
                appendLog({ task: 'balance', model: '', ok: true, elapsed_ms: Date.now() - started, error: '' });
                return { status: 'ok', is_available: !!d.is_available, total_balance: cny.total_balance || '',
                         currency: cny.currency || 'CNY', raw: infos };
            }).catch(function (err) {
                var msg = err && err.message ? err.message : '余额查询失败(可能被跨域拦住)';
                appendLog({ task: 'balance', model: '', ok: false, elapsed_ms: Date.now() - started, error: msg });
                return { status: 'error', message: msg };
            });
    }
    function quickLocal(action, query) {
        var sites = localSites().filter(function (s) { return !s.archived; });
        if (action === 'random') {
            if (!sites.length) return Promise.resolve({ status: 'error', message: '本机书签还是空的,先导入几个吧' });
            var pick = sites[Math.floor(Math.random() * sites.length)];
            return Promise.resolve({ status: 'ok', reply: '给你翻到一个:' + pick.name + '(' + pick.category
                + (pick.subcat ? ' / ' + pick.subcat : '') + ')' + (pick.description ? '\n' + pick.description : ''),
                links: [{ name: pick.name, url: pick.url }] });
        }
        if (action === 'stats') {
            var cats = {};
            sites.forEach(function (s) { cats[s.category] = (cats[s.category] || 0) + 1; });
            var top = sites.slice().sort(function (a, b) { return (b.clicks || 0) - (a.clicks || 0); }).slice(0, 3);
            var reply = '本机收了 ' + sites.length + ' 个书签,共 ' + Object.keys(cats).length + ' 个大类。';
            if (top.length && top[0].clicks) reply += '\n点得最多的是:' + top.filter(function (s) { return s.clicks; }).map(function (s) { return s.name; }).join('、') + '。';
            return Promise.resolve({ status: 'ok', reply: reply, links: top.map(function (s) { return { name: s.name, url: s.url }; }) });
        }
        if (action === 'search') {
            var q = String(query || '').trim().toLowerCase().slice(0, 50);
            if (!q) return Promise.resolve({ status: 'error', message: '要搜什么?给我个关键词' });
            var hits = sites.filter(function (s) {
                return [s.name, s.url, s.description, s.category, s.subcat, (s.tags || []).join(' ')]
                    .join(' ').toLowerCase().indexOf(q) !== -1;
            }).sort(function (a, b) { return (b.clicks || 0) - (a.clicks || 0); }).slice(0, 6);
            if (!hits.length) return Promise.resolve({ status: 'ok', reply: '没找到和「' + q + '」相关的书签,换个词试试?', links: [] });
            return Promise.resolve({ status: 'ok', reply: '找到 ' + hits.length + ' 个和「' + q + '」相关的书签:',
                                     links: hits.map(function (s) { return { name: s.name, url: s.url }; }) });
        }
        return Promise.resolve({ status: 'error', message: '不认识的快捷操作' });
    }
    function quick(action, query) {
        var started = Date.now();
        return quickLocal(action, query).then(function (res) {
            appendLog({ task: 'quick', model: cfg().model, ok: !!(res && res.status === 'ok'),
                elapsed_ms: Date.now() - started,
                error: res && res.status === 'ok' ? '' : (res && res.message ? res.message : '') });
            return res;
        });
    }
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text || '');
        var ta = document.createElement('textarea');
        ta.value = text || '';
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
    }

    // ===== AI 找网站 / AI 分类：两个独立 modal，与主人端 #navAiModal / #navAiClassifyModal 同壳 =====
    var findModal = null, classModal = null;
    function ensureFindModal() {
        if (findModal) return findModal;
        findModal = document.createElement('div');
        findModal.className = 'modal fade';
        findModal.id = 'navGuestAiModal';
        findModal.tabIndex = -1;
        findModal.setAttribute('data-no-resize', '1');
        findModal.innerHTML =
            '<div class="modal-dialog modal-lg nav-ai-dialog"><div class="modal-content nav-ai-content">' +
            '<div class="modal-header"><h5 class="modal-title"><i class="fas fa-wand-magic-sparkles me-2"></i>AI 找网站 ' +
            '<small class="text-muted fw-normal fs-6">生成候选 → 检测能否连上 → 去重导入本机</small></h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body nav-ai-body">' +
            '<div class="nav-ai-form">' +
            '<div class="row g-2 mb-2">' +
            '<div class="col-md-5"><label class="small text-muted mb-0" for="gaiCat">大类</label><select id="gaiCat" class="form-select form-select-sm"></select></div>' +
            '<div class="col-md-4"><label class="small text-muted mb-0" for="gaiSub">小分类(可选)</label><select id="gaiSub" class="form-select form-select-sm"><option value="">(不指定，大类直属)</option></select></div>' +
            '<div class="col-md-3"><label class="small text-muted mb-0" for="gaiCount">条数</label><input id="gaiCount" type="number" min="1" max="15" value="8" class="form-control form-control-sm"></div>' +
            '</div>' +
            '<label class="small text-muted mb-1" for="gaiScene">补充要求（类似网站 / 额外限制，可不填）</label>' +
            '<textarea id="gaiScene" class="form-control mb-2" rows="2" placeholder="例如：只要免费额度的大模型站、要有中文界面、能本地部署的软件" aria-label="补充要求"></textarea>' +
            '<div class="d-flex align-items-center gap-2 flex-wrap mb-2">' +
            '<button class="btn btn-primary nav-modal-primary" id="gaiGenerate"><i class="fas fa-wand-magic-sparkles me-1"></i>生成候选网站</button>' +
            '<label class="form-check small mb-0 ms-auto"><input class="form-check-input" type="checkbox" id="gaiCheckAlive" checked> 导入前检测能否连上</label></div>' +
            '<div class="border rounded p-2 mt-2">' +
            '<div class="d-flex justify-content-between align-items-center">' +
            '<span class="small fw-bold">无 API 手动模式 <span class="text-muted fw-normal">— 没配接口也能用：提示词复制到任意 AI，回复粘贴回来</span></span>' +
            '<button class="btn btn-sm btn-link p-0 text-decoration-none" data-bs-toggle="collapse" data-bs-target="#gaiManual">展开/收起</button></div>' +
            '<div id="gaiManual" class="collapse mt-2">' +
            '<div class="d-flex gap-2">' +
            '<button class="btn btn-sm btn-outline-primary flex-grow-1" id="gaiPrompt"><i class="fas fa-copy me-1"></i>第 1 步：生成提示词并复制</button>' +
            '<button class="btn btn-sm btn-outline-secondary" id="gaiCopyPrompt" type="button">复制</button></div>' +
            '<textarea id="gaiPromptText" class="form-control form-control-sm mt-2" rows="7" readonly placeholder="点上面按钮生成提示词(自动复制)，粘贴到任意 AI 对话框发送" aria-label="生成的提示词"></textarea>' +
            '<textarea id="gaiPaste" class="form-control form-control-sm mt-2" rows="8" placeholder="第 2 步：把 AI 的完整回复粘贴到这里(带 ```json 围栏或前后说明文字都能解析)" aria-label="粘贴 AI 回复"></textarea>' +
            '<button class="btn btn-sm btn-success nav-modal-primary mt-2" id="gaiParse">第 3 步：解析并预览（预览后照常检测并导入）</button>' +
            '</div></div></div>' +
            '<div id="gaiPreview" class="nav-ai-preview"></div>' +
            '<div id="gaiStatus" class="small mt-2"></div>' +
            '</div>' +
            '<div class="modal-footer nav-ai-footer">' +
            '<span class="small text-muted me-auto" id="gaiFootHint">生成候选后在这里检测能否连上并导入</span>' +
            '<button type="button" class="btn btn-sm btn-success nav-modal-primary" id="gaiImport" disabled>检测并导入所选</button></div>' +
            '</div></div>';
        document.body.appendChild(findModal);
        document.getElementById('gaiGenerate').addEventListener('click', runFind);
        document.getElementById('gaiPrompt').addEventListener('click', function () {
            var p = buildSitePrompt(readFindCat(), readFindSub(), valueOf('gaiScene'), readFindCount());
            document.getElementById('gaiPromptText').value = p;
            copyText(p).then(function () { setStatus('find', '✓ 提示词已复制，去任意 AI 粘贴发送', 'success'); })
                .catch(function () { setStatus('find', '提示词已生成，自动复制失败，请点「复制」', 'warning'); });
        });
        document.getElementById('gaiCopyPrompt').addEventListener('click', function () {
            copyText(document.getElementById('gaiPromptText').value)
                .then(function () { setStatus('find', '✓ 已复制', 'success'); });
        });
        document.getElementById('gaiParse').addEventListener('click', function () {
            var text = valueOf('gaiPaste');
            if (!text.trim()) { setStatus('find', '先粘贴 AI 的回复', 'danger'); return; }
            try {
                var drafts = parseSiteDrafts(text, readFindCount());
                var filtered = filterDrafts(drafts);
                findDrafts = filtered.kept;
                findMeta = { channel: 'manual' };
                renderDrafts(filtered.kept, filtered.skipped);
                setStatus('find', '✓ 解析到 ' + drafts.length + ' 条，可改字段后导入', 'success');
            } catch (e) { setStatus('find', e.message || '解析失败', 'danger'); }
        });
        document.getElementById('gaiImport').addEventListener('click', importDrafts);
        return findModal;
    }
    function ensureClassModal() {
        if (classModal) return classModal;
        classModal = document.createElement('div');
        classModal.className = 'modal fade';
        classModal.id = 'navGuestAiClassifyModal';
        classModal.tabIndex = -1;
        classModal.setAttribute('data-no-resize', '1');
        classModal.innerHTML =
            '<div class="modal-dialog modal-lg modal-dialog-scrollable nav-ai-classify-dialog"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title"><i class="fas fa-tags me-2"></i>AI 分类 + 标签 ' +
            '<small class="text-muted fw-normal fs-6">只列建议调整的条目，逐条决定是否采纳</small></h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="row g-2 mb-2 align-items-end">' +
            '<div class="col-md-4"><label class="small text-muted mb-0" for="gacScope">范围</label>' +
            '<select id="gacScope" class="form-select form-select-sm"><option value="all">全部书签</option><option value="uncategorized">未分类(含「自定义」)</option><option value="category">指定大类…</option></select></div>' +
            '<div class="col-md-3 d-none" id="gacCatWrap"><label class="small text-muted mb-0" for="gacCat">大类</label><select id="gacCat" class="form-select form-select-sm"></select></div>' +
            '<div class="col-6 col-md-2"><label class="small text-muted mb-0" for="gacLimit">条数</label><input id="gacLimit" type="number" min="1" max="200" value="60" class="form-control form-control-sm"></div>' +
            '<div class="col-6 col-md-3"><button type="button" class="btn btn-sm btn-primary w-100" id="gacRun"><i class="fas fa-wand-magic-sparkles me-1"></i>开始分类</button></div>' +
            '</div>' +
            '<div class="small text-muted mb-2">条数是一次处理总量；超过 40 条会自动分批（每批 40 条），不会截断。</div>' +
            '<div class="border rounded p-2 mt-2">' +
            '<div class="d-flex justify-content-between align-items-center">' +
            '<span class="small fw-bold">没配 AI 接口? <span class="text-muted fw-normal">复制提示词去任意 AI 跑，回复整段粘回来</span></span>' +
            '<button type="button" class="btn btn-sm btn-link p-0 text-decoration-none" data-bs-toggle="collapse" data-bs-target="#gacManual">展开/收起</button></div>' +
            '<div id="gacManual" class="collapse mt-2">' +
            '<button type="button" class="btn btn-sm btn-outline-primary w-100" id="gacPrompt"><i class="fas fa-copy me-1"></i>第 1 步：生成提示词并复制</button>' +
            '<textarea id="gacPromptText" class="form-control form-control-sm mt-2" rows="6" readonly placeholder="点上面按钮生成提示词(会自动复制)，粘到任意 AI 对话框发送" aria-label="生成的提示词"></textarea>' +
            '<textarea id="gacPaste" class="form-control form-control-sm mt-2" rows="6" placeholder="第 2 步：把 AI 的完整回复粘到这里(带 ```json 围栏或前后说明都能解析)" aria-label="粘贴 AI 回复"></textarea>' +
            '<button type="button" class="btn btn-sm btn-success nav-modal-primary mt-2" id="gacParse">第 3 步：解析并对比</button>' +
            '</div></div>' +
            '<div id="gacStatus" class="small mt-3"></div>' +
            '<div id="gacResult"></div>' +
            '</div></div></div>';
        document.body.appendChild(classModal);
        document.getElementById('gacScope').addEventListener('change', function () {
            document.getElementById('gacCatWrap').classList.toggle('d-none', this.value !== 'category');
        });
        document.getElementById('gacRun').addEventListener('click', runClassify);
        document.getElementById('gacPrompt').addEventListener('click', function () {
            collectClassifyItems().then(function (items) {
                if (!items.length) { setStatus('classify', '没有符合条件的书签', 'warning'); return; }
                var p = buildClassifyPrompt(items);
                document.getElementById('gacPromptText').value = p;
                copyText(p).then(function () { setStatus('classify', '✓ 提示词已复制(' + items.length + ' 条)', 'success'); })
                    .catch(function () { setStatus('classify', '提示词已生成，自动复制失败', 'warning'); });
            });
        });
        document.getElementById('gacParse').addEventListener('click', function () {
            var text = valueOf('gacPaste');
            if (!text.trim()) { setStatus('classify', '先粘贴 AI 的回复', 'danger'); return; }
            collectClassifyItems().then(function (items) {
                try {
                    var parsed = parseClassify(text, items.length);
                    classifyItems = items;
                    applyClassifyRows(parsed, true);
                    setStatus('classify', '✓ 解析到 ' + parsed.length + ' 条建议', 'success');
                } catch (e) { setStatus('classify', e.message || '解析失败', 'danger'); }
            });
        });
        document.getElementById('gacResult').addEventListener('change', function (ev) {
            var sw = ev.target.closest('.gac-adopt');
            if (!sw) return;
            var i = Number(sw.closest('tr').getAttribute('data-i'));
            classifyAdopt[i] = sw.checked;
            sw.closest('tr').classList.toggle('text-muted', !sw.checked);
            paintApply();
        });
        return classModal;
    }
    function syncCats() {
        var cats = window.navGuestLocal ? window.navGuestLocal.categories() : [];
        ['gaiCat', 'gacCat'].forEach(function (id) {
            var sel = document.getElementById(id);
            if (!sel) return;
            var old = sel.value;
            sel.innerHTML = '';
            (cats.length ? cats : ['我的导入']).forEach(function (c) {
                var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
            });
            if (old && cats.indexOf(old) !== -1) sel.value = old;
        });
        var catSel = document.getElementById('gaiCat');
        if (catSel && !catSel.dataset.boundSub) {
            catSel.dataset.boundSub = '1';
            catSel.addEventListener('change', function () { syncCats(); });
        }
        var subSel = document.getElementById('gaiSub');
        if (subSel) {
            var cat = (document.getElementById('gaiCat') || {}).value;
            var oldSub = subSel.value;
            var subs = [];
            if (window.navGuestLocal && typeof window.navGuestLocal.subs === 'function') {
                try { subs = (window.navGuestLocal.subs() || {})[cat] || []; } catch (e) { subs = []; }
            }
            subSel.innerHTML = '<option value="">(不指定，大类直属)</option>';
            subs.forEach(function (t) {
                var o = document.createElement('option'); o.value = t; o.textContent = t; subSel.appendChild(o);
            });
            if (oldSub && subs.indexOf(oldSub) !== -1) subSel.value = oldSub;
        }
    }
    function valueOf(id) { var el = document.getElementById(id); return el ? String(el.value || '') : ''; }
    function setStatus(where, msg, kind) {
        var el = document.getElementById(where === 'find' ? 'gaiStatus' : 'gacStatus');
        if (!el) return;
        el.className = 'small mb-2 text-' + (kind || 'muted');
        el.textContent = msg || '';
    }
    function readFindCat() { return valueOf('gaiCat') || (window.navGuestLocal && window.navGuestLocal.categories()[0]) || '我的导入'; }
    function readFindSub() { return valueOf('gaiSub'); }
    function readFindCount() { return Math.max(1, Math.min(15, parseInt(valueOf('gaiCount'), 10) || 8)); }
    function openFind() {
        ensureFindModal();
        syncCats();
        bootstrap.Modal.getOrCreateInstance(findModal).show();
    }
    function openClassify() {
        ensureClassModal();
        syncCats();
        bootstrap.Modal.getOrCreateInstance(classModal).show();
    }
    function runFind() {
        var cat = readFindCat(), sub = readFindSub(), scene = valueOf('gaiScene'), count = readFindCount();
        if (!cat) { setStatus('find', '先选一个大类', 'danger'); return; }
        var btn = document.getElementById('gaiGenerate');
        btn.disabled = true;
        setStatus('find', 'AI 正在挑选网站,约 10~60 秒…');
        document.getElementById('gaiPreview').innerHTML = '<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div> 生成中…</div>';
        var meta = {};
        buildSitePrompt(cat, sub, scene, count);
        var sites = localSites();
        var existing = sites.filter(function (s) { return s.category === cat; }).map(function (s) { return { name: s.name, url: s.url }; });
        var subs = [];
        sites.forEach(function (s) {
            if (s.category === cat && s.subcat) s.subcat.split(/\s+[/>]\s+/).forEach(function (x) { x = x.trim(); if (x && subs.indexOf(x) < 0) subs.push(x); });
        });
        chatJson(SITE_SYSTEM_PROMPT, buildSiteUser(cat, sub, scene, count, existing, subs),
                 function (t) { return parseSiteDrafts(t, count); }, { task: 'find', temperature: 0.5, timeout: 120, count: count })
            .then(function (res) {
                btn.disabled = false;
                var filtered = filterDrafts(res.value);
                findDrafts = filtered.kept;
                findMeta = { channel: 'api', cat: cat, sub: sub, model: res.meta.model, elapsed_ms: res.meta.elapsed_ms, repaired: res.meta.repaired };
                renderDrafts(filtered.kept, filtered.skipped, res.meta);
            }).catch(function (err) {
                btn.disabled = false;
                document.getElementById('gaiPreview').innerHTML = '<div class="alert alert-danger mb-0 py-2 small"></div>';
                document.querySelector('#gaiPreview .alert').textContent = err.message || '生成失败';
                setStatus('find', err.message || '生成失败', 'danger');
            });
    }
    function renderDrafts(drafts, skipped, meta) {
        var box = document.getElementById('gaiPreview');
        var html = '';
        if (meta && (meta.model || meta.elapsed_ms != null)) {
            html += '<div class="small text-muted mb-2">本次:' + esc(meta.model || '') + (meta.elapsed_ms != null ? ' · ' + (meta.elapsed_ms / 1000).toFixed(1) + 's' : '') + (meta.repaired ? ' · 格式已修复' : '') + '</div>';
        }
        if (skipped && skipped.length) {
            html += '<div class="alert alert-secondary py-1 px-2 small mb-2">已剔除 ' + skipped.length + ' 条本机已有同域名候选:' + esc(skipped.map(function (s) { return s.name; }).join('、')) + '</div>';
        }
        var foot = document.getElementById('gaiFootHint');
        if (foot) foot.textContent = drafts.length ? '勾选要导入的候选，点右侧「检测并导入所选」' : '生成候选后在这里检测能否连上并导入';
        if (!drafts.length) {
            html += '<div class="alert alert-warning mb-0 py-2 small">没有可导入的候选(可能全部与本机重复),可调整要求后重试。</div>';
        }
        drafts.forEach(function (d, i) {
            html += '<div class="border rounded p-2 mb-2" data-gai-draft="' + i + '">'
                + '<div class="d-flex align-items-center gap-2 mb-1"><input class="form-check-input gai-check m-0" type="checkbox" checked id="gai-ck-' + i + '">'
                + '<input class="form-control form-control-sm fw-bold gai-name" value="' + esc(d.name) + '" aria-label="网站名称"></div>'
                + '<div class="row g-1"><div class="col-8"><input class="form-control form-control-sm gai-url font-monospace" value="' + esc(d.url) + '" aria-label="网址"></div>'
                + '<div class="col-4"><input class="form-control form-control-sm gai-sub" value="' + esc(d.subcat || '') + '" placeholder="小分类" aria-label="小分类"></div></div>'
                + '<textarea class="form-control form-control-sm mt-1 gai-desc" rows="2" placeholder="一句话简介">' + esc(d.description) + '</textarea></div>';
        });
        box.innerHTML = html;
        document.getElementById('gaiImport').disabled = !drafts.length;
        document.getElementById('gaiImport').textContent = drafts.length ? ('导入所选(' + drafts.length + ')') : '导入所选';
        setStatus('find', drafts.length ? ('已生成 ' + drafts.length + ' 个候选,可改字段后导入') : '没有候选', drafts.length ? 'success' : 'warning');
    }
    function importDrafts() {
        var picked = [];
        document.querySelectorAll('#gaiPreview [data-gai-draft]').forEach(function (box) {
            if (!box.querySelector('.gai-check').checked) return;
            picked.push({
                name: box.querySelector('.gai-name').value,
                url: box.querySelector('.gai-url').value,
                subcat: box.querySelector('.gai-sub').value,
                description: box.querySelector('.gai-desc').value
            });
        });
        if (!picked.length) { toast('没有勾选任何候选'); return; }
        var category = (findMeta && findMeta.cat) || readFindCat();
        var defaultSub = (findMeta && findMeta.sub) || readFindSub();
        var checkAlive = document.getElementById('gaiCheckAlive').checked;
        var btn = document.getElementById('gaiImport');
        btn.disabled = true;
        setStatus('find', '正在' + (checkAlive ? '检测并' : '') + '写入本机书签…');
        var results = [];
        var chain = checkAlive
            ? picked.reduce(function (p, item) {
                return p.then(function () {
                    return probeUrl(item.url).then(function (r) { results.push({ item: item, ok: r.ok, error: r.error }); });
                });
            }, Promise.resolve())
            : Promise.resolve(picked.forEach(function (item) { results.push({ item: item, ok: true, error: '' }); }));
        chain.then(function () {
            var alive = results.filter(function (r) { return r.ok; }).map(function (r) {
                var it = r.item;
                it.category = category;
                it.subcat = it.subcat || defaultSub;
                return it;
            });
            var dead = results.filter(function (r) { return !r.ok; });
            if (!alive.length) {
                btn.disabled = false;
                setStatus('find', '全部 ' + dead.length + ' 条都连不上,没有写入。可取消「导入前检测」再试。', 'warning');
                return null;
            }
            return window.navGuestLocal.addSites(alive).then(function (res) {
                btn.disabled = false;
                var msg = '已写入本机 ' + res.added.length + ' 条';
                if (dead.length) msg += ';' + dead.length + ' 条连不上未写入';
                if (res.skipped.length) msg += ';' + res.skipped.length + ' 条重复跳过';
                toast(msg);
                setStatus('find', msg, res.added.length ? 'success' : 'warning');
                findDrafts = [];
                document.getElementById('gaiPreview').innerHTML = '<div class="alert alert-success py-2 small mb-0">' + esc(msg) + '</div>';
                document.getElementById('gaiImport').disabled = true;
                if (window.navPetState) { window.navPetState('happy'); }
                return null;
            });
        }).catch(function (err) {
            btn.disabled = false;
            setStatus('find', err.message || '导入失败', 'danger');
        });
    }

    // ===== 分类 =====
    function collectClassifyItems() {
        var scope = valueOf('gacScope');
        var cat = valueOf('gacCat');
        var limit = Math.max(1, Math.min(CLASSIFY_MAX, parseInt(valueOf('gacLimit'), 10) || 60));
        var sites = localSites().filter(function (s) { return !s.archived; });
        if (scope === 'uncategorized') {
            sites = sites.filter(function (s) { return !s.category || s.category === '未分类' || s.category === '自定义'; });
        } else if (scope === 'category' && cat) {
            sites = sites.filter(function (s) { return s.category === cat; });
        }
        return Promise.resolve(sites.slice(0, limit).map(function (s) {
            return { name: s.name, url: s.url, category: s.category, subcat: s.subcat,
                     tags: s.tags || [], description: s.description };
        }));
    }
    function runClassify() {
        var btn = document.getElementById('gacRun');
        btn.disabled = true;
        setStatus('classify', '正在取本机书签…');
        document.getElementById('gacResult').innerHTML = '';
        collectClassifyItems().then(function (items) {
            if (!items.length) { btn.disabled = false; setStatus('classify', '没有符合条件的书签', 'warning'); return; }
            classifyItems = items;
            classifyRows = []; classifyAdopt = [];
            var chunks = [];
            for (var i = 0; i < items.length; i += CLASSIFY_BATCH) chunks.push(items.slice(i, i + CLASSIFY_BATCH));
            var acc = [], done = 0;
            function step(k) {
                if (k >= chunks.length) {
                    btn.disabled = false;
                    applyClassifyRows(acc, false);
                    setStatus('classify', 'AI 返回 ' + acc.length + ' 条建议,逐条决定是否采纳', acc.length ? 'success' : 'muted');
                    return;
                }
                setStatus('classify', 'AI 正在分类:' + done + '/' + items.length + '(第 ' + (k + 1) + '/' + chunks.length + ' 批)…');
                var catalog = classifyCatalog();
                chatJson(CLASSIFY_SYSTEM_PROMPT, buildClassifyUser(chunks[k], catalog, classifyTags()),
                         function (t) { return parseClassify(t, chunks[k].length); },
                         { task: 'classify', temperature: 0.2, timeout: 150, count: chunks[k].length })
                    .then(function (res) {
                        res.value.forEach(function (r) {
                            var it = chunks[k][r.i - 1];
                            if (!it) return;
                            acc.push({ i: r.i, url: it.url, name: it.name, old_category: it.category, old_subcat: it.subcat,
                                       old_tags: it.tags || [], category: r.category, subcat: r.subcat,
                                       tags: r.tags, reason: r.reason });
                        });
                        done += chunks[k].length;
                        step(k + 1);
                    }).catch(function (err) {
                        btn.disabled = false;
                        if (acc.length) applyClassifyRows(acc, false);
                        setStatus('classify', '第 ' + (k + 1) + ' 批失败:' + (err.message || '未知错误')
                            + (acc.length ? ';前面 ' + acc.length + ' 条建议已保留' : ''), 'danger');
                    });
            }
            step(0);
        });
    }
    function applyClassifyRows(parsed, manual) {
        var items = classifyItems;
        var rows = parsed.map(function (r) {
            var it = items[r.i - 1];
            if (!it) return null;
            return { url: it.url, name: it.name, old_category: it.category, old_subcat: it.subcat,
                     old_tags: it.tags || [], category: r.category, subcat: r.subcat, tags: r.tags || [], reason: r.reason };
        }).filter(Boolean);
        // 前端也过滤一次"本来就对"的条目,只留建议调整
        rows = rows.filter(function (r) {
            var a = r.tags.slice().sort().join('|'), b = (r.old_tags || []).slice().sort().join('|');
            return r.category !== (r.old_category || '') || r.subcat !== (r.old_subcat || '') || a !== b;
        });
        classifyRows = rows;
        classifyAdopt = rows.map(function () { return true; });
        renderClassify();
    }
    function renderClassify() {
        var box = document.getElementById('gacResult');
        if (!classifyRows.length) {
            box.innerHTML = '<div class="alert alert-success py-2 small mb-0">这批书签的分类和标签都没问题,不用改。</div>';
            return;
        }
        var html = '<div class="d-flex align-items-center gap-2 mb-1"><span class="small text-muted me-auto" id="gacCount"></span>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-gac-adopt="all">全选</button>'
            + '<button type="button" class="btn btn-sm btn-outline-secondary" data-gac-adopt="none">全部忽略</button></div>'
            + '<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr>'
            + '<th style="width:17%">站点</th><th style="width:41%">现分类 → 建议</th><th style="width:26%">标签</th><th class="text-end" style="width:16%">采纳</th>'
            + '</tr></thead><tbody>';
        classifyRows.forEach(function (r, i) {
            html += '<tr data-i="' + i + '"><td><span class="d-block text-truncate" title="' + esc(r.url) + '">' + esc(r.name) + '</span></td>'
                + '<td><div class="d-flex align-items-center gap-1"><span class="small text-muted text-truncate">' + esc((r.old_category || '未分类') + (r.old_subcat ? ' / ' + r.old_subcat : '')) + '</span>'
                + '<span class="small text-muted">→</span><input class="form-control form-control-sm gac-cat" value="' + esc(r.category) + '" aria-label="新大类">'
                + '<input class="form-control form-control-sm gac-sub" value="' + esc(r.subcat) + '" placeholder="小分类" aria-label="新小分类"></div>'
                + (r.reason ? '<div class="small text-muted text-truncate">' + esc(r.reason) + '</div>' : '') + '</td>'
                + '<td><input class="form-control form-control-sm gac-tags" value="' + esc((r.tags || []).join(', ')) + '" aria-label="标签"></td>'
                + '<td class="text-end"><label class="form-check form-switch d-inline-block mb-0"><input type="checkbox" class="form-check-input gac-adopt" role="switch" checked></label></td></tr>';
        });
        html += '</tbody></table></div><div class="d-flex align-items-center gap-2 mt-2"><span class="small text-muted me-auto" id="gacApplyCount"></span>'
            + '<button type="button" class="btn btn-sm btn-success nav-modal-primary" id="gacApply">应用已采纳</button></div>';
        box.innerHTML = html;
        box.querySelectorAll('[data-gac-adopt]').forEach(function (b) {
            b.addEventListener('click', function () {
                var on = b.getAttribute('data-gac-adopt') === 'all';
                classifyAdopt = classifyRows.map(function () { return on; });
                box.querySelectorAll('tr[data-i]').forEach(function (tr) {
                    var i = Number(tr.getAttribute('data-i'));
                    tr.querySelector('.gac-adopt').checked = classifyAdopt[i];
                    tr.classList.toggle('text-muted', !classifyAdopt[i]);
                });
                paintApply();
            });
        });
        document.getElementById('gacApply').addEventListener('click', applyClassify);
        paintApply();
    }
    function paintApply() {
        var n = classifyAdopt.filter(Boolean).length;
        var c = document.getElementById('gacCount');
        if (c) c.textContent = '共 ' + classifyRows.length + ' 条建议,默认全采纳';
        var ac = document.getElementById('gacApplyCount');
        if (ac) ac.textContent = '已采纳 ' + n + ' / 共 ' + classifyRows.length + ' 条';
        var btn = document.getElementById('gacApply');
        if (btn) { btn.disabled = n === 0; btn.textContent = '应用已采纳的 ' + n + ' 条'; }
    }
    function splitTags(raw) {
        var out = [], seen = {};
        String(raw || '').split(/[,，、;；\s]+/).forEach(function (t) {
            t = t.trim().slice(0, 10);
            if (t && !seen[t] && out.length < 8) { seen[t] = 1; out.push(t); }
        });
        return out;
    }
    function applyClassify() {
        var rows = [];
        document.querySelectorAll('#gacResult tr[data-i]').forEach(function (tr) {
            var i = Number(tr.getAttribute('data-i'));
            if (!classifyAdopt[i]) return;
            var cat = String(tr.querySelector('.gac-cat').value || '').trim();
            if (!cat) return;
            rows.push({ url: classifyRows[i].url, category: cat,
                        subcat: String(tr.querySelector('.gac-sub').value || '').trim(),
                        tags: splitTags(tr.querySelector('.gac-tags').value) });
        });
        if (!rows.length) { toast('没有勾选任何变更'); return; }
        var btn = document.getElementById('gacApply');
        btn.disabled = true;
        var updated = 0;
        var chain = rows.reduce(function (p, r) {
            return p.then(function () {
                return window.navGuestLocal.patch(r.url, { category: r.category, subcat: r.subcat, tags: r.tags })
                    .then(function (res) { if (res.ok) updated += 1; });
            });
        }, Promise.resolve());
        chain.then(function () {
            toast('已更新 ' + updated + ' 个本机书签');
            setStatus('classify', '已更新 ' + updated + ' 个本机书签', 'success');
            classifyRows = []; classifyAdopt = [];
            document.getElementById('gacResult').innerHTML = '';
            if (window.navPetState) window.navPetState('happy');
        }).catch(function (err) {
            btn.disabled = false;
            setStatus('classify', err.message || '应用失败', 'danger');
        });
    }

    // ===== 初始化 =====
    window.navGuestAi = {
        open: openPanel,
        savePetConfig: savePetConfig,
        openFind: openFind,
        openClassify: openClassify,
        configured: configured,
        config: cfg,
        modelFor: modelFor,
        chat: chat,
        quick: quick,
        whisper: whisper,
        balance: balance,
        probe: probeUrl,
        logs: readLogs,
        clearLogs: clearLogsStore,
        fetchModels: fetchModels,
        testModel: testModel,
        testAllModels: testAllModels,
        promptSite: buildSitePrompt,
        suggest: suggestSite,
        promptClassify: buildClassifyPrompt,
        parseSite: parseSiteDrafts
    };
    loadCfg().then(function () {
        if (cfgCache.baseUrl && cfgCache.model) {
            window.dispatchEvent(new CustomEvent('nav-guest-ai-config', { detail: cfgCache }));
        }
    });
    document.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-guest-ai]');
        if (!b) return;
        var act = b.getAttribute('data-guest-ai');
        if (act === 'find') openFind();
        else if (act === 'classify') openClassify();
        else if (act === 'config') openPanel();
    });
})();
