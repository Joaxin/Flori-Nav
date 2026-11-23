# -*- coding: utf-8 -*-
"""WSGI entrypoint(Vercel 通过 manage.py + WSGI_APPLICATION 自动识别)。"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_wsgi_application()
