# Bookmark_to_md

浏览器书签多格式转换 + 格式检查工具集。**主链路（`bookmarks.py` / `check_bookmarks.py` / `bookmark_core.py`）纯 Python 标准库、零第三方依赖**（Python 3.8+，实测 3.12 通过）。

唯一需要第三方库的是已归档的旧版 `md.py`（`bs4 + lxml + html5lib + requests`），不再维护，见文末。

支持 Chrome / Edge / Firefox / Opera / Yandex 等导出的 Netscape 书签 HTML（`<!DOCTYPE NETSCAPE-Bookmark-file-1>`）。

## 文件说明

| 文件 | 作用 |
|---|---|
| `bookmarks.py` | 转换 CLI：书签 HTML ↔ JSON ↔ Markdown，四个方向 |
| `check_bookmarks.py` | 格式检查工具：校验 HTML / JSON / MD 三种书签文件 |
| `bookmark_core.py` | 共享核心：书签树模型 + 三种格式的解析器/生成器 |
| `_archive/` | 旧版单方向脚本的归档位置（依赖 bs4/lxml/html5lib/requests）。**本次并入 Flori-Nav 时没有带过来**，目录当前不存在，旧版说明见文末 Legacy |

脚本与说明随 Flori-Nav 仓库一起跟踪。但 **8 份样本 HTML 是真实浏览记录**，根目录 `.gitignore` 已排除 `Bookmark_Tools/*.html` 与 `Bookmarks.md`，只在本机保留；确实要入库时用 `git add -f` 单独加。废弃文件仍按老规矩移入 `_archive/`（保留原名）而不是删除。

## 快速上手

四个转换方向（互斥参数，必选其一）：

```shell
python bookmarks.py -f bookmarks_2026_9_23.html --html2md           # 书签 -> Markdown
python bookmarks.py -f bookmarks_chrome.md --md2html                # Markdown -> 可导入浏览器的书签 HTML
python bookmarks.py -f bookmarks.html --html2json                   # 书签 -> JSON 树
python bookmarks.py -f bookmarks.json --json2html -o restored.html  # JSON -> 书签 HTML
```

> `--md2html` 的输入必须是本工具产出的 Markdown（链接行形如 `- [标题](url)`），例如先 `python bookmarks.py -f bookmarks_chrome.html --html2md` 得到 `bookmarks_chrome.md`。仓库里的 `Bookmarks.md` 是旧版 `md.py` 的输出（链接行没有 `- ` 前导），因此对它跑 `--md2html` 现在会直接报"未检测到任何书签/链接"退出，而不是像以前那样写出一个不含任何书签的空 HTML。

每个可选功能一个独立开关，**默认全部关闭**，自己决定开哪些：

| 开关 | 功能 |
|---|---|
| `--meta` | Markdown 里用 `<!-- add_date=... last_modified=... tags=... toolbar=1 -->` 注释保留元数据（md 无损往返必需） |
| `--icons` | 生成的 HTML 写回 `ICON` 属性（JSON 始终保留 icon） |
| `--dedup` | 删除重复 URL（保留首次出现，逐条打印被删项） |
| `--fetch-titles` | 为空白/裸 URL 的标题联网抓取真实网页标题（配合 `--timeout N`，默认 10 秒/条） |
| `-y` / `--yes` | 目标已存在时直接覆盖，不弹交互确认（脚本/CI 里等价于自动"是"） |

`-f/--file` 输入路径；`-o/--output_file` 输出路径，缺省时按输入文件名自动换后缀（`html2md`→`.md`，`md2html`/`json2html`→`.html`，`html2json`→`.json`）。

转换任意深度层级、空文件夹、"其他书签"等非书签栏顶层目录，以及 `ADD_DATE` / `LAST_MODIFIED` / `TAGS` / `ICON` / `PERSONAL_TOOLBAR_FOLDER` 字段（icon 与日期在 md 链路按开关取舍，见上表）。

## 防误覆盖 / 防呆

写盘前依次做三件事（都发生在 `--fetch-titles` 联网抓标题之前，不会白跑网络）：

1. **输出 == 输入直接拒绝**：把输出路径和 `-f` 都归一化后比较（`os.path.normcase(os.path.realpath(...))`，再用 `os.path.samefile` 兜底），大小写差异、Windows 短文件名（`BOOKMA~1.HTM`）、符号链接/junction 都能识别（硬链接只有 `samefile` 那条能查出，Windows 上要 Python 3.12+ 它的 `st_ino` 才可信），报 `错误: 输出路径与输入文件是同一个文件…请用 -o 指定一个不同的输出路径` 并退出 `1`。默认换后缀也算：对一个内容为 Markdown 的 `.html` 文件跑 `--md2html`，缺省输出就是它自己，以前会把源文件原地覆盖。
2. **覆盖已有目标前先问**：目标文件已存在且不是输入文件时，交互式终端（`stdin` 与 `stdout` 都是 tty）打印 `目标已存在: X，覆盖? [y/N]`，回车/`n` 即取消（退出 `1`，目标原封不动），`y`/`yes`（不区分大小写）才写入。非 tty（管道、重定向、CI）不提问、不阻塞，`-y/--yes` 则跳过提问直接覆盖。
3. **解析结果为空就不写空文件**：输入非空但 parse 后链接数为 0（典型是把方向开关选反了，或对纯文本跑 `--html2md`），打印 `错误: 未检测到任何书签/链接…可能选错转换方向` 并提示该用哪个方向，退出 `1`，不产出空 `.md` / 空 `.html`。输入文件本身为空时行为不变（仍写出空输出，退出 `0`）。

`bookmarks.py` 退出码：`0` 已写出 / `1` 被上述任一保护拦下 / `2` 解析失败（格式与方向开关不匹配）。

Windows 控制台（GBK）安全：两个 CLI 顶部都有 `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")` 兜底块（`sys.platform == "win32"` 才生效），中文报错不会因为代码页抛 `UnicodeEncodeError`。

## 格式检查

```shell
python check_bookmarks.py -f bookmarks_2026_9_23.html    # 按扩展名/内容自动识别格式，--format html|md|json 可强制
python check_bookmarks.py -f Bookmarks.md --strict       # 警告也计为非零退出码
```

按 ERROR / WARN / INFO 三级报告：

- **HTML**：缺 NETSCAPE 头、`<A>` 缺 HREF / 空 HREF、解析失败
- **JSON**：schema 校验（type / url / children 类型、未知键）
- **Markdown**：无法识别的行、标题层级跳跃、坏链接行
- **通用**：空 URL（ERROR）、异常 URL scheme、空标题、重复 URL（含首次出现位置）、时间戳非 unix 值或超出合理区间、超 6 级嵌套（md）

退出码：`0` 干净 / `1` 有 ERROR（`--strict` 时含 WARN；解析失败也算 ERROR，同样退 `1`）/ `2` 文件根本读不到。

## 格式约定

### JSON 树（本工具自有格式，无损存储）

```json
{
  "type": "folder", "title": "Bookmarks",
  "children": [
    {"type": "folder", "title": "书签栏", "add_date": "1603882023",
     "last_modified": "1772800937", "personal_toolbar": true,
     "children": [
       {"type": "link", "title": "Example", "url": "https://example.com/",
        "add_date": "1600000000", "tags": ["demo"], "icon": "data:image/png;base64,..."}
     ]}
  ]
}
```

### Markdown

- 文件夹 = 标题，**标题层级 = 文件夹深度**（顶层 `##`，其下 `###`…），顶层标题后带 `---` 分隔线
- 链接 = 列表项 `- [标题](url)`（URL 含空格/括号时用 `<...>` 包裹）
- `--meta` 时元数据以行尾 HTML 注释保存，普通 Markdown 渲染器不可见

### 已知限制

- Markdown 标题最深 6 级，更深的文件夹会被压平（生成时打印警告，checker 可查出）
- md 导出时文件夹内链接排在该文件夹子目录之前（重新导入归属不变）
- md 链路默认不含 icon（md 不存储 icon）

## 与 Flori-Nav 配合

导航页本身就能导入浏览器书签（前端解析 Netscape HTML，三层以上文件夹自动拼成 `二级 / 三级`，所以不装 Python 也能导入）。这组脚本负责导入前后的清洗与批量转换：

| 场景 | 命令 |
|---|---|
| 导入前查重复 URL | `python bookmarks.py -f bookmarks.html --html2json --dedup` |
| 给裸 URL 补真实标题 | `python bookmarks.py -f bookmarks.html --html2json --fetch-titles --timeout 10` |
| 体检浏览器导出的文件 | `python check_bookmarks.py -f bookmarks.html --strict` |
| 把 nav 导出的书签转成 Markdown 存档 | `python bookmarks.py -f nav_bookmarks.html --html2md --meta` |
| Markdown 清单变回可导入的书签 | `python bookmarks.py -f list.md --md2html -o import.html` |

层级对应关系：nav 导入时第 1 层文件夹 = 大类，第 2 层 = 二级分类，第 3 层及更深 = `二级 / 三级` 拼接；nav 反向导出时三级会写成一个名为 `视频 / 图生视频` 的文件夹——数据不丢（重新导入仍是三级），但浏览器侧看是单层文件夹。

## 测试语料

8 份真实浏览器导出样本（`check_bookmarks.py` 实测）：`Chrome.html` 526 条 / `Firefox.html` 2154 条 / `Yandex.html` 421 条 / `bookmarks_2026_9_23.html` 429 条 / `bookmarks_opera.html` 358 条，4 份小样例（`bookmarks_chrome/firefox/opera/yandex.html`）各 18 条。

> 样本是真实浏览记录，默认被 `.gitignore` 排除，只留在本机；clone 下来看不到这些文件是正常的。

- 目录内常驻的校验工具只有 `check_bookmarks.py`：`python check_bookmarks.py -f <样本>` 逐个报告 ERROR / WARN / INFO。
- 双向对拍不是自动化测试（仓库内没有对拍脚本），样本经上述 checker + 一次性脚本/人工校验。要复现可以用 CLI 自身：`--html2json` → `--json2html -o r.html` → 再 `--html2json`，两份 JSON 比较（这条链路是逐节点全等的）；`--html2md --meta` → `--md2html` 的 md 往返只在"节点集合"意义上全等——icon 不进 md，且同层兄弟顺序会变成"链接在前、子目录在后"（见已知限制）。

---

## Legacy: md.py（旧版，仅 HTML → Markdown）

已归档到 `_archive/md.py`（连同逐字节相同的 `_archive/md_原版备份_20260923.py` 与旧 README 草稿 `_archive/README - 副本.md`）：依赖 `bs4 + lxml + html5lib + requests`，本机已跑不通，不再维护；功能由 `bookmarks.py --html2md` 及其 `--dedup` / `--fetch-titles` / `--icons` 覆盖。历史缺陷（新版已修）：第 3 层起文件夹名丢失、根节点硬编码、空锚文本崩溃、`Fetching` 内引用未定义变量 `response`。

## 附录：Netscape 书签文件结构

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1562719012" LAST_MODIFIED="1562725161" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><H3 ADD_DATE="1562724652" LAST_MODIFIED="1562725029">h1.1</H3>
        <DL><p>
            <DT><H3 ADD_DATE="1562724661" LAST_MODIFIED="1562724961">h2.1</H3>
            <DL><p>
                <DT><A HREF="https://www.csswinner.com/" ADD_DATE="1562724823" ICON="data:image/png;base64,...">CSS Winner</A>
                <DT><A HREF="https://www.behance.net/" ADD_DATE="1562724797" TAGS="design,inspiration">Behance</A>
            </DL><p>
            <DT><H3 ADD_DATE="1562725246" LAST_MODIFIED="1562725246">H3.2 EMPTY</H3>
            <DL><p>
            </DL><p>
            <DT><A HREF="https://www.brusheezy.com/" ADD_DATE="1562725029">游离于子文件夹之外的链接</A>
        </DL><p>
    </DL><p>
</DL><p>
```

要点：`DT>H3` + 紧随的 `DL` 构成文件夹嵌套；`DT>A` 为链接；老版 Firefox 会以 `DT>DD>A` 出现；`HR`、`P` 为分隔噪声。

## 描述(`<DD>`)的保留

- 解析 Netscape 文件时会读取链接后面的 `<DD>` 作为 `description`,导出 HTML 时写回 `<DD>`
- **Chrome / Edge 的导出不含 `<DD>`**(实测 432 条链接、0 个 DD),这类文件本身没有描述;网站导入时会用「书签分类:xxx」兜底
- Firefox / 部分旧版浏览器的导出带 `<DD>`,可正常往返保留
