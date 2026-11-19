# Changelog

## Pinterest 发布结果确认
- 扩充简繁中文 Pin 成功提示，并在点击前注册变更监听，保留短暂提示证据，避免推广弹窗遮挡后漏识别。
- 被动监听本次点击后浏览器发起的 Pin 创建请求；仅在成功响应包含有效 Pin ID 且非草稿时确认成功并保存链接。不发送或重放接口请求。
- 成功确认超时返回“已提交，结果待确认”，以警告记录并保留待确认截图，停止使用失败事件和超时异常误报。
- 提交后的页面丢失或通信异常保留待确认状态；推广弹窗、编辑器清空、旧响应和保存草稿都不能单独证明发布成功。

## 界面卡顿与 GPU 性能采样
- 每 5 秒汇总界面帧间隔、100ms 心跳延迟、长任务及输入等待峰值，记录可见性变化，避免把后台节流误判为卡顿。
- 增加 Electron 主进程事件循环延迟、各子进程 CPU/内存、GPU 驱动和加速状态、GPU 退出及窗口无响应事件。
- 发布期间异步读取 Windows PDH GPU 最忙引擎利用率，标注采样不可用、预热和采样耗时；采样失败不影响发布，取消时安全释放计数器。
- 日志列表改为每页 100 条，250ms 合并更新；搜索与复制仍覆盖最近 1000 条，文件保留完整日志。
- 同机离线日志压力测试：优化前渲染 1000 条时出现 103ms 长任务；优化后渲染 100 条，同场景未观察到超过 50ms 长任务。这不代表已经验证真实平台发布的全部卡顿来源。

## 发布期间界面可操作
- 发布批次使用独立状态，不再在整个发布期间禁用素材导入、创建草稿、无关草稿编辑和普通设置。
- 当前批次及关联文案草稿保持锁定，但允许选择查看；浏览器登录、浏览器配置及再次提交批次仍互斥。
- 发布结束仅刷新草稿列表，不再重新读取整个图片库的缩略图。
- 使用悬挂的模拟发布请求验证发布期间导航、编辑、设置、日志筛选及失败后解锁，无实际平台发布。

## 各平台独立持久化配置
- 新增独立的平台默认配置面板及读写接口，分别保存到本机数据文件。
- 创建草稿时带入图片分组数量、标签、Pinterest 图板与标题、X 相对定时偏好。
- 保留旧版本默认行为，已存在的草稿不会随默认配置改变，各草稿仍可覆盖设置。
- 验证跨平台隔离、保存重载、创建时继承、逐条覆盖及设置页面操作。

## 中文界面与混合文案模式
- 素材选择后支持统一文案、平台独立文案及混合使用，创建时持久化批次关联与两个文案版本。
- 发布队列可切换模式，保存统一正文会同步同批次可编辑草稿，保留独立备份及历史发布记录。
- 主界面、系统菜单、文件选择窗口、任务状态及应用提示改为简体中文，保留诊断标识和原始错误。
- 回归验证文案切换、素材分组、持久化、中文界面、X 定时字段、登录设置及日志筛选。

## Pinterest board selection and log rendering
- Searches the requested board within the board picker and reports Pinterest's explicit no-results state before submission.
- Memoizes unchanged log rows and shares the date formatter to avoid repeatedly formatting/rendering the entire log history for each new event.
- Verified the requested public test board was created; no post was published during diagnosis.

## Pinterest field and publishing performance diagnostics
- Recognizes the observed alternative-text placeholder 描述你 Pin 图的视觉详细信息.
- Reduces control polling from 200 ms to 500 ms and requires a user gesture for browser media autoplay.
- Logs aggregate Windows CPU/available memory and page main-thread/JS heap counters every five seconds while publishing; cancels monitoring before browser cleanup.

## Pinterest alternative text
- Supports visible alternative-text fields, direct buttons, and fields/buttons under More options in English and Chinese.
- Checks filled alternative text before continuing; does not silently omit it or submit on failure.
- Local regressions cover delayed expansion, already-visible fields, nested buttons, and Chinese title/description/board labels.

## Native Chrome login handoff
- All platforms log in through ordinary Chrome with isolated profiles and no automation/debugging flags.
- Finish Login closes only that dedicated browser normally, then captures an encrypted snapshot through headless Playwright without restoring stale state first.
- Keeps profile locks until login is saved; failed closure or snapshot can be retried. Publishing visibility and X scheduling remain available.
- Added local native Chrome-to-headless transfer and stale-session/closure regression tests.

## Instagram accessibility controls
- Prioritizes visible control text over decorative SVG labels.
- Waits for asynchronously expanded alt-text inputs, supports summary accordions and already-expanded sections, and verifies one filled field per image.
- Added full caption + nonempty alt-text + submission-checkpoint regressions for one and multiple images.

## Instagram caption labels
- Recognizes 添加配文 and aria-placeholder/data-placeholder fields, including empty contenteditable attributes.
- Failed control waits include field-label diagnostics without input values.
- Loads the page adapter at the start of each new job so subsequent adapter fixes do not require restarting the worker.

## Instagram creation readiness
- Waits for a stable creation entry and uses a Playwright actionable click rather than a DOM click.
- Confirms the upload dialog before loading/uploading images. A no-op click can retry up to three times, with five-second observation windows; visible menus/dialogs suspend retries.
- Logs each click and confirmation; failures stop before upload and preserve a screenshot.

## Instagram continue-button fix
- Added Continue / 继续 / 繼續 for Instagram crop and edit steps, based on the captured failure screen.
- Added stage logs and isolated regressions for all three labels, including conflicting controls outside the composer.

## Python + Playwright publishing
- Replaced the extension/pairing production flow with persistent browser profiles and headless Playwright publishing.
- Added Edge/Chrome/Chromium selection, a saved visible-browser switch, and explicit login/open/save-close controls.
- Windows DPAPI login snapshots preserve cookies, LocalStorage and IndexedDB across browser restarts.
- Retained X native scheduling and the durable checkpoint before final submission; login and publishing cannot share an active profile.
- Preserved step/error logs and added failure screenshots (latest 50 retained).
- Added isolated real-browser regressions for profiles, login snapshot encryption, all platforms, scheduling, checkpoints and screenshots.

## Extension 0.3.2
- X drafts can specify a native scheduled publication time, separate from local reminders.
- The extension fills the schedule dialog and requires a Schedule button and scheduling confirmation; it never falls back to immediate posting.
- Accepted schedules have a distinct scheduled state and cannot be submitted twice. Manage cancellation or changes on X.
- Added a real-extension fixture regression for date/time conversion, persisted-checkpoint-before-scheduling, and scheduling confirmation.

## Extension 0.3.1
- Fixed upload validation when X clears its file input after consuming the files; image previews still must appear before submission.
- Added Instagram Traditional Chinese controls and icon labels; upload, caption, Next and Share are scoped to the creation dialog.
- Detects X account-suspension headings and stops before preparing/submitting a post with an actionable error.
- Page initialization logs include the loaded extension version. Reload the unpacked extension after updating.
- Added intercepted-browser regressions for cleared upload inputs, Traditional Chinese Instagram with conflicting background controls, and suspended X accounts. No real posts are sent by these tests.

## 0.2.0
- Added user-initiated native OS file drag from prepared draft cards.
- Supports dragging prepared image files to compatible platform composers (up to 10 Instagram images, 4 X images, 1 Pinterest image).
- X draft preparation opens a Share Intent URL with caption text prefilled. Local images must still be dragged by the user.
- Added explicit UI guidance that the user completes upload and final publication.
- No browser scripting, simulated mouse control, or automated clicking is included.
