# -*- coding: utf-8 -*-
"""模板全局变量:`static_version`。

nav 的模板里大量使用 `{% static 'js/x.js' %}?v={{ static_version }}`。
它取 nav/static 里最新文件的 mtime,改完脚本刷新页面就能拿到新版,不用手工改版本号。

2026-11-14 两处调整:
- 只扫 `nav/static`:模板里带 `?v=` 的只有这个目录下的文件;把项目级 `static/`
  (vendor 大文件)也算进来,会让"改一张卡片样式 → 所有 vendor URL 一起变号"。
- 缓存 30s → 2s:改完前端最多等 2 秒,不用再怀疑"是不是缓存没刷新"。
"""

import os
import time

from django.conf import settings

_CACHE = {'at': 0.0, 'v': ''}


def nav_brand(request):
    """品牌名与标识(2026-11-14)。

    模板里要出现三处(标题、顶栏字标、PWA 名称),统一从 nav.brand 取,
    改名字只改一个常量。标识是内联 SVG,不是静态文件 —— 顶栏要跟着字号缩放。
    """
    from nav.brand import BRAND_MARK_SVG, BRAND_NAME, BRAND_TAGLINE

    return {
        'nav_brand_name': BRAND_NAME,
        'nav_brand_tagline': BRAND_TAGLINE,
        'nav_brand_mark': BRAND_MARK_SVG,
    }


def nav_lang(request):
    """页面语言(2026-11-23)。

    语言状态只有一份:cookie `nav_lang`。LocaleMiddleware 也读它,
    所以模板里的 gettext 与前端词条表不会各说各话。
    取值只有 zh / en;未知值一律回落中文。
    """
    raw = (request.COOKIES.get('nav_lang') or '').strip().lower()
    # ?lang=xx 只对当次请求生效，用于预览/分享，不写 cookie
    query = (request.GET.get('lang') or '').strip().lower()
    if query in ('zh', 'zh-hans', 'en'):
        raw = query
    lang = 'en' if raw.startswith('en') else 'zh'
    return {
        'nav_lang': lang,
        'nav_lang_code': 'en' if lang == 'en' else 'zh-CN',
    }


def static_version(request):
    now = time.time()
    if now - _CACHE['at'] > 2:
        latest = 0.0
        for base in (settings.BASE_DIR / 'nav' / 'static',):
            for dirpath, _dirnames, filenames in os.walk(base):
                for name in filenames:
                    try:
                        latest = max(latest, os.path.getmtime(os.path.join(dirpath, name)))
                    except OSError:
                        pass
        _CACHE['at'] = now
        _CACHE['v'] = str(int(latest))
    return {'static_version': _CACHE['v']}
