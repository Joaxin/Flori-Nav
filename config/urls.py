# -*- coding: utf-8 -*-
from django.http import JsonResponse
from django.urls import include, path
from django.views.generic import RedirectView


def healthz(request):
    """部署平台/uptime 探针用,不碰数据库。"""
    return JsonResponse({'status': 'ok'})


urlpatterns = [
    path('healthz', healthz, name='healthz'),
    path('', RedirectView.as_view(pattern_name='nav_sites', permanent=False)),
    path('', include('nav.urls')),
]
