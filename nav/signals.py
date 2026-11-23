# nav/signals.py
"""写库后防抖刷新游客公开快照(2026-11-19)。

快照是静态 JSON,原本只能手动 `manage.py export_nav_public`;主人增删改站点 / 分类后,
访客页看不到新内容。这里在 NavSite / NavCategory 的 post_save / post_delete 上挂防抖
刷新:连续改动合并成一次写文件;快照失败只记日志,绝不反噬主写库流程。

测试环境(sys.argv 含 `test`)不刷新,避免每个用例 setUp/tearDown 都重写静态快照文件。
"""

import json
import logging
import os
import sys
import threading
from pathlib import Path

from django.conf import settings
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .management.commands.export_nav_public import public_payload
from .models import NavCategory, NavSite

logger = logging.getLogger(__name__)

_timer = None
_timer_lock = threading.Lock()
DEBOUNCE_SECONDS = 1.5


def _snapshot_path() -> Path:
    return Path(settings.BASE_DIR) / 'nav' / 'static' / 'guest' / 'nav-public.json'


def _is_testing() -> bool:
    """测试进程不写真实静态快照。

    只判断 sys.argv 不够稳:Django 测试运行器可能改写 argv;测试库名与
    默认库不同这一点更可靠。两者任一命中都视为测试。
    """
    if 'test' in sys.argv:
        return True
    try:
        from django.db import connection
        current = str(connection.settings_dict.get('NAME') or '')
        default = str(settings.DATABASES.get('default', {}).get('NAME') or '')
        return bool(current and default and current != default)
    except Exception:
        return False


def _existing_site_count() -> int:
    """现有快照里的站点数;文件缺失/损坏算 0。"""
    try:
        with open(_snapshot_path(), 'r', encoding='utf-8') as fp:
            data = json.load(fp)
        return len(data.get('sites') or []) if isinstance(data, dict) else 0
    except (OSError, ValueError):
        return 0


def write_public_snapshot(force=False) -> bool:
    """把当前公开快照写到静态文件。

    force=False（自动刷新）时，空结果不覆盖已有非空快照；
    force=True（主人在后台显式切换范围）时严格按当前配置写入，
    即使结果为空也生效。
    """
    payload = public_payload()
    # 公开快照可能是一份人工整理/历史快照,而库里此刻只有隐藏分类里的
    # 内置站点。空结果直接覆盖会把访客页清空,所以保留已有非空快照;
    # 真要清空请显式切换范围或跑 manage.py export_nav_public。
    if not payload.get('sites') and _existing_site_count() > 0 and not force:
        logger.warning('跳过空快照写入:库里没有可见站点,保留现有快照')
        return False
    path = _snapshot_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=1) + '\n'
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)  # 同目录原子替换,避免访客读到写了一半的 JSON
    return True


def _write_snapshot() -> None:
    global _timer
    with _timer_lock:
        _timer = None
    try:
        write_public_snapshot(force=False)
    except Exception as exc:  # 快照失败不能打断写库
        logger.warning('刷新游客快照失败:%s', exc)
        try:
            _snapshot_path().with_name(_snapshot_path().name + '.tmp').unlink(missing_ok=True)
        except Exception:
            pass


def schedule_snapshot_refresh(**_kwargs) -> None:
    if _is_testing():
        return
    global _timer
    with _timer_lock:
        if _timer is not None:
            _timer.cancel()
        _timer = threading.Timer(DEBOUNCE_SECONDS, _write_snapshot)
        _timer.daemon = True
    _timer.start()


@receiver(post_save, sender=NavSite, dispatch_uid='nav-site-snapshot-save')
@receiver(post_delete, sender=NavSite, dispatch_uid='nav-site-snapshot-delete')
@receiver(post_save, sender=NavCategory, dispatch_uid='nav-cat-snapshot-save')
@receiver(post_delete, sender=NavCategory, dispatch_uid='nav-cat-snapshot-delete')
def _on_nav_changed(**kwargs) -> None:
    schedule_snapshot_refresh()


def connect_signals() -> None:
    # receiver 装饰器已完成 connect;这里留口子便于以后显式重连 / 测试隔离。
    pass
