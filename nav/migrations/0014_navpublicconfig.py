"""游客页公开范围配置（2026-11-21）。

单例行 pk=1：选择公开快照只导出全部未隐藏站点，还是只导出内置站点。
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('nav', '0013_navaiconfig_model_classify_and_call_log'),
    ]

    operations = [
        migrations.CreateModel(
            name='NavPublicConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scope', models.CharField(choices=[('public', '公开（全部未隐藏站点）'), ('builtin', '仅内置站点')], default='public', max_length=10, verbose_name='游客页显示范围')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='更新时间')),
            ],
            options={
                'verbose_name_plural': '游客页公开配置',
            },
        ),
    ]
