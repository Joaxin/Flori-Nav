# nav — 网址导航(通用 Django app,可整包移植)

内置 + 自定义网址导航卡片页:三级分组(大类 → 二级 → 三级/直属站点)、分类排序与显隐、
站点编辑、子网页/备用网址(镜像/资源站)弹窗、favicon 自动抓取、一键链接测活(支持代理,
超时/预算可临时调,附"内容新地址"迁移检测)、JSON v10 导入导出、浏览器书签 HTML 导入导出、游客只读 JSON 快照、
站点休眠(收起来不进分类,数据一条不动)、
站点标签(卡片徽章 + 按标签筛选)、日历 + 自定义倒计时(挂时钟问候开关)、单文件 HTML 小工具托管。
通用网址导航 app，不含任何特定行业业务逻辑，种子站点在 `nav_data.py` 可按项目替换。

## 移植四步(2026-10-16 真实冒烟校正:原写"三步"漏了静态目录配置)

1. 把 `nav/` 整个文件夹复制到目标项目根目录(与 manage.py 同级);再把宿主的 `static/vendor/`(jQuery + Font Awesome,含 `webfonts/`)拷到目标项目的 `static/vendor/`
2. `settings.py`:
   - `INSTALLED_APPS` 加 `'nav'`
   - `STATICFILES_DIRS = [BASE_DIR / 'static']` —— **必须**。`startproject` 默认是空列表,不配的话根 `static/` 不在查找路径里 → vendor 一律 404 → jQuery 为 null → **页内所有交互静默失效**(页面看着正常,点什么都没反应)
   - `MEDIA_ROOT = BASE_DIR / 'media'` —— 工具上传用;Django 有默认空值,建议显式配
3. 根 `urls.py` 加一行:`path('', include('nav.urls')),`
4. `python manage.py migrate`

**成功判据**(2026-10-16 在全新 `startproject` 项目里实测通过,可照此验收):
- `python manage.py test nav` → **316 个测试全绿**(这份测试就是移植契约;2026-11-11 复测)
- 视图与测试都按域拆好了,移植时整包拷贝即可:`views.py` 是回填门面,实现分在 `views_nav_{base,sites,assets,check,export,tools,ai,pet,guest}.py`;测试分在 `tests_nav_{sites,ai,health,icons,pet,shell,guest}.py`(公共底座 `tests_nav_common.py`)
- 5 个静态资源全 200:`/static/vendor/js/jquery-3.7.1.min.js`、`/static/vendor/css/all.min.css`、`/static/vendor/webfonts/fa-solid-900.woff2`、`/static/css/tailwind.gen.css`、`/static/bootstrap-shim.js`
- 浏览器打开 `/nav/`:`typeof window.jQuery === 'function'`、过滤/零命中提示/清空还原/标签面板/添加站点弹窗全部可用、**console 无错误**
- 首次访问自动按 `nav_data.DEFAULT_SITES` 播种内置站点(实测 88 个)

零额外配置:页面自带独立壳的 CSS/JS —— Tailwind v4 **预编译产物**
(`assets/tailwind.css` → `nav/static/css/tailwind.gen.css`,改样式跑 `pnpm build:css`)+ 手写的
Bootstrap 兼容垫片(`nav/static/bootstrap-shim.js`:Modal/Dropdown/Offcanvas/Tooltip/Tabs/Alert)。
浏览器版运行时 `tailwind.browser.js`(275 KB,页面内实时编译)已于 2026-11-12 删除,别再加回去。
**无 CDN、离线可打开**,跟随系统明暗;代码层面**零宿主 import**(不依赖 searchapp/content_engine/kb),
settings 只读 `NAV_BASE_TEMPLATE`/`NAV_LINK_TOTAL_TIMEOUT`(都有默认值)/`MEDIA_ROOT`。
> ⚠️ jQuery/Font Awesome 是独立壳**唯一**的外部依赖:目标项目若没有 `static/vendor/js/jquery-3.7.1.min.js` 和
> `static/vendor/css/all.min.css`(图标还额外依赖同目录 `webfonts/` 字体),卡片照样能显示(服务端渲染),
> 但页内所有交互(过滤/拖拽/设置/弹窗/桌宠)会因为 jQuery 是 null 全部失效,图标位置显示成空白方框。
> 移植时把宿主 `static/vendor/` 整个拷过去,或改 `nav/templates/nav/base.html` 那两行 `static` 引用。

## 外观(全部本机 localStorage,不碰服务端)

- 卡片布局六选一(设置 → 显示):`卡片`(默认)/`大图标`(无边框、悬停浮起,类 Flame,可再配每行最多 N、对齐方式、图标大小、间距四档细节)/`紧凑列表`(一行一项,类 Dashy)/`杂志`(两列宽卡 + 完整简介)/`极简`(纯文字行),键 `navLayout`。网格列数 `auto-fill` 自适应窗口宽度。
- 主题色:预设 6 色均为**明暗双档**(暗色主题自动切到提亮档,自定义取色器在暗色下自动 mix 提亮),统一驱动 `--nav-accent` token —— 卡片、目录、按钮(primary/outline-primary)、输入框聚焦、开关、badge、弹窗全部跟随,不再和 Bootstrap 蓝混排;键 `navAccent`,清空=跟随宿主主题。
- **界面模式**(设置 → 显示,主控制):`浏览`(默认,露时钟/目录/搜索/最近)/`专注`(只留卡片,时钟/目录/搜索/最近全隐)。一键写好下面的显示开关,想单独调某项就展开「逐项微调」。模式本身不落键,当前档位由这些开关反推(所以刷新后仍然一致)。
  开关 = `navShowClock`(时钟问候,默认开)/`navShowToc`(左侧目录,默认开)/`navShowSearch`(居中大搜索框,默认开)/`navShowRecent`(最近使用,默认开)/`navShowUrl`(卡片详细网址,默认关)/`navShowActions`(常显卡片编辑/删除按钮,默认关:默认悬停卡片才出);存 `'1'`/`'0'`;逐项微调到与两个模式都不一致时,界面模式 行显示「当前:自定义(逐项微调过)」。旧键 `navShowEdit`/`navShowDelete` 任一为 1 会一次性迁移到 `navShowActions=1`。另有总开关 `navShowCardActions`(默认开):关掉后卡片右上角 ✎ / × 彻底不出现——悬停、常显、触屏都不出(`.hide-actions`),编辑/删除改走卡片右键菜单;它关着时「常显」开关置灰。
- 主题皮肤七套(默认/极光/纸质/日落/水墨/简白/书房):`body[data-nav-theme]` 覆盖变量 + `!important` 表面模式,每套连圆角/边框/密度/字体一起换;皮肤按钮在 ⚙「外观」分区与设置面板双向同步,键 `navTheme`。浅色皮肤(纸质/日落/水墨/简白/书房)各有一套夜间版:深色档下保留强调色、衬线字体与纹理,只把纸白/米白换成同色系暗面——否则皮肤在 body 上的 token 与 `!important` 纸面会把「外观 → 明暗」整个压掉(2026-11-19 修)。极光本身是暗色皮肤,不参与夜间翻转。
- 快捷设置下拉(2026-11-19 重排):按 **外观**(明暗 / 皮肤 / 背景特效)、**排列**(6 种布局)、**显隐**(浏览/专注 + 左侧目录)三段分区,底部「全部设置 →」进右侧抽屉;`#navQuickSettingsMenu` 的 `auto-close=outside`,点分区内控件不收菜单。
- 壁纸(设置 → 壁纸 独立 tab):图源三档(本机上传 / 🎲 picsum 随机 / 必应今日,走服务端代理 `api_nav_bing_bg` 规避 CORS)、遮罩浓度 0-90%(`#navWallMask`)、模糊度 0-30px(`#navWallLayer` 独立壁纸层,body 背景不能单独 filter)、下载原图;前端 canvas 取色出最多 5 色色片喂给主题色,可开「壁纸换色→主题色自动跟随」。键 `navBgSource`/`navWallMask`/`navWallBlur`/`navWallPalette`。
- 顶部搜索引擎框:内置引擎清单配置在 `nav_data.NAV_SEARCH_ENGINES`(`{query}` 为占位符);用户也可在搜索框右侧 **+** 弹出的窗口里添加/删除自定义引擎(模板必须含 `{query}`,只存本机 `navEngines`,不进服务端与导出 JSON)。选中的引擎记住在本机(键 `navSearchEngine`),回车/点按钮在新标签页打开。
- 卡片图标:站点自己的 favicon(添加时自动抓取)优先 → `favicon.im` 兜底 → 失败再级联 Google s2(挂代理时可用)→ 仍失败换成**首字母色块**(颜色按名称哈希),永不留白。抓不到图标时可手动「选择图标」:纯色字母图标(文字≤8 字 + 8 色板/自定义色 + 字号 20-64)、在线候选点选、本地图标上传(≤300KB,存 `MEDIA_ROOT/nav_favicons/`,内容 md5 命名去重)——落库为 `icon_text`/`icon_color`/`icon_size` 三字段,进导出 JSON。全站热链图标另可一键本地化(`/api/nav/favicon-localize/`,≤200 张,失败保持热链)。
- 目录跟随滚动:浏览时左侧目录自动高亮当前分类/小分类(accent 左边条 + 8% 染色);搜索无命中时显示"无匹配结果"并连同空小分类一起隐藏;主题/配色切换带 .25s 过渡。(参考 nav_ultimate 布局手法,2026-09-23)
- 顶栏布局:第一行(紫底 sticky 顶栏)= 汉堡(仅手机)+「共 N 个站点 · N 个工具」计数 左,标签筛选、AI 菜单、添加站点、体检篮、多选、更多(上传工具/链接测活/导入导出)、⚙ 快捷设置 右;第二行 = 居中大搜索框(720px,全网搜索)+ 其下星标/最近 chips 行。2026-11-19 收敛:🎨 皮肤撤销独立入口,并入 ⚙「外观」分区;主链只留高频动作。折叠箭头(大类/小分类/目录二级)默认隐藏,悬停标题才显现,折叠状态常显;工具区空提示压成一行小灰字虚线框。手机端(<768px)目录收进汉堡唤出的抽屉。
- 「卡片显示详细网址」开关统一控制**六种布局**的 URL 显隐:卡片=简介下方整行;大图标=名称下方小字;紧凑列表=开=完整 URL 换行,关=隐藏(紧凑列表曾无视开关常显,已修并有测试锁住)。
- **大图标布局(2026-11-19 修「白方块大小不一 / 站名跑到块外」)**:favicon 外面包着一层 `.site-favwrap`,而整个包装又塞在 `.site-name` 里——只给 `.site-fav` 设 `display:block` 没用,包装盒仍是行内盒,图标与站名挤在同一行,长站名被卡片宽度裁掉、首字母兜底块的大小也跟着乱。现在 `.lyr-icon` 下把包装盒与文字列都改成块级(图标 `--icon-favsize` 居中独占一行,`.site-title` 再单独裁两行);同时挡住皮肤(`!important`)给 `.site-card` 刷实底——文件末尾一条 `.nav-hub.lyr-icon .site-card` 覆盖:平时透明,悬停才出主题色淡染,纸质/极光下才真的是「悬浮图标」而不是一排白/深色方块。
- 工具上传自动提取:名称/简介留空时自动取文件里的 `<title>` / meta description(og:description 兜底);图标只认 `data:image/...`(≤2000 字符)或绝对 http(s) favicon 地址,相对路径对本地单文件无意义直接丢弃;手动填了则以手动为准。图标存 `NavTool.favicon`,卡片左上角显示,导出/导入 JSON 一起带走(tools 多一个 `favicon` 键,旧文件照常导入)。
- 工具可改名/改分类/改简介(卡片右上 ✎,`/api/nav/tools/edit/`):只动这三项,**主键与文件都不变**,所以 `/nav/tools/<pk>/` 地址不变、旧链接不失效。导入时按名称 upsert —— 同名工具视为同一个。
- ⚠️ **托管工具运行在 sandbox 不透明源里**(2026-11-05 起,`nav_tool_open` 下发 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads`)。原因:工具多半是从网上下载的 HTML,此前它在本站源执行,能读 `document.cookie`、能带凭据打本机任意端点。副作用有三条,都是刻意的:① 工具**读不到本站 localStorage**(写会抛 `SecurityError`),所以"工具之间共享本站存储"这条老行为没有了;② 带凭据的 `fetch` 到本站 API 会被当跨源拦掉;③ 引 CDN 的脚本/样式**照常可用**(只加了 sandbox,没加 `default-src`,别顺手补源限制,会把图表库一起打死)。要恢复旧行为就删掉 `nav_tool_open` 里那行 CSP,同时删掉 `NavToolTests.test_tool_page_is_sandboxed_but_still_runs_scripts` —— 那条测试就是钉这件事的。
- PWA 壳(GET `/nav/manifest.webmanifest`、`/nav/icon.svg`、`/nav-sw.js`):网络优先、断网回退缓存(不缓存 `/api/` 与 `/admin/`),浏览器地址栏可直接"安装应用"。**只在独立运行 `nav/base.html` 时生效**——宿主模式不加载该文件,零影响。
- 星标置顶:卡片右上 ☆(或 chips 行右侧 ×)把站点固定到页面顶部"★ 星标"chips 行,只存本机 `navStars`;整行可在 设置 → 显示 隐藏。
- 最近使用:点击任意卡片/工具自动记录,页面顶部"🕘 最近"chips 行展示最近 12 条(本机最多存 40),键 `navRecent`,开关 `navShowRecent`(默认可见)。
- **浏览器书签互导**:导入按钮选 `.html/.htm` 文件即走书签通道(前端 DOMParser 解析 → 预览"新增/已存在/跳过"→ 仍由 `/api/nav/import/` 落库);文件夹层级映射 大类/小分类(三级及更深的文件夹名拼进小分类),没有文件夹的书签进「未分类」,与已有网址相同走更新不新建,不再有 500 条单次上限(原 BM_MAX=500 截断已移除)——解析出全部 items 后按 BM_BATCH 切片、逐批顺序 POST 到 `/api/nav/import/`(幂等 upsert,单批失败不中断),弹窗进度条实时显示导入进度,无论书签文件多大都全量入库,不再丢数据。导出按钮旁的「导出书签」生成 Netscape 格式 HTML(`/api/nav/export-bookmark/`),浏览器「导入收藏夹」可原样读回。
- **单入口 + 访客只读(2026-11-21,取代原来 `/nav/` 与 `/nav/guest/` 两套页面)**:`/nav/` 由服务端判角色——带对 `NAV_WRITE_TOKEN`(请求头 / cookie `nav_token` / `?nav_token=`)渲染主人全量页;没带或带错渲染访客只读页,**网址不变**。令牌未配置时一律视为主人(本地开发零负担)。访客分支在任何数据库查询之前返回,GET 0 查询;站点来自 `python manage.py export_nav_public` 生成的 `nav/static/guest/nav-public.json`(自动过滤隐藏分类、休眠站点与点击统计)。**访客页与主人页是同一套 `nav_sites.html` + `nav-sites.js` + `pet.js`**:外观、布局、目录、设置抽屉、桌宠全部照搬,模板只多输出一个 `NAV_GUEST_MODE`——前端据此隐藏添加/编辑/删除/体检篮/多选/导入导出/维护 tab 等写入口,并把所有 `/api/nav/` 请求经 fetch 闸门挡成空响应(不读主人 AI 配置、不写库)。访客自己导入的书签/JSON 只写本机 `localStorage`(键 `navGuestBookmarksV1`),渲染成与自用版同样的卡片;顶栏「导入书签」「主人登录」是仅有的两个额外入口。登录 POST `/nav/login/` 校验后写 HttpOnly cookie,同一地址立刻变自用版;自用版「更多 → 退出主人态」POST `/nav/logout/` 清 cookie 回到访客视图。`/nav/guest/` 保留为**强制访客态**入口(不看 cookie),已分享出去的旧链接行为不变。角色判定集中在 `nav/nav_access.py`,测试见 `nav/tests_nav_identity.py`。
- **本机整包备份 / 恢复(2026-11-21)**:访客菜单与主人菜单各只有 1 条「整包备份」(`data-nav-backup`)与 1 条「整包恢复(本机)」(`data-nav-restore`);旧的「整包备份(JSON)」「整包备份(本机)」双入口与 `navGuestExportJson` 已删除。整包由 `navBackup.collect()` 采集这台浏览器全部 `nav*` 前缀 localStorage 键 + IndexedDB(`pinsflora-nav`/kv)条目,格式 `{format:'pinsflora-nav-local', version:1, created_at, mode:'guest'|'owner', entries:{key:{type:'ls'|'idb', value}}}`,不含服务端站点库;恢复走 `navBackup.restoreObject()` 的确认 → 覆盖落盘 → 刷新流程,失败项汇总提示,不静默吞。采集端对本机 AI 配置键 `navGuestAiCfgV1` 擦除 `apiKey`/`key`/`token` 三个敏感字段(`SENSITIVE_FIELDS`),`baseUrl`/`model`/`modelClassify`/`persona`/`memoryRounds` 等非敏感配置保留;恢复端 `keepLocalAiKey()` 在入站配置缺 Key 时保留本机当前 Key,避免"恢复一次就把 Key 弄丢"。「导入(JSON / 书签)」只收站点树 / 书签:整包文件拖进导入会被明确拒绝,提示「这是本机整包，请用整包恢复」(模板解析层 + 两个调用点共两处)。「备份到文件夹 / 从文件夹恢复」是同一整包格式的 File System 变体(仅访客菜单,`nav-fs-backup.js`):内容仍由 `navBackup.collect()` 生成,这里只管写进 / 读出本地目录;目录句柄存独立 IndexedDB `pinsflora-nav-fs`(键 `backupDir`),**不进 `navStore`**——否则整包备份会把不可 JSON 序列化的 `DirectoryHandle` 一并收进去;不支持 File System 的浏览器自动回落为下载 / 选择文件。只写用户指定目录,不新增任何服务端端点。
- **站点标签 + 标签云**(2000 站主导航形态):添加/编辑弹窗可填标签(逗号分隔,最多 8 个/每个 ≤10 字,落库 `NavSite.tags`);卡片简介下显示标签徽章;顶栏 🏷 打开**标签云面板**——全部标签按站点数分三档字号、按热度降序,点击 = **多选 AND 过滤**(选中实心高亮,面板关闭后仍生效,顶栏按钮亮成 primary 提示),面板内「清空」一键解除。标签云与搜索框**组合过滤**(两者结果再 AND);面板每次打开重渲染并对存活标签自洁(剪掉随卡片删除而绝迹的选中标签)。标签随 JSON v9 导出来回,旧文件缺 `tags` 键不清零本机标签。
  - 卡片 `data-tags` 是 **JSON 数组**(`data-tags='["设计 素材","免费"]'`),不是空格分隔——空格分隔无法表示含内部空格的标签。编辑弹窗预填仍走 site-edit 按钮的逗号分隔 `data-tags`,两者用途不同别混淆。
  - **站内搜索词从整串匹配改为逐词 AND**:输入「设计 素材」不再要求两词连续出现,分别出现即命中(中文搜索更直觉);纯函数 `navFilterHits` 仍按单词跑,多词合并在编排层。
- **日历 + 自定义倒计时**(时钟问候下一行,跟随 `navShowClock` 开关):日历显示本地日期/星期/今年第 N 天(纯前端,本地时间);自定义倒计时在 设置 → 显示「显示时钟问候」下方管理(名称 + 目标日期,最多 8 个,同日去重),卡片样式 pill 显示"距X N 天/就是今天/已到期 N 天",键 `navCountdowns`。链接测活弹窗里可临时改 单条超时/总预算(键 `navLinkTimeout`/`navLinkTotal`,空=用服务端默认 10s/60s,区间 3~30 / 10~300 秒,非法值服务端 400 报错)。
- 键盘操作:`Ctrl/Cmd+K` 或 `/` 聚焦大搜索框;大搜索框内 `↑↓` 选卡片、`Enter` 无选中时走全网搜索;站内搜索框内 `↑↓` 在可见卡片间移动高亮,`Enter` 打开(有子页的弹窗选择),`Esc` 清空/收起历史面板。大框输入为空时点开弹出本机搜索历史(键 `navSearchHistory`,去重置顶,最多 12 条)。
- 卡片拖拽排序:键 `navDrag`,**默认开**(设置 → 显示 可关)。跨分类拖动后点底部"保存排序"条才提交(`/api/nav/site-order/`),不保存刷新即放弃;直接拖到左侧目录项 = 换分类并立即落库(`/api/nav/move/`,只改分类/小分类)。
- **目录设置归口(2026-11-19)**:目录标题旁的齿轮负责 **显示左侧目录 / 常驻·抽屉形态 / 展开折叠 / 数量 / 6 种列表样式(默认 / 极简 / 时间轴 / 胶囊 / 柔光 / 缎带;柔光=柔和圆角块面 + 渐变选中 + 计数徽标,缎带=左侧渐变竖条标层级 + 选中项横向渐隐;「卡片」样式 2026-11-19 按用户要求删除,老键值 `navTocStyle='cards'` 自动回落默认) / 二级·三级显隐**;显隐开关与快捷设置「显隐」区里的 `#navQuickShowToc` 是同一键 `navShowToc` 双入口(目录关掉后齿轮自己也看不见,必须留这个出口),两边同键同步;抽屉「逐项微调」里不再重复这一项。
- **目录抽屉(2026-11-19 修遮挡)**:① 抽屉**一律实底** `var(--bs-offcanvas-bg, var(--bs-body-bg)) !important` + `backdrop-filter: none`——壁纸规则会给 `.nav-toc` 85% 半透明 + 6px 模糊,常驻态没问题,但抽屉是压在正文上的覆盖层,半透明就会「卡片从目录里透出来」(用户截图「还遮挡」);② 推开量改为量 `.nav-toc` 的 `getBoundingClientRect().width`(「铺满 / 宽档」给目录挂 zoom,写死 280 时抽屉实际 330,卡片会被压住一截),真实宽度同时写进 `--toc-w` 给把手定位;③ **常驻形态不再显示左侧把手**——整块目录本来就看得见,那条小舌头只会压住正文左边;抽屉形态仍从目录齿轮切进去,切进去后把手才出现(收起 / 展开都用它)。
- 删除可恢复:删站点成功后 8 秒内可在提示条点「撤销」原样恢复(名称/分类/小分类/简介/子页/备用网址/自定义图标/排序/点击数/是否内置全部带回,走 `/api/nav/delete/` 返回的整行 → `/api/nav/restore/`)。**删站点不再弹确认框**(2026-10-30):本来就能一键撤销的动作,反悔的机会放在做完之后,少一次点击。触屏设备(无悬停)上编辑 ✎ / 删除 × 按钮常显,否则根本没有操作入口。
- **桌宠聊天窗口的显示开关与弹窗返场(2026-11-19)**:宠物设置新增 **💬 聊天** 页签,两个键只影响聊天窗口渲染——`navPetChatReasoning`(默认显示「思考详情」折叠行,设 `'0'` 隐藏整块,回复本体照常)、`navPetChatCopy`(默认 **不显示** 每条回复下的复制按钮,设 `'1'` 才出「复制回复 / 复制思考」);开关改完即时重绘,不用关窗重开。另一个坑:任何 Bootstrap 弹窗打开都会把聊天窗 `petChatWindowClose()` **永久收起**,所以在「宠物设置」里联动打开 AI 接口、返回后聊天窗就再也不回来(用户 2026-11-19 反馈「点其他设置返回就自动隐藏」)——现在改成 **让位 + 返场**:`petChatSuspendForModal()` 只记一笔并临时移除 `show`,最后一个弹窗 `hidden.bs.modal`(且没有别的 `.modal.show` / `modal-open`)时 `petChatWindowOpen(true)` 还原且**不抢焦点**;**宠物设置也一律让位**(原来唯一豁免,结果设置窗和聊天窗并排/半叠着互相压住,用户截图右半边就是被压住的聊天窗),齿轮浮层在进入任一个设置前先收起。用户自己点 ✕、或快捷 chip 主动开 AI 找站/AI 分类时的关闭不受影响。
  设置弹窗另外两条 UI 收尾:① 兼容层给所有 `.modal-dialog` 挂 `overflow:auto`(为 resize 抓手),内容只要高 1px 就会站出一条系统白滚动条——宠物设置改成 `overflow: hidden !important`,滚动交给 `.modal-body`,并给 `.modal-body` 换成主题化细滚动条;② 页签加到 6 个(外观/互动/聊天/声音/提醒/天气),`flex-wrap: wrap` 防窄屏挤出省略号。
- **桌宠人设 / 记忆轮数 / 桌宠模型 / 碎碎念走 AI 搬到宠物设置(2026-11-19)**:这一栏原来塞在顶栏「AI 接口」弹窗里,但它只影响桌宠自己,和接口地址/模型不是一回事。现在放在 **宠物设置 → 💬 聊天**:`#petAiPersona` 文本域、`#petAiRounds` 数字(0–20,0 = 只记当前这句)、`#petAiModelPet` 桌宠模型(空 = 默认模型)、`#petAiWhisperOn` 开关(键 `navPetAiWhisper`,勾选即生效),外加「保存桌宠设置」小按钮(`#navPetPersonaSave`,提示行 `#navPetPersonaHint`)。打开设置时 `petPersonaLoad()` 从 `/api/nav/pet-ai/config/` 回填;保存只 POST `{persona, memory_rounds, model_pet}`,后端改为 **字段缺省不覆盖**——老写法无条件写 `base_url`/`model`,只发人设会把接口地址和模型清空,桌宠与「AI 找网站」一起失联。AI 接口弹窗只剩接口/默认模型/分类模型/检测/日志,底部注明这些项在宠物设置里改。同一页签底部还有「清空聊天记录（本机）」(`#navPetChatClearInSet`):只清 `navPetChatHistoryV1`,先走 `navConfirm` 确认(删了没有服务端副本),聊天窗开着就顺手重绘成空态并提示「已清空」。
- **任务模型改为下拉可选(2026-11-19)**:分类模型 `#petAiModelClassify`(AI 接口 → 高级)和桌宠模型 `#petAiModelPet`(宠物设置 → 💬 聊天)都是「输入框 + ▾」,点 ▾ 从已检测到的模型里选;默认项只留一个 **「默认（跟随主模型）」**(空值),接口返回的 `default` / `默认` 条目会被 `petAiCleanModelList()` 剔掉并去重,避免同一个默认出现两次。手打自定义模型名仍然保留。两个下拉共用 `petAiRenderTaskModelMenus()`;宠物设置里没有接口地址框,打开时由 `petPersonaLoad()` 拿已存 `base_url` 走 `petAiPrefetchModels()` 让服务端补列表。按钮/菜单 id 分别是 `petAiClassifyModelBtn/Menu`、`petAiModelPetBtn/Menu`。
- **多选批量条(2026-11-19 二级收纳)**:外露只有 打开 / 收藏 / 删除 / 取消 与「更多」;复制链接、全选可见、换分类(大类+小分类)、加标签、💤 休眠收进贴着操作条上沿的 `.ms-more-panel` 浮层,展开态在勾选变化时保留,「全部取消」后自动收起。所有动作 id(`navMsGoOpen/Star/Del/Copy/All/Cat/Tags/Arch`、`navMsCat`、`navMsSub`、`navMsTags`)不变。顶栏 `#navBulkToggle` 是 **32px 图标位**(图标 + `aria-label` / tooltip,不带文字)——图标位里再塞「多选」两个字会溢出,压住右边的「更多」。
- **页内反馈层:全站没有浏览器原生弹窗**。“刚做完什么/哪里没做对”走 `window.navToast(msg)` 或 `window.navToast(msg, {label, fn, ms})`(页面底部浮层,可挂一个动作按钮,如「撤销」);需要用户拍板的**不可恢复**动作走 `window.navConfirm({title, body, confirmLabel, cancelLabel, danger, onOk})`,返回 `Promise<boolean>`。这一层定义在 `nav_sites.html` 的主脚本里(样式在同页样式区,颜色全走主题变量,11 套主题与暗色都能读),是自制的一层遮罩 + 卡片,**不借 Bootstrap Modal**;默认焦点在「取消」上(回车不许顺手确认破坏性动作)、Esc 与点遮罩都算取消、关闭后焦点还给触发它的按钮、「减少动效」偏好下不做动画。规矩:凡是删了能恢复的一律直接执行 + 带撤销的提示,只有删了不能恢复的(工具删除:文件会一起从库里移除,没有恢复通道)才弹这一层。拆到 `nav/static/js/*.js` 的模块经 `window.navToast` / `window.navConfirm` 取用并判存。整层零外部依赖,带着 `nav_sites.html` 移植就走。
- 体检记录角标:**只有跑过「链接测活」之后**,打不开的主站卡片才多一枚「打不开」小角标,悬停显示原因(HTTP 404 / Timeout / 重定向无目标…)和距上次体检几天。它是**上次体检的读数,不是新检测**:页面打开时不测、不重试,也绝不改你的网址/备用网址/子页(搬家建议仍要你在弹窗里手动"加入备用"),重测一次即覆盖,没测过的条目保持原样。存 `NavSite.last_check_at`/`last_check_ok`/`last_check_note` 三字段,**不进导出 JSON**(体检是本机的事实,换机不该带走旧结论)。
- **全库体检分批 + 断点续测(2000 站量级)**:「全部填入并检测」不再一次性提交、也不再把 300 条之外的丢掉 —— 按 **32 条一批**顺序跑(8 并发 × 4 轮,单批最坏 4×单条超时,稳稳落在默认 60s 预算内),批完即渲染该批结果并更新进度条,逐批落库。跑动中可「停止」,已测的都已入库;中断(关页面/刷新/批请求失败)后弹窗里会出现「继续上次体检(剩 N 条)」,点击只补没测过的(判据:卡片 `data-check-at` 早于本次体检开始时间),已测的自动跳过 —— 断点状态只存一个 `localStorage` 时间戳(`navLinkCheckStartedAt`),1 小时内有效,不依赖服务端任务表。⚠️ 总预算不够的批次,没跑到的条目按「未测(预算不足)」黄标返回,**不写入体检记录**(不误报"打不开")——后端 `skipped` 标记 + 前端黄色角标是这条承诺的两半。续测只覆盖主站(子页没有时间戳),与"全库体检"语义一致。
- **💤 休眠(2026-10-30,「删之前先收起来」)**:状态是 `NavSite.archived_at` 一个字段(迁移 `0011`),`/api/nav/archive/` `{id, on}` 只写这一列——名称/网址/子页/备用/标签/星标/点击数/体检记录一律不碰。休眠站**不进分类,也不进一切派生数据**(测活"填入该大类网址"、"加入备用"的站点映射、小分类提示都拿不到它),但仍在库里:顶栏计数照旧算它,写作「共 N 个站点 · 含休眠 M」。**入口两个**:🩺 保养列表行末 💤(单条,带 8 秒撤销)、多选批量条「💤 休眠」(`/api/nav/batch/` 的 `archive`/`unarchive`)。**出口在抽屉「🩺 保养」页签下方**的「休眠中」列表(服务端渲染,打开页面零请求;自带小过滤,只影响显示)——「唤醒」放回原来的分类,**唤醒/撤销必须刷新**才看得见卡片,因为卡片是服务端渲染进分类的。休眠状态**随导出 JSON v10 一起走**(键 `archived`,ISO 时间串;缺键的 v9 及更早文件不清本机状态),否则换机即复活。`/api/nav/site-order/` 保存排序不会顺手清掉休眠站的 `order`(它们不在 DOM 里,与"隐藏分类不参与清空"同一条规矩)。
- **🩺 保养(体检篮抽屉的第二个页签,纯前端)**:两个轴——使用(超过 90 天没打开 / 收录超 30 天却从没记录到点击)与体检(从没体检 / 超 30 天)。读卡片 `data-clicks`/`data-check-at`/`data-created`/`data-cat` 加本机 `navRecent`/`navStars`,**不发任何请求、不新增后端与字段**;行内 ↗=打开并计入最近使用、☆=切换星标、死链行给「修」(打开那张卡的编辑弹窗)。诚实边界:`click_count` 没有时间戳、`navRecent` 只留 40 条,所以"点过但不知道多久前"单列「判断不了」,不拿点击数猜沉睡;点击统计是后加的,很早以前点过的站可能显示成从没点过。分档是纯函数 `window.navMaintenanceBuckets`,脚本可单独验。
- **三级分组(展示层,不改模型)**:小分类名写成 **「设计素材 / 配色」** 或 **「设计素材 > 配色」**(两种分隔符都支持)时,该大类会渲染成 **大类 → 父级 → 子级** 三层;不含分隔符的大类完全走原有两级,存量数据零影响(向后兼容)。规则:① **只拆第一层**——`A / B / C` 得到父级 `A`、子级 `B / C`;② 父级或子级拆出来为空(如 ` / x`、`x / `)时不拆,整串当普通小分类;③ 同一大类下混用没问题——无分隔符的小分类(如 `精选`)直接成为父级,其站点直属显示在父级下;④ 折叠状态沿用完整 subcat 串作键(如 `自定义/精选 / 入门`),与站点数据一致。
  - 左侧目录在三级模式下**只列父级**(锚点指向父块),避免 2000 站时 TOC 条目爆炸;子级在正文里可见,搜索/标签过滤同样能命中。
  - 拖拽换分类无需特殊处理:目录拖放解析 `data-collapse-id` 时用 `split('/')` 后 `slice(1).join('/')` 还原,三级串能完整带回。
- **三级分类表单(2026-11-12)**:添加/编辑站点不再要求手写分隔符 —— 表单拆成「二级分类 + 三级」两个输入(均可选),提交时前端合成 `二级 / 三级`,后端 `subcat2` 走 `_compose_nav_subcat` 再合成一次(API 直连也生效):
  - 只填三级 → 按二级存;只填二级 → 与旧数据完全一致;编辑时自动按分隔符回填两格
  - 二级 datalist 列该大类已有的父级,三级 datalist 只列所选二级下的子级;手改二级会立刻换候选
  - 存储仍是 `NavSite.subcat` 一个字段,渲染、折叠键、导出 v10、拖拽换分类**零迁移**
  - 总长压在字段上限 50 内(`_compose_nav_subcat` 负责截断,优先保住三级)
  - 视图侧实现:`NAV_SUBCAT_SEPS` 常量 + `_nav_split_subcat()` + `nav_sites` 里为含分隔符的大类额外构建 `group['tree']`(同时把 `group['items']` 置空省内存);模板按 `{% if group.tree %}` 走三级分支,否则走原两级分支。
- **站内搜索性能(2000 站量级预备)**:`navApplyFilter` 已索引化 —— 首次过滤时把卡片 haystack(`data-search` 小写)、标签(`data-tags` JSON)与「小分类/大类 → 所含卡片」层级建成一份内存索引,之后每次输入只跑纯字符串匹配(`navFilterHits`,不碰 DOM)+ 差异写 display(只写变化项),不再整树遍历 + 全量 `getAttribute`。2000 站单次过滤:单词语义实测约 0.2ms;3 词 AND + 2 标签 AND 组合约 9ms(仍在单帧预算内)。索引失效做**数量 + 元素身份**双重校验:删除/撤销(数量变)、删 1 增 1 或编辑换节点(数量不变但节点被替换)都会自动重建,不依赖调用方手动刷新;新增/编辑/导入保存均走整页刷新,索引天然重建。⚠️ 清空还原仍走**过滤前的内联样式快照**(`navApplyFilter.snap`,Map 按元素记录),**不许**改用 `:visible` 判断 —— 2026-10-04 曾因此清空后全白;契约由 `nav/tests_nav_sites.py::NavFilterIndexTests` / `NavTagCloudTests` 锁定。

## 配置项(都可选)

| settings | 默认 | 说明 |
|---|---|---|
| `NAV_BASE_TEMPLATE` | `'nav/base.html'` | 接入已有站点时改成宿主的 base(如 `'myapp/base.html'`),需含 `title/extra_head/content/scripts` 块 |
| `MEDIA_ROOT` | Django 默认 | 托管的 HTML 小工具存 `nav_tools/` 子目录,只依赖标准文件存储 |

接入宿主站点时,在宿主导航栏加 `{% url 'nav_sites' %}` 入口即可(URL 名全局唯一,app 不带 namespace)。

## 页面与 API 契约

- 页面:`/nav/`(GET,`ensure_csrf_cookie`,AJAX 从 cookie 读 csrftoken 发 `X-CSRFToken` 头)
- APIs(均 POST + JSON,除注明外返回 `{status:'success'|'error', message?}`):
  - `/api/nav/add/` `{name,url,category?,subcat?,description?,site_title?,favicon?,icon_text?,icon_color?,icon_size?,children?,alternates?,tags?}` → `{id}`
    (`tags` 为字符串数组,后端清洗:去空白/去重/最多 8 个/每个 ≤10 字;非数组按空处理)
  - `/api/nav/edit/` `{id, 同 add 字段}` | `/api/nav/delete/` `{id}` → `{site:被删整行}`
  - `/api/nav/restore/` `{site:上面那整行}` → `{id}`:原样恢复误删站点(含子页/备用网址/自定义图标/标签/排序/点击数/`is_builtin`);URL 已存在时 400 而非重复建一条
  - `/api/nav/move/` `{id,category,subcat}`:拖卡片到左侧目录换分类,只改这两个字段
  - `/api/nav/archive/` `{id, on}`(POST):休眠/唤醒,只写 `archived_at`(on 缺省=休眠);条目不存在 404、id 非数字 400、GET 405。批量版走 `/api/nav/batch/` 的 `action:'archive'|'unarchive'`
  - `/api/nav/fetch-meta/` `{url}` → `{title,favicon,description,moved?}`(抓对方首页 meta;
    同一次抓取顺带解析"可能的新地址",格式同 link-check 的 moved;打不开时 502 + message)
  - `/api/nav/link-check/` `{urls:[...≤300], proxy?, timeout?, total_timeout?}` → `{results:[{url,ok,status,error,skipped?,moved?}]}`;
    `timeout`(单条超时,整数 3~30 秒)与 `total_timeout`(整批总预算,整数 10~300 秒)均可选,缺省/空串用默认 10s/60s,
    接受 "5" 这类数字字符串(前端 input 值),非法值 400 + message;顺带把逐条结果按主站 URL 写回 `NavSite.last_check_at/last_check_ok/last_check_note`(卡片「打不开」角标的数据源;只写这三个字段,不动链接)。
    ⚠️ 预算耗尽没跑到的条目返回 `skipped:true`(error='Timeout'),**这类条目不写体检记录**——「没结论」不等于「打不开」,写了会误报角标
  - 前端「全库体检」按 **32 条一批**顺序调用本端点(2000 站 = 63 批),逐批渲染进度、逐批落库,可「停止」可「继续上次体检」;
    旧行为是超 300 条直接截断丢弃,现已改为分批,不再丢
    text/html 页面正文里解析"可能的新地址",有候选时附 `moved:[{url,reason}]`,
    reason ∈ canonical/og:url/redirect/hint/link(按可信度排序,≤6 条,同站丢弃)
  - `/api/nav/link-adopt/` `{id,url,name?}`:把迁移检测候选一键追加到该站点 `alternates`(幂等去重)
  - `/api/nav/category-order/` `{order:[名称 或 {name,hidden}]}`(整表替换)
  - `/api/nav/site-order/` `{order:[站点id,…]}`(按页面 DOM 顺序整表提交,依序赋 `order=1..N`;未列入的清空 order 排到最后,**当前隐藏的分类里的站点不参与清空**,工具不参与)
  - `/api/nav/click/` `{id}`:卡片点击埋点,累加 `click_count`(设置 → 排序 的「按常用度排序」读它)
  - `/api/nav/export/`(GET 下载 JSON)/ `/api/nav/export-bookmark/`(GET 下载 Netscape 书签 HTML:
    大类 → 文件夹、小分类 → 子文件夹、直属站点挂大类下,供浏览器「导入收藏夹」读回;站点范围与 JSON 导出一致)
    / `/api/nav/import/`(multipart `nav_file`,v1–v10 兼容,幂等 upsert)
    **浏览器书签(.html)导入走前端解析**(DOMParser:文件夹层级 → 大类/小分类,三级及更深文件夹名拼接,
    没有文件夹的进「未分类」)→ 预览(新增/已存在/跳过计数)→ 仍由本端点落库,不新增服务端解析通道
  - `/api/nav/reset/`(恢复内置站点)
  - AI 找网站:`/api/nav/ai/config/`(NavAiConfig 单例,**只在顶栏「AI 接口」弹窗里配**,全站共用;AI 找网站/桌宠都不再重复配置、未配置时生成报错指向顶栏与手动模式);**保存 = 当场探活通过才落库**(「保存」与「选中模型即保存」共用 `petAiTestThenSave`);批量测试模型进行中会拒绝保存并提示等它跑完(同一个接口排队会把当场复测拖成超时);探活失败的提示会写明「上面『可用 N/M』是上次批量测试的旧结果」,不再让人误会成配置坏了;**配置其实已写库、界面却说失败**的坑(2026-11-19)是 `petAiRenderDiag()` 调了未定义的 `petAiFmtAt`,ReferenceError 被外层 `.catch` 吞成「测试或保存请求失败」——现在 `petAiFmtAt` 已补上且时间解析不出来时返回空串、`petAiPost` 对非 JSON 响应会翻成「403 刷新页面 / 服务器返回 N」,`/api/nav/ai/generate/`(接口模式)、
    `/api/nav/ai/prompt/` + `/api/nav/ai/parse/`(无 API 手动模式:复制提示词 → 贴回回复 → 解析)、
    `/api/nav/ai/import/`(测活后入库,单次≤20 条,超出回报 `truncated`);`/api/nav/ai/model-test/`(单模型当场探活,**超时/连不上/429/5xx 自动重试一次**:第一次 10s、第二次 15s;2026-11-19 修「显示可用却保存失败」——31 个模型串行测完后网关排队,单次 10s 会把可用模型判死)、`/api/nav/pet-geo/`(桌宠天气的城市→坐标代理)
  - 壁纸/图标:`/api/nav/bing-bg/`(必应今日 JSON,服务端取、缓存 6h)、`/api/nav/bing-bg-raw/`(同源图片代理,供 canvas 取色)、
    `/api/nav/icon-upload/`(multipart ≤300KB)、`/api/nav/favicon-localize/`(POST,全站图标本地化)、
    `/nav-fav/<name>`(GET,文件名严格 `fav_[0-9a-f]{32}.<ext>`,SVG 带 CSP sandbox)
  - 工具:`/api/nav/tools/upload/`(multipart `tool_file`+name/category/description)、
    `/api/nav/tools/edit/` `{id,name,category,description}`(只改这三项,主键与文件不动)、
    `/nav/tools/<pk>/`(GET 直接返回托管 HTML)、`/api/nav/tools/delete/` `{id}`
- 导入导出 JSON 格式 v10:`{format:'pinsflora-nav', version:10, category_order, sites, tools}`;
  内置站点**若与种子有差异**(改过名称/分类/图标等)也会导出,换机不再丢自定义修改;
  站点行含 `children`/`alternates`/`tags`(v9 新增)/`archived`(v10 新增,休眠时间 ISO 串,正常显示为 `''`)/
  `order`(拖拽排序,未排序为 null)、
  `icon_text`/`icon_color`/`icon_size`(自定义图标)与 `click_count`(常用度)。
  **老文件缺新键时,本机已设的图标/点击数/标签/休眠状态保持不变**(不会被清零);
  `archived` 认不出的值(既不是空/`false`,也不是可解析的时间串)**什么都不写**,宁可保留本机原样也不猜;
  缺的其他字段按空处理,幂等 upsert 不丢数据。

## 数据

模型:`NavSite`(站点;自定义图标 `icon_text`/`icon_color`/`icon_size`、子页与备用网址 `children`/`alternates`、标签 `tags`(JSONField 字符串数组,≤8 个/每个 ≤10 字)、拖拽排序 `order`、常用度 `click_count`、休眠 `archived_at`(空=正常显示)、上次体检记录 `last_check_at`/`last_check_ok`/`last_check_note`(后三者不进导出))、
`NavCategory`(分类排序/显隐,空表按内置顺序兜底)、`NavTool`(托管工具文件)、`NavAiConfig`(全站共用的接口配置单例:找网站 + 桌宠同一份,**只在顶栏「AI 接口」弹窗里配**,与宿主/content_engine 的 AI 配置互不相通)。
迁移在 `nav/migrations/` 里随目录一起拷,`migrate` 即可(标签在 `0009_navsite_tags`,休眠在 `0011_navsite_archived_at`)。
跨项目搬运自定义数据用页面右上角的 导出 → 导入 即可,不碰数据库。

## 注意

- 内置种子(`nav_data.py`)与页面文案可按项目随意增删,恢复内置用 `/api/nav/reset/`。
- 页面外观与本机偏好(主题/壁纸/布局/界面模式/星标/最近/引擎/宠物…约 50 个键)**全部存 localStorage**,服务端一个字都不写;清掉站点数据即回到出厂外观。
- 桌宠素材在 `nav/static/pet/`(约 57MB 透明 webm + 表情包,来自 PC2005-cloud/dsh-pet,MIT,**素材禁商用**):整目录删掉页面照常工作,或把设置里的「桌宠」开关关掉(键 `navPetOn`,默认开)。
- 本 app 是从旧导航项目抽离的通用模块:数据早在 `nav/0002` 迁移就搬进了 `nav_*`。该迁移用 `introspection.table_names()` 判表是否存在,缺表自动跳过,所以带着旧表的老库和全新库都能 `migrate`。
  ✅ 旧表 `searchapp_navsite`/`searchapp_navcategory`/`searchapp_navtool` **已于 2026-11-07 按用户指令从活跃库 DROP**(删前逐表核对 89/14/0 行与 `nav_*` 业务列逐行一致,备份 `db.sqlite3.bak-nav-drop-20261107`);副本库 `db-DESKTOP-QI22IOV.sqlite3` 更早已 DROP。迁移仍带表存在性守卫,所以老库、全新库都能 `migrate`。**任何会话仍不得擅自 DROP**(本条此前误写过"已于 2026-10-10 DROP")。
- ⚠️ **`bootstrap-shim.js` 的 dropdown 必须派发 `show.bs.dropdown`**(2026-10-16 修复):shim 只切 `.show` class、不派发事件时,页面挂在 `show.bs.dropdown` 上的懒渲染永不执行,面板**静默空白**——而所有字符串契约断言照样全绿。Modal/Offcanvas 本来就派发,dropdown 是漏的;现已补齐 `show/shown/hide/hidden.bs.dropdown`(目标为 menu 元素,`bubbles:true`),并由 `NavTagCloudTests.test_dropdown_shim_fires_show_event` 锁定。
- ⚠️ **弹窗宽度只靠 max-width**(2026-10-29 修复):兼容层里 `.modal-dialog` 是 `w-auto`,`max-w-lg/3xl`(`.modal-sm` 补了 Bootstrap 的 300px)是它唯一的宽度来源。`bootstrap-shim.js` 的拖拽/缩放增强必须**先量出 `max-width` 落成显式宽度再置 `none`**,否则 `width:auto` 会让所有弹窗退回铺满整屏(用户实测"AI 接口弹窗过大")。窄屏靠 `min(宽度, calc(100vw - 2rem))` 收窄;双击标题栏同时复位位置与尺寸。
- **改前端交互后建议跑一次真实浏览器验证**(HTTP 层与字符串断言都验不出"JS 到底有没有执行"):临时写一个 `StaticLiveServerTestCase` 子类,`setUpClass` 里 `sync_playwright().start()` + `chromium.launch(headless=True)`,测试方法里 `page.goto(self.live_server_url + '/nav/')` 后点击/输入/断言 `is_visible()`;文件顶部需 `os.environ['DJANGO_ALLOW_ASYNC_UNSAFE'] = '1'`(playwright 的 sync API 会建 event loop,否则 Django 禁止 ORM 调用)。Django 会自动建独立测试库并销毁,造数据不碰真实库。跑完即删,别让它进正式契约(拖慢主测试套件)。

## 桌宠外部语料与前端治理(2026-11-10 ~ 11-11)

- **零密钥兜底**:`nav/pet_sources.py` 串联 青云客 → 思知 → 土味情话。没配 AI Key 时对话与碎碎念自动降级,配了就走原来的 AI 链路;第三方推广句按 `_PET_AD_MARKERS` 直接丢弃(实测青云客会回「去奥龙霸斯淘宝店睇睇啦」)。
- **天气第二行**:`/api/nav/pet-brief/` 一次返回「空气质量 + 明日预报」,源为 Open-Meteo air-quality / daily(与实况天气同经纬度,30 分钟缓存)。**没有用 WAQI** —— 其 demo token 实测对任何城市都返回同一座上海站点。
- **每日英语**:`/api/nav/pet-daily-en/`(金山词霸 dsapi,按天缓存),右键菜单「📖 每日英语」点播。
- **`!important` 治理(2026-11-11)**:110 → 64 处。清单见 `docs/nav-css-important-清单.md`;回归门 `_css_style_gate.py`(11 主题 × 3 布局读 computed value,同一份代码连跑两次 0 差异)。截图哈希门已证伪:同代码连拍 13/13 全部不同(背景层在动)。新增主题前先跑 `_audit_css_important.py`,过不了门就别合。

