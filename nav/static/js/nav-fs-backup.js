/* 访客「文件夹备份」(2026-11-21):
   用浏览器自带的 File System Access API(window.showDirectoryPicker)指定一个本地文件夹,
   把整包备份直接写进去;也能列出文件夹里的备份读回来恢复。
   —— 不是 WebDAV,不经过任何服务器:文件落在用户自己选的目录里。

   与 nav-backup.js 的分工:
   - 备份内容仍由 navBackup.collect() 生成,格式与「整包备份」完全一致;
   - 这里只管「写进文件夹 / 从文件夹读出」;
   - 目录句柄存在独立的 IndexedDB(pinsflora-nav-fs),不放进 navStore,
     否则整包备份会把一个不可 JSON 序列化的 DirectoryHandle 也收进去。

   对外:window.navFsBackup = {supported, save, open, choose, refresh, forget, folderName}
*/
(function () {
    'use strict';
    if (!window.NAV_GUEST_MODE) return;

    var DB_NAME = 'pinsflora-nav-fs';
    var DB_VER = 1;
    var STORE = 'kv';
    var DIR_KEY = 'backupDir';
    var LIST_MAX = 200;
    var FILE_NAME_RE = /^nav_backup.*\.json$/i;

    var dirHandle = null;
    var dirTouched = false;
    var loadingDir = null;
    var listCache = [];
    var modal = null;
    var busy = false;

    function toast(msg) {
        if (window.navToast) window.navToast(msg);
        else if (window.console) console.warn('[nav-fs-backup] ' + msg);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function stampName(d) {
        d = d || new Date();
        return 'nav_backup_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
            + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.json';
    }
    function stampText(ms) {
        if (!ms) return '时间未知';
        var d = new Date(ms);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function sizeText(n) {
        n = Number(n) || 0;
        if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
        if (n >= 1024) return Math.round(n / 1024) + ' KB';
        return n + ' B';
    }
    function folderLabel() { return dirHandle && dirHandle.name ? dirHandle.name : '未选择文件夹'; }

    function supported() {
        return !!(window.showDirectoryPicker && window.isSecureContext !== false);
    }
    function whyUnsupported() {
        if (!window.showDirectoryPicker) {
            return '当前浏览器没有 File System Access API,需要 Chrome / Edge 等 Chromium 浏览器';
        }
        return '页面不是 HTTPS / localhost,浏览器不允许网页写本地文件夹';
    }
    function friendlyError(e) {
        var name = (e && e.name) || '';
        if (name === 'AbortError') return '已取消';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
            return '没有拿到文件夹权限(需要 HTTPS / localhost,并在系统弹窗里点允许)';
        }
        if (name === 'NotFoundError') return '文件夹或文件已经不在了,请重新选择';
        if (name === 'NoModificationAllowedError' || name === 'InvalidStateError') {
            return '文件正被其他程序占用,稍后再试';
        }
        if (name === 'QuotaExceededError') return '磁盘空间不足';
        return (e && e.message) || '未知错误';
    }

    // ---------- 独立 IDB:只存 DirectoryHandle,不进整包 ----------
    var dbPromise = null;
    function openDb() {
        if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-idb'));
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
            req.onblocked = function () { reject(new Error('idb-blocked')); };
        });
        dbPromise.catch(function () { dbPromise = null; });
        return dbPromise;
    }
    function idbGet(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).get(key);
                req.onsuccess = function () { resolve(req.result === undefined ? null : req.result); };
                req.onerror = function () { reject(req.error || new Error('idb-get-error')); };
            });
        }).catch(function () { return null; });
    }
    function idbSet(key, val) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(val, key);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { reject(tx.error || new Error('idb-put-error')); };
                tx.onabort = function () { reject(tx.error || new Error('idb-put-abort')); };
            });
        }).catch(function () { return false; });
    }
    function idbDel(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(key);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { resolve(false); };
                tx.onabort = function () { resolve(false); };
            });
        }).catch(function () { return false; });
    }

    loadingDir = idbGet(DIR_KEY).then(function (h) {
        if (!dirTouched && !dirHandle) dirHandle = (h && h.kind === 'directory') ? h : null;
        return dirHandle;
    }).catch(function () { return dirHandle; });

    // ---------- 权限 ----------
    function permState(handle, mode) {
        if (!handle || typeof handle.queryPermission !== 'function') return Promise.resolve('granted');
        return Promise.resolve(handle.queryPermission({ mode: mode })).catch(function () {
            return 'denied';
        });
    }
    // 必须在用户手势的调用链里;只是 query 的话不需要手势。
    function ensurePermission(handle, mode, requestFirst) {
        if (!handle) return Promise.resolve(false);
        if (requestFirst && typeof handle.requestPermission === 'function') {
            return Promise.resolve(handle.requestPermission({ mode: mode })).then(function (s) {
                return s === 'granted';
            }).catch(function () { return false; });
        }
        return permState(handle, mode).then(function (state) {
            if (state === 'granted') return true;
            if (typeof handle.requestPermission !== 'function') return false;
            return Promise.resolve(handle.requestPermission({ mode: mode })).then(function (s) {
                return s === 'granted';
            }).catch(function () { return false; });
        });
    }

    // ---------- 选文件夹 ----------
    // 必须由 click 处理器同步调用,不能先 await 别的东西再来。
    function choose() {
        if (!supported()) {
            toast(whyUnsupported());
            return Promise.resolve(false);
        }
        var picker;
        try {
            // 必须在 click 处理器里同步发起;失败(iframe / 无手势)会同步 throw,
            // 不能让它冒到事件处理器外面变成一条无声的 console 错误。
            picker = window.showDirectoryPicker({ id: 'pinsflora-nav-backup', mode: 'readwrite' });
        } catch (e) {
            toast('选择文件夹失败:' + friendlyError(e));
            return Promise.resolve(false);
        }
        return Promise.resolve(picker)
            .then(function (handle) {
                dirTouched = true;
                dirHandle = handle;
                var preview = document.getElementById('navFsPreview');
                if (preview) preview.classList.add('d-none');
                return idbSet(DIR_KEY, handle).then(function (ok) {
                    if (!ok) toast('文件夹已选,但浏览器没记住授权;下次备份需要重新选择');
                    renderFolderState();
                    return true;
                });
            })
            .catch(function (e) {
                if (e && e.name === 'AbortError') return false;
                toast('选择文件夹失败:' + friendlyError(e));
                return false;
            });
    }

    // ---------- 写 ----------
    function flushGuestData() {
        if (window.navGuestLocal && typeof window.navGuestLocal.saveNow === 'function') {
            return Promise.resolve(window.navGuestLocal.saveNow()).catch(function () { return null; });
        }
        return Promise.resolve();
    }
    function writeFile(handle, name, text) {
        return handle.getFileHandle(name, { create: true }).then(function (fh) {
            return fh.createWritable().then(function (writable) {
                return Promise.resolve(writable.write(new Blob([text], { type: 'application/json' })))
                    .then(function () { return writable.close(); });
            });
        });
    }
    function doSave() {
        if (busy) return Promise.resolve(false);
        if (!dirHandle) return Promise.resolve(false);
        busy = true;
        setStatus('正在打包…');
        var handle = dirHandle;
        var label = folderLabel();
        var wrote = false;
        return ensurePermission(handle, 'readwrite', true).then(function (ok) {
            if (!ok) throw new Error('没有拿到文件夹读写权限,请点「选择/更换」重新授权');
            return flushGuestData();
        }).then(function () {
            return window.navBackup.collect();
        }).then(function (pack) {
            var count = Object.keys(pack.entries || {}).length;
            if (!count) { toast('本机还没有可备份的数据'); return false; }
            var text = JSON.stringify(pack, null, 2);
            var name = stampName();
            return writeFile(handle, name, text).then(function () {
                wrote = true;
                setStatus('已备份 ' + name + ' · ' + count + ' 项 · ' + stampText(Date.now()));
                toast('已备份到「' + label + '」:' + name + '(' + count + ' 项)');
                return refreshList(false);
            });
        }).then(function () {
            busy = false;
            return wrote;
        }).catch(function (e) {
            busy = false;
            var msg = friendlyError(e);
            setStatus('备份失败:' + msg, true);
            toast('文件夹备份失败:' + msg);
            if (e && e.name === 'NotFoundError') {
                dirHandle = null;
                idbDel(DIR_KEY);
                renderFolderState();
            }
            return false;
        });
    }
    // 菜单「备份到文件夹」:没有句柄就同步拉系统选择框,选完直接保存。
    function save() {
        if (!supported()) {
            toast(whyUnsupported() + ',已改为下载整包备份');
            if (window.navBackup) window.navBackup.exportPack();
            return Promise.resolve(false);
        }
        if (!dirHandle) {
            return choose().then(function (ok) { return ok ? doSave() : false; });
        }
        return doSave();
    }

    // ---------- 读:列目录 ----------
    function isBackupFile(name) { return FILE_NAME_RE.test(String(name || '')); }
    function listBackups(handle) {
        var out = [];
        var iterator = handle.entries();
        function step() {
            if (out.length >= LIST_MAX) return Promise.resolve(out);
            return iterator.next().then(function (res) {
                if (res.done) return out;
                var name = res.value[0];
                var entry = res.value[1];
                if (!entry || entry.kind !== 'file' || !isBackupFile(name)) return step();
                return entry.getFile().then(function (file) {
                    out.push({ name: name, handle: entry, size: file.size, modified: file.lastModified });
                    return step();
                }, function () { return step(); });
            });
        }
        return step().then(function () {
            out.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
            return out;
        });
    }

    // ---------- 恢复 ----------
    function readText(file) {
        if (file && typeof file.text === 'function') return file.text();
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = function () { reject(reader.error || new Error('read-failed')); };
            reader.readAsText(file, 'utf-8');
        });
    }
    function summaryOf(pack) {
        var entries = pack.entries || {};
        var count = Object.keys(entries).length;
        var sites = 0;
        if (entries.navGuestBookmarksV1) {
            try {
                var raw = entries.navGuestBookmarksV1.value;
                var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (Array.isArray(arr)) sites = arr.length;
            } catch (e) { /* 读不出书签数就留 0 */ }
        }
        var createdMs = pack.created_at ? new Date(pack.created_at).getTime() : 0;
        var created = (createdMs && !isNaN(createdMs)) ? stampText(createdMs) : '';
        return (created || '时间未知') + ' · ' + (pack.mode === 'owner' ? '主人' : '访客')
            + ' · ' + count + ' 项 · 书签 ' + sites + ' 个';
    }
    function loadPack(item) {
        return item.handle.getFile().then(function (file) {
            return readText(file);
        }).then(function (text) {
            var pack = window.navBackup && window.navBackup.parse ? window.navBackup.parse(text) : null;
            if (!pack) throw new Error('这个文件不是 pinsflora 整包备份');
            return pack;
        });
    }
    function peekAt(item) {
        if (!item) return Promise.resolve(false);
        setStatus('读取 ' + item.name + '…');
        return loadPack(item).then(function (pack) {
            showPreview(item.name, summaryOf(pack));
            setStatus('');
            return true;
        }).catch(function (e) {
            setStatus('读取失败:' + friendlyError(e), true);
            toast('读取备份失败:' + friendlyError(e));
            return false;
        });
    }
    function restoreAt(item) {
        if (!item || busy) return Promise.resolve(false);
        busy = true;
        setStatus('读取并准备恢复 ' + item.name + '…');
        return loadPack(item).then(function (pack) {
            showPreview(item.name, summaryOf(pack));
            setStatus('');
            return window.navBackup.restoreObject(pack, { source: item.name });
        }).then(function (ok) {
            busy = false;
            if (!ok) setStatus('已取消恢复');
            return !!ok;
        }).catch(function (e) {
            busy = false;
            var msg = friendlyError(e);
            setStatus('恢复失败:' + msg, true);
            toast('恢复失败:' + msg);
            return false;
        });
    }

    // ---------- 模态 ----------
    function ensureModal() {
        if (modal) return modal;
        modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'navFsBackupModal';
        modal.tabIndex = -1;
        modal.setAttribute('data-no-resize', '1');
        modal.innerHTML =
            '<div class="modal-dialog modal-lg modal-dialog-scrollable">' +
            '<div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title"><i class="fas fa-folder-open me-2"></i>文件夹备份' +
            '<small class="text-muted fw-normal fs-6 ms-2">整站本机数据</small></h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
            '<div class="modal-body">' +
            '<div class="nav-fs-folder">' +
            '<div class="nav-fs-folder__icon"><i class="fas fa-folder"></i></div>' +
            '<div class="nav-fs-folder__main"><b id="navFsFolderName">未选择文件夹</b>' +
            '<div class="small text-muted" id="navFsFolderMeta">第一次备份会打开系统文件夹选择框</div></div>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="navFsChoose">选择/更换</button>' +
            '<button type="button" class="btn btn-sm btn-link p-0 text-decoration-none" id="navFsForget">忘记</button>' +
            '</div>' +
            '<div class="d-flex align-items-center gap-2 flex-wrap my-2">' +
            '<button type="button" class="btn btn-sm btn-primary" id="navFsSave"><i class="fas fa-floppy-disk me-1"></i>立即备份</button>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" id="navFsRefresh"><i class="fas fa-rotate me-1"></i>刷新列表</button>' +
            '<span class="small text-muted ms-auto" id="navFsStatus"></span>' +
            '</div>' +
            '<div class="alert alert-warning py-2 small d-none" id="navFsUnsupported"></div>' +
            '<div class="small fw-semibold mb-1">文件夹里的备份</div>' +
            '<div id="navFsList" class="nav-fs-list"></div>' +
            '<div class="nav-fs-preview d-none" id="navFsPreview"></div>' +
            '<div class="form-text small mt-2">只写你指定的文件夹,不经过服务器;备份内含书签 / 工具 / 分组 / 外观 / 桌宠 / 足迹 / 本机设置(不含 API Key,换机需重填),与「整包备份」同一格式,请选自己可控的目录。</div>' +
            '</div>' +
            '<div class="modal-footer"><button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">关闭</button></div>' +
            '</div></div>';
        document.body.appendChild(modal);

        document.getElementById('navFsChoose').addEventListener('click', function () {
            if (busy) return;
            choose().then(function (ok) {
                if (ok) refreshList(false);
                else renderFolderState();
            });
        });
        document.getElementById('navFsSave').addEventListener('click', function () {
            if (busy) return;
            if (!supported()) { toast(whyUnsupported()); return; }
            if (!dirHandle) {
                choose().then(function (ok) { if (ok) doSave(); });
                return;
            }
            doSave();
        });
        document.getElementById('navFsRefresh').addEventListener('click', function () {
            if (busy) return;
            if (!dirHandle) { toast('先选择一个文件夹'); return; }
            ensurePermission(dirHandle, 'read', true).then(function (ok) {
                if (!ok) { toast('没有文件夹读取权限,请点「选择/更换」重新授权'); return; }
                refreshList(false);
            });
        });
        document.getElementById('navFsForget').addEventListener('click', function () {
            if (busy) return;
            forget();
        });
        document.getElementById('navFsList').addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('[data-fs-act]') : null;
            if (!btn || busy) return;
            var i = Number(btn.getAttribute('data-fs-i'));
            var item = listCache[i];
            if (!item) return;
            if (btn.getAttribute('data-fs-act') === 'peek') { peekAt(item); return; }
            restoreAt(item);
        });
        return modal;
    }

    function setStatus(msg, danger) {
        var el = document.getElementById('navFsStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'small ms-auto ' + (danger ? 'text-danger' : 'text-muted');
    }
    function showPreview(name, summary) {
        var el = document.getElementById('navFsPreview');
        if (!el) return;
        el.classList.remove('d-none');
        el.innerHTML = '<i class="fas fa-circle-info me-1"></i><b>' + esc(name) + '</b> · ' + esc(summary);
    }
    function renderFolderState() {
        if (!modal) return;
        var nameEl = document.getElementById('navFsFolderName');
        var metaEl = document.getElementById('navFsFolderMeta');
        if (nameEl) nameEl.textContent = folderLabel();
        if (metaEl) {
            if (!dirHandle) {
                metaEl.textContent = '第一次备份会打开系统文件夹选择框';
            } else {
                metaEl.textContent = '已记住这个文件夹;需要时点「选择/更换」重新授权';
                var current = dirHandle;
                permState(current, 'readwrite').then(function (state) {
                    if (!modal || dirHandle !== current) return;
                    if (state === 'granted') metaEl.textContent = '已授权读写,只存在这台浏览器';
                    else if (state === 'prompt') metaEl.textContent = '授权已过期,备份时会再问一次';
                    else metaEl.textContent = '授权被拒绝,请点「选择/更换」重新选';
                });
            }
        }
    }
    function renderList(list) {
        var box = document.getElementById('navFsList');
        if (!box) return;
        listCache = list || [];
        if (!dirHandle) {
            box.innerHTML = '<div class="nav-fs-empty">还没有选择文件夹。点「选择/更换」指定一个目录。</div>';
            return;
        }
        if (!listCache.length) {
            box.innerHTML = '<div class="nav-fs-empty">这个文件夹里还没有 nav_backup*.json 备份。点「立即备份」写第一份。</div>';
            return;
        }
        var html = '';
        listCache.forEach(function (it, i) {
            html += '<div class="nav-fs-row">' +
                '<div class="nav-fs-row__icon"><i class="fas fa-file-code"></i></div>' +
                '<div class="nav-fs-row__main"><b title="' + esc(it.name) + '">' + esc(it.name) + '</b>' +
                '<span class="nav-fs-row__meta">' + esc(stampText(it.modified)) + ' · ' + esc(sizeText(it.size)) + '</span></div>' +
                '<button type="button" class="btn btn-sm btn-link p-0 text-decoration-none" data-fs-act="peek" data-fs-i="' + i + '">详情</button>' +
                '<button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" data-fs-act="restore" data-fs-i="' + i + '">恢复</button>' +
                '</div>';
        });
        box.innerHTML = html;
    }
    function refreshList(interactive) {
        if (!modal) return Promise.resolve(false);
        var box = document.getElementById('navFsList');
        if (!supported()) {
            renderUnsupported();
            return Promise.resolve(false);
        }
        if (!dirHandle) { renderList([]); return Promise.resolve(false); }
        var handle = dirHandle;
        return permState(handle, 'read').then(function (state) {
            if (state !== 'granted' && interactive) {
                return ensurePermission(handle, 'read', true).then(function (ok) {
                    return ok ? 'granted' : 'denied';
                });
            }
            return state;
        }).then(function (state) {
            if (state !== 'granted') {
                listCache = [];
                if (box) {
                    box.innerHTML = '<div class="nav-fs-empty">还没有这个文件夹的读取权限。点「选择/更换」重新选中同一目录即可授权。</div>';
                }
                return false;
            }
            return listBackups(handle).then(function (list) {
                if (dirHandle !== handle) return false;
                renderList(list);
                renderFolderState();
                return true;
            });
        }).catch(function (e) {
            if (box) {
                box.innerHTML = '<div class="nav-fs-empty">读文件夹失败:' + esc(friendlyError(e)) + '</div>';
            }
            return false;
        });
    }
    function renderUnsupported() {
        if (!modal) return;
        var alertEl = document.getElementById('navFsUnsupported');
        var listEl = document.getElementById('navFsList');
        if (alertEl) {
            alertEl.classList.remove('d-none');
            alertEl.textContent = whyUnsupported() + '。可以继续用「整包备份」下载,再用「整包恢复」打开。';
        }
        if (listEl) listEl.innerHTML = '<div class="nav-fs-empty">当前环境不支持文件夹读写。</div>';
        ['navFsChoose', 'navFsSave', 'navFsRefresh'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.disabled = true;
        });
    }

    function forget() {
        dirTouched = true;
        dirHandle = null;
        idbDel(DIR_KEY);
        setStatus('');
        var preview = document.getElementById('navFsPreview');
        if (preview) preview.classList.add('d-none');
        renderFolderState();
        renderList([]);
        toast('已忘记这个文件夹;磁盘上的备份文件没有动');
    }
    function openModal() {
        if (!supported()) {
            toast(whyUnsupported() + ',已改为选择备份文件');
            if (window.navBackup) window.navBackup.restorePack();
            return;
        }
        ensureModal();
        renderFolderState();
        // 从菜单点进来时借这次用户手势补一次读取授权,省得用户再点「选择/更换」。
        refreshList(true);
        bootstrap.Modal.getOrCreateInstance(modal).show();
    }

    // ---------- 菜单入口 ----------
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-nav-fs-save]')) {
            ev.preventDefault();
            save();
            return;
        }
        if (t.closest('[data-nav-fs-open]')) {
            ev.preventDefault();
            openModal();
        }
    });

    loadingDir.then(function () {
        renderFolderState();
        if (modal) refreshList(false);
    });

    window.navFsBackup = {
        supported: supported,
        save: save,
        open: openModal,
        choose: choose,
        refresh: function () { return refreshList(true); },
        forget: forget,
        folderName: function () { return folderLabel(); }
    };
})();
