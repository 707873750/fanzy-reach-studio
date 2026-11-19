# Fanzy Reach Studio

Local-first Windows desktop assistant for preparing image posts for Instagram, X and Pinterest.

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
- Store images, drafts and settings locally. The DeepSeek API key is encrypted with Electron `safeStorage`.

## Python + Playwright 无头发布

生产发布由 Python Playwright 执行，无需浏览器扩展或配对。首次使用专用窗口登录，后续复用独立配置；不会读取当前日常 Chrome/Edge 的登录资料。

### 首次使用

1. 安装 Python 3.10+，运行 `python -m pip install -r python/requirements.txt`。开发模式自动使用项目 `.venv/Scripts/python.exe`，也可用 `FANZY_PYTHON` 指定解释器。
2. 安装 Google Chrome，启动程序。三个平台的登录和发布统一使用 Chrome。
3. 点击 **登录 X / Instagram / Pinterest**，程序直接启动普通 Chrome（无自动化及远程调试参数），使用各平台专用目录。完成登录与验证后点击 **完成登录 / 关闭窗口**，程序正常关闭 Chrome，再用无头 Playwright 读取同一目录并保存加密快照；此时不会恢复旧快照覆盖新会话。登录期间不定时读取快照；手动关闭窗口后仍需点击完成登录。退出程序也会尝试完成保存，失败记录在运行日志。保存成功不代表平台账号必然可发布。
4. 默认关闭 **显示浏览器**，发布在无头模式执行。开启后发布过程可见；登录窗口始终可见。发布期间请勿手动编辑自动化窗口。
5. 创建并保存草稿；Pinterest 填写准确的画板名。勾选草稿并点击 **Submit selected**。程序自动上传、填写并提交。X 定时草稿则提交到平台排程。

登录配置按平台隔离，保存在 `browser-profiles/chrome/<平台>/`。除了浏览器原生配置，还保存 Windows DPAPI 加密的 Cookie、LocalStorage 和 IndexedDB 快照，避免浏览器关闭后丢失会话。快照只能由同一 Windows 用户解密；不要分享整个配置目录。已有 Chrome 配置继续复用，旧 Edge / Chromium 配置保留但不再用于发布，需在普通 Chrome 中重新登录。旧扩展可停用，生产发布不再使用它。

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

## Requirements

- Windows 10/11 x64
- Node.js 22 LTS or a compatible newer LTS release
- npm
- Python 3.10+, Playwright and Google Chrome
- Internet connection for DeepSeek AI requests and platform publishing

## Install and run

```powershell
npm install
npm run typecheck
npm run dev
```

## Build Windows installer

```powershell
npm run dist:win
```

Output:

```text
release/Fanzy-Reach-Studio-0.1.0-x64.exe
```

For an unpacked build:

```powershell
npm run pack:win
```

Build on Windows for the most predictable Windows installer. Sharp is a native Node addon; electron-builder rebuilds production dependencies for Electron during packaging.

## DeepSeek setup

1. Open Settings in the app.
2. Paste your DeepSeek API key.
3. Click Save API key.
4. Return to Publishing Queue and choose a draft.
5. Click Generate with AI.

The app sends selected, resized images to DeepSeek. The originals remain in the local app data directory. AI requests are external network requests and may incur provider charges.

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
- The installer has not been tested on a clean Windows machine; Python and the selected browser must be provisioned separately.

## Security notes

- Renderer has no direct Node integration.
- Context isolation and sandboxing are enabled.
- The preload exposes a narrow, typed API.
- Only HTTPS external links are opened.
- DeepSeek API keys are encrypted with Electron `safeStorage` on Windows.
- Login snapshots are encrypted with Windows DPAPI; browser profiles and diagnostic screenshots stay local.
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

配置仅在创建新草稿时复制进去，不覆盖已有草稿；在单条草稿中修改不会反向改变默认配置。X 保存的是相对创建时间的延后分钟数（10 至 10080 分钟），0 表示提交时立即发布，同批次 X 草稿使用同一个定时时间。创建后仍需手动提交，提交时须距排程至少 5 分钟。AI 生成会重新生成该草稿的标题和标签。

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
