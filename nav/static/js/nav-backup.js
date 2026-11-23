/* 整包备份 / 恢复(2026-11-20 P2,2026-11-21 脱敏)
   ----------------------------------------------------------------------------
   备份的是"这台浏览器里的全部导航本机数据":书签、工具、分组顺序、外观/壁纸、
   桌宠偏好、足迹、本机 AI 配置……也就是所有 nav* 前缀的 localStorage 键 + IndexedDB
   (pinsflora-nav / kv) 里的全部键;不包含服务端数据库(那是主人侧的站点库,另有导出)。
   注意:AI 配置里的 apiKey / key / token 不进整包(换机需重填);恢复时若入站配置
   没带 Key 而本机当前有,保留本机当前 Key,避免"恢复一次就把 Key 弄丢"。
   恢复是覆盖式写入:先确认、再逐项落盘、最后刷新页面;失败项汇总提示,不静默吞。

   文件格式:
   {format:'pinsflora-nav-local', version:1, created_at, mode:'guest'|'owner',
    entries: {key: {type:'ls'|'idb', value}}}
   旧导出({sites:[...]})不当作整包文件,交给原来的导入管道处理。
*/
(function () {
    'use strict';

    var FORMAT = 'pinsflora-nav-local';
    var VERSION = 1;
    var BIG_KEYS = {'navCustomBg': 1};   // 大对象必须走 IDB,不能塞回 localStorage
    // AI 配置键:采集时擦除 Key 类字段;恢复时缺 Key 保本机当前值。
    var AI_CFG_KEY = 'navGuestAiCfgV1';
    var SENSITIVE_FIELDS = ['apiKey', 'key', 'token'];

    function lsKeys() {
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('nav') === 0) out.push(k);
            }
        } catch (e) { /* 隐私模式读不到:当作没有 */ }
        return out;
    }
    function modeOf() { return (window.NAV_GUEST_MODE ? 'guest' : 'owner'); }
    function stamp(d) {
        d = d || new Date();
        function p(n) { return n < 10 ? '0' + n : String(n); }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
    }
    function download(filename, text) {
        var blob = new Blob([text], {type: 'application/json'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 0);
    }
    function toast(msg) { if (window.navToast) window.navToast(msg); }
    // created_at 存的是 ISO(UTC);给用户看的确认框统一换成本机时区,
    // 否则和文件夹列表里的文件修改时间会差时区,看着像对不上。
    function localTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (!d || isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 16);
        function p(n) { return n < 10 ? '0' + n : String(n); }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    // 采集端脱敏:AI 配置里的 Key 类字段不进整包;baseUrl / model / modelClassify /
    // persona / memoryRounds 等非敏感配置保留。LS 条目是字符串、IDB 条目是对象,
    // 擦除后必须保持原类型,否则恢复端写回会错。
    function scrubAiCfgEntry(entry) {
        if (!entry) return entry;
        var raw = entry.value;
        if (typeof raw === 'string') {
            var parsed = null;
            try { parsed = JSON.parse(raw); } catch (e) { return entry; }
            if (!parsed || typeof parsed !== 'object') return entry;
            SENSITIVE_FIELDS.forEach(function (f) { delete parsed[f]; });
            return {type: entry.type, value: JSON.stringify(parsed)};
        }
        if (raw && typeof raw === 'object') {
            var copy = Object.assign({}, raw);
            SENSITIVE_FIELDS.forEach(function (f) { delete copy[f]; });
            return {type: entry.type, value: copy};
        }
        return entry;
    }

    // ---------- 采集 ----------
    function collect() {
        var entries = {};
        lsKeys().forEach(function (k) {
            try {
                var v = localStorage.getItem(k);
                entries[k] = {type: BIG_KEYS[k] ? 'idb' : 'ls', value: v};
            } catch (e) { /* 单键读失败就跳过 */ }
        });
        var chain = Promise.resolve();
        if (window.navStore && window.navStore.keys) {
            chain = window.navStore.keys().then(function (keys) {
                return Promise.all((keys || []).map(function (k) {
                    return window.navStore.get(k, null).then(function (v) {
                        if (v === null || v === undefined) return null;
                        return {k: k, v: v};
                    }).catch(function () { return null; });
                }));
            }).then(function (rows) {
                (rows || []).forEach(function (row) {
                    if (row) entries[row.k] = {type: 'idb', value: row.v};
                });
            });
        }
        return chain.then(function () {
            if (entries[AI_CFG_KEY]) entries[AI_CFG_KEY] = scrubAiCfgEntry(entries[AI_CFG_KEY]);
            return {format: FORMAT, version: VERSION, created_at: new Date().toISOString(),
                    mode: modeOf(), entries: entries};
        });
    }

    function exportPack() {
        return collect().then(function (pack) {
            var n = Object.keys(pack.entries).length;
            if (!n) { toast('本机还没有可备份的数据'); return pack; }
            download('nav_backup_' + stamp() + '.json', JSON.stringify(pack));
            toast('整包备份已下载:' + n + ' 项本机数据');
            return pack;
        }).catch(function () { toast('备份失败:本机存储读取异常'); });
    }

    // ---------- 恢复 ----------
    var fileInput = null;
    function pickFile() {
        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json,application/json';
            fileInput.className = 'd-none';
            fileInput.id = 'navBackupFile';
            document.body.appendChild(fileInput);
            fileInput.addEventListener('change', function () {
                var f = fileInput.files && fileInput.files[0];
                fileInput.value = '';
                if (f) restoreFile(f);
            });
        }
        fileInput.value = '';
        fileInput.click();
    }

    // 文本 → 整包对象。格式不对 / 解析失败一律 null,调用侧统一给提示。
    function parsePack(text) {
        var raw = String(text == null ? '' : text).replace(/^\uFEFF/, '');
        var pack;
        try { pack = JSON.parse(raw); } catch (e) { pack = null; }
        if (!pack || pack.format !== FORMAT || !pack.entries || typeof pack.entries !== 'object') return null;
        return pack;
    }

    // 整包对象 → 确认 → 覆盖落盘 → 刷新。文件夹恢复与文件恢复共用这一条,
    // 免得两套入口对"覆盖式 / 失败项 / 刷新"的处理慢慢走偏。
    function restorePackObject(pack, opts) {
        opts = opts || {};
        if (!pack || pack.format !== FORMAT || !pack.entries || typeof pack.entries !== 'object') {
            toast('不是整包备份文件(整包备份的 format 是 ' + FORMAT + ')');
            return Promise.resolve(false);
        }
        var keys = Object.keys(pack.entries);
        if (!keys.length) { toast('备份文件里没有内容'); return Promise.resolve(false); }
        var created = localTime(pack.created_at);
        var source = String(opts.source || '');
        var where = source ? '「' + source + '」里的备份' : '备份';
        return new Promise(function (resolve) {
            function ask(ok) {
                if (ok) applyPack(pack, keys);
                resolve(!!ok);
            }
            if (window.navConfirm) {
                window.navConfirm({
                    title: '恢复整包备份',
                    body: '将用' + where + '覆盖这台浏览器里的 ' + keys.length + ' 项本机数据'
                        + (created ? '(备份时间 ' + created + ')' : '')
                        + '。当前的本地书签、设置和足迹会被替换,服务端站点库不受影响。',
                    confirmLabel: '覆盖恢复', danger: true
                }).then(ask);
            } else {
                ask(true);
            }
        });
    }

    function restoreFile(file) {
        var reader = new FileReader();
        reader.onload = function () {
            var pack = parsePack(reader.result);
            if (!pack) {
                toast('不是整包备份文件(整包备份的 format 是 ' + FORMAT + ')');
                return;
            }
            restorePackObject(pack);
        };
        reader.onerror = function () { toast('备份文件读取失败'); };
        reader.readAsText(file, 'utf-8');
    }

    function parseCfgLike(v) {
        if (v == null) return null;
        if (typeof v === 'object') return v;
        if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } }
        return null;
    }
    function readLocalAiCfg() {
        var fromLs = null;
        try { fromLs = parseCfgLike(localStorage.getItem(AI_CFG_KEY)); } catch (e) { fromLs = null; }
        if (window.navStore && window.navStore.get) {
            return window.navStore.get(AI_CFG_KEY, null).then(function (v) {
                return v == null ? fromLs : parseCfgLike(v);
            }).catch(function () { return fromLs; });
        }
        return Promise.resolve(fromLs);
    }
    // 恢复防呆:入站配置没带 apiKey(整包已脱敏)而本机当前有 Key 时,保本机当前 Key,
    // 避免"恢复一次就把 Key 弄丢"。这是保守决策:若希望整包彻底覆盖 AI 配置,
    // 可去掉这里的合并、直接写回入站值。读本机配置失败不抛错,不阻断其它键的恢复。
    function keepLocalAiKey(rec) {
        var inbound = parseCfgLike(rec.value);
        if (!inbound || typeof inbound !== 'object') return Promise.resolve(rec.value);
        var hasInboundKey = SENSITIVE_FIELDS.some(function (f) {
            return !!String(inbound[f] || '').trim();
        });
        if (hasInboundKey) return Promise.resolve(rec.value);
        return readLocalAiCfg().then(function (local) {
            if (local && typeof local === 'object' && local.apiKey) inbound.apiKey = local.apiKey;
            return typeof rec.value === 'string' ? JSON.stringify(inbound) : inbound;
        }).catch(function () { return rec.value; });
    }

    function writeRecord(k, rec) {
        var val = rec.value;
        if (rec.type === 'idb' || BIG_KEYS[k]) {
            if (!window.navStore) throw new Error('no store');
            return window.navStore.set(k, val);
        }
        try { localStorage.setItem(k, String(val)); } catch (e) { throw e; }
    }

    function applyPack(pack, keys) {
        var chain = Promise.resolve();
        var failed = 0;
        keys.forEach(function (k) {
            var rec = pack.entries[k] || {};
            chain = chain.then(function () {
                if (k === AI_CFG_KEY) {
                    // 缺 Key 的 AI 配置先合并本机当前 Key,再按原类型落盘;单项失败不影响其它键。
                    return keepLocalAiKey(rec).then(function (merged) {
                        rec.value = merged;
                        return writeRecord(k, rec);
                    });
                }
                return writeRecord(k, rec);
            }).catch(function () { failed++; });
        });
        chain.then(function () {
            if (failed) toast('恢复完成,' + failed + ' 项写入失败(多半是存储空间不足)');
            else toast('整包恢复完成,正在刷新…');
            setTimeout(function () { location.reload(); }, 900);
        });
    }

    // 入口统一用 data 属性委托:访客导出菜单与主人「更多」菜单各有一份按钮,
    // 两套 DOM 可能同时渲染(访客 CSS 只是隐藏),不能靠 id 绑定。
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('[data-nav-backup]')) { exportPack(); return; }
        if (e.target.closest('[data-nav-restore]')) { pickFile(); }
    });

    window.navBackup = {collect: collect, exportPack: exportPack, restorePack: pickFile,
                        parse: parsePack, restoreObject: restorePackObject,
                        _apply: applyPack};
})();
