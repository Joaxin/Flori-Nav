/* 本机持久化薄封装(2026-11-19):大对象/长列表走 IndexedDB,小偏好仍用 localStorage。
   - 主客共用:访客态同样可写,不经过服务端、不触发 /api/nav/ 请求。
   - IDB 不可用(隐私模式 / 被禁用 / 老浏览器)时自动回落 localStorage,不抛错中断页面。
   - 存值支持字符串 / 普通对象 / Blob / File(结构化克隆);小标量偏好不必走这一层。
   对外:window.navStore.get(key, fallback) / set(key, value) / remove(key)。
   读是异步 Promise;首屏就要同步读到的小设置仍直接用 localStorage,不要套这层。 */
(function () {
    'use strict';

    var DB_NAME = 'pinsflora-nav';
    var DB_VER = 1;
    var STORE = 'kv';
    var dbPromise = null;

    function idbAvailable() {
        return typeof indexedDB !== 'undefined';
    }

    function openDb() {
        if (!idbAvailable()) return Promise.reject(new Error('indexeddb-unavailable'));
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
        // 打开失败别把 rejected 缓存住,下次还能再试
        dbPromise.catch(function () { dbPromise = null; });
        return dbPromise;
    }

    function withTx(mode, fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, mode);
                var store = tx.objectStore(STORE);
                var out = fn(store);
                tx.oncomplete = function () { resolve(out); };
                tx.onerror = function () { reject(tx.error || new Error('idb-tx-error')); };
                tx.onabort = function () { reject(tx.error || new Error('idb-tx-abort')); };
            });
        });
    }

    function lsGet(key, fallback) {
        try {
            var v = localStorage.getItem(key);
            return v === null ? fallback : v;
        } catch (e) { return fallback; }
    }

    function lsSet(key, value) {
        try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        } catch (e) { /* 隐私模式/配额满:接住,不中断调用 */ }
    }

    // 异步读:先 IDB;缺失或 IDB 异常时回落 localStorage(旧数据迁移期兼容)。
    function get(key, fallback) {
        if (!idbAvailable()) return Promise.resolve(lsGet(key, fallback));
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readonly');
                var store = tx.objectStore(STORE);
                var req = store.get(key);
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error || new Error('idb-get-error')); };
                tx.onabort = function () { reject(tx.error || new Error('idb-get-abort')); };
            });
        }).then(function (val) {
            return val === undefined || val === null ? lsGet(key, fallback) : val;
        }).catch(function () { return lsGet(key, fallback); });
    }

    // 写:优先 IDB;成功后清掉 localStorage 旧镜像避免占配额。IDB 失败回落 localStorage。
    // 返回 Promise<true 落 IDB / false 回落 localStorage>。
    function set(key, value) {
        if (!idbAvailable()) { lsSet(key, value); return Promise.resolve(false); }
        return withTx('readwrite', function (s) { s.put(value, key); }).then(function () {
            try { localStorage.removeItem(key); } catch (e) {}
            return true;
        }).catch(function () { lsSet(key, value); return false; });
    }

    // 删:IDB 与 localStorage 镜像一起清。
    function remove(key) {
        function lsClear() { try { localStorage.removeItem(key); } catch (e) {} }
        if (!idbAvailable()) { lsClear(); return Promise.resolve(); }
        return withTx('readwrite', function (s) { s.delete(key); }).catch(function () {}).then(lsClear);
    }

    // 列出 IDB 里所有键(整包备份用)。IDB 不可用/打开失败给空数组,不抛错。
    function keys() {
        if (!idbAvailable()) return Promise.resolve([]);
        return openDb().then(function (db) {
            return new Promise(function (resolve) {
                var out = [];
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).openCursor();
                req.onsuccess = function () {
                    var cur = req.result;
                    if (!cur) return;
                    out.push(cur.key);
                    cur.continue();
                };
                tx.oncomplete = function () { resolve(out); };
                tx.onabort = function () { resolve(out); };
                tx.onerror = function () { resolve(out); };
            });
        }).catch(function () { return []; });
    }

    window.navStore = { get: get, set: set, remove: remove, keys: keys };
})();
