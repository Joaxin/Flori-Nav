"""AI 接口增强(2026-11-19)。

- NavAiConfig:按任务分配模型(model_classify/model_pet)+ 最近一次模型探活结果
  (last_check_*),失败原因不再只存在于当次提示里。
- NavAiCallLog:最近 AI 调用摘要(环形保留),用于事后复核某次失败出在哪一步。
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('nav', '0012_navsite_last_check_code_navsite_last_check_ms'),
    ]

    operations = [
        migrations.AddField(
            model_name='navaiconfig',
            name='model_classify',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='分类模型(可选)'),
        ),
        migrations.AddField(
            model_name='navaiconfig',
            name='model_pet',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='桌宠模型(可选)'),
        ),
        migrations.AddField(
            model_name='navaiconfig',
            name='last_check_at',
            field=models.DateTimeField(blank=True, default=None, null=True, verbose_name='最近检测时间'),
        ),
        migrations.AddField(
            model_name='navaiconfig',
            name='last_check_ok',
            field=models.BooleanField(blank=True, default=None, null=True, verbose_name='最近检测可用'),
        ),
        migrations.AddField(
            model_name='navaiconfig',
            name='last_check_ms',
            field=models.PositiveIntegerField(blank=True, default=None, null=True, verbose_name='最近检测耗时(ms)'),
        ),
        migrations.AddField(
            model_name='navaiconfig',
            name='last_check_model',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='最近检测模型'),
        ),
        migrations.AddField(
            model_name='navaiconfig',
            name='last_check_message',
            field=models.CharField(blank=True, default='', max_length=200, verbose_name='最近检测说明'),
        ),
        migrations.CreateModel(
            name='NavAiCallLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('task', models.CharField(default='chat', max_length=24, verbose_name='任务')),
                ('model', models.CharField(blank=True, default='', max_length=100, verbose_name='模型')),
                ('ok', models.BooleanField(default=True, verbose_name='成功')),
                ('elapsed_ms', models.PositiveIntegerField(blank=True, default=None, null=True, verbose_name='耗时(ms)')),
                ('http_status', models.PositiveSmallIntegerField(blank=True, default=None, null=True, verbose_name='HTTP 状态')),
                ('message', models.CharField(blank=True, default='', max_length=200, verbose_name='摘要')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True, verbose_name='时间')),
            ],
            options={
                'verbose_name_plural': 'AI 调用记录',
                'ordering': ('-id',),
            },
        ),
    ]
