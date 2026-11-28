/* nav-webdav.js — 游客端 WebDAV 前端直连备份（2026-11-28，路线 1）
   ----------------------------------------------------------------------------
   边界：
   - 只在游客页加载；配置（目录 URL / 用户名 / 密码）只写这台浏览器的
     localStorage（navGuestWebdavV1），不经过服务器、不写服务端数据库；
   - 备份内容直接复用 navBackup.collect()，与「整包备份」同一格式；
     整包备份文件不含 WebDAV 凭据（nav-backup.js 已排除该键）；
   - 恢复前走 navBackup.restoreObject()，复用同一套格式校验 + 覆盖确认 + 刷新；
   - 浏览器直连 WebDAV 会触发 CORS 预检，服务端必须允许 PROPFIND / PUT / GET
     与 Authorization / Depth / Content-Type 头；不支持时只能换服务器或代理。
*/
(function () {
    'use strict';

    var KEY = 'navGuestWebdavV1';
    var modal = null;
    var $ = function (id) { return document.getElementById(id); };

    function T(zh) {
        return (window.NavI18n && typeof window.NavI18n.t === 'function') ? window.NavI18n.t(zh) : zh;
    }
    function toast(msg) {
        if (window.navToast) window.navToast(msg);
        else if (window.showToast) window.showToast(msg);
    }
    function readCfg() {
        try {
            var raw = localStorage.getItem(KEY);
            var obj = raw ? JSON.parse(raw) : null;
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) { return {}; }
    }
    function saveCfg(cfg) {
        try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; }
        catch (e) { toast(T('本机存储空间不足，WebDAV 配置未保存')); return false; }
    }
    function formCfg() {
        return {
            url: String(($('navDavUrl') || {}).value || '').trim(),
            user: String(($('navDavUser') || {}).value || '').trim(),
            pass: String(($('navDavPass') || {}).value || '')
        };
    }
    function baseOf(url) {
        return String(url || '').replace(/\/+$/, '') + '/';
    }
    function fileUrl(name) {
        return baseOf(formCfg().url) + encodeURIComponent(name);
    }
    function b64utf8(text) {
        var bytes;
        try { bytes = new TextEncoder().encode(text); }
        catch (e) {
            bytes = [];
            for (var i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i));
        }
        var bin = '';
        for (var j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
        return btoa(bin);
    }
    function headers(extra) {
        var cfg = formCfg();
        var out = Object.assign({'Accept': 'application/json, application/xml, text/xml, */*'}, extra || {});
        if (cfg.user || cfg.pass) out.Authorization = 'Basic ' + b64utf8(cfg.user + ':' + cfg.pass);
        return out;
    }
    function status(msg, kind) {
        var el = $('navDavStatus');
        if (!el) return;
        el.textContent = String(msg || '');
        el.className = 'small mt-2 ' + (kind === 'ok' ? 'text-success' : kind === 'err' ? 'text-danger' : 'text-muted');
    }
    function busy(btn, on) {
        if (!btn) return;
        btn.disabled = !!on;
    }
    function httpError(r) {
        if (r.status === 401) return T('认证失败：检查用户名 / 密码');
        if (r.status === 403) return T('没有权限：检查账号对目录的读写权限');
        if (r.status === 404) return T('目录不存在：先在 WebDAV 里建好这个目录');
        if (r.status === 405) return T('服务器不允许该方法（PROPFIND / PUT）');
        return T('服务器返回 HTTP ') + r.status;
    }
    function netError(err) {
        var text = String((err && err.message) || err || '');
        if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
            return T('连不上：可能是地址 / 证书 / CORS。浏览器直连要求 WebDAV 允许跨域（含 PROPFIND、PUT、Authorization）');
        }
        return text || T('请求失败');
    }
    function propfind(url, depth) {
        var body = '<?xml version="1.0" encoding="utf-8"?>'
            + '<d:propfind xmlns:d="DAV:"><d:prop>'
            + '<d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>'
            + '</d:prop></d:propfind>';
        return fetch(url, {
            method: 'PROPFIND',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            headers: headers({'Depth': String(depth || 0), 'Content-Type': 'application/xml; charset=utf-8'}),
            body: body
        });
    }
    function saveFromForm() {
        var cfg = formCfg();
        if (!cfg.url) { status(T('先填 WebDAV 目录 URL'), 'err'); return null; }
        if (!/^https?:\/\//i.test(cfg.url)) { status(T('地址要以 http:// 或 https:// 开头'), 'err'); return null; }
        saveCfg(cfg);
        return cfg;
    }

    function testConnection() {
        var cfg = saveFromForm();
        if (!cfg) return;
        var btn = $('navDavTest');
        busy(btn, true);
        status(T('正在连接…'));
        propfind(baseOf(cfg.url), 0).then(function (r) {
            if (r.ok || r.status === 207) {
                status(T('连接成功，目录可读'), 'ok');
            } else {
                status(httpError(r), 'err');
            }
        }).catch(function (err) { status(netError(err), 'err'); })
          .then(function () { busy(btn, false); });
    }

    function stamp() {
        var d = new Date();
        function p(n) { return n < 10 ? '0' + n : String(n); }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
            + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function backupNow() {
        var cfg = saveFromForm();
        if (!cfg) return;
        if (!window.navBackup || !window.navBackup.collect) { status(T('备份模块未加载'), 'err'); return; }
        var btn = $('navDavBackup');
        busy(btn, true);
        status(T('正在打包本机数据…'));
        window.navBackup.collect().then(function (pack) {
            var name = 'nav_backup_' + stamp() + '.json';
            var text = JSON.stringify(pack);
            var n = Object.keys(pack.entries || {}).length;
            status(T('正在上传 ') + n + T(' 项…'));
            return fetch(fileUrl(name), {
                method: 'PUT',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                headers: headers({'Content-Type': 'application/json'}),
                body: text
            }).then(function (r) {
                if (r.ok || r.status === 201 || r.status === 204) {
                    status(T('已备份到 WebDAV：') + name, 'ok');
                    toast(T('WebDAV 备份完成'));
                } else {
                    status(httpError(r), 'err');
                }
            });
        }).catch(function (err) { status(netError(err), 'err'); })
          .then(function () { busy(btn, false); });
    }

    function parseList(xmlText) {
        var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (!doc || doc.getElementsByTagName('parsererror').length) throw new Error(T('服务器返回的不是合法 WebDAV XML'));
        var res = Array.prototype.slice.call(doc.getElementsByTagName('*')).filter(function (el) {
            return el.localName === 'response';
        });
        var out = [];
        res.forEach(function (resp) {
            var href = '', size = 0, modified = '';
            Array.prototype.slice.call(resp.getElementsByTagName('*')).forEach(function (el) {
                if (el.localName === 'href' && !href) href = String(el.textContent || '').trim();
                else if (el.localName === 'getcontentlength' && !size) size = Number(el.textContent || 0) || 0;
                else if (el.localName === 'getlastmodified' && !modified) modified = String(el.textContent || '').trim();
            });
            if (!href) return;
            var decoded = href;
            try { decoded = decodeURIComponent(href.split('?')[0]); } catch (e) {}
            var name = decoded.replace(/\/+$/, '').split('/').pop() || '';
            if (!name || !/\.json$/i.test(name)) return;
            if (!/^nav_backup/i.test(name)) return;
            var abs = href;
            try { abs = new URL(href, baseOf(formCfg().url)).href; } catch (e2) {}
            out.push({name: name, url: abs, size: size, modified: modified});
        });
        out.sort(function (a, b) {
            return String(b.name).localeCompare(String(a.name), 'zh-Hans-CN', {numeric: true});
        });
        return out;
    }

    function loadList(announce) {
        var cfg = saveFromForm();
        if (!cfg) return Promise.resolve([]);
        var btn = $('navDavList');
        busy(btn, true);
        status(T('正在读取备份列表…'));
        return propfind(baseOf(cfg.url), 1).then(function (r) {
            if (!(r.ok || r.status === 207)) throw new Error(httpError(r));
            return r.text();
        }).then(function (text) {
            var rows = parseList(text);
            var sel = $('navDavFiles');
            if (!sel) return rows;
            sel.innerHTML = '';
            if (!rows.length) {
                var empty = document.createElement('option');
                empty.value = '';
                empty.textContent = T('目录里没有 nav_backup*.json');
                sel.appendChild(empty);
                if (announce) status(T('目录里没有备份文件'), 'err');
            } else {
                rows.forEach(function (row) {
                    var opt = document.createElement('option');
                    opt.value = row.url;
                    opt.textContent = row.name + (row.size ? ' · ' + Math.round(row.size / 1024) + ' KB' : '');
                    sel.appendChild(opt);
                });
                if (announce) status(T('找到 ') + rows.length + T(' 个备份，选择后点「恢复所选」'), 'ok');
            }
            $('navDavRestore').disabled = !rows.length;
            return rows;
        }).catch(function (err) {
            status(netError(err), 'err');
            return [];
        }).then(function (rows) { busy(btn, false); return rows; });
    }

    function restoreSelected() {
        var sel = $('navDavFiles');
        var url = sel ? String(sel.value || '') : '';
        if (!url) { status(T('先读取列表并选择一个备份'), 'err'); return; }
        var cfg = formCfg();
        if (!cfg.url) { status(T('先填 WebDAV 目录 URL'), 'err'); return; }
        var btn = $('navDavRestore');
        busy(btn, true);
        status(T('正在下载备份…'));
        fetch(url, {
            method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
            headers: headers({'Accept': 'application/json'})
        }).then(function (r) {
            if (!r.ok) throw new Error(httpError(r));
            return r.text();
        }).then(function (text) {
            var pack = window.navBackup && window.navBackup.parse ? window.navBackup.parse(text) : null;
            if (!pack) { status(T('不是可识别的整包备份'), 'err'); return; }
            status(T('备份已下载，等待确认覆盖…'), 'ok');
            if (window.navBackup && window.navBackup.restoreObject) {
                window.navBackup.restoreObject(pack, {source: (sel.options[sel.selectedIndex] || {}).text || 'WebDAV'});
            }
        }).catch(function (err) { status(netError(err), 'err'); })
          .then(function () { busy(btn, false); });
    }

    function forget() {
        try { localStorage.removeItem(KEY); } catch (e) {}
        ['navDavUrl', 'navDavUser', 'navDavPass'].forEach(function (id) {
            var el = $(id); if (el) el.value = '';
        });
        var sel = $('navDavFiles'); if (sel) sel.innerHTML = '';
        var rb = $('navDavRestore'); if (rb) rb.disabled = true;
        status(T('已清除这台浏览器里的 WebDAV 配置'), 'ok');
    }

    function openModal() {
        if (!modal) {
            var el = $('navWebdavModal');
            if (!el || !window.bootstrap) { toast(T('WebDAV 弹窗未加载')); return; }
            modal = window.bootstrap.Modal.getOrCreateInstance(el);
        }
        var cfg = readCfg();
        if ($('navDavUrl')) $('navDavUrl').value = cfg.url || '';
        if ($('navDavUser')) $('navDavUser').value = cfg.user || '';
        if ($('navDavPass')) $('navDavPass').value = cfg.pass || '';
        status(T('凭据只存在这台浏览器，不随整包备份导出'), '');
        modal.show();
        setTimeout(function () { if ($('navDavUrl')) $('navDavUrl').focus(); }, 300);
    }

    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('[data-nav-webdav]')) { e.preventDefault(); openModal(); }
    });
    document.addEventListener('DOMContentLoaded', function () {
        var t = $('navDavTest'), b = $('navDavBackup'), l = $('navDavList'), r = $('navDavRestore'), f = $('navDavForget');
        if (t) t.addEventListener('click', testConnection);
        if (b) b.addEventListener('click', backupNow);
        if (l) l.addEventListener('click', function () { loadList(true); });
        if (r) r.addEventListener('click', restoreSelected);
        if (f) f.addEventListener('click', forget);
        ['navDavUrl', 'navDavUser', 'navDavPass'].forEach(function (id) {
            var el = $(id);
            if (el) el.addEventListener('change', function () { saveCfg(formCfg()); });
        });
    });

    window.navWebdav = {open: openModal, test: testConnection, backup: backupNow,
                        list: loadList, restore: restoreSelected, forget: forget};
})();
