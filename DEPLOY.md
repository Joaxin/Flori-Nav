# 部署与运维

这份文档面向公网部署,是一份可以照着一步步操作的完整教程。只想在本机跑起来,请看 [README.md](README.md)。

整个部署分五步:**生成密钥 → 建 Neon 数据库 → Vercel 导入仓库并配环境变量 → 部署并迁移 → 验证**。下面按顺序来。

---

## 0. 前置准备

你需要三个账号,都可用免费档:

1. **GitHub** —— 代码仓库已推上去(本项目:`https://github.com/Joaxin/Flori-Nav`)。
2. **Neon** —— https://console.neon.tech ,提供 Postgres 数据库。
3. **Vercel** —— https://vercel.com ,用来跑 Django 并自动部署。

---

## 1. 生成两个密钥

部署前先在本地生成两个随机字符串。**各生成一次,之后固定用同一份**,不要每次部署都换(换了会让已签名的 cookie 失效、主人令牌失效)。

### 1.1 `DJANGO_SECRET_KEY`(Django 签名密钥)

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

也可以等价地用:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

要求:50 位以上随机字符串。`.env.example` 里的 `dev-only-insecure-key-change-me-before-deploying` 是占位符,**不能上生产**。

### 1.2 `NAV_WRITE_TOKEN`(主人写令牌,公网必配)

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

不设置它的话,`/api/nav/` 下的新增、编辑、删除、导入、重置、工具上传全部对匿名请求开放,而且 AI 模型探测接口允许请求内网地址,会被当成内网探针(SSRF)。**公网必须设。**

---

## 2. Neon:建数据库并拿连接串

### 2.1 创建项目和数据库

1. 登录 https://console.neon.tech ,点 **New Project**。
2. 区域建议选离你近的(如 `Asia Pacific (Singapore)`),名字随意。
3. 创建后 Neon 会自带一个默认数据库(通常叫 `neondb`)。可以沿用,也可以新建一个叫 `flori_nav` 的库——建议用 `flori_nav`,和下文连接串示例一致。
4. 不用手动建表,迁移在第 4 步做。

### 2.2 复制 Pooled 连接串

1. 在 Neon 项目页左侧或顶部找到 **Connection Details**(连接详情)。
2. 切到 **Connection string** 标签页——**这里默认显示的就是 pooled(池化)连接串,不用手动勾选"Pooled connection"**,直接复制整条即可。
3. 它长这样:

```text
postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/flori_nav?sslmode=require
```

**关键辨认点**:主机名里带 `-pooler`(`ep-xxx-pooler`)。这就是连接池端点,专门用于 Serverless。

> ⚠️ **不要用直连主库的 5432 连接串**(主机不带 `-pooler` 的那种)。Serverless 函数实例随时回收,直连会迅速耗尽 Neon 的连接数。`config/settings.py` 已经针对池化端点做了两处处理:`CONN_MAX_AGE = 0`(用完即断,不攒僵尸连接)、`DISABLE_SERVER_SIDE_CURSORS = True`(兼容 transaction 模式)。

> ⚠️ 如果 Connection Details 里有多条连接串(比如标了 "Direct connection" 和 "Pooled connection"),只复制带 `-pooler` 的那条。密码是完整的,复制时别截掉。

把这条连接串先存到记事本,第 3 步要用。

---

## 3. Vercel:导入仓库并配置环境变量

### 3.1 导入 GitHub 仓库

1. 登录 https://vercel.com ,点 **Add New → Project**。
2. 选择/授权 GitHub,导入 `Joaxin/Flori-Nav`(或你的 fork)。
3. Framework Preset 让 Vercel 自动识别为 **Django**(它通过 `manage.py` 识别)。
4. **先不要急着点 Deploy**——先把环境变量配上,否则会带着错误配置构建。

### 3.2 配置环境变量

在项目页 **Settings → Environment Variables**,逐条添加(Environment 选 `Production`,预览环境如需要也勾上):

| 变量名 | 值 | 必填 | 说明 |
|---|---|---|---|
| `DJANGO_SECRET_KEY` | 第 1.1 步生成的密钥 | ✅ 必填 | 不填且非 DEBUG 时直接报错 |
| `DJANGO_DEBUG` | `False` | ✅ 必填 | 生产必须 False |
| `DATABASE_URL` | 第 2.2 步复制的 pooler 连接串 | ✅ 建议填 | 不填会用 SQLite(Vercel 上不持久) |
| `NAV_WRITE_TOKEN` | 第 1.2 步生成的令牌 | ✅ 公网必填 | 主人写接口与页面身份令牌 |
| `DJANGO_ALLOWED_HOSTS` | 留空即可 | 可选 | 留空时自动放行 `*.vercel.app` 和平台注入的域名 |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | 留空即可 | 可选 | 自定义域名时才需要填 `https://你的域名` |
| `NAV_LINK_TOTAL_TIMEOUT` | `60` | 可选 | 全库测活总预算(秒);函数时长有限,别调太大 |
| `SFLORA_LOG_LEVEL` | `INFO` | 可选 | 日志级别 |

填完后,**点 Redeploy**(或回到 Deployments 点右上角 `...` → Redeploy)。改环境变量不会自动重跑已失败的部署,必须手动触发一次。

> `config/settings.py` 对 Vercel 域名已做适配:`ALLOWED_HOSTS` 留空时自动放行 `*.vercel.app` 与 `VERCEL_URL`,`CSRF_TRUSTED_ORIGINS` 自动加 `https://*.vercel.app`,并设置了 `SECURE_PROXY_SSL_HEADER`,所以自定义域名之外的域名配置可以留空。

---

## 4. 部署与首次迁移

### 4.1 构建

正常情况:Vercel 检测到 `STATIC_ROOT` 后会在构建时自动跑 `collectstatic`,静态文件由 CDN 提供,无需额外配置。`vercel.json` 只需保留:

```json
{
  "regions": ["hkg1"],
  "functions": { "config/wsgi.py": { "maxDuration": 60 } }
}
```

构建失败时看第 6 节的排查表。

### 4.2 首次数据库迁移(必须做一次)

**Vercel 构建不会自动执行 migrate**,第一次部署成功后需要手动建表。两种方式选一个:

**方式 A —— 本地用 Vercel CLI(推荐)**

```bash
vercel env pull .env.local     # 把 Vercel 环境变量拉到本地
python manage.py migrate       # 连到 Neon 建表
```

> 这会生成本地 `.env.local`,它不在代码仓库里(被 `.gitignore` 忽略),不算改动代码。`DATABASE_URL` 会从 Vercel 拉下来,所以 migrate 连的就是线上 Neon 库。

**方式 B —— 不装 CLI 的话**

在 Neon 控制台的 SQL Editor 里手工执行 `nav/migrations/` 下的 SQL——较繁琐,一般不推荐。

### 4.3 生成访客快照(可选)

访客页不查数据库,只读静态快照 `nav/static/guest/nav-public.json`。改了公开范围或站点后,需要重新生成并随代码发布:

```bash
python manage.py export_nav_public
```

---

## 5. 验证部署

部署成功后按顺序验证:

1. **访客页**:打开 `https://你的域名.vercel.app/nav/`,应能看到站点列表(只读)。
2. **主人页**:浏览器访问一次
   ```text
   https://你的域名.vercel.app/?nav_token=你的NAV_WRITE_TOKEN
   ```
   服务端会写入 HttpOnly cookie(30 天),之后这台浏览器就是主人态,网址不变。没带或带错令牌是访客只读态。
3. **写接口**:主人态下试着新增/编辑一个站点,确认能写进 Neon。
4. **数据库**:在 Neon 控制台的 **Tables** 里应能看到 `nav_navsite`、`nav_navcategory` 等表,且有一条数据。

如果第 2 步能进主人态、第 3 步写入成功,整条链路就通了。

---

## 6. 常见报错排查

### 6.1 构建阶段:`AppRegistryNotReady: Apps aren't loaded yet.`

**现象**:Build Logs 里出现

```text
Error: [DJANGO_SETTINGS_FAILED] Failed to read Django application settings from /vercel/path0/manage.py
  django/utils/translation/trans_real.py line 218  _add_installed_apps_translations
  django/apps/registry.py line 147  → AppRegistryNotReady: Apps aren't loaded yet.
```

**原因**:`config/settings.py` 顶部的 i18n 配置用了 `gettext_lazy`:

```python
from django.utils.translation import gettext_lazy as _lazy
LANGUAGES = [
    ('zh-hans', _lazy('简体中文')),
    ('en', _lazy('English')),
]
```

Vercel 在构建阶段探测 Django 项目时,会在 app registry 初始化**之前**导入 settings;`gettext_lazy` 一经求值就去扫描已安装 app 的翻译(`apps.get_app_configs()`),此时 apps 还没 ready,于是抛错。

**处理**:把这两行改成普通字符串(语言名是固定文案,不需要 lazy 翻译):

```python
LANGUAGES = [
    ('zh-hans', '简体中文'),
    ('en', 'English'),
]
```

> 这个改动很小,但涉及代码文件。需要时让维护者确认后再改。

### 6.2 构建阶段:`缺少 DJANGO_SECRET_KEY`

非 DEBUG 环境下没提供 `DJANGO_SECRET_KEY` 会直接抛 `RuntimeError`。检查第 3.2 步是否填了,并且填在正确的 Environment(Production)下。

### 6.3 访问 400:`DisallowedHost`

请求域名不在 `ALLOWED_HOSTS` 里。自定义域名时把域名填进 `DJANGO_ALLOWED_HOSTS`(逗号分隔);用 `*.vercel.app` 默认域名则留空即可。

### 6.4 访问 403 CSRF 失败

自定义域名时把 `https://你的域名` 填进 `DJANGO_CSRF_TRUSTED_ORIGINS`。

### 6.5 写接口 403

没带写令牌。确认 `NAV_WRITE_TOKEN` 已设置,且访问时带cookie或请求头:

- 浏览器先访问一次 `/?nav_token=你的令牌`,或
- API 请求带请求头 `X-Nav-Write-Token: 你的令牌`

### 6.6 页面空态 / 访客页没数据

访客页读静态快照 `nav/static/guest/nav-public.json`,不查数据库。改了数据后没重新生成快照,或快照没随代码发布。按 4.3 步执行 `export_nav_public` 并重新部署。

### 6.7 数据库连接报错

- 确认 `DATABASE_URL` 用的是带 `-pooler` 的连接串,不是直连 5432;
- 确认 Neon 项目没有暂停(免费档长时间不用会休眠,唤醒即可);
- 确认已执行 migrate(4.2 步)。

---

## 7. Serverless 已知限制

- 函数文件系统只读且临时:`MEDIA_ROOT` 里的图标本地化、HTML 工具不会持久化;需要长期保存请接对象存储(Vercel Blob / S3 + django-storages)。
- 全库测活受函数时长限制;页面已按 32 条/批分批,超时调小 `NAV_LINK_TOTAL_TIMEOUT`。
- 游客页读取的是静态快照 `nav/static/guest/nav-public.json`。改了公开范围或站点后,需要重新生成并随代码发布。

---

## 8. 安全细节

### 写接口

`nav` 的写接口原本是本地自用工具,默认没有登录校验:`/api/nav/add|edit|delete|import|reset`、工具上传。公网部署至少加一层:`NAV_WRITE_TOKEN`、Django `login_required`、Vercel Deployment Protection,或反向代理 Basic Auth。

### 可选写令牌

设置 `NAV_WRITE_TOKEN=<令牌>` 后:

- `/api/nav/` 下的 `POST/PUT/PATCH/DELETE` 必须带请求头 `X-Nav-Write-Token` 或 cookie `nav_token`,否则 403;
- `GET/HEAD/OPTIONS` 不受影响;
- 同一个令牌兼任页面身份:`/nav/` 带对令牌渲染主人页,没带 / 带错渲染访客只读页;
- 浏览器访问一次 `/?nav_token=<令牌>`,服务端写入 30 天 cookie,后续写操作自动带上。

不设 `NAV_WRITE_TOKEN`(或设为空)时中间件完全放行,适合本地开发。

### SSRF 防护

测活、图标本地化、元信息抓取默认拒绝内网、环回、链路本地地址。本机自测内网站点时临时设置 `NAV_ALLOW_PRIVATE_NET=1`。

**例外:AI 接口探测**。`/api/nav/ai/models` 和 `/api/nav/ai/model-test` 会向用户填写的 `base_url` 发起服务端请求,且允许内网 / 本机地址(主用例是本机网关,如 Ollama、One-API)。公网部署必须配合 `NAV_WRITE_TOKEN` 或登录校验,不要把这组能力暴露给匿名访客。

---

## 9. 访客页快照

访客页不查数据库,只读 `nav/static/guest/nav-public.json`。文件缺失或损坏时访客页显示空态。

生成命令:

```bash
python manage.py export_nav_public
```

生成时会自动过滤隐藏分类、休眠站点和点击统计。公开范围可在后台切换为「公开(全部未隐藏站点)」或「仅内置站点」。

---

## 快速核对清单

部署前对着过一遍:

- [ ] `DJANGO_SECRET_KEY` 已生成并填入 Vercel Production
- [ ] `NAV_WRITE_TOKEN` 已生成并填入 Vercel Production
- [ ] `DJANGO_DEBUG=False`
- [ ] Neon 项目已建,复制的是带 `-pooler` 的 Connection string
- [ ] `DATABASE_URL` 填入 Vercel
- [ ] 部署成功(构建无 `AppRegistryNotReady` 等错误)
- [ ] 已执行 `python manage.py migrate`
- [ ] 访客页能看到数据
- [ ] `?nav_token=` 能进主人态,写接口能写进 Neon
