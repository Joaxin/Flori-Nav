# -*- coding: utf-8 -*-
"""Format checker for bookmark files (Netscape HTML / JSON / Markdown).

Detects the format by extension (or file content), parses it with the same
engine as bookmarks.py, then reports structural problems as ERROR / WARN / INFO.
Exit code: 0 clean, 1 has ERROR (or WARN too with --strict) -- a parse failure is
reported as ERROR and also exits 1 --, 2 cannot read the file at all.

Examples:
  python check_bookmarks.py -f bookmarks_2026_9_23.html
  python check_bookmarks.py -f Bookmarks.md --strict
"""
import argparse
import json
import os
import re
import sys
import time

import bookmark_core as core

# Windows GBK 控制台/管道下打印中文会 UnicodeEncodeError: 强制 UTF-8 输出
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

KNOWN_SCHEMES = ("http:", "https:", "ftp:", "file:", "about:", "data:",
                 "chrome:", "chrome-extension:", "javascript:", "mailto:")

# unix seconds for 2000-01-01 .. now + ~3 years
DATE_MIN = 946684800
DATE_MAX = int(time.time()) + 3 * 365 * 86400

MD_LINK_HINT = re.compile(r"^\s*[-*]\s*\[")


def build_arg_parser():
    parser = argparse.ArgumentParser(
        prog="check_bookmarks.py",
        description="Validate a bookmark file (Netscape HTML / JSON / Markdown) and "
                    "report structural problems as ERROR / WARN / INFO.")
    parser.add_argument("-f", "--file", required=True, help="file to check")
    parser.add_argument("--format", choices=("auto", "html", "md", "json"), default="auto",
                        help="input format, default: auto (by extension, then content)")
    parser.add_argument("--strict", action="store_true", help="warnings also cause a non-zero exit code")
    return parser


def detect_format(path, text):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".html", ".htm"):
        return "html"
    if ext == ".json":
        return "json"
    if ext == ".md":
        return "md"
    head = text.lstrip()[:200]
    if "NETSCAPE-Bookmark-file" in head or head.startswith("<!DOCTYPE") or head.startswith("<"):
        return "html"
    try:
        json.loads(text)
        return "json"
    except ValueError:
        pass
    return "md"


def line_of(text, offset):
    return text.count("\n", 0, offset) + 1


def check_html_raw(text, issues):
    if "NETSCAPE-Bookmark-file" not in text[:200]:
        issues.append(("WARN", "structure", "missing '<!DOCTYPE NETSCAPE-Bookmark-file-1>' header"))
    if "<DL" not in text.upper():
        issues.append(("ERROR", "structure", "no <DL> folder containers found"))
    if "<A" not in text.upper():
        issues.append(("WARN", "structure", "no <A> links found, file appears to hold no bookmarks"))
    for match in re.finditer(r"<A\b[^>]*>", text, re.I):
        if not re.search(r"\bHREF\s*=", match.group(0), re.I):
            issues.append(("ERROR", "line %d" % line_of(text, match.start()), "<A> without HREF attribute"))
        elif re.search(r'\bHREF\s*=\s*""', match.group(0), re.I):
            issues.append(("ERROR", "line %d" % line_of(text, match.start()), "<A> with empty HREF"))


def check_md_raw(text, issues):
    previous_level = None
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line == "---":
            continue
        heading = re.match(r"^(#{1,6})\s", line)
        if heading:
            level = len(heading.group(1))
            if previous_level is not None and level > previous_level + 1:
                issues.append(("WARN", "line %d" % lineno,
                               "heading level jumps from %d to %d, folder nesting may be lost"
                               % (previous_level, level)))
            previous_level = level
        elif line.startswith("- ") or line.startswith("* "):
            if MD_LINK_HINT.match(line) and not re.match(
                    r"^\s*[-*]\s*\[((?:\\.|[^\]\\])*)\]\(.*\)", line):
                issues.append(("WARN", "line %d" % lineno, "malformed link line: %s" % line[:60]))
        elif line.startswith("<!--"):
            continue
        else:
            issues.append(("WARN", "line %d" % lineno, "content not recognized as folder heading or link: %r" % line[:60]))


def check_json_raw(data, issues, path="$"):
    if not isinstance(data, dict):
        issues.append(("ERROR", path, "node must be an object"))
        return
    extra = set(data) - set(core.MODEL_KEYS)
    if extra:
        issues.append(("WARN", path + "/" + str(data.get("title", "")),
                       "unknown key(s): %s" % ", ".join(sorted(extra))))
    node_type = data.get("type")
    if node_type not in ("folder", "link"):
        issues.append(("ERROR", path, "'type' must be \"folder\" or \"link\", got %r" % node_type))
        return
    if node_type == "link" and not isinstance(data.get("url"), str):
        issues.append(("ERROR", path, "link node requires string 'url'"))
    for child_index, child in enumerate(data.get("children", []) or []):
        check_json_raw(child, issues, "%s.children[%d]" % (path, child_index))


def check_model(root, fmt, issues):
    seen_urls = {}

    def check_dates(node, where):
        for key in ("add_date", "last_modified"):
            value = node.get(key)
            if value is None:
                continue
            if not str(value).isdigit():
                issues.append(("WARN", where, "%s=%r is not a unix timestamp" % (key, value)))
            elif not (DATE_MIN <= int(value) <= DATE_MAX):
                issues.append(("WARN", where, "%s=%s looks like an out-of-range date" % (key, value)))

    def recurse(node, trail, depth):
        where = "/".join(trail) or "(root)"
        check_dates(node, where)
        if node.get("type") == "folder":
            if not node.get("title"):
                issues.append(("WARN", where, "folder with empty title"))
            if not node.get("children"):
                issues.append(("INFO", where, "empty folder"))
            if fmt == "md" and depth > 6:
                issues.append(("WARN", where, "deeper than 6 levels; Markdown headings cannot preserve this nesting"))
            for child in node.get("children", []):
                recurse(child, trail + [child.get("title") or "(untitled)"], depth + 1)
        else:
            url = node.get("url", "")
            if not url:
                issues.append(("ERROR", where, "link with empty URL"))
            elif not url.lower().startswith(KNOWN_SCHEMES):
                issues.append(("WARN", where, "unusual URL scheme: %s" % url[:40]))
            if not node.get("title"):
                issues.append(("WARN", where, "link with empty title: %s" % url[:60]))
            if url:
                if url in seen_urls:
                    issues.append(("WARN", where, "duplicate URL (first seen under %s)" % seen_urls[url]))
                else:
                    seen_urls[url] = where

    for child in root.get("children", []):
        recurse(child, [child.get("title") or "(untitled)"], 2)
    return root


def main():
    args = build_arg_parser().parse_args()
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    try:
        with open(args.file, encoding="utf-8-sig", errors="replace") as fh:
            text = fh.read()
    except OSError as exc:
        print("Cannot read %s: %s" % (args.file, exc))
        return 2

    fmt = args.format if args.format != "auto" else detect_format(args.file, text)
    issues = []
    model = None
    try:
        if fmt == "html":
            check_html_raw(text, issues)
            model = core.parse_html(text)
        elif fmt == "json":
            try:
                check_json_raw(json.loads(text), issues)
            except ValueError as exc:
                issues.append(("ERROR", "structure", "invalid JSON: %s" % exc))
            model = core.parse_json(text)
        else:
            model, _parse_warnings = core.parse_md(text)
            check_md_raw(text, issues)
    except (ValueError, KeyError) as exc:
        issues.append(("ERROR", "structure", "failed to parse as %s: %s" % (fmt, exc)))

    if model is not None:
        check_model(model, fmt, issues)

    folders, links = core.count_nodes(model) if model else (0, 0)
    print("Format: %s | folders: %d | links: %d" % (fmt, folders, links))
    if not issues:
        print("OK, no issues found.")
        return 0
    counts = {"ERROR": 0, "WARN": 0, "INFO": 0}
    for severity, where, message in issues:
        counts[severity] += 1
        print("%-5s %-40s %s" % (severity, where, message))
    print("Summary: %d error(s), %d warning(s), %d info" % (counts["ERROR"], counts["WARN"], counts["INFO"]))
    if counts["ERROR"] or (args.strict and counts["WARN"]):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
