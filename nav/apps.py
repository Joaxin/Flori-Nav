# nav/apps.py
from django.apps import AppConfig


class NavConfig(AppConfig):
    name = 'nav'
    verbose_name = '网址导航'

    def ready(self):
        # 触发 signals 模块导入,注册 NavSite / NavCategory 变更后的快照防抖刷新。
        from . import signals  # noqa: F401
