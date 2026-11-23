# nav/tests_nav_common.py
"""nav 测试的公共底座(2026-11-07 从 tests.py 拆出)。

原来 3499 行的 `nav/tests.py` 把 54 个类按时间堆在一起,现在按域分到
`tests_nav_sites` / `tests_nav_ai` / `tests_nav_health` / `tests_nav_icons` /
`tests_nav_pet` / `tests_nav_shell`。公共 import 与读 JS 源码的小工具
(`_pet_js` / `_find_ai_js` / `_health_js` 等)留在本文件,各文件按需**显式** import。

约定:新增用例放进对应域;跨域夹具才放这里。
"""

import json

import os

import re

from unittest.mock import patch

from unittest import mock

from django.test import TestCase, override_settings

from django.urls import reverse

from django.core.files.uploadedfile import SimpleUploadedFile

from .models import NavSite, NavTool, NavCategory

import json as _json

from .models import NavAiConfig  # noqa: E402

def _pet_js():
    """桌宠 JS 已拆到 static/js/pet.js(2026-10-25 渐进拆分第一刀)——契约断言读两处:渲染页 + pet.js。"""
    import os as _os
    return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              'static', 'js', 'pet.js'), encoding='utf-8').read()

def _find_ai_js():
    """AI 找网站 JS 已拆到 static/js/find-ai.js(2026-10-25 渐进拆分第二刀)——契约断言读两处:渲染页 + find-ai.js。"""
    import os as _os
    return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              'static', 'js', 'find-ai.js'), encoding='utf-8').read()

def _stars_js():
    """星标/过滤/拖拽 JS 已拆到 static/js/stars-filter.js(2026-10-25 第五刀)。"""
    import os as _os
    return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              'static', 'js', 'stars-filter.js'), encoding='utf-8').read()

def _lt_js():
    """链接测活 JS 已拆到 static/js/linktest.js(2026-10-25 第三刀)。"""
    import os as _os
    return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              'static', 'js', 'linktest.js'), encoding='utf-8').read()

def _ie_js():
    """导入导出/书签 JS 已拆到 static/js/import-export.js(2026-10-25 第四刀)。"""
    import os as _os
    return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              'static', 'js', 'import-export.js'), encoding='utf-8').read()

def _theme_js():
    """主题皮肤/壁纸/时钟 JS 已拆到 static/js/theme.js(2026-10-25 渐进拆分第六刀)。"""
    import os as _os
    return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              'static', 'js', 'theme.js'), encoding='utf-8').read()

def _health_js():
    """体检篮/健康总览/点击热力 JS(2026-10-25 brainstorm 落地轮)。"""
    import os as _os
    return open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              'static', 'js', 'health.js'), encoding='utf-8').read()

def _batch_js():
    """多选批量操作 JS(2026-10-26 点单 1;休眠动作 2026-10-30 并入同一端点)。"""
    return open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'static', 'js', 'batch.js'), encoding='utf-8').read()


def static_text(rel_path):
    """读取 static 目录里的文件(2026-11-07 CSS 外置后用)。

    断言"页面上有这条样式"时,目标应该是"浏览器实际加载的全部内容":
    模板 HTML + 它引用的 CSS/JS。找不到文件返回空串,让断言按原样失败。
    """
    from django.contrib.staticfiles import finders
    found = finders.find(rel_path)
    if not found:
        return ''
    with open(found, encoding='utf-8') as fh:
        return fh.read()
