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

## Important publishing boundary

This is an assisted-publishing application. It does not automate website interaction, read browser cookies, upload content through browser scripting, or click Publish. The user completes the final upload and publication on the official website.

The local reminder scheduler only runs while the application is open. It does not provide unattended publishing. Native drag-and-drop is user-initiated: the user drags the prepared draft card into the platform composer, then reviews and publishes manually. X text is prefilled with its Share Intent; local images still need to be dragged by the user.

## Electron compatibility

This starter pins Electron to `^41.0.0` because electron-vite 5.0.0 locates the Electron executable through `node_modules/electron/path.txt`. Electron 42+ changed its binary download behavior, so do not upgrade Electron to 42+ with this electron-vite setup unless you also upgrade to an electron-vite release that explicitly supports the new mechanism.

## Requirements

- Windows 10/11 x64
- Node.js 22 LTS or a compatible newer LTS release
- npm
- Internet connection only for DeepSeek AI requests and opening platform websites

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
- `reach-data.json` — local library, drafts and encrypted settings

Use the app's own UI to manage data. Do not manually edit `reach-data.json` while the app is running.

## Current limitations

- No official API publishing is implemented.
- No automatic browser publishing, simulated mouse control, or automated website interaction is implemented. Native OS file drag is initiated by the user from the desktop app.
- No unattended background scheduling after app exit.
- Instagram carousel grouping uses a conservative default of 10 images; check the current platform composer limits before publishing.
- X grouping uses a conservative default of 4 images.
- Pinterest creates one Pin draft per image.
- Published status is user-confirmed, not independently verified by the app.
- AI output must be reviewed before posting.
- The source package has not been compiled or tested on a clean Windows machine in this environment. Use the typecheck and packaging commands below on your Windows development machine before distributing it.

## Security notes

- Renderer has no direct Node integration.
- Context isolation and sandboxing are enabled.
- The preload exposes a narrow, typed API.
- Only HTTPS external links are opened.
- DeepSeek API keys are encrypted with Electron `safeStorage` on Windows.
- This local app does not provide a secure multi-user secret vault. Windows DPAPI protects the stored key for the current Windows user, but malware running as that user may still access application secrets.

## Suggested next steps

1. Add campaign names and reusable caption templates.
2. Add platform-specific image crop editor.
3. Add export-folder naming and per-draft ZIP export.
4. Add Windows toast notification and tray mode.
5. Add an optional official API integration only after reviewing each platform's current terms, access requirements and costs.

