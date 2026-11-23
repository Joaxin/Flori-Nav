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
        '编辑站点': 'Edit site',
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
        '内置网站': 'Built-in sites',
        '我的 HTML 工具': 'My HTML tools',
        '本地托管': 'Local hosting',
        '（最大 2MB，仅存本地）': '(max 2 MB, stored locally)',
        '一次批量检测，不用逐个点': 'Batch check — no site-by-site clicking',
        '第 1 步：生成提示词并复制': 'Step 1: generate the prompt and copy it',
        '🎲 随机': '🎲 Random',
        '必应今日': 'Bing today',

        /* ---------- 2026-11-23 补:添加/编辑站点弹窗(表单字段、占位符、按钮) ---------- */
        '名称': 'Name',
        '网址': 'URL',
        '二级分类': 'Subcategory',
        '(可选)': '(optional)',
        '三级': 'Level 3',
        '标签': 'Tags',
        '(可选,逗号分隔,最多 8 个;点卡片上的标签可按标签筛选)': '(optional, comma-separated, up to 8; click a card tag to filter)',
        '抓取': 'Fetch',
        '识别标题/图标': 'Detect title/icon',
        '选择图标': 'Choose icon',
        '抓取对方首页的 <title>、favicon 和 description': "Fetch the site's <title>, favicon and description",
        '选择图标:纯色文字 / 在线获取 / 本地上传': 'Choose icon: color letter / online / upload',
        '按网址抓取对方网站的 meta description': "Fetch the site's meta description",
        '高级选项(子网页 / 备用网址)': 'Advanced (sub-pages / alternate URLs)',
        '子网页 / 子站点': 'Sub-pages / sub-sites',
        '自定义': 'Custom',
        '(可选,点击卡片时弹窗选择)': '(optional, pick in the card dialog)',
        '添加子页': 'Add sub-page',
        '备用网址 / 镜像': 'Alternate URLs / mirrors',
        '(可选,同一站点资源站/备份/新域名等,卡片弹窗可选)': '(optional: mirror, backup domain, etc.)',
        '添加备用网址': 'Add alternate URL',
        '保存后继续添加': 'Keep adding after save',
        '关闭此表单': 'Close this form',
        '再加一个站点表单(批量添加，最多 20 个)': 'Add another site form (batch add, max 20)',
        '「识别标题/图标」只回填名称与图标；简介旁的「抓取」只回填简介。': '“Detect title/icon” fills only the name and icon; “Fetch” next to the description fills only the description.',
        '例如： DHL Express': 'e.g. DHL Express',
        'dhl.com(自动加 https://)': 'dhl.com (https:// added automatically)',
        '输入新名称即新建': 'Type a new name to create one',
        '如:视频': 'e.g. Video',
        '如:图生视频': 'e.g. Image-to-video',
        '一句话说明用途': 'One line on what it is for',
        '如:免费,常用,推理': 'e.g. free, common, reasoning',
        '站点': 'Site',
        '个表单': 'forms',
        '最多': 'Up to',
        '先填写网址': 'Fill in the URL first',
        '抓取失败,可手动填写': 'Fetch failed — fill it in manually',
        '已填入简介': 'Description filled',

        /* ---------- 2026-11-23 补:设置面板(维护 / 排序 / 内容) ---------- */
        '本机排序': 'Local order',
        '本机偏好 · 分类排序': 'Local preferences · Category order',
        '调顺序/显隐后点"保存排序"生效；隐藏的分类不在页面显示': 'Reorder or hide, then click “Save order”; hidden categories stay off the page.',
        '只调整这台浏览器上的分组顺序与显隐，不写主人库；保存后刷新保持。不含管理员开关。': 'Reorders and hides groups on this browser only; nothing is written to the library. It does not touch admin switches.',
        '显示范围': 'Visibility scope',
        '公开：全部未隐藏站点': 'Public: all visible sites',
        '仅内置站点': 'Built-in sites only',
        '保存并刷新访客页': 'Save and refresh the guest page',
        '只影响访客页公开快照；主人页始终显示全部站点。切换「仅内置站点」后，快照只包含内置清单里的站点。': 'Affects the guest snapshot only; the owner page always shows every site. With “Built-in sites only”, the snapshot contains just the built-in list.',
        '图标本地化': 'Icon localization',
        '一键本地化': 'Localize all',
        '把内置清单里新增的站点补进数据库，不影响你自定义的条目。': 'Adds new built-in sites to the database; your own entries are untouched.',
        '恢复内置站点': 'Restore built-in sites',
        '管理员系统维护': 'Admin maintenance',
        '显示卡片编辑 / 删除小按钮': 'Show card edit / delete buttons',
        '左侧目录的显隐、样式和层级，都在本页「目录与页面」里设置；快捷设置的「显隐」里也有一个开关。': 'Sidebar visibility, style and depth live in “Sidebar & page”; the quick Show / hide panel has a switch too.',
        '也可以到 ⚙ 设置 →「分类排序」里点眼睛图标恢复。': 'You can also restore it in ⚙ Settings → Category order with the eye icon.',
        '还没有站点，点右上角"添加站点",或在 ⚙ 设置里"恢复内置站点"。': 'No sites yet. Click “Add site” at the top right, or “Restore built-in sites” in ⚙ Settings.',
        '选择图片(≤300KB,存本机服务)': 'Choose an image (≤300 KB, stored locally)',
        '(跟随「显示时钟问候」开关，只存这台浏览器)': '(follows the clock greeting switch; this browser only)',
        '上传': 'Upload',
        '添加': 'Add',
        '复制': 'Copy',
        '模型': 'Model',
        '自定义搜索引擎': 'Custom search engine',
        '搜索网址模板': 'Search URL template',
        '已添加的自定义引擎(换浏览器/清缓存后需重加):': 'Engines you added (clearing storage removes them):',
        '上传 HTML 单文件工具': 'Upload a single-file HTML tool',
        'HTML 文件': 'HTML file',
        '编辑工具': 'Edit tool',
        '选择书签文件(.html)': 'Choose a bookmark file (.html)',

        /* ---------- 2026-11-23 补:链接检测 / 导入 / AI 弹窗 ---------- */
        '网址列表(可粘贴整段文本，自动提取网址；超 32 条自动分批，可中断续测)': 'URL list (paste a whole paragraph; URLs are extracted; batches of 32, resumable)',
        '批量测活 · 复制提示词 · 粘贴回复预览后写库': 'Batch check · copy prompt · paste reply, preview, save',
        '把清单发给任意 AI,再把整段回复粘回「粘贴导入」页签;提示词可直接在上方文本框里改。': 'Send the list to any AI, paste the whole reply into “Paste to import”; edit the prompt in the box above.',
        '解析收藏夹 HTML,预览后入库': 'Parse a bookmark HTML, preview, then import',
        '文件夹 → 大类/小分类；没有文件夹的书签进「未分类」;与导航里已有的网址相同会走更新不新建': 'Folders → category/subcategory; loose bookmarks go to “Uncategorized”; existing URLs are updated, not duplicated',
        '合并后分类以第一次出现的那条为准，其余网址作为它的子网页；库里已经单独存在的同类站点不会自动删除': 'After merging, the first occurrence becomes the parent; other URLs become sub-pages; separate existing sites are kept',
        '导入时抓取网站简介(meta description)': 'Fetch descriptions (meta description) when importing',
        '逐条访问每个网址读简介，条数多时要等几分钟；有些站会拒抓(403)或超时，失败就保留书签原有简介': 'Visits each URL for its description; many URLs take minutes; 403s and timeouts keep the bookmark description',
        '全站共用：找网站 · 桌宠': 'Shared: site finder · pet',
        '填一份 OpenAI 兼容接口（DeepSeek 只是最常见的例子）。「AI 找网站」和桌宠的聊天、AI 碎碎念、查余额都用这一份。': 'One OpenAI-compatible endpoint (DeepSeek is just the usual example) powers “AI site finder”, pet chat, musings and balance checks.',
        '不接也完全不影响': 'Optional — nothing breaks',
        '——找网站有手动模式，桌宠本地碎碎念、动画、互动一切照旧。': '— the site finder has a manual mode; the pet still muses, animates and interacts locally.',
        '接口状态': 'Endpoint status',
        '检测中': 'Checking',
        '💰 查余额': '💰 Balance',
        '接口地址（Base URL）': 'Endpoint (Base URL)',
        '检测模型': 'Detect models',
        '可用 0/0': 'Available 0/0',
        '测试全部': 'Test all',
        '填好接口地址后自动检测（如 Magpie：http://127.0.0.1:3425/v1）': 'Detected automatically once the endpoint is set (e.g. Magpie: http://127.0.0.1:3425/v1)',
        '高级：按任务分配模型（可选，空 = 跟随默认模型）': 'Advanced: model per task (optional; empty = default)',
        '分类模型': 'Categorization model',
        '清除记忆（不可恢复）': 'Clear memory (cannot be undone)',
        '测当前模型': 'Test current model',
        '最近 AI 调用（排查用，只留摘要）': 'Recent AI calls (debugging, summaries only)',
        '刷新记录': 'Refresh log',
        '接口挂了 / 模型拒答 / 解析失败，这里能看出是哪一步': 'Endpoint down / refusal / parse failure — see which step failed here.',
        '小分类(可选)': 'Subcategory (optional)',
        '(不指定，大类直属)': '(none — directly under the category)',
        '代理(可选)': 'Proxy (optional)',
        '补充要求（类似网站 / 额外限制，可不填）': 'Extra requirements (similar sites / limits, optional)',
        '生成候选网站': 'Generate candidates',
        '无 API 手动模式': 'No-API manual mode',
        '— 没配接口也能用：提示词复制到任意 AI,回复粘贴回来': '— works without an endpoint: copy the prompt to any AI, paste the reply back',
        '第 3 步：解析并预览（预览后照常测活并导入）': 'Step 3: parse and preview (then check and import)',
        '生成候选后在这里测活并导入': 'Check and import after generating',
        '测活并导入所选': 'Check and import selected',
        '只列建议调整的条目，逐条决定是否采纳': 'Only suggested changes; accept one by one',
        '范围': 'Scope',
        '全部站点': 'All sites',
        '未分类(含「自定义」)': 'Uncategorized (incl. custom)',
        '指定大类…': 'Pick a category…',
        '开始分类': 'Start categorizing',
        '条数是一次处理总量；超过 40 条会自动分批（每批 40 条），不会截断。': 'Count is the total per run; over 40 is split into batches of 40, never truncated.',
        '没配 AI 接口?': 'No AI endpoint?',
        '复制提示词去任意 AI 跑，回复整段粘回来': 'Copy the prompt to any AI and paste the whole reply back',
        '第 3 步：解析并对比': 'Step 3: parse and compare',
        'AI 分类 + 标签': 'AI categories + tags',

        /* ---------- 2026-11-23 补:按钮 tooltip / aria(多行说明按行匹配,见 translateMultiLine) ---------- */
        '打开目录': 'Open sidebar',
        'AI 工具': 'AI tools',
        'AI 找网站 / 重新分类 / 配置接口': 'AI site finder / re-categorize / endpoint settings',
        '手动添加一条本机书签': 'Add a local bookmark',
        '只存这台浏览器，不写服务器': 'Stored in this browser only',
        '网址 + 名称 + 分类，批量最多 20 个': 'URL + name + category; up to 20 at a time',
        '体检篮（本机）': 'Health basket (local)',
        '待清理 / 待测活的站点': 'Sites to clean up / to check',
        '体检发现打不开的站会叼到这里，逐个修 URL 或删除': 'Sites that fail the check land here — fix the URL or delete them',
        '上传 HTML 工具 / 链接测活 / 数据导入导出': 'Upload HTML tools / link check / import & export',
        '标签管理': 'Tag manager',
        '多选 = 同时满足，可与搜索框叠加过滤': 'Multiple tags = AND; stacks with the search box',
        '多选模式': 'Multi-select',
        '勾选卡片后可批量打开、收藏、分类或删除': 'Tick cards to open, star, categorize or delete in bulk',
        '批量选择': 'Multi-select',
        '导入浏览器书签（HTML）或 JSON': 'Import bookmarks (HTML) or JSON',
        '书签 / 工具 / 分组 / 外观 / 桌宠 / 足迹': 'Bookmarks / tools / groups / appearance / pet / history',
        '打包成一个文件': 'packed into one file',
        '不含 API Key,换机需重填': 'API keys excluded; re-enter on a new device',
        '用浏览器 File System 选一个本地文件夹': 'Pick a local folder with the File System API',
        '整包备份直接写进去;不经过服务器': 'Backups are written straight in; no server involved',
        '列出指定文件夹里的整包备份,确认后覆盖恢复': 'List backups in that folder and restore over this browser',
        '需要 Chrome / Edge 等 Chromium 浏览器': 'Requires Chrome / Edge (Chromium)',
        '从整包备份文件恢复这台浏览器的本机数据(覆盖式)': 'Restore this browser from a backup file (overwrites)',
        '浏览器收藏夹格式 HTML': 'Browser bookmark HTML',
        '书签全字段 / 工具元数据 / 分组顺序与隐藏 / 本机偏好': 'All bookmark fields / tool metadata / group order & hidden / local prefs',
        '打包成 JSON': 'packed as JSON',
        'AI Key 默认不导出明文;工具 HTML 一并纳入,文件可能偏大': 'API keys stay masked by default; tool HTML is included, so files can be large',
        '本机书签的使用与点击统计': 'Usage and click stats for local bookmarks',
        '只读写这台浏览器，不发请求': 'Reads and writes this browser only',
        '本机足迹的点击热力图': 'Click heatmap of local history',
        '本机书签保养分组 / 体检记录 / 网址规整,只读写这台浏览器': 'Local bookmark maintenance groups / health log / URL cleanup, all local',
        '把书签图标抓回本机 IDB 缓存': 'Cache bookmark icons in local IDB',
        '受浏览器跨域限制,不能保证全部成功;不做任何服务端下载;缓存随整包备份一起走': 'Cross-origin limits apply; nothing downloads server-side; the cache travels with backups',
        '上传 HTML 工具': 'Upload HTML tool',
        '支持 .html / .htm,单个最大 2MB;数据仅存本机': 'Supports .html / .htm up to 2 MB; data stays local',
        '批量检测网址是否还能打开': 'Batch-check whether URLs still work',
        '批量检测链接、复制 AI 提示词、粘贴回复预览后写库': 'Batch link check, copy the AI prompt, paste and preview the reply',
        '只导出你自定义的站点与工具，不含内置站点': 'Exports only your own sites and tools, not built-in ones',
        '导入 JSON / 浏览器书签，只新增或更新': 'Import JSON / bookmarks; add or update only',
        '大类 / 小分类变成文件夹，浏览器「导入收藏夹」可读回': 'Categories become folders readable by browser bookmark import',
        '站点范围与 JSON 导出一致': 'Same site set as the JSON export',
        '本机设置 / 外观 / 桌宠 / 足迹': 'Local settings / appearance / pet / history',
        '打包成一个文件(不含服务端站点库)': 'packed into one file (server site library excluded)',
        '只读访客页：默认站点来自公开快照，导入只存对方浏览器': 'Guest view: sites come from the public snapshot; imports stay in that browser',
        '跟随系统的明暗设置': 'Follow the system light/dark setting',
        '始终浅色，不跟系统': 'Always light, ignore the system',
        '始终深色，不跟系统': 'Always dark, ignore the system',
        '红色': 'Red', '橙色': 'Orange', '黄色': 'Yellow', '绿色': 'Green',
        '青色': 'Cyan', '蓝色': 'Blue', '紫色': 'Purple', '粉色': 'Pink',
        '自定义颜色': 'Custom color',
        '默认蓝灰': 'Default blue-grey',
        '冷色渐变、轻发光': 'Cool gradient with a soft glow',
        '米白纸感、柔边框': 'Paper white with soft borders',
        '暖橙紫、低饱和': 'Warm orange-purple, low saturation',
        '黑白墨色、强对比': 'Ink black and white, high contrast',
        '纯白极简、去装饰': 'Pure white, minimal',
        '深木色、暖黄光': 'Dark wood with warm light',
        '页面分类': 'Page categories',
        'DeepSeek 等兼容接口，全站共用': 'OpenAI-compatible endpoint, shared site-wide',
        '同时满足才显示，可叠加搜索过滤': 'All selected tags must match; stacks with search',
        '体检篮': 'Health basket',
        '死链篮': 'Dead links',
        '保养': 'Maintenance',
        'URL 卫生': 'URL hygiene',
        '唤醒': 'Wake',
        '收起来的站不在分类里，但数据一条没动；点「唤醒」就回到原来的分类。': 'Dormant sites leave the categories but keep all data; “Wake” puts them back.',
        '还没有休眠的站。在上方保养列表里点 💤 就能把不想看见的站先收起来，不用删。': 'No dormant sites. Click 💤 in the maintenance list to tuck a site away without deleting it.',
        '支持 .html / .htm 单文件，最大 2MB；工具自己存在 localStorage 的数据按': 'Supports single .html / .htm files up to 2 MB; tool localStorage data is keyed by',
        '本站域名': "this site's domain",
        '共享(不是按文件隔离)，重命名工具不会丢它的数据。名称/简介/图标留空时自动从文件里的 <title>、meta description、favicon 提取。': "shared (not per file), so renaming keeps its data. Empty name/description/icon are read from the file's <title>, meta description and favicon.",
        '只改这几项：托管地址与文件本身不动，工具存在本机的数据照常保留。': 'Only these fields change; the hosted URL and file stay put, and local tool data is kept.',
        '语法：把搜索词所在的位置写成': 'Syntax: put the placeholder where the query goes',
        ',搜索时自动替换成关键词。例:': ', replaced with the keyword at search time. e.g.',
        '找网站固定用上面的默认模型；这里只覆盖分类，建议选低温、稳定的模型。桌宠模型在「宠物设置 → 💬 聊天」里改。': 'Site finding always uses the default model; this only overrides categorization — a low-temperature, stable model works best. The pet model lives in Pet settings → 💬 Chat.',
        '「AI 找网站」弹窗里的接口设置是同一份，两边改都生效；桌宠人设、记忆轮数、桌宠模型、碎碎念开关在「宠物设置 → 💬 聊天」里改。': 'The endpoint in the “AI site finder” dialog is the same one; changes apply both ways. Pet persona, memory turns, model and musings live in Pet settings → 💬 Chat.',
        '生成候选 → 自动测活 → 去重导入': 'Generate → auto-check → dedupe and import',
        '30 秒内未选择,将自动打开主站': 'Main site opens automatically if nothing is picked in 30 s',
        '背景皮肤': 'Background theme',
        '无': 'None',
        '还没有倒计时': 'No countdowns yet',
        '↑↓ 选择 · Enter 执行 · Esc 关闭': '↑↓ select · Enter run · Esc close',
        '🎲 随机来一个': '🎲 Surprise me',
        '🎬 动作点播…': '🎬 Request an action…',
        '🍚 喂食': '🍚 Feed',
        '❤️ 状态': '❤️ Status',
        '🎭 演出与声音': '🎭 Perform & sound',
        '🖼 来张表情包': '🖼 Send a sticker',
        '🌊 海浪声': '🌊 Waves',
        '🌧 雨声': '🌧 Rain',
        '🔔 通知测试': '🔔 Test notification',
        '⌨️ 指令列表': '⌨️ Command list'
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
