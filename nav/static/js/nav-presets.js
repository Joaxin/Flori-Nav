/* nav/static/js/nav-presets.js —— P0 新增模块(R-01 / R-04 / R-07)。
 *
 * 调用方:
 *   - 模板 head 在首帧前内联调用 `window.NavPresets.migrate()`(一次性旧档迁移);
 *   - nav-sites.js 集成阶段通过 `applyPresetNow` 调用 `apply(id)`,并监听
 *     `nav:presetchange` 事件回写既有三档布局控件。
 *
 * 键清单唯一数据源:`借鉴调研/05-presets.draft.json` + `借鉴调研/p0/00-接口契约.md`
 * 第 3 节表格。本模块只写既有键(包内 keys)与 preset 键 `navLayoutPreset`,
 * 不向 navLayout 三值白名单 {card, icon, list} 新增档位。
 *
 * 边界约束(契约第 2 节):
 *   - 只依赖 localStorage(try/catch 包裹);不依赖 jQuery / Bootstrap / DOM 结构;
 *   - 零网络调用:无 fetch / XMLHttpRequest / sendBeacon / 后端接口请求 / $.ajax;
 *   - 不包 IIFE,与 nav-sites.js 同风格,顶层 const 定义后挂 window.NavPresets。
 */

// --- 集中常量区:集成阶段的稳定锚点,公开方法签名与键名以契约为准 ---

// 预设 id 顺序即 UI 按钮顺序(契约 PRESET_IDS)。
// portal 为 2026-11-23 借鉴 0x3.com 新增的第五档:分类行标签 + 多列密排;
// 不扩 navLayout 三值白名单,仍只写既有键。
const PRESET_IDS = ['classic', 'compact', 'portal', 'gallery', 'app-first'];

// 回落档:任何非法 id / 非法 layout 都回落到 classic。
const PRESET_DEFAULT = 'classic';

// localStorage 存储键(契约写死,不许改)。
const KEY_PRESET = 'navLayoutPreset';
const KEY_MIGRATED = 'navPresetMigrated';

// 既有三档布局白名单(与 nav-sites.js 既有值域一致,严禁新增)。
const ALLOWED_LAYOUTS = ['card', 'icon', 'list'];

// 旧档值 → 预设 id 的一次性迁移映射(契约 resolveLegacy)。
const LEGACY_LAYOUT_MAP = {
    card: 'classic',
    icon: 'compact',
    list: 'compact'
};

// 五套预设包:keys 逐键等于契约第 3 节表格。
// 值类型:navCardDescLines 为数字;navFontScale 为字符串;navShow* 为 '0'/'1';
// 其余为字符串。navCardDescLines 在 P1(R-10)才被界面消费,P0 只写入不读取。
const PRESETS = {
    classic: {
        id: 'classic',
        name: '经典目录',
        desc: '分类层级深、桌面主导的常规浏览',
        mobile: '卡片两轨 160px;目录走 Bootstrap offcanvas;顶栏保持现状',
        keys: {
            navLayout: 'card',
            navDensity: 'comfortable',
            navTocStyle: 'soft',
            navShowToc: '1',
            navTocMode: 'dock',
            navFontScale: '',
            navShowClock: '1',
            navShowSearch: '1',
            navShowRecent: '1',
            navShowTools: '1',
            navShowUrl: '0',
            navShowTags: '1',
            navShowHealth: '1',
            navShowActions: '0',
            navUrlMode: 'clip',
            navPageWidth: 'default',
            navCardDescLines: 2
        }
    },
    compact: {
        id: 'compact',
        name: '紧凑效率',
        desc: '一屏看更多的高频工具型浏览',
        mobile: '单列媒体行;目录 offcanvas;隐藏时钟与工具区',
        keys: {
            navLayout: 'list',
            navDensity: 'compact',
            navTocStyle: 'seeseed',
            navShowToc: '1',
            navTocMode: 'dock',
            navFontScale: 'sm',
            navShowClock: '0',
            navShowSearch: '1',
            navShowRecent: '0',
            navShowTools: '0',
            navShowUrl: '0',
            navShowTags: '1',
            navShowHealth: '0',
            navShowActions: '0',
            navUrlMode: 'clip',
            navPageWidth: 'default',
            navCardDescLines: 1
        }
    },
    portal: {
        id: 'portal',
        name: '门户密度',
        desc: '参考 0x3 的分类行标签 + 多列密排',
        mobile: '两列;隐藏简介与标签,只留图标和站名',
        keys: {
            navLayout: 'card',
            navDensity: 'compact',
            navTocStyle: 'seeseed',
            navShowToc: '0',
            navTocMode: 'dock',
            navFontScale: 'sm',
            navShowClock: '0',
            navShowSearch: '1',
            navShowRecent: '0',
            navShowTools: '0',
            navShowUrl: '0',
            navShowTags: '0',
            navShowHealth: '0',
            navShowActions: '0',
            navUrlMode: 'clip',
            navPageWidth: '100',
            navCardDescLines: 1
        }
    },
    gallery: {
        id: 'gallery',
        name: '橱窗展示',
        desc: '封面/视觉导向的橱窗式浏览',
        mobile: '2 列;769-1024 三列;容器收窄至 90%',
        keys: {
            navLayout: 'card',
            navDensity: 'relaxed',
            navTocStyle: 'ribbon',
            navShowToc: '1',
            navTocMode: 'dock',
            navFontScale: 'md',
            navShowClock: '1',
            navShowSearch: '1',
            navShowRecent: '1',
            navShowTools: '1',
            navShowUrl: '0',
            navShowTags: '1',
            navShowHealth: '1',
            navShowActions: '0',
            navUrlMode: 'wrap',
            navPageWidth: '90',
            navCardDescLines: 2
        }
    },
    'app-first': {
        id: 'app-first',
        name: '移动优先',
        desc: '手机端为主的随身浏览,两层导航分离',
        mobile: '单列;汉堡抽屉展开顶层分类;二级胶囊横滚',
        keys: {
            navLayout: 'card',
            navDensity: 'comfortable',
            navTocStyle: 'default',
            navShowToc: '1',
            navTocMode: 'drawer',
            navFontScale: 'md',
            navShowClock: '0',
            navShowSearch: '1',
            navShowRecent: '1',
            navShowTools: '0',
            navShowUrl: '0',
            navShowTags: '1',
            navShowHealth: '0',
            navShowActions: '0',
            navUrlMode: 'clip',
            navPageWidth: '100',
            navCardDescLines: 1
        }
    }
};

// localStorage 读写统一收口:禁用/隐私模式等异常一律静默回落,不抛错、不发请求。
function _storageGet(key) {
    try {
        return window.localStorage.getItem(key);
    } catch (e) {
        return null;
    }
}

function _storageSet(key, value) {
    try {
        window.localStorage.setItem(key, String(value));
        return true;
    } catch (e) {
        return false;
    }
}

// --- 内部:旧档值反解;未知值返回 null ---
function _resolveLegacyInternal(layout) {
    if (Object.prototype.hasOwnProperty.call(LEGACY_LAYOUT_MAP, layout)) {
        return LEGACY_LAYOUT_MAP[layout];
    }
    return null;
}

// --- 公开 API: resolveLegacy(layout) —— 'card'→'classic';'icon'|'list'→'compact';其它→null ---
function resolveLegacy(layout) {
    return _resolveLegacyInternal(layout);
}

// --- 公开 API: read() —— { id, source },source = 'stored' | 'migrated' | 'default' | 'invalid';default 不写盘 ---
function read() {
    var stored = _storageGet(KEY_PRESET);
    if (stored && Object.prototype.hasOwnProperty.call(PRESETS, stored)) {
        return { id: stored, source: 'stored' };
    }
    if (_storageGet(KEY_MIGRATED) !== null) {
        var legacy = _storageGet('navLayout');
        var migratedId = _resolveLegacyInternal(legacy);
        if (migratedId) {
            return { id: migratedId, source: 'migrated' };
        }
        return { id: PRESET_DEFAULT, source: 'invalid' };
    }
    return { id: PRESET_DEFAULT, source: 'default' };
}

// --- 公开 API: apply(id, opts) —— 只写包内白名单键 + preset 键;三重校验;不发网络请求 ---
function apply(id, opts) {
    var preset = PRESETS[id];
    // 校验一:id 必须是五个合法预设之一;未知 id 不写任何键,回落 classic。
    if (!preset) {
        return { id: PRESET_DEFAULT, fallback: true, keys: PRESETS[PRESET_DEFAULT].keys };
    }
    var keys = preset.keys;
    // 校验二:包内 navLayout 必须落在既有三档白名单内;越值即拒绝并回落 classic。
    if (ALLOWED_LAYOUTS.indexOf(keys.navLayout) === -1) {
        return { id: PRESET_DEFAULT, fallback: true, keys: PRESETS[PRESET_DEFAULT].keys };
    }
    // 校验三:只允许写 PRESETS[id].keys 里出现的键 + KEY_PRESET;遍历白名单本身,
    // 白名单之外的键一律不碰(不读、不写、不删)。
    Object.keys(keys).forEach(function (key) {
        _storageSet(key, keys[key]);
    });
    _storageSet(KEY_PRESET, id);

    // 派发变更事件;订阅方(集成层)负责回写既有布局控件,本模块不碰 DOM。
    var detail = { id: id, keys: keys };
    try {
        document.dispatchEvent(new CustomEvent('nav:presetchange', { detail: detail }));
    } catch (e) {
        // 事件环境缺失(如无 document 的纯脚本环境)时静默忽略,存储结果已落盘。
    }
    return { id: id, keys: keys };
}

// --- 公开 API: migrate() —— 旧值一次性迁移,幂等;已存在 preset 键时不覆盖包内键 ---
function migrate() {
    // 已有 preset 键:用户手改过的值必须保留,直接原样返回,不改任何包内键。
    var existing = _storageGet(KEY_PRESET);
    if (existing && Object.prototype.hasOwnProperty.call(PRESETS, existing)) {
        return { id: existing, changed: false };
    }
    // 触发条件:preset 键不存在 且 迁移标记不存在 且 旧 navLayout 有值。
    var legacy = _storageGet('navLayout');
    var already = _storageGet(KEY_MIGRATED);
    if (legacy === null || already !== null) {
        var current = read();
        return { id: current.id, changed: false };
    }
    var resolved = _resolveLegacyInternal(legacy);
    if (!resolved) {
        // 其它旧值(非法/未知)回落 classic,记为迁移过,避免重复探测。
        resolved = PRESET_DEFAULT;
    }
    // 只写 preset 键与迁移标记;旧 navLayout 及其余包内键保持原样,不覆盖。
    _storageSet(KEY_PRESET, resolved);
    _storageSet(KEY_MIGRATED, '1');
    return { id: resolved, changed: true };
}

// --- 公开 API: onChange(fn) —— 订阅 'nav:presetchange' ---
function onChange(fn) {
    if (typeof fn !== 'function') return;
    try {
        document.addEventListener('nav:presetchange', fn);
    } catch (e) {
        // 无 document 环境下不订阅;存储侧行为不受影响。
    }
}

window.NavPresets = {
    PRESET_IDS: PRESET_IDS,
    DEFAULT: PRESET_DEFAULT,
    PRESETS: PRESETS,
    KEY_PRESET: KEY_PRESET,
    KEY_MIGRATED: KEY_MIGRATED,
    ALLOWED_LAYOUTS: ALLOWED_LAYOUTS,
    read: read,
    apply: apply,
    migrate: migrate,
    resolveLegacy: resolveLegacy,
    onChange: onChange
};
