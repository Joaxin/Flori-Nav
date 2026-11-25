# nav/views.py
"""导航应用视图的**门面**(2026-11-07 拆分后)。

实现按域分在 views_nav_base / sites / assets / check / export / tools / ai / pet。
本文件只做全量回填:`urls.py` 与测试里的 `from .views import xxx` 一个字不用改。

⚠️ 改行为去对应域模块;新增名字记得同时加进下面的 import 列表。
"""

# 原 import 头保留:`patch('nav.views.requests.get')` 这类**模块对象**的 patch
# 是直接改 requests.get,与哪个模块 import 无关;但常量(NAV_TOOL_MAX_BYTES /
# DEFAULT_SITES)与函数(_nav_check_link)的 patch 必须打在真正读取它的模块上,
# 已在 2026-11-07 迁到 views_nav_tools / views_nav_base / views_nav_check。
import base64
import json
import logging
import math
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, urljoin
from html import unescape as _html_unescape, escape as _html_escape

import requests
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render, get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST, require_http_methods

from .models import NavSite, NavCategory, NavTool, NavAiConfig
from .nav_data import DEFAULT_SITES
from . import ai as ai_pipeline

from .views_nav_base import (
    NAV_AI_IMPORT_MAX, NAV_CHILDREN_MAX, NAV_SITE_ORDER_MAX, NAV_TAG_MAX, NAV_TAG_NAME_MAX,
    _NAV_DESC_NAME2_RE, _NAV_DESC_NAME_RE, _NAV_ICON_HREF1_RE, _NAV_ICON_HREF2_RE,
    _NAV_META_TITLE_RE, _NAV_META_UA, _NAV_OGDESC_RE, _builtin_customized, _clean_icon_color,
    _clean_nav_children, _clean_nav_tags, _decode_nav_html, _json_body, _nav_payload,
    _normalize_nav_url, _parse_category_order_items, _parse_site_meta, _parse_tool_meta,
    _save_category_order, _seed_nav_sites, _site_defaults, _site_row, logger,
    NAV_SEARCH_ENGINES,
)  # noqa: F401
from .views_nav_sites import (
    _HYGIENE_TRACK_KEYS, _HYGIENE_TRACK_PREFIXES, _archive_flag, _hygiene_url,
    api_nav_alt_swap, api_nav_archive, api_nav_batch, api_nav_click, api_nav_guest_scope,
    api_nav_hygiene, api_nav_category_unhide, nav_add,
    nav_category_order, nav_category_rename, nav_delete, nav_edit, nav_fetch_meta, nav_move,
    nav_restore, nav_site_order, nav_site_pin, nav_site_swap, nav_sites,
)  # noqa: F401
from .views_nav_assets import (
    NAV_FAVICON_MAX_BYTES, api_nav_bing_bg, api_nav_bing_bg_raw, api_nav_favicon_localize,
    api_nav_icon_upload, nav_favicon_file,
)  # noqa: F401
from .views_nav_check import (
    NAV_LINK_MAX, NAV_LINK_TIMEOUT, NAV_LINK_TIMEOUT_MAX, NAV_LINK_TIMEOUT_MIN,
    NAV_LINK_TOTAL_MAX, NAV_LINK_TOTAL_MIN, NAV_LINK_TOTAL_TIMEOUT, NAV_LINK_UPDATE_BATCH,
    NAV_MOVED_MAX, NAV_MOVED_READ_MAX, NAV_SUBCAT_SEPS, _NAV_A_HREF_RE, _NAV_CANONICAL2_RE,
    _NAV_CANONICAL_RE, _NAV_MOVE_HINT_RE, _NAV_OGURL2_RE, _NAV_OGURL_RE, _NAV_REFRESH_RE,
    _NAV_URL_IN_TEXT_RE, _nav_check_link, _nav_check_links, _nav_detect_moved,
    _nav_is_same_site, _nav_link_param, _nav_site_key, _nav_split_subcat, _parse_moved_urls,
    _read_html_capped, _record_link_checks, nav_link_adopt, nav_link_check,
)  # noqa: F401
from .views_nav_export import (
    _bookmark_a_line, nav_export, nav_export_bookmark, nav_import, nav_reset,
)  # noqa: F401
from .views_nav_guest import nav_guest  # noqa: F401
from .nav_access import nav_login, nav_logout  # noqa: F401
from .views_nav_tools import (
    NAV_TOOL_MAX_BYTES, _HTML_TAG_RE, _nav_tool_sanitize_text, nav_manifest, nav_pwa_icon,
    nav_sw, nav_tool_delete, nav_tool_edit, nav_tool_open, nav_tool_upload,
)  # noqa: F401
from .views_nav_ai import (
    _nav_fetch_meta_map, _nav_meta_best_effort, api_nav_ai_config, api_nav_ai_generate,
    api_nav_ai_models, api_nav_ai_model_test, api_nav_ai_logs,
    api_nav_ai_import, api_nav_ai_parse, api_nav_ai_prompt,
    api_nav_ai_classify_items, api_nav_ai_classify_batch, api_nav_ai_classify_prompt,
    api_nav_ai_classify_parse, api_nav_ai_classify_apply, api_nav_ai_suggest,
)  # noqa: F401
from .views_nav_pet import (
    _PET_GEO_CACHE_TTL, _PET_GEO_TIMEOUT, _pet_ai_status, _pet_geo_pick, _pet_geo_score,
    _pet_geo_strip_suffix, api_nav_pet_ai_config, api_nav_pet_balance, api_nav_pet_brief,
    api_nav_pet_chat, api_nav_pet_quick, api_nav_pet_daily_en, api_nav_pet_geo,
    api_nav_pet_ip_geo, api_nav_pet_weather,
    api_nav_pet_whisper,
)  # noqa: F401
