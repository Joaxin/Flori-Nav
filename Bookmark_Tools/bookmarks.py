# -*- coding: utf-8 -*-
"""Bookmark format converter: Netscape HTML <-> JSON <-> Markdown.

One flag per feature, all optional features default to OFF:
  --html2md / --md2html / --html2json / --json2html   (pick exactly one)
  --fetch-titles   fetch <title> for blank/URL-like titles (network)
  --icons          write ICON attributes back into generated HTML
  --dedup          remove duplicated URLs (first occurrence kept)
  --meta           keep ADD_DATE / LAST_MODIFIED / TAGS in Markdown comments

Safety:
  * the output path is never allowed to resolve to the input file (use -o)
  * overwriting an existing output asks "target exists, overwrite? [y/N]" on an
    interactive terminal; pipes/CI never block, and -y/--yes skips the question
  * parsing that yields zero links (wrong direction flag) aborts instead of
    writing an empty .md / .html

Examples:
  python bookmarks.py -f bookmarks.html --html2json
  python bookmarks.py -f bookmarks.json --json2html -o restored.html --icons
  python bookmarks.py -f bookmarks.html --html2md --meta --dedup
  python bookmarks.py -f Bookmarks.md --md2html
  python bookmarks.py -f Bookmarks.md --md2html -o Bookmarks.html -y   # no prompt
"""
import argparse
import os
import re
import sys

import bookmark_core as core

# Windows GBK 控制台/管道下打印中文会 UnicodeEncodeError: 强制 UTF-8 输出
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

URL_LIKE_TITLE = re.compile(r"^https?://", re.I)


def build_arg_parser():
    parser = argparse.ArgumentParser(
        prog="bookmarks.py",
        description="Convert browser bookmarks between Netscape HTML, JSON and Markdown "
                    "(stdlib only, no third-party dependencies).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Examples:", 1)[1] if "Examples:" in __doc__ else "")
    direction = parser.add_mutually_exclusive_group(required=True)
    direction.add_argument("--html2md", action="store_true", help="Netscape HTML -> Markdown")
    direction.add_argument("--md2html", action="store_true", help="Markdown -> Netscape HTML (importable by browsers)")
    direction.add_argument("--html2json", action="store_true", help="Netscape HTML -> JSON tree")
    direction.add_argument("--json2html", action="store_true", help="JSON tree -> Netscape HTML")
    parser.add_argument("-f", "--file", required=True, help="input file path")
    parser.add_argument("-o", "--output_file", help="output file path, default: input name with the new extension")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="overwrite an existing output file without asking (default: prompt on a tty)")
    parser.add_argument("--fetch-titles", action="store_true",
                        help="fetch real page titles for links whose title is blank or a bare URL (uses network)")
    parser.add_argument("--timeout", type=float, default=10.0, help="per-request timeout seconds for --fetch-titles")
    parser.add_argument("--icons", action="store_true", help="write ICON attributes into generated HTML (parsed either way)")
    parser.add_argument("--dedup", action="store_true", help="remove duplicated URLs, keeping the first occurrence")
    parser.add_argument("--meta", action="store_true",
                        help="keep dates/tags as HTML comments in Markdown (needed for lossless md round-trips)")
    return parser


def read_text(path):
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        return fh.read()


def load_model(args):
    text = read_text(args.file)
    try:
        if args.md2html:
            model, warnings = core.parse_md(text)
            for warning in warnings:
                print("[md] %s" % warning)
            return model, text
        if args.json2html:
            return core.parse_json(text), text
        return core.parse_html(text), text
    except (ValueError, KeyError) as exc:
        print("Failed to parse %s: %s" % (args.file, exc))
        print("Check that the direction flag matches the actual file format.")
        sys.exit(2)


DIRECTIONS = ("html2md", "md2html", "html2json", "json2html")

OUTPUT_EXTENSIONS = {"html2md": ".md", "md2html": ".html", "html2json": ".json", "json2html": ".html"}

EMPTY_MODEL_HINTS = {
    "html2md": "看起来不是浏览器导出的 Netscape HTML 书签（若要 Markdown -> HTML 请用 --md2html）",
    "html2json": "看起来不是浏览器导出的 Netscape HTML 书签（若要 HTML -> Markdown 请用 --html2md）",
    "md2html": "看起来不是本工具生成的 Markdown 书签列表 `- [标题](url)`（若要 HTML -> Markdown 请用 --html2md）",
    "json2html": "看起来不是 --html2json 生成的 JSON 树（若要 HTML -> JSON 请用 --html2json）",
}


def direction_of(args):
    for name in DIRECTIONS:
        if getattr(args, name):
            return name
    return "json2html"  # mutually exclusive group makes this unreachable


def abort_if_no_links(args, model, text):
    """A parse with zero links means the direction flag does not match the file."""
    folders, links = core.count_nodes(model)
    if links or not text.strip():
        return
    print("错误: 未检测到任何书签/链接（解析到 %d 个文件夹 / %d 个链接），可能选错转换方向："
          "文件 %s %s。" % (folders, links, args.file, EMPTY_MODEL_HINTS[direction_of(args)]))
    print("已中止，未写出空的输出文件。")
    sys.exit(1)


def _same_path(left, right):
    """Same file behind different spellings (case, 8.3 short name, symlink, hard link)."""
    if os.path.normcase(os.path.realpath(left)) == os.path.normcase(os.path.realpath(right)):
        return True
    try:
        return os.path.samefile(left, right)
    except OSError:
        return False


def abort_if_output_is_input(args, out):
    if _same_path(out, args.file):
        print("错误: 输出路径与输入文件是同一个文件（%s），已中止以免覆盖源文件。" % out)
        print("请用 -o 指定一个不同的输出路径。")
        sys.exit(1)


def _is_interactive():
    try:
        return bool(sys.stdin) and bool(sys.stdout) and sys.stdin.isatty() and sys.stdout.isatty()
    except (AttributeError, ValueError, OSError):
        return False


def confirm_overwrite(args, out):
    """Ask before truncating an existing target; never block on pipes/CI/non-tty."""
    if args.yes or not os.path.isfile(out) or not _is_interactive():
        return
    try:
        answer = input("目标已存在: %s，覆盖? [y/N] " % out)
    except (EOFError, KeyboardInterrupt):
        print("\n已取消，未写入 %s。" % out)
        sys.exit(1)
    if answer.strip().lower() not in ("y", "yes"):
        print("已取消，未写入 %s。" % out)
        sys.exit(1)


def dedup_model(root):
    seen = {}
    removed = []

    def recurse(node):
        kept = []
        for child in node.get("children", []):
            if child.get("type") == "link":
                url = child.get("url", "")
                if url in seen:
                    removed.append((url, seen[url]))
                    continue
                seen[url] = child.get("title", "")
            else:
                recurse(child)
            kept.append(child)
        node["children"] = kept

    recurse(root)
    for url, title in removed:
        print("[dedup] removed duplicate: %s (%s)" % (url, title or "no title"))
    return len(removed)


def fetch_titles(root, timeout):
    from urllib.request import Request, urlopen

    todo = [n for n in core.walk(root)
            if n.get("type") == "link"
            and re.match(r"^https?://", n.get("url", ""))
            and (not n.get("title") or URL_LIKE_TITLE.match(n.get("title", "")))]
    ok = failed = 0
    for index, node in enumerate(todo, 1):
        print("[fetch %d/%d] %s" % (index, len(todo), node["url"]))
        title = None
        try:
            request = Request(node["url"], headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=timeout) as response:
                body = response.read(300000).decode("utf-8", "replace")
            match = re.search(r"<title[^>]*>(.*?)</title>", body, re.S | re.I)
            if match:
                title = re.sub(r"\s+", " ", match.group(1)).strip()
        except Exception as exc:
            failed += 1
            print("[fetch] failed: %s" % exc.__class__.__name__)
            continue
        if title:
            node["title"] = title
            ok += 1
        else:
            failed += 1
    print("[fetch] done: %d candidate(s), %d renamed, %d failed" % (len(todo), ok, failed))


def default_output(args, extension):
    if args.output_file:
        return args.output_file
    return os.path.splitext(args.file)[0] + extension


def main():
    args = build_arg_parser().parse_args()
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    model, source_text = load_model(args)
    abort_if_no_links(args, model, source_text)

    out = default_output(args, OUTPUT_EXTENSIONS[direction_of(args)])
    abort_if_output_is_input(args, out)
    confirm_overwrite(args, out)

    if args.dedup:
        dedup_model(model)
    if args.fetch_titles:
        fetch_titles(model, args.timeout)

    if args.html2md:
        text, warnings = core.generate_md(model, meta=args.meta)
        for warning in warnings:
            print("[md] %s" % warning)
    elif args.html2json:
        text = core.generate_json(model)
    else:
        text = core.generate_html(model, icons=args.icons)

    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    folders, links = core.count_nodes(model)
    print("Wrote %s (%d folders, %d links)" % (out, folders, links))


if __name__ == "__main__":
    main()
