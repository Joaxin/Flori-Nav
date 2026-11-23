/* ==========================================================================
   nav-i18n.js — 中英双语词条表（2026-11-23）
   设计边界：
   - 语言状态只有一份：cookie `nav_lang`（zh / en）。Django 的 LocaleMiddleware
     读同一个 cookie，所以后端 gettext 与前端词条表不会各说各话。
   - 中文是默认语言，中文界面不做任何 DOM 改动；只有 en 时才遍历文本节点。
   - 只替换「整段文本恰好等于词条」的节点，以及 data-tip / title / placeholder /
     aria-label 四个属性；站点名、简介、网址、标签云等用户内容一律跳过。
   - 不发网络请求、不写库；只读 cookie 与 localStorage 的兜底副本。
   - 新插入的节点（筛选、搜索、弹窗）由 MutationObserver 补翻，按帧合并。
   ========================================================================== */
(function () {
    'use strict';

    var COOKIE = 'nav_lang';
    var COOKIE_AGE = 365 * 24 * 3600;
    var SKIP_SELECTOR = [
        '.site-name', '.site-title', '.site-desc', '.site-url', '.site-meta',
        '.toc-num', '.tagcloud', 'pre', 'code', 'textarea',
        '[data-i18n-skip]'
    ].join(',');
    var ATTRS = ['data-tip', 'title', 'placeholder', 'aria-label'];

    /* ---------- 词条表（中文 → English） ---------- */
    var DICT = {
        /* 顶栏与快捷设置 */
        '更多工具与设置': 'More tools & settings',
        '更多': 'More',
        '快捷设置': 'Quick settings',
        '全部设置': 'All settings',
        '外观': 'Appearance',
        '排列': 'Layout',
        '显隐': 'Show / hide',
        '明暗': 'Light / dark',
        '自动': 'Auto',
        '浅色': 'Light',
        '深色': 'Dark',
        '皮肤': 'Theme',
        '背景特效': 'Background effects',
        '默认': 'Default',
        '极光': 'Aurora',
        '纸质': 'Paper',
        '日落': 'Sunset',
        '水墨': 'Ink',
        '简白': 'Plain',
        '书房': 'Study',
        '布局预设': 'Layout presets',
        '经典目录': 'Classic',
        '紧凑效率': 'Compact',
        '门户密度': 'Portal',
        '橱窗展示': 'Gallery',
        '移动优先': 'Mobile-first',
        '卡片': 'Cards',
        '大图标': 'Big icons',
        '媒体行': 'Media rows',
        '杂志': 'Magazine',
        '极简': 'Minimal',
        '分栏': 'Columns',
        '卡片布局': 'Card layout',
        '卡片密度': 'Card density',
        '紧凑': 'Compact',
        '舒适': 'Comfortable',
        '宽松': 'Relaxed',
        '简介行数': 'Description lines',
        '一行': 'One line',
        '两行': 'Two lines',
        '三行': 'Three lines',
        '卡片排序': 'Card order',
        '排序方式': 'Sort by',
        '默认顺序': 'Default order',
        '按常用度': 'Most used',
        '按名称': 'Name',
        '最近添加': 'Recently added',
        '显示内容': 'Visible content',
        '界面模式': 'Interface mode',
        '浏览': 'Browse',
        '专注': 'Focus',
        '逐项微调': 'Fine-tune',
        '左侧目录': 'Sidebar',
        '目录与页面': 'Sidebar & page',
        '页面宽度': 'Page width',
        '默认 1400px': 'Default 1400px',
        '铺满 100%': 'Full width 100%',
        '设置按钮': 'Settings button',
        '顶栏': 'Top bar',
        '左下角': 'Bottom left',
        '右下角': 'Bottom right',
        '交互': 'Interaction',
        '语言': 'Language',
        '中文': 'Chinese',
        '英文': 'English',
        '跟随系统': 'Follow system',
        '界面语言': 'Interface language',
        '切换后整页刷新，只影响这台设备': 'Reloads the page; affects this device only',

        /* 设置面板 tab 与小节 */
        '布局': 'Layout',
        '效果': 'Effects',
        '维护': 'Maintenance',
        '配色': 'Colors',
        '主题皮肤': 'Theme skins',
        '壁纸': 'Wallpaper',
        '页面效果': 'Page effects',
        '游客页内容': 'Guest page',
        '图标资产': 'Icon assets',
        '内置站点': 'Built-in sites',

        /* 目录 */
        '目录': 'Contents',
        '形态': 'Mode',
        '常驻侧栏': 'Docked sidebar',
        '抽屉': 'Drawer',
        '展开全部': 'Expand all',
        '折叠全部': 'Collapse all',
        '列表样式': 'List style',
        '时间轴': 'Timeline',
        '胶囊': 'Pills',
        '柔光': 'Soft glow',
        '缎带': 'Ribbon',
        '显示数量': 'Show counts',
        '显示二级分类': 'Show subcategories',
        '显示三级分类': 'Show third level',
        '显示左侧目录': 'Show sidebar',
        '目录宽度': 'Sidebar width',
        '自适应': 'Auto',
        '窄栏': 'Narrow',
        '白卡': 'Card',
        '分类与目录管理': 'Categories & sidebar',
        '更多目录设置': 'More sidebar settings',

        /* 卡片与站点操作 */
        '添加站点': 'Add site',
        '新建站点': 'New site',
        '编辑': 'Edit',
        '删除': 'Delete',
        '置顶': 'Pin',
        '上移': 'Move up',
        '下移': 'Move down',
        '换分类': 'Change category',
        '关闭': 'Close',
        '取消': 'Cancel',
        '确定': 'OK',
        '保存': 'Save',
        '保存排序': 'Save order',
        '恢复默认': 'Restore defaults',
        '还没有站点': 'No sites yet',
        '导入': 'Import',
        '导出': 'Export',
        '导入书签': 'Import bookmarks',
        '导出书签': 'Export bookmarks',
        '导入(JSON / 书签)': 'Import (JSON / bookmarks)',
        '整包备份': 'Full backup',
        '整包恢复': 'Full restore',
        '备份到文件夹': 'Back up to folder',
        '从文件夹恢复': 'Restore from folder',
        '上传工具': 'Upload tool',
        '链接测活': 'Check links',
        '本机统计': 'Local stats',
        '足迹热力图': 'Activity heatmap',
        '本地化全部图标': 'Cache all icons',

        /* 常见提示与空态 */
        '没有匹配的站点': 'No matching sites',
        '清除筛选': 'Clear filters',
        '加载中…': 'Loading…',
        '加载中...': 'Loading…',
        '请稍候': 'Please wait',
        '搜索': 'Search',
        '搜索站点或网址': 'Search sites or URLs',
        '最近使用': 'Recent',

        /* 设置面板：外观段 */
        '以下项目全部只存本机浏览器，不影响其他设备、不进导出文件。': 'These settings live in this browser only — they do not affect other devices and are not included in exports.',
        '本机偏好只存这台浏览器；管理员系统维护仅主人可用': 'Local preferences stay in this browser; system maintenance is owner-only.',
        '访客模式（本机暂存）：书签与外观只存这台浏览器；严格只读，不写服务器': 'Guest mode (local): bookmarks and appearance stay in this browser; strictly read-only, nothing is written to the server.',
        '主题色': 'Accent color',
        '从壁纸取色': 'Pick from wallpaper',
        '壁纸换色 → 主题色自动跟随': 'Wallpaper change → accent follows',
        '跟随主题(默认)': 'Follow theme (default)',
        '靛蓝': 'Indigo', '天蓝': 'Sky', '翠绿': 'Emerald', '琥珀': 'Amber', '赤红': 'Red', '紫罗兰': 'Violet',
        '自定义主题色': 'Custom accent',
        '分栏细节(选了「分栏」才生效)': 'Column details (active when Columns is selected)',
        '分几栏': 'Number of columns',
        '2 栏': '2 columns', '3 栏(默认)': '3 columns (default)', '4 栏': '4 columns',
        '每栏几列': 'Columns per group',
        '跟着宽度走(默认)': 'Follow width (default)',
        '一列': 'One', '两列': 'Two',
        '每个分类对齐顶部': 'Align each category to the top',
        '分栏里每条只有「图标 + 站名」一行，简介、标签、网址都不显示。': 'In Columns view each entry is a single icon + name line; description, tags and URL are hidden.',
        '布局细节(对「大图标」布局生效)': 'Icon layout details (applies to Big icons)',
        '每行最多': 'Max per row',
        '自动(随宽度)': 'Auto (by width)',
        '4 个': '4', '6 个': '6', '8 个': '8', '10 个': '10', '12 个': '12',
        '对齐方式': 'Alignment',
        '左对齐(铺满)': 'Left (fill)',
        '居中分段': 'Centered groups',
        '两端对齐(中间等距)': 'Justified',
        '等距分布': 'Space evenly',
        '图标大小': 'Icon size',
        '小 28': 'Small 28', '标准 34': 'Standard 34', '大 44': 'Large 44', '特大 56': 'XL 56',
        '图标间距': 'Icon spacing',
        '整页外观，差异明显': 'Whole-page looks, clearly different',
        '壁纸模式：明暗 / 皮肤 / 特效暂不可调；清除壁纸后恢复。': 'With a wallpaper on, light/dark, theme and effects are locked; clear it to change them.',
        '未设置壁纸': 'No wallpaper',
        '更换壁纸': 'Change wallpaper',
        '清除壁纸': 'Clear wallpaper',
        '无背景': 'No background',
        '遮罩浓度': 'Overlay opacity',
        '往主题底色方向压一层，提高壁纸上文字的可读性': 'Adds a theme-colored layer so text stays readable on the wallpaper',
        '模糊度': 'Blur',
        '高斯模糊壁纸本身；顶栏/卡片不受影响': 'Gaussian blur on the wallpaper only; top bar and cards stay sharp',
        '背景强度': 'Effect strength',
        '只调背景特效层的浓度，文字、卡片、目录不受影响': 'Adjusts the effect layer only; text, cards and sidebar are unaffected',
        '点击波纹': 'Click ripple',
        '桌宠物(小鲸鱼)': 'Desktop pet (whale)',
        '页面上一只小鲸鱼：点击说话、拖拽挪窝。': 'A little whale on the page — click to talk, drag to move.',
        '显示时钟问候': 'Clock & greeting',
        '自定义倒计时': 'Custom countdown',
        '字号': 'Font size',
        '(只放大文字，不改卡片列数)': '(Text only; card columns stay the same)',
        '(9 项)': '(9 items)',
        '小': 'Small', '大': 'Large', '特大': 'XL',
        '显示顶部搜索框': 'Show top search bar',
        '拼音首字母搜索': 'Pinyin initials search',
        '显示「最近使用」行': 'Show the Recent row',
        '显示「我的 HTML 工具」': 'Show My HTML tools',
        '卡片显示详细网址': 'Show full URL on cards',
        '网址显示': 'URL display',
        '单行截断(默认)': 'Single line (default)',
        '完整换行': 'Wrap fully',
        '卡片显示编辑 ✎ / 删除 × 按钮': 'Show edit / delete buttons on cards',
        '常显卡片操作按钮': 'Always show card actions',
        '显示站点标签': 'Show site tags',
        '显示「内置网站」分类': 'Show the “Built-in sites” category',
        '「内置网站」分类已隐藏，站点还在库里。': 'The “Built-in sites” category is hidden; its sites are still saved.',
        '重新显示': 'Show again',
        '显示体检状态': 'Show link status',
        '选左下或右下后，顶栏那个齿轮会变成页面角落的圆按钮，点开还是同一套设置。': 'Choosing bottom left / right turns the top-bar gear into a round corner button that opens the same settings.',
        '卡片操作：右键(触屏长按)打开菜单，可编辑 / 置顶 / 上移下移 / 换分类 / 删除': 'Card actions: right-click (or long-press) opens a menu to edit / pin / move / recategorize / delete',

        /* 顶栏菜单与维护工具 */
        'AI 找网站': 'AI site finder',
        'AI 分类': 'AI categorize',
        'AI 接口': 'AI API',
        '标签筛选': 'Tag filter',
        '本机数据': 'Local data',
        '整包恢复(本机)': 'Full restore (local)',
        '导出书签(HTML)': 'Export bookmarks (HTML)',
        '链接检测 / AI 提示词': 'Link check / AI prompt',
        '本机工具': 'Local tools',
        '保养维护(本机)': 'Maintenance (local)',
        '访客书签 JSON': 'Guest bookmarks JSON',
        '主人登录': 'Owner sign-in',
        '退出主人态': 'Exit owner mode',
        '游客页(只读)': 'Guest page (read-only)',
        '站点': 'Sites',
        '分类': 'Categories',
        '视图': 'View',
        '多选': 'Select',
        '清空': 'Clear',
        '星标': 'Starred',
        '添加搜索引擎': 'Add search engine',
        '全部展开': 'Expand all',
        '全部折叠': 'Collapse all',
        '正在查看:': 'Viewing:',
        '返回全部': 'Back to all',
        '在此分类新建站点': 'New site in this category',
        '重命名分类': 'Rename category',
        '隐藏这个分类': 'Hide this category',
        '显示这些站点': 'Show these sites',
        '无匹配结果，换个关键词试试': 'No matches — try another keyword',
        '选择图标': 'Choose icon',
        '纯色图标': 'Solid color',
        '在线获取': 'Fetch online',
        '本地图标': 'Local icon',
        '图标文字': 'Icon letter',
        '字体大小': 'Font size',
        '颜色': 'Color',
        '站点网址': 'Site URL',
        '点选一个候选作为图标': 'Click a candidate to use as the icon',
        '保存后继续添加': 'Save and add another',
        '选择大类…': 'Pick a category…',
        '填入该大类网址': 'Fill in that category URL',
        '全部填入并检测': 'Fill all and check',
        '最旧 50 条': 'Oldest 50',
        '继续上次体检': 'Resume last check',
        '含子网页': 'Include subpages',
        '测试结果': 'Results',
        '只看打不开': 'Broken only',
        '停止': 'Stop',
        '本机复测': 'Recheck locally',
        '开始检测': 'Start check',
        '链接检测': 'Link check',
        'AI 提示词': 'AI prompt',
        '粘贴导入': 'Paste to import',
        '检测全部': 'Check all',
        '只重测勾选': 'Recheck selected',
        '含休眠站': 'Include dormant',
        '全部': 'All',
        '失败': 'Failed',
        '未测': 'Untested',
        '可连': 'Reachable',
        '休眠': 'Dormant',
        '找替代网址': 'Find a replacement URL',
        '规范化网址': 'Normalize URLs',
        '补全分类标签': 'Fill category tags',
        '复制提示词与清单': 'Copy prompt and list',
        '解析预览': 'Parse preview',
        '仅补空字段': 'Fill empty fields only',
        '覆盖已有': 'Overwrite existing',
        '应用勾选条目': 'Apply selected items',
        '导入浏览器书签': 'Import browser bookmarks',
        '选择书签文件(.html)': 'Choose a bookmark file (.html)',
        '合并为一个站点': 'Merge into one site',
        '分别导入': 'Import separately',
        '上传本机 HTML 小工具': 'Upload a local HTML tool',
        '+ 上传本机 HTML 小工具': '+ Upload a local HTML tool',
        '每 5 分钟': 'Every 5 minutes',
        '每 10 分钟': 'Every 10 minutes',
        '待机': 'Idle', '吃饭': 'Eat', '玩耍': 'Play', '节日': 'Holiday', '表演': 'Perform',
        '网格': 'Grid',
        '壁纸模式：明暗 / 皮肤 / 特效暂不可调，清除壁纸后恢复。': 'With a wallpaper on, light/dark, theme and effects are locked; clear it to change them.',
        '跟随明暗调整深浅': 'Adjusts shade with light/dark',
        '导出 JSON': 'Export JSON',
        '工具名称': 'Tool name',
        '简介': 'Description',
        '标准': 'Standard',
        '大类': 'Category',
        '条数': 'Items',
        '展开/收起': 'Expand / collapse',
        '用自带 Key,候选只存本机': 'Bring your own key; candidates stay local',
        '重判本机书签,补齐标签': 'Re-tag local bookmarks',
        'AI 接口与对话': 'AI API & chat',
        '接口/Key/模型只存本机': 'Endpoint / key / model stay local',
        '按分类推荐，测活去重后导入': 'Recommend by category; check and dedupe before import',
        '重判分类，补齐标签，逐条采纳': 'Re-judge categories, fill tags, accept one by one',
        '添加本机站点': 'Add local site',
        '服务端数据': 'Server data',
        'HTML 工具': 'HTML tools',
        '我的 HTML 工具': 'My HTML tools',
        '本地托管': 'Local hosting',
        '（最大 2MB，仅存本地）': '(max 2 MB, stored locally)',
        '一次批量检测，不用逐个点': 'Batch check — no site-by-site clicking',
        '第 1 步：生成提示词并复制': 'Step 1: generate the prompt and copy it',
        '🎲 随机': '🎲 Random',
        '必应今日': 'Bing today'
    };

    var DICT_KEYS_BY_LEN = Object.keys(DICT).sort(function (a, b) { return b.length - a.length; });

    /* ---------- 语言读写 ---------- */
    function readLang() {
        var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
        var v = m ? decodeURIComponent(m[1]) : '';
        if (!v) {
            try { v = localStorage.getItem('navLang') || ''; } catch (e) {}
        }
        if (!v) {
            var attr = document.documentElement.getAttribute('data-nav-lang') || '';
            v = attr;
        }
        return v.indexOf('en') === 0 ? 'en' : 'zh';
    }

    function writeLang(lang) {
        lang = lang === 'en' ? 'en' : 'zh';
        try {
            document.cookie = COOKIE + '=' + lang + '; path=/; max-age=' + COOKIE_AGE + '; SameSite=Lax';
        } catch (e) {}
        try { localStorage.setItem('navLang', lang); } catch (e) {}
        return lang;
    }

    /* ---------- 文本替换 ---------- */
    function lookup(text) {
        if (!text) return null;
        if (Object.prototype.hasOwnProperty.call(DICT, text)) return DICT[text];
        return null;
    }

    function translateMultiLine(raw) {
        // data-tip 的多行说明用 \n 拼；逐行翻，任何一行没词条就保留原行
        var parts = String(raw).split('\n');
        var out = parts.map(function (line) {
            var t = line.trim();
            if (!t) return line;
            var hit = lookup(t);
            return hit ? line.replace(t, hit) : line;
        });
        return out.join('\n');
    }

    function translateNode(node) {
        var raw = node.nodeValue;
        if (!raw) return;
        var lead = raw.match(/^\s*/)[0];
        var tail = raw.match(/\s*$/)[0];
        var core = raw.trim();
        if (!core) return;
        var hit = lookup(core);
        if (hit) {
            node.nodeValue = lead + hit + tail;
            return;
        }
        // 长句里夹着可译短语时不做替换：避免把用户自己写的中文段落拆坏
    }

    function insideSkipped(el) {
        if (!el || !el.closest) return false;
        return !!el.closest(SKIP_SELECTOR);
    }

    function walk(root) {
        if (!root) return;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                var p = n.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                var tag = p.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
                if (insideSkipped(p)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var n;
        while ((n = walker.nextNode())) translateNode(n);
    }

    function translateAttrs(root) {
        if (!root || !root.querySelectorAll) return;
        ATTRS.forEach(function (attr) {
            if (root.hasAttribute && root.hasAttribute(attr) && !insideSkipped(root)) {
                var v0 = root.getAttribute(attr);
                var t0 = translateMultiLine(v0);
                if (t0 !== v0) root.setAttribute(attr, t0);
            }
            root.querySelectorAll('[' + attr + ']').forEach(function (el) {
                if (insideSkipped(el)) return;
                var v = el.getAttribute(attr);
                var t = translateMultiLine(v);
                if (t !== v) el.setAttribute(attr, t);
            });
        });
    }

    function translateAll() {
        walk(document.body);
        translateAttrs(document.body);
        paintLangButtons();
    }

    /* ---------- 动态节点 ---------- */
    var observer = null;
    var pending = [];
    var rafId = 0;

    function flush() {
        rafId = 0;
        var list = pending; pending = [];
        list.forEach(function (node) {
            if (!node || !node.isConnected) return;
            if (node.nodeType === 1) {
                walk(node);
                translateAttrs(node);
            } else if (node.nodeType === 3) {
                if (node.parentElement) translateNode(node);
            }
        });
    }

    function schedule(node) {
        if (!node) return;
        pending.push(node);
        if (pending.length > 60) { flush(); return; }
        if (!rafId) rafId = requestAnimationFrame(flush);
    }

    function observe() {
        if (observer || !window.MutationObserver) return;
        observer = new MutationObserver(function (records) {
            records.forEach(function (r) {
                if (r.type === 'childList') {
                    r.addedNodes.forEach(function (n) { schedule(n); });
                } else if (r.type === 'attributes' && ATTRS.indexOf(r.attributeName) >= 0) {
                    schedule(r.target);
                }
            });
        });
        observer.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ATTRS
        });
    }

    /* ---------- 语言按钮 ---------- */
    function paintLangButtons() {
        var group = document.getElementById('navLangGroup');
        if (!group) return;
        var lang = readLang();
        group.querySelectorAll('.btn').forEach(function (btn) {
            var on = String(btn.getAttribute('data-nav-lang')) === lang;
            btn.classList.toggle('btn-secondary', on);
            btn.classList.toggle('btn-outline-secondary', !on);
        });
    }

    function setLang(lang) {
        writeLang(lang);
        // 后端 LocaleMiddleware 与模板 gettext 都靠这个 cookie，重载后整页一致。
        // 若当前 URL 带着 ?lang= 预览参数，必须先去掉它再跳转——否则 query 会盖住 cookie，
        // 点了「English」看起来没反应。
        try {
            var url = new URL(window.location.href);
            if (url.searchParams.has('lang')) {
                url.searchParams.delete('lang');
                window.location.replace(url.toString());
                return;
            }
        } catch (e) {}
        window.location.reload();
    }

    function bindLangGroup() {
        var group = document.getElementById('navLangGroup');
        if (!group) return;
        if (group.dataset.navI18nBound === '1') return;
        group.dataset.navI18nBound = '1';
        group.addEventListener('click', function (e) {
            var btn = e.target.closest('.btn');
            if (!btn) return;
            var v = btn.getAttribute('data-nav-lang');
            if (!v) return;
            setLang(v);
        });
        paintLangButtons();
    }

    /* ---------- 启动 ---------- */
    function boot() {
        bindLangGroup();
        if (readLang() !== 'en') return;
        translateAll();
        observe();
    }

    window.NavI18n = {
        getLang: readLang,
        setLang: setLang,
        translate: translateAll,
        // 动态文案用：navT('保存') → 'Save'；没有词条原样返回
        t: function (zh) { return readLang() === 'en' ? (DICT[zh] || zh) : zh; },
        dict: DICT
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
