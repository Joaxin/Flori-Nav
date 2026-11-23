# -*- coding: utf-8 -*-
"""Shared bookmark tree model and Netscape-HTML / JSON / Markdown converters.

The model is a dict tree:
  folder: {"type": "folder", "title": str, "children": [node...],
           optional "add_date", "last_modified", "personal_toolbar": True}
  link:   {"type": "link", "title": str, "url": str,
           optional "add_date", "last_modified", "tags": [str...], "icon": str,
         "description": str}
The virtual root is a folder; its children are the top-level folders
(bookmark bar, other bookmarks, mobile bookmarks ...).
"""
import json
import re
from html import escape
from html.parser import HTMLParser

MODEL_KEYS = ("type", "title", "url", "children",
              "add_date", "last_modified", "tags", "icon", "personal_toolbar")


def folder(title="", children=None, **meta):
    node = {"type": "folder", "title": title, "children": list(children or [])}
    node.update(meta)
    return node


def link(title="", url="", **meta):
    node = {"type": "link", "title": title, "url": url}
    node.update(meta)
    return node


def walk(node):
    yield node
    if node.get("type") == "folder":
        for child in node.get("children", []):
            yield from walk(child)


def count_nodes(root):
    folders = sum(1 for n in walk(root) if n.get("type") == "folder") - 1
    links = sum(1 for n in walk(root) if n.get("type") == "link")
    return folders, links


def _clean_title(text):
    return re.sub(r"\s+", " ", text or "").strip()


def _apply_date_attrs(node, attrs):
    add = attrs.get("add_date") or attrs.get("add_date".upper())
    if add:
        node["add_date"] = add
    last = attrs.get("last_modified")
    if last:
        node["last_modified"] = last


# --------------------------------------------------------------------------
# Netscape HTML
# --------------------------------------------------------------------------

class _NetscapeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = folder("Bookmarks")
        self.stack = [self.root]
        self._cap = None
        self._buf = []
        self._attrs = {}
        self._last_link = None      # 紧邻的 <DD> 归属这条链接
        self._in_dd = False
        self._dd_buf = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ("h3", "a"):
            self._cap = tag
            self._buf = []
            self._attrs = {k.lower(): (v or "") for k, v in attrs}
        elif tag == "dd":
            # Netscape 的 <DD> 就是描述;只有紧跟链接之后才算,文件夹后的 <DD> 不当描述
            self._in_dd = True
            self._dd_buf = []
        elif tag == "dl":
            self._last_link = None
            top = self.stack[-1]
            pending = top.pop("_pending", None)
            self.stack.append(pending if pending is not None else top)
        # dt / dd / p / hr / h1 / body / meta / title: ignored or absorbed

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data):
        if self._in_dd:
            self._dd_buf.append(data)
        elif self._cap:
            self._buf.append(data)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "dd":
            if self._in_dd and self._last_link is not None:
                desc = " ".join("".join(self._dd_buf).split())[:200]
                if desc:
                    self._last_link["description"] = desc
                self._last_link = None
            self._in_dd = False
            self._dd_buf = []
            return
        if tag == "dl":
            if len(self.stack) > 1:
                self.stack.pop()
        elif tag == "h3" and self._cap == "h3":
            node = folder(_clean_title("".join(self._buf)))
            attrs = self._attrs
            _apply_date_attrs(node, attrs)
            if attrs.get("personal_toolbar_folder", "").lower() == "true":
                node["personal_toolbar"] = True
            top = self.stack[-1]
            top["children"].append(node)
            top["_pending"] = node
            self._cap = None
        elif tag == "a" and self._cap == "a":
            attrs = self._attrs
            node = link(_clean_title("".join(self._buf)), attrs.get("href", ""))
            _apply_date_attrs(node, attrs)
            tags = (attrs.get("tags") or "").strip()
            if tags:
                node["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
            icon = attrs.get("icon")
            if icon:
                node["icon"] = icon
            self.stack[-1]["children"].append(node)
            self._last_link = node
            self._cap = None


def _strip_pending(node):
    node.pop("_pending", None)
    if node.get("type") == "folder":
        for child in node.get("children", []):
            _strip_pending(child)


def parse_html(text):
    parser = _NetscapeParser()
    parser.feed(text)
    parser.close()
    _strip_pending(parser.root)
    return parser.root


def generate_html(root, icons=False):
    lines = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        "<!-- This is an automatically generated file.",
        "     It will be read and overwritten.",
        "     DO NOT EDIT! -->",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        "<TITLE>Bookmarks</TITLE>",
        "<H1>Bookmarks</H1>",
        "<DL><p>",
    ]

    def emit(node, indent):
        pad = "    " * indent
        if node.get("type") == "folder":
            attrs = ""
            if "add_date" in node:
                attrs += ' ADD_DATE="%s"' % escape(str(node["add_date"]), True)
            if "last_modified" in node:
                attrs += ' LAST_MODIFIED="%s"' % escape(str(node["last_modified"]), True)
            if node.get("personal_toolbar"):
                attrs += ' PERSONAL_TOOLBAR_FOLDER="true"'
            lines.append("%s<DT><H3%s>%s</H3>" % (pad, attrs, escape(node.get("title", ""), False)))
            lines.append("%s<DL><p>" % pad)
            for child in node.get("children", []):
                emit(child, indent + 1)
            lines.append("%s</DL><p>" % pad)
        else:
            attrs = ' HREF="%s"' % escape(node.get("url", ""), True)
            if "add_date" in node:
                attrs += ' ADD_DATE="%s"' % escape(str(node["add_date"]), True)
            if "last_modified" in node:
                attrs += ' LAST_MODIFIED="%s"' % escape(str(node["last_modified"]), True)
            if node.get("tags"):
                attrs += ' TAGS="%s"' % escape(",".join(node["tags"]), True)
            if icons and node.get("icon"):
                attrs += ' ICON="%s"' % escape(node["icon"], True)
            lines.append('%s<DT><A%s>%s</A>' % (pad, attrs, escape(node.get("title", ""), False)))
            if node.get("description"):
                lines.append('%s<DD>%s' % (pad, escape(node["description"], False)))

    for child in root.get("children", []):
        emit(child, 1)
    lines.append("</DL><p>")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# JSON (the dict model serialized as-is)
# --------------------------------------------------------------------------

def _node_from_json(data, path):
    if not isinstance(data, dict):
        raise ValueError("%s: node must be an object" % path)
    node_type = data.get("type")
    if node_type not in ("folder", "link"):
        raise ValueError("%s: 'type' must be \"folder\" or \"link\"" % path)
    title = data.get("title", "")
    if not isinstance(title, str):
        raise ValueError("%s: 'title' must be a string" % path)
    meta = {}
    for key in ("add_date", "last_modified"):
        if key in data:
            meta[key] = str(data[key])
    if data.get("tags"):
        tags = data["tags"]
        if not isinstance(tags, list):
            raise ValueError("%s: 'tags' must be a list" % path)
        meta["tags"] = [str(t) for t in tags]
    if data.get("icon"):
        meta["icon"] = str(data["icon"])
    if data.get("personal_toolbar"):
        meta["personal_toolbar"] = True
    if node_type == "link":
        url = data.get("url")
        if not isinstance(url, str) or not url:
            raise ValueError("%s: link node requires a non-empty string 'url'" % path)
        return link(_clean_title(title), url, **meta)
    children = data.get("children", [])
    if not isinstance(children, list):
        raise ValueError("%s: folder 'children' must be a list" % path)
    kids = [_node_from_json(c, "%s.children[%d]" % (path, i)) for i, c in enumerate(children)]
    return folder(_clean_title(title), kids, **meta)


def parse_json(text):
    return _node_from_json(json.loads(text), "$")


def generate_json(root):
    return json.dumps(root, ensure_ascii=False, indent=2) + "\n"


# --------------------------------------------------------------------------
# Markdown
#   folder  -> '#'*level + '  ' + title   ('---' after every level-2 heading)
#   link    -> '- [title](url)'
#   optional metadata as trailing ' <!-- add_date=.. last_modified=.. tags=a,b -->'
# --------------------------------------------------------------------------

_MD_HEAD_RE = re.compile(r"^(#{1,6})(?:[ \t]+(.*?))?[ \t]*(?:<!--[ \t]*(.*?)[ \t]*-->)?[ \t]*$")
_MD_LINK_RE = re.compile(r"^[ \t]*[-*][ \t]+\[((?:\\.|[^\]\\])*)\]\((.*?)\)[ \t]*(?:<!--[ \t]*(.*?)[ \t]*-->)?[ \t]*$")
_MD_ANGLE_URL_RE = re.compile(r"^<(.*)>$", re.S)


def _md_escape_title(title):
    return re.sub(r"([\[\]\\])", r"\\\1", title)


def _md_unescape(text):
    return re.sub(r"\\(.)", r"\1", text)


def _md_format_url(url):
    if re.search(r"[\s()<>]", url):
        return "<" + url + ">"
    return url.replace("\\", "\\\\").replace(")", "\\)")


def _md_meta_comment(node):
    parts = []
    for key in ("add_date", "last_modified"):
        if key in node:
            parts.append("%s=%s" % (key, node[key]))
    if node.get("tags"):
        parts.append("tags=%s" % ",".join(node["tags"]))
    if node.get("personal_toolbar"):
        parts.append("toolbar=1")
    return "  <!-- %s -->" % " ".join(parts) if parts else ""


def _md_apply_meta(node, token_string):
    if not token_string:
        return
    for token in token_string.split():
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        if key == "tags":
            if value:
                node["tags"] = [t for t in value.split(",") if t]
        elif key in ("add_date", "last_modified"):
            node[key] = value
        elif key == "toolbar":
            if value == "1":
                node["personal_toolbar"] = True


def generate_md(root, meta=False):
    lines = []
    warnings = []

    def emit(node, level):
        if node.get("type") == "folder":
            head_level = min(level, 6)
            if level > 6:
                warnings.append("folder '%s' is deeper than 6 levels; heading level clamped to 6"
                                % node.get("title", ""))
            head = "#" * head_level + "  " + node.get("title", "")
            if meta:
                head += _md_meta_comment(node)
            lines.append("")
            lines.append(head)
            lines.append("")
            if head_level == 2:
                lines.append("---")
                lines.append("")
            # links first: anything emitted after a heading is owned by that
            # heading's folder, so trailing links would re-parse into the last subfolder
            children = node.get("children", [])
            for child in children:
                if child.get("type") != "folder":
                    emit(child, level + 1)
            for child in children:
                if child.get("type") == "folder":
                    emit(child, level + 1)
        else:
            line = "- [%s](%s)" % (_md_escape_title(node.get("title", "")),
                                   _md_format_url(node.get("url", "")))
            if meta:
                line += _md_meta_comment(node)
            lines.append(line)

    for child in root.get("children", []):
        emit(child, 2)
    text = "\n".join(lines).strip("\n")
    return (text + "\n" if text else ""), warnings


def parse_md(text):
    root = folder("Bookmarks")
    stack = [(1, root)]
    warnings = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line == "---" or (line.startswith("<!--") and line.endswith("-->")):
            continue
        match = _MD_HEAD_RE.match(line)
        if match:
            level = len(match.group(1))
            title = _md_unescape(match.group(2) or "")
            while len(stack) > 1 and stack[-1][0] >= level:
                stack.pop()
            if level > stack[-1][0] + 1:
                warnings.append("line %d: heading level jumps from %d to %d"
                                % (lineno, stack[-1][0], level))
            node = folder(title)
            _md_apply_meta(node, match.group(3))
            stack[-1][1]["children"].append(node)
            stack.append((level, node))
            continue
        match = _MD_LINK_RE.match(line)
        if match:
            url = match.group(2)
            angle = _MD_ANGLE_URL_RE.match(url)
            if angle:
                url = angle.group(1)
            else:
                url = re.sub(r"\\(.)", r"\1", url)
            node = link(_md_unescape(match.group(1)), url)
            _md_apply_meta(node, match.group(3))
            stack[-1][1]["children"].append(node)
            continue
        warnings.append("line %d: unrecognized content %r" % (lineno, line[:60]))
    return root, warnings
