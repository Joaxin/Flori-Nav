# 部署与运维

这份文档面向公网部署。只想在本机跑起来，请看 [README.md](README.md)。

## 1. 部署前的最低配置

公网部署**必须**设置 `NAV_WRITE_TOKEN`。不设置时：

- `/api/nav/` 下的新增、编辑、删除、导入、重置、工具上传全部对匿名请求开放；
- AI 模型探测接口允许请求内网地址，存在被当成内网探针（SSRF）的风险。

生成一个长随机令牌：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

把它写进部署环境变量，然后访问一次：

```text
https://你的域名/?nav_token=你的令牌
```

服务端会写入 HttpOnly cookie（30 天），之后这台浏览器就是主人态；没带或带错令牌的访问是访客只读态，网址不变。

## 2. Vercel

1. 把仓库推到 GitHub，在 Vercel 导入；Vercel 会通过 `manage.py` 识别 Django。
2. 配置环境变量：
   - `DJANGO_SECRET_KEY`：必须显式提供
   - `DJANGO_DEBUG=False`
   - `DATABASE_URL`：线上建议 Postgres
   - **`NAV_WRITE_TOKEN`：公网必配**
   - `DJANGO_ALLOWED_HOSTS` / `DJANGO_CSRF_TRUSTED_ORIGINS`：按自定义域名填写
3. 首次部署后执行迁移：

```bash
vercel env pull
python manage.py migrate
```

`vercel.json` 只保留：

```json
{
  "regions": ["hkg1"],
  "functions": { "config/wsgi.py": { "maxDuration": 60 } }
}
```

静态文件不需要额外配置：设置 `STATIC_ROOT` 后，Vercel 构建时会自动 `collectstatic`，由 CDN 提供 `/static/`。

## 3. 数据库

本地零配置用 `db.sqlite3`。线上建议 Postgres（Neon / Supabase）：

```bash
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/flori_nav?sslmode=require
```

`config/settings.py` 已经处理了 Serverless 的两个坑：

- `CONN_MAX_AGE = 0`：请求用完即断，不攒僵尸连接
- `DISABLE_SERVER_SIDE_CURSORS = True`：兼容连接池的 transaction 模式

连接数交给**池化端点**（Neon 带 `-pooler` 的主机、Supabase 的 pooler），不要直连 5432 主库。

## 4. Serverless 已知限制

- 函数文件系统只读且临时：`MEDIA_ROOT` 里的图标本地化、HTML 工具不会持久化；需要长期保存请接对象存储。
- 全库测活受函数时长限制；页面已按 32 条/批分批，超时调小 `NAV_LINK_TOTAL_TIMEOUT`。
- 游客页读取的是静态快照 `nav/static/guest/nav-public.json`。改了公开范围或站点后，需要重新生成并随代码发布：

```bash
python manage.py export_nav_public
```

## 5. 安全细节

### 写接口

`nav` 的写接口原本是本地自用工具，默认没有登录校验：

`/api/nav/add|edit|delete|import|reset`、工具上传。

公网部署至少加一层：`NAV_WRITE_TOKEN`、Django `login_required`、Vercel Deployment Protection，或反向代理 Basic Auth。

### 可选写令牌

设置 `NAV_WRITE_TOKEN=<令牌>` 后：

- `/api/nav/` 下的 `POST/PUT/PATCH/DELETE` 必须带请求头 `X-Nav-Write-Token` 或 cookie `nav_token`，否则 403；
- `GET/HEAD/OPTIONS` 不受影响；
- 同一个令牌兼任页面身份：`/nav/` 带对令牌渲染主人页，没带 / 带错渲染访客只读页；
- 浏览器访问一次 `/?nav_token=<令牌>`，服务端写入 30 天 cookie，后续写操作自动带上。

不设 `NAV_WRITE_TOKEN`（或设为空）时中间件完全放行，适合本地开发。

### SSRF 防护

测活、图标本地化、元信息抓取默认拒绝内网、环回、链路本地地址。

本机自测内网站点时，临时设置：

```bash
NAV_ALLOW_PRIVATE_NET=1
```

**例外：AI 接口探测**。`/api/nav/ai/models` 和 `/api/nav/ai/model-test` 会向用户填写的 `base_url` 发起服务端请求，且允许内网 / 本机地址，因为主用例就是本机网关（如 Ollama、One-API 或其他 OpenAI 兼容代理）。公网部署必须配合 `NAV_WRITE_TOKEN` 或登录校验，不要把这组能力暴露给匿名访客。

## 6. 访客页快照

访客页不查数据库，只读 `nav/static/guest/nav-public.json`。文件缺失或损坏时访客页显示空态。

生成命令：

```bash
python manage.py export_nav_public
```

生成时会自动过滤隐藏分类、休眠站点和点击统计。公开范围可在后台切换为「公开（全部未隐藏站点）」或「仅内置站点」。
