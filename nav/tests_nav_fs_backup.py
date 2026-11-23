"""访客「文件夹备份」契约(File System Access API,2026-11-21)。

这个功能只在访客页出现:用 window.showDirectoryPicker 选本地文件夹,
把整包备份写进去;也能列出文件夹里的 nav_backup*.json 读回来恢复。
护栏只钉三件事:
1. 入口与脚本只在访客态,不污染主人页;
2. 目录句柄存独立 IDB,不混进 navStore(否则整包备份会序列化 DirectoryHandle);
3. 恢复复用 nav-backup 的覆盖式确认,不另造一套落盘逻辑。
"""
import os
from pathlib import Path
from unittest import mock

from django.test import TestCase
from django.urls import reverse

NAV_DIR = Path(__file__).resolve().parent


class GuestFolderBackupTests(TestCase):
    def setUp(self):
        # 本机 .env 可能配了 NAV_WRITE_TOKEN;这组用例要同时拿到访客页与主人页,
        # 显式把令牌清空,避免 /nav/ 被判成访客态。
        self.env_patch = mock.patch.dict(os.environ, {'NAV_WRITE_TOKEN': ''})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        self.fs = (NAV_DIR / 'static' / 'js' / 'nav-fs-backup.js').read_text(encoding='utf-8')
        self.backup = (NAV_DIR / 'static' / 'js' / 'nav-backup.js').read_text(encoding='utf-8')

    def test_entry_and_module_are_guest_only(self):
        for token in ('data-nav-fs-save', 'data-nav-fs-open', 'js/nav-fs-backup.js'):
            self.assertIn(token, self.guest)
            self.assertNotIn(token, self.owner)
        self.assertIn('if (!window.NAV_GUEST_MODE) return;', self.fs)

    def test_file_system_access_contract(self):
        for token in ('showDirectoryPicker', 'isSecureContext', 'getFileHandle',
                      'createWritable', 'queryPermission', 'requestPermission',
                      'entries', 'getFile', 'navBackup.collect',
                      'navBackup.restoreObject', 'navFsBackupModal',
                      'navFsChoose', 'navFsList'):
            self.assertIn(token, self.fs)

    def test_directory_handle_has_its_own_indexeddb(self):
        # 目录句柄不能进 navStore:整包备份会枚举 navStore 里的全部键并 JSON 序列化。
        self.assertIn("DB_NAME = 'pinsflora-nav-fs'", self.fs)
        self.assertIn("DIR_KEY = 'backupDir'", self.fs)
        self.assertNotIn("navStore.set('backupDir'", self.fs)
        self.assertNotIn("navStore.set(DIR_KEY", self.fs)

    def test_restore_reuses_nav_backup_confirmation(self):
        # 文件夹恢复必须回到 nav-backup 的同一套 format 校验 + 覆盖确认 + 落盘 + 刷新。
        for token in ('restoreObject: restorePackObject', 'parse: parsePack'):
            self.assertIn(token, self.backup)
        self.assertIn("title: '恢复整包备份'", self.backup)
        self.assertIn('danger: true', self.backup)
        self.assertIn('window.navBackup.restoreObject(pack, { source: item.name })', self.fs)

    def test_backup_flushes_in_memory_sites_first(self):
        self.assertIn('saveNow: function ()', self.guest)
        self.assertIn('window.navGuestLocal.saveNow', self.fs)
        self.assertIn('navBackup.collect', self.fs)

    def test_local_only_and_no_native_dialogs(self):
        self.assertNotIn('/api/nav/', self.fs)
        self.assertNotIn('XMLHttpRequest', self.fs)
        for bad in ('window.alert(', 'window.confirm(', 'window.prompt('):
            self.assertNotIn(bad, self.fs)
