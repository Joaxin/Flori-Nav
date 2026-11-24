# -*- coding: utf-8 -*-
"""Flori-Nav — 网址导航站(独立项目)。

设计取舍:
- 只装 nav 一个业务 app,不装 admin/auth/sessions/messages:这个站点没有登录体系,
  少装一个 app 就少一批表、少一批可被探测的端点。
- 数据库两档:DATABASE_URL 存在 → Postgres(Neon/Supabase 等,含连接池);
  不存在 → 本地 SQLite。切换只靠环境变量,代码里没有分支判断。
- 静态文件交给 Vercel 的 collectstatic + CDN;本地 runserver 自己服务。

所有密钥/域名都从环境变量读,仓库里不放真值。见 .env.example。
"""

import os
import urllib.parse
from pathlib import Path

from .envfile import load_env_file

BASE_DIR = Path(__file__).resolve().parent.parent

# 本地 .env(已存在的真实环境变量优先,部署平台的注入不会被覆盖)
_ENV_FILE = Path(os.environ.get('SFLORA_ENV_FILE') or (BASE_DIR / '.env'))
load_env_file(_ENV_FILE, os.environ)


def _env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None or raw == '':
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


def _env_list(name, default=()):
    raw = (os.environ.get(name) or '').strip()
    if not raw:
        return list(default)
    return [item.strip() for item in raw.split(',') if item.strip()]


# ---------------------------------------------------------------------------
# 基础
# ---------------------------------------------------------------------------
# 默认值按运行环境分:
#   - 部署平台(VERCEL 注入)默认 False —— 漏设环境变量时宁可白屏也不要带着调试页上线;
#   - 本地/测试默认 True —— 不然每个开发者都得先写 .env 才能跑 manage.py。
DEBUG = _env_bool('DJANGO_DEBUG', not os.environ.get('VERCEL'))

# 部署环境必须显式提供 DJANGO_SECRET_KEY;本地开发用固定占位值,免得每次启动都报错
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY') or ''
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = 'dev-only-insecure-key-change-me-before-deploying'
    else:
        raise RuntimeError('缺少 DJANGO_SECRET_KEY:非 DEBUG 环境必须通过环境变量提供')

# Vercel 预览域名每次都变,本地默认放开;生产环境不写 DJANGO_ALLOWED_HOSTS 时
# 回落到 vercel.app 通配 + 平台注入的 VERCEL_URL,而不是"什么都不填 => 全站 400"。
ALLOWED_HOSTS = _env_list('DJANGO_ALLOWED_HOSTS')
if not ALLOWED_HOSTS:
    if DEBUG:
        ALLOWED_HOSTS = ['*']
    else:
        ALLOWED_HOSTS = ['*.vercel.app']
        if os.environ.get('VERCEL_URL'):
            ALLOWED_HOSTS.append(os.environ['VERCEL_URL'])

CSRF_TRUSTED_ORIGINS = _env_list('DJANGO_CSRF_TRUSTED_ORIGINS')
if os.environ.get('VERCEL'):
    # Vercel 部署:预览与生产域名都在 vercel.app 下
    CSRF_TRUSTED_ORIGINS.append('https://*.vercel.app')

# Vercel 在函数前面放了一层代理,不设这个 Django 会把请求当成 http
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

INSTALLED_APPS = [
    'django.contrib.staticfiles',
    'nav',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
    # 2026-11-23 i18n:按 ?lang= / cookie nav_lang 切语言;必须在 CommonMiddleware 之后
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # 可选写令牌:NAV_WRITE_TOKEN 为空时完全放行(本地无感);放 CSRF 之后,不干预读请求
    'config.middleware.WriteTokenMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'config.context_processors.static_version',
                'config.context_processors.nav_brand',
                'config.context_processors.nav_lang',
            ],
        },
    },
]

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------
_PG_OPTION_KEYS = (
    'sslmode', 'channel_binding', 'sslrootcert', 'sslcert', 'sslkey',
    'connect_timeout', 'application_name', 'target_session_attrs', 'options',
)


def _postgres_config(url):
    """解析 DATABASE_URL → Django DATABASES['default']。

    两处 serverless 专属处理:
    - CONN_MAX_AGE = 0:函数实例随时回收,长连接会攒成僵尸,每个请求用完即断;
    - DISABLE_SERVER_SIDE_CURSORS = True:Neon / Supabase 的连接池端点多为
      transaction 模式,服务端游标在事务外会失效。
    连接数上限交给服务商的池化端点,不要直连 5432 主库。
    """
    parsed = urllib.parse.urlparse(url)
    options = {}
    for key, values in urllib.parse.parse_qs(parsed.query).items():
        if key in _PG_OPTION_KEYS and values:
            options[key] = values[-1]
    options.setdefault('connect_timeout', 10)
    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': urllib.parse.unquote(parsed.path.lstrip('/')),
        'USER': urllib.parse.unquote(parsed.username or ''),
        'PASSWORD': urllib.parse.unquote(parsed.password or ''),
        'HOST': parsed.hostname or '',
        'PORT': str(parsed.port or ''),
        'CONN_MAX_AGE': 0,
        'CONN_HEALTH_CHECKS': False,
        'DISABLE_SERVER_SIDE_CURSORS': True,
        'OPTIONS': options,
    }


def _sqlite_config(path):
    return {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': str(path),
        # 拿不到写锁先等 20 秒,而不是立刻 "database is locked"
        'OPTIONS': {'timeout': 20},
    }


DATABASE_URL = (os.environ.get('DATABASE_URL') or '').strip()
if DATABASE_URL:
    _scheme = urllib.parse.urlparse(DATABASE_URL).scheme.split('+')[0]
    if _scheme in ('postgres', 'postgresql'):
        DATABASES = {'default': _postgres_config(DATABASE_URL)}
    elif _scheme in ('sqlite', 'sqlite3'):
        DATABASES = {'default': _sqlite_config(urllib.parse.urlparse(DATABASE_URL).path or (BASE_DIR / 'db.sqlite3'))}
    else:
        raise RuntimeError(f'不支持的 DATABASE_URL 协议:{_scheme}(支持 postgres/postgresql/sqlite)')
else:
    DATABASES = {'default': _sqlite_config(BASE_DIR / 'db.sqlite3')}


# ---------------------------------------------------------------------------
# 静态文件 / 媒体
# ---------------------------------------------------------------------------
STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
# Vercel 检测到 STATIC_ROOT 会在构建时自动跑 collectstatic 并由 CDN 提供服务
STATIC_ROOT = BASE_DIR / 'staticfiles_build'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
# 注意:Vercel 函数文件系统只读,上传的图标/HTML 工具不会持久化。
# 需要线上上传能力时接对象存储(如 Vercel Blob / S3 + django-storages)。


# ---------------------------------------------------------------------------
# nav app 挂点
# ---------------------------------------------------------------------------
NAV_BASE_TEMPLATE = 'nav/base.html'
NAV_LINK_TOTAL_TIMEOUT = int(os.environ.get('NAV_LINK_TOTAL_TIMEOUT') or 60)

LANGUAGE_CODE = 'zh-hans'
TIME_ZONE = 'Asia/Shanghai'
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# 语言(2026-11-23):中文默认,可切英文。
# - 模板/后端用 Django 原生 i18n(gettext);前端文案由 nav-i18n.js 的词条表翻译。
# - 语言存在 cookie `nav_lang`(不是 django_language),LocaleMiddleware 直接吃这个值,
#   这样前端切语言和后端 gettext 是同一份状态,不会出现「页面英文、接口中文」。
# ---------------------------------------------------------------------------
# 语言名用普通字符串,不要在这里用 gettext_lazy:
# Vercel 构建探测阶段会在 app registry 就绪前导入 settings,
# lazy 求值会触发 apps.get_app_configs() -> AppRegistryNotReady。
LANGUAGES = [
    ('zh-hans', '简体中文'),
    ('en', 'English'),
]
LOCALE_PATHS = [BASE_DIR / 'locale']
LANGUAGE_COOKIE_NAME = 'nav_lang'
LANGUAGE_COOKIE_AGE = 365 * 24 * 3600


# ---------------------------------------------------------------------------
# 日志:只打控制台。函数环境没有持久磁盘,写文件只会白占地方
# ---------------------------------------------------------------------------
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'plain': {'format': '%(levelname)-7s %(name)s: %(message)s'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'}},
    'loggers': {
        'nav': {
            'handlers': ['console'],
            'level': (os.environ.get('SFLORA_LOG_LEVEL') or 'INFO').upper(),
            'propagate': False,
        },
    },
}
