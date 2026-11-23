# nav/views_nav_guest.py
"""游客只读页（2026-11-19，2026-11-21 改为单入口后的兼容分支）。

`/nav/` 现在按身份自动分流（见 `nav/nav_access.py`）：没带主人令牌就走到这里。
这个视图刻意不碰数据库：所有默认站点来自生成好的静态快照
`nav/static/guest/nav-public.json`；游客自己导入的书签与设置只存在浏览器
`localStorage`，不回传服务器。这样即使把链接发给别人，也不会让他们
拿到主人侧的增删改入口。

`/nav/guest/` 保留为**强制访客态**入口：不看 cookie，已分享出去的旧链接
行为不变，也不会因为主人自己点开而变成自用页。
"""

from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .nav_access import nav_render_guest


@require_http_methods(["GET"])
@ensure_csrf_cookie          # 访客页要能提交「主人登录」,需要 csrftoken cookie
def nav_guest(request):
    return nav_render_guest(request)
