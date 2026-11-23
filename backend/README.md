# FastAPI 积分生图后端

链路：Electron renderer → preload / 主进程 → HTTPS FastAPI → 火山视觉智能 / DeepSeek。
本地使用 Uvicorn + SQLite；Cloudflare 使用 Python Workers 的 ASGI 入口 + D1。
生图 API、Bearer token 格式及数据库 schema 与原后端兼容；新版桌面端的图片理解使用新增的 `/api/captions` 接口。

## 本地运行

安装 Node.js 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)，在项目根目录执行：

```powershell
npm run backend:install
npm run demo:server
```

uv 会根据 `backend/.python-version` 安装本地 Python，并使用独立的 `backend/.venv`。
后端监听 `http://127.0.0.1:8787`。`demo:server` 保留原来的本地 Electron 密钥桥接：
尝试读取当前用户已加密保存的火山 AK/SK，经进程 IPC 和子进程环境传入 Python，不写明文文件或日志。
`backend/local.mjs` 仅是启动桥接，所有 HTTP 和业务逻辑都由 Python 实现。

不需要桌面密钥桥接时，可以直接启动：

```powershell
npm run backend:dev
```

将 `backend/.dev.vars.example` 复制为 `backend/.dev.vars` 并填写 `VOLC_AK`、`VOLC_SK`。
这些是火山视觉智能 AK/SK，不是方舟 API Key；需开通「通用 3.0 文生图」。
实际生图会消耗供应商额度，自动测试不会调用付费接口。

图片理解在 `backend/.dev.vars` 中配置 `DEEPSEEK_API_KEY`；可用 `DEEPSEEK_MODEL` 覆盖默认的 `deepseek-flash`。密钥仅由服务端读取，不会返回桌面端，也不再读取旧的桌面 DeepSeek 密钥。修改后重启后端。图片理解共用登录账户，支持独立文案、跨平台统一文案和视频封面分析，当前不扣应用积分，上游费用由服务端账户承担。

桌面端通过 `npm run dev` 启动，在「生图账户」中点击「没有账号？注册」：

- 用户名：3–32 位字母、数字或下划线，不区分大小写；`demo` 为保留名称
- 密码：8–128 位，需确认密码；注册成功后自动登录
- 每个账号独立保存积分、签到和生图任务，新账号为 0 积分
- 原本地 `demo` 账号继续可用，默认密码 `demo12345`，可用 `DEMO_PASSWORD` 覆盖；自注册账号无需配置它
- 默认签到奖励：30 积分；每次生图：10 积分

后端地址不会在桌面界面显示，也不由登录表单传入。主进程默认连接本机 `http://127.0.0.1:8787`；开发者可在启动桌面端前设置 `FANZY_BACKEND_URL`。该配置在下次登录时生效，已有会话继续绑定原服务器，切换前请处理待查询任务并退出登录。

配置项：`GENERATION_ENABLED=false` 暂停生图，`IMAGE_COST` 修改价格，`CHECKIN_REWARD` 修改每日奖励。
`DEMO_PORT` 修改本地端口。修改配置后重启后端。
直接 Python 启动时，进程环境变量优先于 `.dev.vars`；桥接入口沿用旧行为，先将 `.dev.vars` 合并到子进程环境。

## 文件和接口

| 文件 | 职责 |
| --- | --- |
| `src/app.py` | FastAPI 路由、鉴权、签到、积分、任务状态和退款 |
| `src/database.py` | SQLite 与 D1 数据访问适配，事务批处理 |
| `src/passwords.py` | 加盐密码哈希，本地 PBKDF2 / Worker Web Crypto |
| `src/provider.py` | 火山 HMAC 签名、提交任务和查询结果 |
| `src/captions.py` | 图片理解、服务端提示词与输入/输出校验 |
| `src/transport.py` | 本地 HTTPX / Worker 原生 Fetch，流式下载图片 |
| `local.py` | Uvicorn 本地入口 |
| `src/worker.py` | Cloudflare ASGI 入口 |
| `schema.sql` | 原有数据库表、唯一约束、余额触发器 |
| `tests/test_api.py` | 不调用真实供应商的自动测试 |

| 方法与路径 | 功能 |
| --- | --- |
| `GET /health` | 健康检查 |
| `POST /api/register` | `{username, password}`，创建独立账号并返回 `{token, account}` |
| `POST /api/login` | `{username, password}`，返回 `{token, account}` |
| `POST /api/logout` | 撤销当前会话 |
| `GET /api/me` | 用户、余额、签到状态、配置、流水、未完成任务 |
| `POST /api/checkin` | 每日签到，返回账户状态 |
| `POST /api/captions` | `{images, platforms, shared, hasVideo}`，返回 `{caption, title, hashtags, alt_text}` |
| `POST /api/tasks` | `{id, prompt, size}`，返回任务状态 |
| `GET /api/tasks/{id}` | 查询当前用户的任务并刷新上游状态 |
| `GET /api/tasks/{id}/image` | 下载已成功任务的图片 |

除健康检查、注册和登录外，业务接口需要 `Authorization: Bearer <token>`。
错误保持 `{ "error": "说明" }` 格式。价格、签到奖励和用户身份均由后端决定。

文案接口只接受 1–35 张 JPEG data URL（每张含编码不超过 1 MiB，总请求不超过 16 MiB），不接受远程图片 URL。桌面端先缩放到最长边 768 像素。`platforms` 为平台数组，独立文案只能指定一个平台；`shared` 和 `hasVideo` 为布尔值。提示词、模型、密钥和上游地址由服务端决定。每账号每分钟最多 30 次，DeepSeek 请求超时为 120 秒。图片与文案只在请求期间处理，不写入数据库或日志；上游错误统一脱敏返回，失败时桌面保留原草稿。

## 数据迁移与一致性

沿用 `backend/.local/demo.sqlite`，不删除或重建数据。启动时执行幂等 schema。
原有余额、签到、任务、积分流水及未过期会话继续有效。迁移前可以停止旧服务并备份 SQLite 文件；不要同时运行两个占用同一端口的后端。
云端继续绑定原 D1 数据库即可，不要为已有账户重新创建数据库。`schema.sql` 也不会重置已有表和数据。
升级注册功能时，先在远程 D1 重新执行 `schema.sql`，增加 `user_credentials` 和 `auth_attempts` 表，再发布 Worker。本地启动会自动补齐这两张表。

- 密码使用独立随机盐与 PBKDF2-SHA256 哈希保存，不存明文；为兼容 Workers Web Crypto，迭代次数为 100,000。
- 注册按来源 IP 每小时限 10 次；登录按用户名每 15 分钟限 10 次，成功后清除该用户名的计数。
- 签到按北京时间计算日期，唯一约束和积分流水业务编号保证一天只奖励一次。
- 会话为随机、可撤销、7 天有效的 token，数据库仅存 SHA-256 哈希；桌面端使用 safeStorage 保存。
- 创建任务与积分扣款处于同一个 SQLite / D1 batch 事务中，余额不能为负。
- 客户端重试必须沿用同一任务 UUID；后端核对用户、提示词及尺寸，避免重复调用或扣款。
- 每位用户同时最多一个 `submitting/pending/uncertain` 任务。
- 明确拒绝、上游失败或过期只退款一次；查询异常不退款。
- 提交结果不确定时保留扣款并标记 `uncertain`，避免自动重试导致重复消费。
- 进程在扣款后中断可能留下 `submitting` 任务，需管理员核对上游并处理；不会盲目重新提交。
- 成功图片目前使用上游临时 URL，请及时保存到桌面素材库。尚未接入 R2 持久存图。

## Cloudflare Workers + D1

Workers 使用 `workers.asgi.entrypoint(app)`，不启动 Uvicorn。
运行时依赖只有 FastAPI；HTTPX / Uvicorn / dotenv 仅在本地依赖组中。
`uv.lock` 锁定本地依赖，`pylock.toml` 锁定 pywrangler 解析出的 Worker 依赖；开发组包含所需的新版项目级 uv，不必修改全局 uv。
Worker 入口位于独立的 `src/`，避免把本地虚拟环境、测试和开发脚本打包进部署文件。
Python Worker 的解释器版本由 Cloudflare compatibility date 决定，可能与本地 Python 版本不同。

以下命令在 `backend` 目录执行：

```powershell
cd backend
uv run pywrangler login

# 仅首次创建；已有数据库请直接使用原数据库 ID
uv run pywrangler d1 create fanzy-image-demo
```

把返回的数据库 ID 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`。
本地验证 Worker 时先初始化本地 D1，并配置 `.dev.vars`：

```powershell
uv run pywrangler d1 execute fanzy-image-demo --local --file schema.sql
uv run pywrangler dev
```

此处的本地 D1 位于 `.wrangler`，与 Uvicorn 使用的 `.local/demo.sqlite` 是两个独立数据库。
本地 Worker 也需要显式设置 `DEMO_PASSWORD`，不会自动读取 Electron 密钥。

准备发布时执行：

```powershell
uv run pywrangler d1 execute fanzy-image-demo --remote --file schema.sql
uv run pywrangler secret put VOLC_AK
uv run pywrangler secret put VOLC_SK
uv run pywrangler secret put DEEPSEEK_API_KEY
uv run pywrangler secret put DEMO_PASSWORD

# 仅检查打包，不发布
uv run pywrangler deploy --dry-run

# 实际发布
uv run pywrangler deploy
```

不要把 AK/SK、DeepSeek API 密钥或密码写入 `vars`、版本库或桌面安装包。需要覆盖 DeepSeek 模型时，可在 `wrangler.jsonc` 的 `vars` 中配置 `DEEPSEEK_MODEL`。
部署后由开发者将桌面端启动环境的 `FANZY_BACKEND_URL` 设置为返回的 HTTPS 地址，用户无需填写。默认 Worker 名称保持 `fanzy-image-demo`，以便替换原入口。
远程发布需要用户自己的 Cloudflare 登录和 D1 ID；仓库不包含账户凭证。

参考：[Cloudflare FastAPI](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/)、
[Python D1](https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers/)。

## 验证与当前范围

在根目录执行：

```powershell
npm run test:backend
npm run typecheck
```

测试覆盖登录/退出/过期、Token 哈希、并发签到、任务幂等、余额不足回滚、失败退款、未知结果保留、任务归属、输入限制、图片响应、原数据库复用、客户端尺寸和火山签名兼容。

也可验证真实的本地 Worker/D1 运行时。以下命令在 `backend` 目录执行，使用独立测试数据和端口，并禁用生图：

```powershell
uv run pywrangler d1 execute fanzy-image-demo --local --persist-to .local/worker-smoke --file schema.sql
uv run pywrangler dev --local --port 8788 --inspector-port 9239 --persist-to .local/worker-smoke --var DEMO_PASSWORD:test-password --var GENERATION_ENABLED:false
```

服务就绪后，另开终端在 `backend` 目录执行 `uv run --no-default-groups python tests/smoke_worker.py`。
该检查验证注册、Web Crypto 密码哈希、重复用户名、登录、D1、并发签到和退出，不调用火山。完成后关闭测试服务。

当前支持用户名密码注册和独立账户，不包含找回密码、邮箱验证、充值或会员系统。
公开运营前还需注册验证、总消费预算和异常任务对账。

### 文案预览操作

`/api/captions` 保留原有请求格式，新增可选 `action`：
- `variants`：传入 `text`（可为空），图片仍为1–35张；一次上游调用返回 `candidates` 三个不同正文字符串，同时兼容返回首条 `caption`。
- `translate`：传入非空 `text` 和1–80字符的 `language`；允许 `images: []`。
- `shorten`：传入非空 `text` 和10–5000之间的整数 `maxLength`；允许 `images: []`。返回正文需严格短于原文且不超过目标长度。

原文最多5000字符，继续使用登录鉴权、频率限制和脱敏错误。桌面预览操作不写入草稿；采用后由用户保存。验证：`python -m unittest discover -s tests -p test_caption_preview.py`，桌面在构建后运行 `node tests/caption-preview.test.mjs` 和 `electron tests/caption-preview-desktop.cjs`。均不调用付费供应商。
