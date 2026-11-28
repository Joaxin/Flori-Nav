# nav/tests_nav_webdav.py
"""游客端 WebDAV 前端直连（2026-11-28，路线 1）。

契约：
- 只在游客页出现；主人页不挂菜单项、弹窗与脚本；
- 配置（目录 URL / 用户名 / 密码）只进 localStorage `navGuestWebdavV1`，
  不经过任何 `/api/nav/` 服务端接口；
- 备份复用 navBackup.collect() 的整包格式，恢复复用 navBackup.restoreObject()；
- 整包备份排除 WebDAV 凭据键，避免密码随备份文件外流。
"""

from pathlib import Path
from django.test import TestCase
from django.urls import reverse


class GuestWebdavContractTests(TestCase):
    def setUp(self):
        self.guest = self.client.get(reverse('nav_guest')).content.decode('utf-8')
        self.owner = self.client.get(reverse('nav_sites')).content.decode('utf-8')
        base = Path(__file__).resolve().parent / 'static' / 'js'
        self.js = (base / 'nav-webdav.js').read_text(encoding='utf-8')
        self.backup = (base / 'nav-backup.js').read_text(encoding='utf-8')

    def test_only_guest_mounts_webdav(self):
        self.assertIn('data-nav-webdav', self.guest)
        self.assertIn('navWebdavModal', self.guest)
        self.assertIn('js/nav-webdav.js', self.guest)
        self.assertNotIn('data-nav-webdav', self.owner)
        self.assertNotIn('navWebdavModal', self.owner)
        self.assertNotIn('js/nav-webdav.js', self.owner)

    def test_direct_browser_webdav_no_owner_api(self):
        for token in ('PROPFIND', 'PUT', 'GET', 'Authorization', 'Basic ', 'Depth',
                      'CORS', 'navGuestWebdavV1'):
            self.assertIn(token, self.js)
        # 游客能力不得夹带任何服务端写接口
        self.assertNotIn('/api/nav/', self.js)
        self.assertNotIn('fetch(\'/api/', self.js)
        # 备份 / 恢复走既有整包管道
        self.assertIn('navBackup.collect', self.js)
        self.assertIn('navBackup.restoreObject', self.js)
        self.assertIn("format: FORMAT", self.backup)

    def test_backup_excludes_credentials(self):
        self.assertIn("SKIP_KEYS = {'navGuestWebdavV1': 1}", self.backup)
        self.assertIn('!SKIP_KEYS[k]', self.backup)
