# -*- coding: utf-8 -*-
"""ASGI entrypoint。

只声明 WSGI_APPLICATION 时 Vercel 走 wsgi.py;若将来需要 WebSocket,
在 settings 里加 ASGI_APPLICATION 即可切到本文件。
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_asgi_application()
