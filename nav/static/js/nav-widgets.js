/* nav/static/js/nav-widgets.js —— P2 R-21 小组件注册表。
 *
 * 职责:为 fixbar(R-24)、背景皮肤(R-25)及后续小组件提供统一的注册 / 挂载 /
 * 卸载协议。本模块只做编排与隔离,不自带任何业务 DOM、不写库、不发网络请求;
 * 业务组件各自独立成文件(nav-fixbar.js / nav-skins.js …),通过 register 接入。
 *
 * ---------------------------------------------------------------------------
 * 注册表 schema(写死,集成方以本节为准)
 * ---------------------------------------------------------------------------
 * window.NavWidgets = {
 *   version: '1',
 *   register(def),      // def: {id, name?, selector?, priority?, mount(el, ctx), unmount?(el)}
 *   mountAll(root?),    // 幂等:已 mounted 的跳过;selector 选不到元素记 skipped
 *   unmount(id),
 *   get(id),
 *   list()              // 返回 [{id, name, priority, mounted, skipped, status, error}]
 * }
 *
 * def 字段约定:
 *   id        必填,非空字符串,全局唯一;重复 register 覆盖旧定义但不重复 mount。
 *   name      可选,展示名;缺省回落到 id。
 *   selector  可选,CSS 选择器;缺省时挂载到 root(无 root 时为 document.body)。
 *   priority  可选,数字,升序挂载;缺省 100;同值按注册先后稳定排序。
 *   mount(el, ctx)  必填;ctx = { root: 挂载根元素 }。
 *   unmount(el)     可选;卸载时回调,异常被注册表隔离,不影响其它组件。
 *
 * 边界约束(契约):
 *   - 零网络:无 fetch / XMLHttpRequest / sendBeacon / $.ajax / axios / 后端接口;
 *   - 零存储:本模块不读写 localStorage / sessionStorage / cookie;
 *   - 不包 IIFE,与 nav-presets.js / nav-sites.js 同风格,顶层函数后挂 window.NavWidgets;
 *   - 不依赖 jQuery / Bootstrap;组件内部可以依赖既有页面结构,注册表本身不查 DOM 业务节点。
 */

// --- 集中常量区:公开签名与队列键名以契约为准 ---

const WIDGET_VERSION = '1';

// 队列兜底键:nav-widgets.js 尚未载入时,其它模块把 def 推进这个数组;
// 本模块载入后 drain 队列,按 priority 升序补挂。
const QUEUE_KEY = '__navWidgetQueue';

// 默认优先级:不显式声明 priority 的组件排在中间,后注册的同类按先后稳定排序。
const DEFAULT_PRIORITY = 100;

// 状态机取值:
//   pending  已注册未挂载;mounted  挂载成功;skipped  选择器无落点/元素被占用;
//   error    mount 抛异常;unmounted 已卸载。
const STATUS_PENDING = 'pending';
const STATUS_MOUNTED = 'mounted';
const STATUS_SKIPPED = 'skipped';
const STATUS_ERROR = 'error';
const STATUS_UNMOUNTED = 'unmounted';

// 内部存储:def 表 / 状态表 / 注册顺序(稳定排序 tie-break)/ 已占用元素表。
const _defs = Object.create(null);
const _state = Object.create(null);
const _order = [];
const _mountedEls = [];

// 首次 mountAll 是否已跑完;为 true 后,后到的 register 立即尝试挂载一次,
// 不再依赖下一次 DOMContentLoaded(允许后加载脚本注册,不要求加载顺序)。
let _ready = false;

// --- 内部:def 归一化与校验 ---

function _normalize(def) {
    if (!def || typeof def !== 'object') return null;
    var id = String(def.id == null ? '' : def.id).trim();
    if (!id) return null;
    if (typeof def.mount !== 'function') return null;
    var priority = Number(def.priority);
    if (!isFinite(priority)) priority = DEFAULT_PRIORITY;
    return {
        id: id,
        name: def.name ? String(def.name) : id,
        selector: def.selector ? String(def.selector) : null,
        priority: priority,
        mount: def.mount,
        unmount: typeof def.unmount === 'function' ? def.unmount : null
    };
}

function _ensureState(id) {
    if (!_state[id]) {
        _state[id] = {
            mounted: false,
            status: STATUS_PENDING,
            el: null,
            error: null,
            skippedReason: null
        };
    }
    return _state[id];
}

// --- 内部:选择器解析;落点不存在返回 null ---

function _resolveEl(def, root) {
    var base = root || (typeof document !== 'undefined' ? document.body : null);
    if (!def.selector) return base;
    if (!base || typeof base.querySelector !== 'function') return null;
    try {
        var el = base.querySelector(def.selector);
        // 选择器命中根元素自身时(如 selector='body'),后代选择器查不到,回落 matches。
        if (!el && typeof base.matches === 'function' && base.matches(def.selector)) {
            el = base;
        }
        return el;
    } catch (e) {
        return null;
    }
}

// --- 内部:单个组件挂载,异常隔离,不向上抛 ---

function _mountOne(def, root) {
    var state = _ensureState(def.id);
    // 幂等:已挂载的不重复进 mount,避免重复 DOM。
    if (state.mounted) return STATUS_MOUNTED;

    var el = _resolveEl(def, root);
    if (!el) {
        state.status = STATUS_SKIPPED;
        state.skippedReason = 'no-match';
        state.error = null;
        return STATUS_SKIPPED;
    }
    // 同一元素被别的组件占用:不重复挂载,避免双重 DOM。
    if (_mountedEls.indexOf(el) !== -1) {
        state.status = STATUS_SKIPPED;
        state.skippedReason = 'el-busy';
        state.error = null;
        return STATUS_SKIPPED;
    }

    var ctx = { root: root || (typeof document !== 'undefined' ? document.body : null) };
    try {
        def.mount(el, ctx);
        state.mounted = true;
        state.status = STATUS_MOUNTED;
        state.el = el;
        state.error = null;
        state.skippedReason = null;
        _mountedEls.push(el);
    } catch (e) {
        // 隔离:单个组件 mount 抛错只记到自己的状态里,继续挂下一个。
        state.mounted = false;
        state.status = STATUS_ERROR;
        state.el = null;
        state.error = e && e.message ? String(e.message) : String(e);
    }
    return state.status;
}

// --- 公开 API: register(def) —— 注册或覆盖定义;已挂载的不重复 mount ---

function register(def) {
    var normalized = _normalize(def);
    if (!normalized) return null;
    var id = normalized.id;
    var existed = Object.prototype.hasOwnProperty.call(_defs, id);
    var state = _ensureState(id);
    // 已挂载:保留既有 el 与挂载状态,仅覆盖定义,不触发重复挂载。
    _defs[id] = normalized;
    if (!existed) _order.push(id);

    // 注册表已就绪(首跑完成):后加载脚本注册后立即尝试挂载一次。
    if (_ready && !state.mounted) {
        _mountOne(normalized, null);
    }
    return id;
}

// --- 公开 API: mountAll(root?) —— 按 priority 升序幂等挂载全部已注册组件 ---

function mountAll(root) {
    var ids = _order.slice().sort(function (a, b) {
        var pa = _defs[a].priority;
        var pb = _defs[b].priority;
        if (pa !== pb) return pa - pb;
        return _order.indexOf(a) - _order.indexOf(b);
    });
    ids.forEach(function (id) {
        _mountOne(_defs[id], root || null);
    });
    _ready = true;
    return list();
}

// --- 公开 API: unmount(id) —— 卸载单个组件;回调异常被隔离 ---

function unmount(id) {
    var state = _state[id];
    var def = _defs[id];
    if (!state || !state.mounted) return false;
    var el = state.el;
    if (def && def.unmount) {
        try {
            def.unmount(el);
        } catch (e) {
            state.error = e && e.message ? String(e.message) : String(e);
        }
    }
    var idx = _mountedEls.indexOf(el);
    if (idx !== -1) _mountedEls.splice(idx, 1);
    state.mounted = false;
    state.status = STATUS_UNMOUNTED;
    state.el = null;
    state.skippedReason = null;
    return true;
}

// --- 公开 API: get(id) —— 返回定义快照(浅拷贝),不存在返回 null ---

function get(id) {
    var def = _defs[id];
    if (!def) return null;
    return {
        id: def.id,
        name: def.name,
        selector: def.selector,
        priority: def.priority,
        mount: def.mount,
        unmount: def.unmount
    };
}

// --- 公开 API: list() —— 全量状态清单;mounted / skipped 布尔 + status/error 明细 ---

function list() {
    return _order.map(function (id) {
        var def = _defs[id];
        var state = _state[id] || {};
        return {
            id: id,
            name: def.name,
            priority: def.priority,
            mounted: state.mounted === true,
            skipped: state.status === STATUS_SKIPPED || state.status === STATUS_ERROR,
            status: state.status || STATUS_PENDING,
            error: state.error || null
        };
    });
}

// --- 公开 API: remount() —— 先卸载全部已挂载组件,再按优先级重跑一次 ---

function remount() {
    _order.slice().forEach(function (id) { unmount(id); });
    return mountAll(null);
}

// --- 内部:队列兜底;本模块载入前推入 __navWidgetQueue 的 def 在此 drain ---

function _drainQueue() {
    var queue = window[QUEUE_KEY];
    if (!Array.isArray(queue)) return;
    queue.forEach(function (def) {
        if (def) register(def);
    });
    queue.length = 0;
}

// --- 启动:drain 队列;DOMContentLoaded 自动跑一次 mountAll ---

function _autoStart() {
    mountAll(null);
}

_drainQueue();

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoStart);
    } else {
        _autoStart();
    }
}

window.NavWidgets = {
    version: WIDGET_VERSION,
    register: register,
    mountAll: mountAll,
    unmount: unmount,
    get: get,
    list: list,
    remount: remount
};
