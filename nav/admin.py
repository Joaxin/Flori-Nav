# nav/admin.py
from django.contrib import admin
from .models import NavSite, NavTool, NavCategory

admin.site.register(NavSite)
admin.site.register(NavTool)
admin.site.register(NavCategory)
