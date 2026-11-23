# Fanzy Reach Studio

Local-first Electron desktop assistant for preparing image posts for Instagram, X, Pinterest, TikTok, Bluesky and Facebook. Windows and macOS packaging instructions: [DESKTOP-BUILD.md](DESKTOP-BUILD.md).

### 桌面端登录、签到与积分生图 Demo

运行 `npm run demo:server` 启动独立后端，再运行 `npm run dev` 启动桌面端。在「素材库 → AI 生成图片」或「设置 → 生图账户」点击「没有账号？注册」，使用用户名和密码注册后自动登录。用户名为 3–32 位字母、数字或下划线，密码为 8–128 位。每个账号独立保存积分和签到记录，新账号为 0 积分，签到默认领取 30 积分。本地兼容账号 `demo`，默认密码 `demo12345`。后端地址由应用内部管理，不在用户界面中输入或展示。

在项目根目录 `.env` 中设置 `MAIN_VITE_BACKEND_URL=https://你的后端地址`，开发时重启 `npm run dev` 生效，安装版需要重新打包。连接云端无需运行本地后端，使用云端账号密码。系统环境变量 `FANZY_BACKEND_URL` 可覆盖 `.env` 地址；已有登录会话仍使用登录时保存的地址，切换后需退出并重新登录。

- 未登录无法生图，桌面 IPC 和后端 API 都校验登录，不回退到本机密钥直连。
- 每日签到默认领取 30 积分，每张图默认消耗 10 积分；权限、费用与余额由后端控制并持久化。
- 后端真实调用火山视觉智能「通用 3.0 文生图」。本机演示可复用已保存的加密 AK/SK，或在 `backend/.dev.vars` 配置服务器密钥；云端使用 Workers Secrets。
- 结果先预览，再点击「保存到素材库」。查询失败可继续查询，不重复扣分或提交生成。明确失败退回积分，受理结果不明则保留记录待核对。
- 当前 demo 仅开放文生图；原有 SeedEdit 实现保留在源码中，未接入此积分 demo。图片理解和文案生成也通过后端调用，共用登录账户，当前不扣应用积分。

详细配置、限制与 Workers + D1 部署步骤见 [backend/README.md](backend/README.md)。验证命令为 `npm run test:backend`、`npm run typecheck`、`npm run build`。安装版需要重新打包。

### Facebook 一键发布

1. 重启应用，在设置中点击 **登录 Facebook**，在专用 Chrome 中登录并选定发布身份和受众，然后点击 **完成登录 / 关闭窗口**。
2. 导入图片，选择 Facebook 创建草稿，编辑文案后勾选草稿并提交。每条支持 1–10 张图片（本应用的保守上限），使用已有浏览器登录会话，无需配置 Meta API 密钥。
3. 定时任务使用本地队列，需保持应用运行。暂不支持群组、Reels、自动填写替代文本或自动切换主页身份；发布沿用 Facebook 当前身份及受众。
4. 只有检测到明确的发布成功提示才标记成功；关闭弹窗不算成功。结果不明确时保留“待确认”，请到 Facebook 核对后手动确认，避免重复提交。不会把首页地址当作帖子链接。

离线浏览器回归：`.venv/Scripts/python.exe -m unittest discover -s python -p test_facebook.py`。测试不发布真实内容；真实账号页面布局仍需登录验证。

## What this starter does

- Import multiple image files or scan a folder (up to 500 images per import).
- Copy imported originals into the app's local data folder.
- Generate local WebP thumbnails and deduplicate images using SHA-256.
- Create platform-specific drafts:
  - Instagram: up to 10 images per carousel draft.
  - X: up to 4 images per post draft.
  - Pinterest: one image per Pin draft.
- Optionally use DeepSeek `deepseek-flash` vision to generate English captions, titles, hashtags and alt text.
- Edit and save draft content locally.
- Prepare platform-sized JPEGs, write `caption.txt`, copy the caption and open the official platform website.
- Start a native Windows file drag from a prepared draft card so the user can drag the files into a compatible platform composer.
- Manually confirm publication and optionally store the published URL.
- Store images, drafts and settings locally. DeepSeek credentials are configured only on the server; the desktop stores its login token using Electron `safeStorage`.

## Python + Playwright 无头发布

生产发布由 Python Playwright 执行，无需浏览器扩展或配对。首次使用专用窗口登录，后续复用独立配置；不会读取当前日常 Chrome/Edge 的登录资料。

### 首次使用

1. 安装版已内置 Python 和 Playwright，无需另外安装。仅源码开发时需要安装 Python 并运行 `python -m pip install -r python/requirements.txt`。开发模式自动使用项目 `.venv/Scripts/python.exe`（Windows）或 `.venv/bin/python`（Mac），也可用 `FANZY_PYTHON` 指定解释器。
2. 安装 Google Chrome，启动程序。三个平台的登录和发布统一使用 Chrome。
3. 点击 **登录 X / Instagram / Pinterest**，程序直接启动普通 Chrome（无自动化及远程调试参数），使用各平台专用目录。完成登录与验证后点击 **完成登录 / 关闭窗口**，程序正常关闭 Chrome，再用无头 Playwright 读取同一目录并保存加密快照；此时不会恢复旧快照覆盖新会话。登录期间不定时读取快照；手动关闭窗口后仍需点击完成登录。退出程序也会尝试完成保存，失败记录在运行日志。保存成功不代表平台账号必然可发布。
4. 默认关闭 **显示浏览器**，发布在无头模式执行。开启后发布过程可见；登录窗口始终可见。发布期间请勿手动编辑自动化窗口。
5. 创建并保存草稿；Pinterest 填写准确的画板名。勾选草稿并点击 **Submit selected**。程序自动上传、填写并提交。X 定时草稿则提交到平台排程。

登录配置按平台隔离，保存在 `browser-profiles/chrome/<平台>/`。Cookie、LocalStorage 和 IndexedDB 快照在 Windows 上继续使用 DPAPI 加密；Mac 使用 AES-GCM，并通过 Electron safeStorage / 系统钥匙串保护加密密钥。密钥通过标准输入传给发布进程，不写入命令行或环境变量。不要分享整个配置目录，也不要跨系统复制登录快照。Mac 需要通过桌面应用启动发布程序。已有 Windows Chrome 配置继续复用；旧 Edge / Chromium 配置保留但不再用于发布。

### 结果与恢复

- 登录失效、验证码、账号限制或页面变化时停止任务；请打开平台登录窗口处理。不会自动处理验证或绕过账号限制。
- 最终发布/排程前必须由 Electron 持久化检查点，Python 收到确认后才允许点击。结果不明进入 `uncertain`，不会自动重发。
- 同一平台的登录窗口未关闭时禁止同时发布；同一批次某平台失败会暂停该平台后续任务。
- 发布完成或失败会关闭自动化浏览器并保存状态；程序退出会关闭其登录窗口。
- 失败时保存本地截图到 `logs/screenshots/`，日志中记录路径，最多保留最近 50 张。截图可能包含账号、草稿或验证信息，请勿未经检查直接分享。
- 页面适配器位于 `python/page_adapter.js`，X 原生排程与原有上传/提交确认流程保持一致。`extension/` 和 `extension_bridge.py` 仅保留为旧版本参考，不随新安装包分发扩展。

### 运行日志与排查

更新后请重启桌面应用。无需刷新扩展或配对。

- 左侧 **运行日志**：实时查看程序、Python 和页面操作记录，也可读取旧版扩展历史日志。支持信息/警告/错误筛选、平台筛选，以及搜索步骤、错误或任务 ID。
- 草稿结果卡片的 **查看该任务日志**：直接筛选当前草稿，区分每次执行的 job ID。展开“详情”查看错误堆栈。
- 搜索 `performance.sample` 查看发布期间每 5 秒的性能采样：整机 CPU 百分比、系统可用内存、页面主线程忙碌比例、JS 堆内存及 DOM 数量。页面负载不等于整机 CPU；这些指标用于对照卡顿时间，不能单独证明根因。任务结束即停止采样。
- **打开日志文件夹**：查看本机实际路径。文件存于 Electron `userData/logs/`，当前文件 `runtime.jsonl`，历史文件 `runtime.1.jsonl` 到 `runtime.10.jsonl`。JSONL 每行是一条独立 JSON 记录，可以用文本编辑器查看。
- 每个文件约 5 MB，超过后轮换；最多保留 10 个历史文件。界面保留最近 1000 条，重启后仍可读取近期历史。更早的记录请查看保留的日志文件。
- 记录任务开始、图片准备/传输/上传、页面控件等待与耗时、文案填写、提交检查点、最终点击、成功确认、异常堆栈、Python 标准错误和退出状态。每条任务日志包含草稿 ID、执行 ID、平台或程序会话，便于追踪。
- 不主动记录正文、图片内容、Cookie 或配对信息；配对令牌、常见凭据和 URL 查询参数会过滤。日志仍可能包含错误中的本地路径，分享前可以检查文件。
- 文件写入失败时，界面明确提示，并暂存在内存中；这部分记录无法保证重启后保留。Python 进程中断时桌面端会记录断开/超时及待确认结果。
- **复制筛选结果**最多 10000 字符；要提供完整历史请使用日志文件。

### 验证

```powershell
# Playwright 是生产依赖。浏览器回归使用系统 Chrome 和隔离配置。
.venv\Scripts\python.exe -m pip install -r python\requirements.txt
.venv\Scripts\python.exe -m unittest discover -s python -p "test_*.py"
node tests/log-store.test.mjs
npm run typecheck
npm run build
.venv\Scripts\python.exe python\smoke_browser.py

```

浏览器发布测试需要系统 Chrome；UI 冒烟测试使用系统 Edge。`test_native_login.py` 用本机 HTTP 页面验证普通 Chrome 到无头模式的配置交接；`test_playwright.py` 在真实无头浏览器中拦截平台请求并返回本地页面，验证登录快照复用、显示模式选择、三个平台、X 定时发布、提交检查点及失败截图；不会发布真实内容。Windows DPAPI 测试需在正常用户环境执行，受限账户可能无法调用 DPAPI。真实平台风控与页面布局仍可能影响发布。

## Electron compatibility

This starter pins Electron to `^41.0.0` because electron-vite 5.0.0 locates the Electron executable through `node_modules/electron/path.txt`. Electron 42+ changed its binary download behavior, so do not upgrade Electron to 42+ with this electron-vite setup unless you also upgrade to an electron-vite release that explicitly supports the new mechanism.

## Development requirements

- Windows 10/11 x64 or macOS (build separately for Apple Silicon / Intel)
- Node.js 22 LTS or a compatible newer LTS release
- npm
- Python 3.12 recommended, Playwright and Google Chrome
- Internet connection for DeepSeek AI requests and platform publishing

## Install and run

```powershell
npm install
npm run typecheck
npm run dev
```

## Build desktop installers

First install the build dependencies into the Python environment used by the project:

```text
python -m pip install -r python/requirements-build.txt
```

Windows:

```powershell
npm run dist:win
```

Output:

```text
release/Fanzy-Reach-Studio-0.2.0-win-x64.exe
```

For an unpacked build:

```powershell
npm run pack:win
```

On macOS, use `npm run dist:mac` on each target architecture. Installers include the Python publisher and Playwright; users still need Google Chrome. See [DESKTOP-BUILD.md](DESKTOP-BUILD.md) for isolated builds, CI, signing, notarization and verification. Sharp is rebuilt for the target platform during packaging.

## DeepSeek setup

1. Configure `DEEPSEEK_API_KEY` in `backend/.dev.vars` locally, or as a Worker Secret in production. Optionally set `DEEPSEEK_MODEL` (default: `deepseek-flash`). Restart or deploy the backend after configuration.
2. Sign in to the backend account in the app's Settings.
3. Return to Publishing Queue, choose drafts and generate independent or shared AI copy.

The app sends selected, resized JPEG images (or video cover frames) to the authenticated `/api/captions` endpoint. The server builds the prompt and calls DeepSeek without storing images or drafts. Originals remain local. Existing desktop DeepSeek keys are no longer read or sent; configure the key on the server. Caption generation currently does not deduct app credits, but provider charges still apply to the server account.

DeepSeek vision documentation:
https://api-docs.deepseek.com/guides/vision/

## Local data location

Electron stores data under `app.getPath("userData")`:

- `assets/` — imported original images
- `thumbnails/` — local WebP previews
- `exports/` — prepared platform folders
- `reach-data.json` — local library, drafts, publication checkpoints and encrypted settings
- `browser-profiles/` — dedicated per-browser/per-platform profiles and DPAPI-encrypted login snapshots
- `logs/screenshots/` — failure screenshots, newest 50 retained

Use the app's own UI to manage data. Do not manually edit `reach-data.json` while the app is running.

## Current limitations

### X 原生定时发布

在 X 草稿中设置「X 定时发布时间」（显示本机时区），至少选择 5 分钟后的时间，保存并勾选草稿，点击 Submit。留空则立即发布。Playwright 现在就向 X 提交排程；只有 X 显示排程确认，任务才记为 `scheduled`，不会提前记为已发布。确认后无需保持桌面程序运行，实际发送由 X 处理。

已提交的排程请在 X 的已排程帖子中查看、修改或取消；本地删除草稿不会取消 X 排程。程序不会自动把到期排程标成已发布。结果不确定时先到 X 核对，避免重复安排。账号暂停、登录验证、页面结构变化均可能阻止排程。原「Local reminder」仍只是本地提醒，与此功能无关。

开发验证使用拦截页面的隔离浏览器测试，未向真实账号提交排程。更新后需重启桌面程序。

- No official API publishing is implemented.
- Browser selectors require real-account validation and maintenance as platform layouts change.
- No unattended background scheduling after app exit.
- Instagram carousel grouping uses a conservative default of 10 images; check the current platform composer limits before publishing.
- X grouping uses a conservative default of 4 images.
- Pinterest creates one Pin draft per image.
- Browser success requires a platform confirmation message; manual publication remains user-confirmed. Post URLs are recorded only when a verified detail URL is available.
- AI output must be reviewed before posting.
- Full clean-machine installation and macOS real-machine acceptance remain required. Python and Playwright are bundled; Google Chrome must be installed separately.

## Security notes

- Renderer has no direct Node integration.
- Context isolation and sandboxing are enabled.
- The preload exposes a narrow, typed API.
- Only HTTPS external links are opened.
- DeepSeek API keys stay on the backend; desktop login tokens are encrypted with Electron `safeStorage`.
- Login snapshots use Windows DPAPI or macOS AES-GCM with a safeStorage-protected key; browser profiles and diagnostic screenshots stay local.
- This local app does not provide a secure multi-user secret vault. Windows DPAPI protects the stored key for the current Windows user, but malware running as that user may still access application secrets.

## Suggested next steps

1. Add campaign names and reusable caption templates.
2. Add platform-specific image crop editor.
3. Add export-folder naming and per-draft ZIP export.
4. Add Windows toast notification and tray mode.
5. Add an optional official API integration only after reviewing each platform's current terms, access requirements and costs.

# 统一文案与独立文案

## Pinterest 发布结果

发布按钮只点击一次。程序监听本次提交后的简繁中文及英文成功提示，并保留短暂出现的提示证据；另被动识别浏览器 `/resource/PinResource/create/` 的成功响应与有效 Pin ID，识别到时保存 Pin 链接。程序不会主动调用或重放创建接口。

45 秒内未取得明确证据时显示“已提交，结果待确认”，日志为警告，并保存待确认截图。推广弹窗或编辑器清空本身不会被认定为成功。平台改变响应格式时仍可能需要手动核对：在 Pinterest 确认帖子存在后，点击“已确认发布成功”；不要直接重发。

## 卡顿诊断

运行日志搜索 `performance.` 可查看以下记录（均不采集鼠标位置、按键内容或文案）：

- `performance.ui`：每 5 秒汇总界面 rAF 回调间隔最大值/P95、100ms 心跳延迟峰值、长任务数量/最大时长、输入排队延迟。`visible` 与 `visibilityChanged` 标识窗口可见性，后台或可见性切换样本不能直接判定为卡顿。能力标志区分不支持与真实零值。rAF 间隔不是显卡完成绘制的耗时。
- `performance.desktop`：主进程事件循环延迟最大值/P95及 Electron 子进程 CPU、工作集内存。发布期间每 5 秒记录；空闲时每 30 秒或检测到大于 150ms 阻塞时记录。GPU 进程的 CPU 占用不是 GPU 硬件利用率。
- `performance.gpu_info` / `performance.gpu_exit`：启动时的 GPU 驱动与加速状态、GPU 进程退出；`performance.unresponsive` / `performance.responsive` 记录窗口失去/恢复响应。
- `performance.sample`：发布页面与整机采样，新增 `gpuBusiestEnginePercent`（所有进程按同一物理引擎归并后的最忙引擎占用，不是各引擎相加）、`gpuCounterStatus` 与 `gpuSampleMs`。使用 [Windows PDH 计数器接口](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhgetformattedcounterarrayw)，无权限或驱动不支持时标注不可用，不返回虚假的零值。它是采样区间平均值，不能排除更短的 GPU 峰值。

判断时对齐同一时段的这些记录：界面长任务/输入延迟高时先看界面；主进程延迟高时看主进程；GPU 引擎占用高或 GPU 退出、帧间隔异常而 JS 延迟低时，再检查渲染与驱动。指标只提供线索，不凭单条高值自动关闭硬件加速。

日志视图每页 100 条、每 250ms 合并更新，筛选和复制覆盖最近 1000 条。离线性能对照可运行 `python/benchmark_ui.py`，真实 Electron 监控验证可运行 `electron tests/performance-desktop.cjs`，测试不发布内容。真实发布仍需重启新版程序后采样确认。

## 各平台默认配置

「设置与账号 → 各平台独立配置」支持分别保存 Instagram 的分组图片数量与标签、X 的分组图片数量与标签及定时偏好、Pinterest 的默认图板与标题及标签。配置写入本机数据文件，重启后仍保留，旧版本没有配置时沿用原来的默认值。

配置仅在创建新草稿时复制进去，不覆盖已有草稿；在单条草稿中修改不会反向改变默认配置。所有平台均可保存相对创建时间的延后分钟数（10 至 10080 分钟），0 表示提交时立即发布，同批次草稿使用同一个定时时间。创建后仍需手动提交，提交时须距排程至少 5 分钟。AI 生成会重新生成该草稿的标题和标签。

### 原生优先与本地定时

在草稿的「定时发布时间」设置时间并提交：X 使用原生排程；Pinterest / Instagram 在当前发布页检测原生排程入口，能识别并核对日期、时间及最终排程按钮时提交原生排程，否则在点击发布之前转入本地队列。当前适配标准日期/时间输入框，未适配的自定义日期控件同样转为本地队列。Instagram 当前使用 instagram.com 发帖入口，没有接入 Meta Business Suite；该页面未开放排程时使用本地任务。TikTok 图片和 Bluesky 使用本地任务。

本地队列持久化保存，每 30 秒检查到期任务；其他发布批次运行时顺延。电脑必须唤醒，程序运行，网络及登录有效。退出、休眠或重启期间错过的任务在恢复运行后补发。失败或结果不确定的任务不自动重试，请在「发布队列」核对平台结果后手动处理。单纯创建草稿或保存默认配置不会启动任务。旧版「本地提醒」仍只提醒，不会转为自动发布。

侧栏「本地定时任务」集中展示已提交的本地任务，按计划发布时间排序，不再混入待提交的发布队列。支持单条一键删除，或全选后批量删除；删除会移除任务和对应草稿，阻止后续自动发布，素材库内容保留。执行中或结果待确认的任务不能删除。若要修改内容或时间，点击「取消定时并保留草稿」返回发布队列，编辑后重新提交。平台原生排程仍在「发布记录」查看。

原生排程只有收到明确排程确认后才进入发布记录；关闭程序不影响已确认的原生排程。修改或取消原生排程请前往平台。页面适配通过拦截页面测试，尚未向真实账号提交新平台的排程。

在素材库选好图片和平台后，填写统一文案。每个平台都可以选择使用统一文案或独立文案，两种方式可混用；切换选项会保留输入的独立版本，也可将统一文案复制到独立编辑框后修改。

同次创建的草稿关联为一个文案批次。发布队列中保存统一正文时，会同步本批次使用统一文案的可编辑草稿；独立文案仅修改当前草稿。切换模式会先保存当前编辑内容。标题、话题标签、图片替代说明、图板与 X 排程仍分别设置。AI 生成会切换为当前平台独立文案。

已有草稿维持独立编辑。已发布、已排程或结果待确认的任务不会被统一文案覆盖。界面使用简体中文；平台名称、日志步骤标识与底层错误堆栈保留原文，方便排查。


## TikTok 图片轮播（网页端适配）

- 平台选择、独立 Chrome 登录、共享/独立文案、AI 文案、平台配置及日志均支持 TikTok。
- 每条草稿最多 35 张图片，按选择顺序导出 JPEG，保持比例缩放至 1080 × 1920 以内，不放大小图；仍使用通用限制：单图 12 MB、单任务 24 MB。
- 标题最多 90 个 UTF-16 单元，描述加话题最多 4000 个。批量提交前请保存草稿。
- 自动发布依赖账号的 TikTok Studio 网页端提供图片上传入口。适配器检测明确支持图片的上传控件、全部本地图片预览和可识别的标题/描述字段；不支持的页面会停止并显示原因。此时可使用准备素材/复制文案功能，在 TikTok 手机端完成轮播并手动确认发布。
- 最终提交沿用持久化检查点；只有明确的发布成功提示才记为成功，“上传成功”不视为已发布。结果不明需要人工核对。
- 已用拦截网络的本地页面测试验证流程，尚未验证真实 TikTok 账号页面。页面布局、预览地址格式或确认弹窗变化可能需要继续适配。
- 本次没有接入 TikTok Content Posting API；该 API 的图片发布要求 OAuth 授权和经验证的公网图片 URL：https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post 。

验证：`.venv\Scripts\python.exe -m unittest discover -s python -p test_tiktok.py`

## 跨平台并行发布

批量勾选不同平台的草稿后，TikTok、Instagram、X、Pinterest、Bluesky 各自使用独立 Python 工作进程及浏览器配置，并行上传与发布（最多五个平台）。同一平台的多条草稿按所选顺序逐条执行。

### Bluesky 图片发布

在「设置与账号」点击「登录 Bluesky」，登录后点击「完成登录 / 关闭窗口」。在素材库选择 Bluesky 创建草稿，再到发布队列勾选并提交，可与其他平台同时发布，也支持 AI 独立文案和统一文案。

当前接入每条 1–4 张图片，导出时按比例缩放至 1600 × 1600 以内。标题、正文和话题合并发布，提交前按 Unicode 字素检查 300 字符限制。填写的替代文本会应用到每张图片。

成功确认被动监听本次浏览器发出的 createRecord / applyWrites 请求，核对正文、图片数量、记录类型和返回的帖子 URI/CID；不会另行调用发布接口或自动重发。没有明确确认时保留「结果待确认」，不因页面跳转或旧帖子误报成功。实现参考 [Bluesky 官方发帖文档](https://docs.bsky.app/docs/tutorials/creating-a-post) 与官方网页客户端的控件标识。

隔离验证：`.venv\Scripts\python.exe -m unittest discover -s python -p test_bluesky.py -v`。这些测试拦截平台请求，不代表真实账号端到端验证。

提交检查点、超时和结果分别归属各平台进程；某平台失败或结果待确认仅暂停该平台的后续任务。整个批次完成前仍锁定所选草稿并禁止启动另一个批次。退出时会关闭全部平台工作进程。

验证：`node tests/parallel-publisher.test.mjs`（模拟进程协议，不发布真实内容）。

## 内容工作台

侧栏「内容工作台」包含 AI 风格模板、素材复用管理和周/月内容日历。

- 风格支持语言、语气、受众、品牌介绍和禁用词；保存并启用后应用于发布队列的独立及统一文案。需同步部署新版后端。模板保存在本机，最多20套；恢复默认会清空自定义模板。
- 素材支持标签（也可作为主题集合）、收藏、名称/标签搜索和指定平台未发布筛选。发布轨迹来自保留的本地发布记录，删除记录后对应轨迹不再可见。批量保存会替换所选素材的标签和收藏状态。
- 日历按本机时区显示，支持平台筛选、周/月切换、未提交草稿拖动改期和按勾选顺序以固定间隔批量安排。开始时间至少在5分钟以后。保存排期不会提交发布，仍需到发布队列提交；已提交的平台排程、本地待执行任务与不确定结果禁止在日历改期。
- 发布队列正文编辑区支持一次请求生成三个候选、选择目标语言翻译和按指定字符数缩短。结果先预览，点击“采用此文案”仅替换当前编辑器正文，再点击“保存修改”持久化；统一文案沿用已有同步规则。标题、标签和图片说明保持不变，正文富文本格式在采用后转为纯文本。
- 翻译和缩短使用当前编辑内容（含尚未保存的修改），不上传图片。缩短结果必须严格短于原文且不超过目标字符数；不满足时保留原文并报错。字符数不等同于各平台的加权计数，发布时仍执行原有平台校验。
- 修改原文、切换草稿或开始发布会使旧预览失效。取消等待会丢弃返回结果，不保证取消已发出的上游请求。新功能需同步部署新版后端并重启桌面端；旧后端不支持三候选。
- 本版本不自动获取远端发布历史。未执行真实账号发布验收。

### 内容工作台的多语言与日历布局

新增工作台、文案候选/翻译/缩短操作支持简体中文、英语、日语、韩语界面，切换时保留用户文案和已保存风格。翻译目标语言使用各语言原名，与界面语言独立。日期和时间按所选界面语言显示，排期时区仍为本机时区。

月/周日历的日期格最多显示两条摘要及剩余数量，选中日期后在独立详情区显示当天全部平台任务，按时间排序并可滚动。窄窗口下详情区移到日历下方；从详情卡片拖至日期格可调整未提交任务日期。

验证：`node tests/i18n.test.mjs`、`electron tests/content-studio-desktop.cjs`、`electron tests/i18n-desktop.cjs`。日历回归覆盖同一天18条六平台任务、四语言切换、窄窗口和周视图。

### 同平台多账号

在「设置与账号 → 平台账号」添加或重命名账号；每个账号分别打开登录窗口并点击「完成登录 / 关闭窗口」。账号名称是本地备注，保存前需在平台页面人工确认用户名，程序不会自动读取头像或验证备注与平台身份一致。登录配置已保存不代表登录仍有效，发布时会检查平台登录和验证状态。

现有账号迁移为各平台「默认账号」，继续使用原浏览器目录和加密登录快照，不搬迁或清除 Cookie。旧草稿、排期和发布记录绑定默认账号，首次迁移前保存 `reach-data.json.before-multi-account.json` 备份；迁移可重复执行。每个平台最多 20 个账号，新增账号使用独立配置目录。

创建草稿时可勾选同平台多个账号，每个目标账号产生独立草稿；旧草稿可在详情中选择账号并保存。本地定时任务需先取消定时后更换账号，正在发布、已提交待核对、已发布或平台已排程的任务禁止更换账号。手动准备素材也打开草稿绑定账号的专用浏览器。日历支持按账号过滤，队列、定时任务和发布记录展示账号名称。

同平台仍串行执行，跨平台并行。一个账号失败或待验证只阻止该账号在当前批次的后续任务，其他账号可继续；重试和定时执行始终使用草稿绑定账号。本功能提供登录环境隔离，不保证平台无法关联设备或网络。界面支持简体中文、英文、日文、韩文，用户填写的账号名称保持原文。

账号卡片支持「删除账号」，需二次确认。有关联草稿、定时任务或发布记录时阻止删除；先转移草稿或移除关联记录。删除只移除本地账号入口并禁止继续使用该账号，不注销平台账号，保留浏览器文件；默认账号删除后不会在重启时重新出现。

### 图片编辑与发布预览

在素材库选中一张图片，点击「编辑所选图片」，支持自由裁剪、1:1 / 4:5 / 9:16 / 16:9 比例、拖动裁剪区域、90° 旋转和文字水印（颜色、大小、不透明度、位置）。保存生成新的 PNG 素材，原图及已绑定原图的草稿不变，编辑副本会自动选中，可用于创建新草稿。副本保存来源和编辑参数；来源仍在素材库时，再次编辑副本会还原参数。动图只处理第一帧，编辑解码限制为 6000 万像素。

草稿详情提供 Instagram、X、Pinterest、TikTok、Bluesky、Facebook 的模拟帖子卡片；切换预览平台只比较样式，不改变草稿发布目标或账号。正文和话题实时显示本次尚未保存的编辑内容，图片预览复用正式发布的 JPEG 导出函数。预览缩略图最高 1200px，展示的尺寸为实际导出尺寸；平台上传后的压缩、字体和折叠效果仍可能不同。视频仅展示已有封面。

支持轮播、拖动缩略图和前后移动调整图片顺序，需点击「保存修改」后写入草稿。正在发布、结果待确认、已发布或已排程的任务禁止改顺序；本地定时任务需先取消。预览不修改草稿状态、不打开平台、不提交发布。所有新增界面提供简体中文、英文、日文、韩文，用户输入的水印和文案不翻译。
