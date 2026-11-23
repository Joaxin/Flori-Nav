# nav/migrations/0002_copy_legacy_nav_data.py
# 从本项目历史版本(searchapp_nav* 旧表)一次性搬运导航数据。
# 全新移植的目标库里没有旧表 → 自动跳过,零影响。
# 旧表是否保留取决于库:2026-11-07 已按用户指令把活跃库 db.sqlite3 里三张旧表 DROP
# (删前核对 navsite 89 行 / navcategory 14 行 / navtool 0 行,业务列与 nav_* 逐行一致);
# 副本库 db-DESKTOP-QI22IOV.sqlite3 更早已 DROP。
# 本迁移用 introspection.table_names() 守卫自动跳过,两种库都能正常 migrate。
from django.db import migrations

TABLES = [('searchapp_navsite', 'nav_navsite'),
          ('searchapp_navcategory', 'nav_navcategory'),
          ('searchapp_navtool', 'nav_navtool')]


def _copy_legacy_nav_data(apps, schema_editor):
    connection = schema_editor.connection
    tables = {t.lower(): t for t in connection.introspection.table_names()}
    quote = connection.ops.quote_name
    with connection.cursor() as cursor:
        for src, dst in TABLES:
            src_t, dst_t = tables.get(src.lower()), tables.get(dst.lower())
            if not src_t or not dst_t:
                continue
            cursor.execute(f"SELECT COUNT(*) FROM {quote(src_t)}")
            if cursor.fetchone()[0] == 0:
                continue
            src_cols = [c.name for c in connection.introspection.get_table_description(cursor, src_t)]
            dst_cols = {c.name for c in connection.introspection.get_table_description(cursor, dst_t)}
            cols = ', '.join(quote(c) for c in src_cols if c in dst_cols)
            cursor.execute(f"INSERT INTO {quote(dst_t)} ({cols}) "
                           f"SELECT {cols} FROM {quote(src_t)}")


class Migration(migrations.Migration):

    dependencies = [
        ('nav', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(_copy_legacy_nav_data, migrations.RunPython.noop),
    ]
