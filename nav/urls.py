# nav/urls.py
# 不带 app_name:URL 名保持全局(nav_sites / nav_add / ...),宿主页面里的 {% url %} 无需改动。
from django.urls import path
from . import views
from .views_nav_check import nav_link_fix

urlpatterns = [
    # `/nav/` 单入口:带令牌=主人全量页,不带=访客只读页(见 nav/nav_access.py)
    path('nav/', views.nav_sites, name='nav_sites'),
    # 强制访客态(不看 cookie),保留给已经分享出去的链接
    path('nav/guest/', views.nav_guest, name='nav_guest'),
    # 访客页「主人登录 / 退出主人态」:只收 POST,密码不进 URL
    path('nav/login/', views.nav_login, name='nav_login'),
    path('nav/logout/', views.nav_logout, name='nav_logout'),

    # --- 网址导航 APIs ---
    path('api/nav/add/', views.nav_add, name='nav_add'),
    path('api/nav/edit/', views.nav_edit, name='nav_edit'),
    path('api/nav/move/', views.nav_move, name='api_nav_move'),
    path('api/nav/favicon-localize/', views.api_nav_favicon_localize, name='api_nav_favicon_localize'),
    path('api/nav/bing-bg/', views.api_nav_bing_bg, name='api_nav_bing_bg'),
    path('api/nav/bing-bg-raw/', views.api_nav_bing_bg_raw, name='api_nav_bing_bg_raw'),
    path('api/nav/icon-upload/', views.api_nav_icon_upload, name='api_nav_icon_upload'),
    path('nav-fav/<str:name>', views.nav_favicon_file, name='nav_favicon_file'),
    path('api/nav/fetch-meta/', views.nav_fetch_meta, name='nav_fetch_meta'),
    path('api/nav/delete/', views.nav_delete, name='nav_delete'),
    path('api/nav/restore/', views.nav_restore, name='nav_restore'),
    path('api/nav/link-check/', views.nav_link_check, name='nav_link_check'),
    path('api/nav/link-fix/', nav_link_fix, name='api_nav_link_fix'),
    path('api/nav/alt-swap/', views.api_nav_alt_swap, name='api_nav_alt_swap'),
    path('api/nav/batch/', views.api_nav_batch, name='api_nav_batch'),
    path('api/nav/archive/', views.api_nav_archive, name='api_nav_archive'),
    path('api/nav/hygiene/', views.api_nav_hygiene, name='api_nav_hygiene'),
    path('api/nav/link-adopt/', views.nav_link_adopt, name='nav_link_adopt'),
    path('api/nav/export/', views.nav_export, name='nav_export'),
    path('api/nav/export-bookmark/', views.nav_export_bookmark, name='api_nav_export_bookmark'),
    path('api/nav/import/', views.nav_import, name='nav_import'),
    path('api/nav/reset/', views.nav_reset, name='nav_reset'),
    path('api/nav/category-order/', views.nav_category_order, name='nav_category_order'),
    path('api/nav/category-unhide/', views.api_nav_category_unhide, name='api_nav_category_unhide'),
    path('api/nav/site-order/', views.nav_site_order, name='nav_site_order'),
    path('api/nav/site-order/pin/', views.nav_site_pin, name='nav_site_pin'),
    path('api/nav/site-order/swap/', views.nav_site_swap, name='nav_site_swap'),
    path('api/nav/category-rename/', views.nav_category_rename, name='nav_category_rename'),
    path('api/nav/guest-scope/', views.api_nav_guest_scope, name='api_nav_guest_scope'),
    path('nav/tools/<int:pk>/', views.nav_tool_open, name='nav_tool_open'),
    path('api/nav/tools/upload/', views.nav_tool_upload, name='nav_tool_upload'),
    path('api/nav/tools/edit/', views.nav_tool_edit, name='nav_tool_edit'),
    path('api/nav/tools/delete/', views.nav_tool_delete, name='nav_tool_delete'),

    # --- PWA 壳(仅独立 nav/base.html 引用;宿主模式不会加载,零影响) ---
    path('nav/manifest.webmanifest', views.nav_manifest, name='nav_manifest'),
    path('nav/icon.svg', views.nav_pwa_icon, name='nav_pwa_icon'),
    path('nav-sw.js', views.nav_sw, name='nav_sw'),

    # --- AI 找网站(接口模式 + 无 API 手动模式)+ 点击统计 ---
    path('api/nav/ai/config/', views.api_nav_ai_config, name='api_nav_ai_config'),
    path('api/nav/ai/models/', views.api_nav_ai_models, name='api_nav_ai_models'),
    path('api/nav/ai/model-test/', views.api_nav_ai_model_test, name='api_nav_ai_model_test'),
    path('api/nav/ai/logs/', views.api_nav_ai_logs, name='api_nav_ai_logs'),
    path('api/nav/ai/generate/', views.api_nav_ai_generate, name='api_nav_ai_generate'),
    path('api/nav/ai/prompt/', views.api_nav_ai_prompt, name='api_nav_ai_prompt'),
    path('api/nav/ai/parse/', views.api_nav_ai_parse, name='api_nav_ai_parse'),
    path('api/nav/ai/import/', views.api_nav_ai_import, name='api_nav_ai_import'),

    # --- AI 分类 + 标签(给已有站点重判大类/小分类并补标签;未配置 AI 时走提示词手动模式) ---
    path('api/nav/ai/classify-items/', views.api_nav_ai_classify_items, name='api_nav_ai_classify_items'),
    path('api/nav/ai/classify-batch/', views.api_nav_ai_classify_batch, name='api_nav_ai_classify_batch'),
    path('api/nav/ai/classify-prompt/', views.api_nav_ai_classify_prompt, name='api_nav_ai_classify_prompt'),
    path('api/nav/ai/classify-parse/', views.api_nav_ai_classify_parse, name='api_nav_ai_classify_parse'),
    path('api/nav/ai/classify-apply/', views.api_nav_ai_classify_apply, name='api_nav_ai_classify_apply'),

    path('api/nav/click/', views.api_nav_click, name='api_nav_click'),
    path('api/nav/pet-geo/', views.api_nav_pet_geo, name='api_nav_pet_geo'),
    path('api/nav/pet-ip-geo/', views.api_nav_pet_ip_geo, name='api_nav_pet_ip_geo'),
    path('api/nav/pet-weather/', views.api_nav_pet_weather, name='api_nav_pet_weather'),

    # --- 桌宠 AI(移植 dsh-pet):配置 / 对话 / AI 碎碎念 / DeepSeek 余额 ---
    path('api/nav/pet-ai/config/', views.api_nav_pet_ai_config, name='api_nav_pet_ai_config'),
    path('api/nav/pet-ai/chat/', views.api_nav_pet_chat, name='api_nav_pet_chat'),
    path('api/nav/pet-quick/', views.api_nav_pet_quick, name='api_nav_pet_quick'),
    path('api/nav/pet-ai/whisper/', views.api_nav_pet_whisper, name='api_nav_pet_whisper'),
    path('api/nav/pet-ai/balance/', views.api_nav_pet_balance, name='api_nav_pet_balance'),
    # --- 桌宠外部语料(2026-11-10):空气+明日预报 / 每日英语 ---
    path('api/nav/pet-brief/', views.api_nav_pet_brief, name='api_nav_pet_brief'),
    path('api/nav/pet-daily-en/', views.api_nav_pet_daily_en, name='api_nav_pet_daily_en'),
]
