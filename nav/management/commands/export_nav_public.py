# nav/management/commands/export_nav_public.py
"""生成游客只读快照 `nav/static/guest/nav-public.json`（2026-11-19）。

为什么单独生成文件，而不是让游客页查库：
- 游客页是纯静态/只读的，服务器不替游客保存任何数据；
- 快照由主人手动生成，游客请求只读静态文件，不产生数据库查询；
- 公开快照只包含页面上本来就可见的站点：过滤隐藏分类和已休眠站点，
  也不带点击次数这类使用统计，避免把主人侧数据顺手泄露出去。
"""

import json
import os
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from nav.brand import BRAND_NAME, BRAND_TAGLINE
from nav.models import NavCategory, NavPublicConfig, NavSite
from nav.views_nav_base import _site_row


# 只挑游客页面真正要展示的键。`_site_row` 里的 click_count / archived 等
# 属于主人侧状态，不进公开快照。
PUBLIC_SITE_KEYS = (
    'name', 'url', 'category', 'subcat', 'description', 'site_title',
    'favicon', 'icon_text', 'icon_color', 'icon_size',
    'children', 'alternates', 'tags', 'order',
)


def public_payload(scope=None):
    """返回可直接序列化的游客快照；不写文件，便于测试和以后复用。

    scope:
    - public：所有未隐藏分类、未休眠站点（历史行为）
    - builtin：只导出内置站点 `is_builtin=True`；内置模式不再受分类隐藏影响，
      避免「内置网站」分类被主人隐藏后游客一张都看不到。
    - None：读取主人后台保存的 NavPublicConfig.scope（默认 public）。
    """
    valid_scopes = {NavPublicConfig.SCOPE_PUBLIC, NavPublicConfig.SCOPE_BUILTIN}
    if scope not in valid_scopes:
        scope = NavPublicConfig.current().scope
    if scope not in valid_scopes:
        scope = NavPublicConfig.SCOPE_PUBLIC

    if scope == NavPublicConfig.SCOPE_BUILTIN:
        sites = NavSite.objects.filter(archived_at__isnull=True, is_builtin=True).order_by('id')
        hidden_categories = set()
        category_rows = NavCategory.objects.order_by('order', 'name')
    else:
        hidden_categories = set(
            NavCategory.objects.filter(hidden=True).values_list('name', flat=True)
        )
        sites = NavSite.objects.filter(archived_at__isnull=True).order_by('id')
        category_rows = NavCategory.objects.filter(hidden=False).order_by('order', 'name')

    rows = []
    for site in sites:
        if site.category in hidden_categories:
            continue
        row = _site_row(site)
        rows.append({key: row.get(key) for key in PUBLIC_SITE_KEYS})

    # 分类顺序沿用主人侧；没建 NavCategory 行的分类排在同名兜底位置。
    row_categories = {row.get('category') or '未分类' for row in rows}
    ordered = []
    seen = set()
    for category in category_rows:
        if category.name not in row_categories or category.name in seen:
            continue
        seen.add(category.name)
        ordered.append(category.name)
    for row in rows:
        name = row.get('category') or '未分类'
        if name not in seen:
            seen.add(name)
            ordered.append(name)

    return {
        'format': 'nav-public',
        'version': 1,
        'generatedAt': timezone.now().isoformat(),
        'scope': scope,
        'brand': {'name': BRAND_NAME, 'tagline': BRAND_TAGLINE},
        'categories': ordered,
        'sites': rows,
    }


class Command(BaseCommand):
    help = '生成游客只读快照 nav/static/guest/nav-public.json（不写数据库）'

    def add_arguments(self, parser):
        parser.add_argument(
            '--output',
            default='',
            help='输出路径；默认 nav/static/guest/nav-public.json',
        )
        parser.add_argument(
            '--scope',
            choices=[NavPublicConfig.SCOPE_PUBLIC, NavPublicConfig.SCOPE_BUILTIN],
            default=None,
            help='临时覆盖公开范围（默认读后台保存的选项）',
        )

    def handle(self, *args, **options):
        output = options.get('output') or ''
        path = Path(output) if output else Path(settings.BASE_DIR) / 'nav' / 'static' / 'guest' / 'nav-public.json'
        path = path.expanduser()
        if not path.is_absolute():
            path = Path(settings.BASE_DIR) / path
        try:
            payload = public_payload(scope=options.get('scope'))
        except Exception as exc:  # 让命令行看到明确原因，而不是半截文件
            raise CommandError(f'生成公开快照失败：{exc}') from exc

        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(payload, ensure_ascii=False, indent=1) + '\n'
        tmp = path.with_name(path.name + '.tmp')
        try:
            tmp.write_text(text, encoding='utf-8')
            os.replace(tmp, path)  # 同目录原子替换，避免游客读到写了一半的 JSON
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

        self.stdout.write(self.style.SUCCESS(
            f'游客快照已生成：{path}（{len(payload["sites"])} 个站点 / {len(payload["categories"])} 个分类）'
        ))
