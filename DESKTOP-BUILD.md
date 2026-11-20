# Windows / macOS 安装包

安装版包含 Electron、Python、Playwright 驱动和页面适配脚本。用户无需 Node、Python 或 pip，但需要安装 Google Chrome，并在应用中登录各个平台。不会打包开发机的账号、浏览器配置、API 密钥或本地素材。

## 本地构建

使用 Node 22、Python 3.12 和 Google Chrome。每个平台、架构单独构建，Node 和 Python 必须与目标架构一致。不能把 Windows `.venv` 或 `node_modules` 复制到 Mac。

Windows PowerShell：

```powershell
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r python/requirements-build.txt
npm ci
npm run typecheck
npm run dist:win
node scripts/smoke-publisher.mjs release/win-unpacked/resources/publisher/fanzy-publisher.exe
```

已有 uv 管理的环境若没有 pip，可以改用：

```powershell
uv --cache-dir .uv-cache pip install --python .venv/Scripts/python.exe -r python/requirements-build.txt
```

macOS Terminal（Apple Silicon 和 Intel 分别在本机执行）：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r python/requirements-build.txt
npm ci
npm run typecheck
npm run dist:mac
```

开发模式支持 `FANZY_PYTHON`；安装版始终启动内置组件。构建脚本也支持 `FANZY_PYTHON`，未指定时优先使用 `.venv`。

产物位于 `release/`：

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | `Fanzy-Reach-Studio-0.2.0-win-x64.exe` |
| Apple Silicon Mac | `Fanzy-Reach-Studio-0.2.0-mac-arm64.dmg`，以及 ZIP |
| Intel Mac | `Fanzy-Reach-Studio-0.2.0-mac-x64.dmg`，以及 ZIP |

文件名版本号随 `package.json` 变化。`pack:win` / `pack:mac` 只生成应用目录。`build:publisher` 生成 `build/publisher/<platform>-<arch>/fanzy-publisher`；打包前检查该组件，缺少时直接失败。

## GitHub Actions

已提供 `.github/workflows/desktop-build.yml`，手动运行 **Desktop installers**。三个独立任务构建 Windows x64、Mac arm64、Mac x64。流程执行单元测试、内置组件测试和本地 Chrome 登录配置交接测试，再上传安装包到当前运行的 Artifacts；不会创建 Release 或自动发布。

默认 `signed=false`：Windows 不配置证书时输出未签名包；Mac 使用 ad-hoc 签名且不公证，仅用于内部验证，不能当作面向普通用户的正式发行版。上传工作流到 GitHub 后才能运行；本地修改本身不会触发远端构建。

## 正式签名与公证

在仓库 Settings → Secrets and variables → Actions 配置密钥，不要提交到仓库，也不要把密码写进命令行记录。

| Secret | 用途 |
| --- | --- |
| `WIN_CSC_LINK` | Windows 签名证书（支持的 PFX 的 Base64 或安全下载地址） |
| `WIN_CSC_KEY_PASSWORD` | Windows 证书密码 |
| `MAC_CSC_LINK` | Apple Developer ID Application `.p12` 证书的 Base64 |
| `MAC_CSC_KEY_PASSWORD` | Apple 证书密码 |
| `APPLE_ID` | 用于公证的 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 应用专用密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

然后以 `signed=true` 运行工作流。签名为强制要求，缺证书时构建失败；Mac 同时强制公证。采用硬件或云端 Windows 签名服务的证书，需要按证书供应商接入签名工具，不能直接导出为 PFX。

本地 Mac 签名使用环境变量 `CSC_LINK` / `CSC_KEY_PASSWORD` 和上述 `APPLE_*` 变量。正式构建命令：

```sh
npm run build:publisher
npm run build
npx electron-builder --mac --publish never -c.forceCodeSigning=true -c.mac.notarize=true
```

Mac 的 Python 可执行文件、动态库、Playwright Node 驱动在应用资源内，随应用签名。发布前仍需在 Mac 上验证签名完整性和实际运行。稳定的 Developer ID 签名也有助于升级时保持钥匙串访问一致。

Windows 本地正式构建同样设置 `WIN_CSC_*` 后运行 `npx electron-builder --win --x64 --publish never -c.forceCodeSigning=true`，前提是已构建 publisher 和 UI。

## 验证与验收

```text
npm run typecheck
node tests/publisher-runtime.test.mjs
node tests/parallel-publisher.test.mjs
python -m unittest discover -s python -p test_desktop_platform.py -v
python -m unittest discover -s python -p test_native_login.py -v
node scripts/smoke-publisher.mjs
```

Python 测试命令请使用安装过依赖的解释器。内置组件冒烟测试在临时目录运行，并移除 PATH 中的 Python；检查加密、Playwright 驱动、系统 Chrome 和页面脚本，不访问账号或发布真实内容。Windows DPAPI 需要正常用户环境，受限沙箱可能无法访问用户密钥。Mac 冒烟测试使用临时内存密钥；真正的钥匙串交接仍需通过已签名的桌面应用验证。

打包后再次传入应用资源中的可执行文件路径运行冒烟测试。Mac 路径为 `release/mac[-arm64]/Fanzy Reach Studio.app/Contents/Resources/publisher/fanzy-publisher`。

正式交付前在无 Node / Python 的干净系统验证安装、启动、导入图片与缩略图、Chrome 登录及重启后的会话恢复、退出清理、升级后的素材与草稿保留。Mac 需验证允许钥匙串访问和拒绝访问时的提示。只有经过授权才用真实账号验证发布。

当前开发环境只能执行 Windows 验证；Mac 安装包、签名、公证和真实设备验收不能由 Windows 本地测试替代。默认仍使用 Electron 图标，可在准备品牌图标后配置 Windows `.ico` 和 Mac `.icns`。

2026-11-20 本地已生成未签名 Windows x64 安装包，验证了最终包内发布组件（无系统 Python PATH）、桌面程序启动/预加载 IPC/隔离存储、Windows DPAPI、模拟 Mac 加密与关闭逻辑，以及本地 Chrome 配置交接。尚未在干净虚拟机执行安装/卸载，也未执行远端 Mac CI 或配置签名证书。

参考：[PyInstaller 运行时资源路径](https://pyinstaller.org/en/stable/runtime-information.html)、[Playwright 打包支持](https://playwright.dev/python/docs/library)、[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)、[electron-builder v26 公证](https://www.electron.build/v26/docs/notarization/)。
