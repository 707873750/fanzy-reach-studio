import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, shell } from "electron";
import path from "node:path";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { initStore, getStore, persistStore, getAppPaths, findDraft } from "./store";
import { importFiles, listImages, deleteImage } from "./image-service";
import { createDrafts, listDrafts, deleteDraft, deleteDrafts, deletePublishRecords, updateDraft, prepareDraft, markPublished, scheduleDraft } from "./draft-service";
import { generateCaption, generateSharedCaption, saveDeepSeekKey, clearDeepSeekKey, getSettings } from "./ai-service";
import type { CopyOptions, Platform } from "../shared/types";
import { runDueScheduledDrafts, assertNotPublishing, getBrowserSettings, saveBrowserSettings, closePlatformBrowser, openPlatformBrowser, publishDrafts, resolvePublish, recoverPublishing, stopPublisher } from "./browser-publisher";

import { initLogs, log, getLogs, flushLogs, errorDetail } from "./run-logger";
import { getPlatformDefaults, savePlatformDefaults } from "./platform-settings";
import { startPerformanceMonitor } from "./performance-monitor";
let stopPerformanceMonitor: (()=>void) | undefined;

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", () => mainWindow?.show());

let mainWindow: BrowserWindow | null = null;
let reminderTimer: NodeJS.Timeout | null = null;

async function walkImages(folder: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkImages(fullPath, depth + 1));
    } else if (entry.isFile() && /\.(jpe?g|png|webp|gif)$/i.test(entry.name)) {
      results.push(fullPath);
    }
    if (results.length >= 500) break;
  }
  return results.slice(0, 500);
}

function registerIpc() {
  const handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
    ipcMain.handle(channel, async (event, ...args) => {
      const quiet = ["logs:list", "logs:renderer-error", "browser:settings", "images:list", "drafts:list", "settings:get", "clipboard:copy"].includes(channel);
      if (!quiet) void log({ source: "app", level: "info", step: channel, message: "开始操作：" + channel });
      try {
        const result = await listener(event, ...args);
        if (!quiet) void log({ source: "app", level: "info", step: `${channel}.done`, message: "操作完成：" + channel });
        return result;
      }
      catch (error) {
        if (channel !== "logs:list") void log({ source: "app", level: "error", step: channel, message: "操作失败：" + channel, detail: errorDetail(error) });
        throw error;
      }
    });
  };
  handle("logs:list", () => getLogs());
  handle("logs:renderer-error", (_event, message, detail) => log({ source: "app", level: "error", step: "renderer.error", message: String(message).slice(0, 2000), detail: typeof detail === "string" ? detail.slice(0, 6000) : undefined }));
  handle("logs:folder", async () => {
    const snapshot = await getLogs();
    const error = await shell.openPath(snapshot.directory);
    if (error) throw new Error(error);
  });
  handle("browser:settings", () => getBrowserSettings());
  handle("browser:settings-save", (_event, settings) => saveBrowserSettings(settings));
  handle("browser:close", (_event, platform: Platform) => closePlatformBrowser(platform));
  handle("browser:open", (_event, platform: Platform) => openPlatformBrowser(platform));
  handle("browser:publish", (_event, ids: string[]) => publishDrafts(ids));
  handle("browser:resolve", (_event, id: string, published: boolean) => resolvePublish(id, published));
  handle("images:import-files", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择图片",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }]
    });
    if (result.canceled) return { imported: [], duplicates: [], errors: [] };
    return importFiles(result.filePaths);
  });

  handle("images:import-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择图片文件夹",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) {
      return { imported: [], duplicates: [], errors: [] };
    }
    const files = await walkImages(result.filePaths[0]);
    return importFiles(files);
  });

  handle("images:list", () => listImages());
  handle("images:delete", (_event, imageId: string) => deleteImage(imageId));

  handle("drafts:create", (_event, imageIds: string[], platforms: Platform[], copy?: CopyOptions) => {
    const allowed = ["instagram", "x", "pinterest", "tiktok", "bluesky", "facebook"];
    if (!Array.isArray(imageIds) || !Array.isArray(platforms) || platforms.some((p) => !allowed.includes(p))) {
      throw new Error("无效的草稿请求");
    }
    return createDrafts(imageIds, platforms, copy);
  });
  handle("drafts:list", () => listDrafts());
  handle("history:delete", (_event, ids: string[]) => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("无效的发布记录请求");
    ids.forEach(id => assertNotPublishing(id));
    return deletePublishRecords(ids);
  });
  handle("drafts:delete", (_event, id: string) => { assertNotPublishing(id); return deleteDraft(id); });
  handle("drafts:delete-many", (_event, ids: string[]) => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("无效的草稿请求");
    ids.forEach(id => assertNotPublishing(id));
    return deleteDrafts(ids);
  });
  handle("drafts:update", (_event, id: string, patch) => {
    assertNotPublishing(id);
    const group = findDraft(id)?.copyGroupId;
    if (group) getStore().drafts.filter(d => d.copyGroupId === group).forEach(d => assertNotPublishing(d.id));
    return updateDraft(id, patch);
  });
  handle("drafts:generate", (_event, id: string) => { assertNotPublishing(id); return generateCaption(id); });
  handle("drafts:generate-shared", (_event, ids: string[]) => generateSharedCaption(ids));
  handle("drafts:prepare", (_event, id: string) => { assertNotPublishing(id); return prepareDraft(id); });

  // Native file drag: the user initiates the drag from the app and drops files
  // into the platform composer. This does not automate the destination website.
  ipcMain.on("files:start-drag", (event, draftId: string) => {
    if (typeof draftId !== "string" || draftId.length > 80) return;
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    const draft = findDraft(draftId);
    if (!draft || !draft.preparedFolder) return;

    const exportRoot = path.resolve(getAppPaths().exports);
    const preparedFolder = path.resolve(draft.preparedFolder);
    const relative = path.relative(exportRoot, preparedFolder);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
    if (!fsSync.existsSync(preparedFolder)) return;

    const maxFiles = draft.platform === "tiktok" ? 35 : (draft.platform === "instagram" || draft.platform === "facebook") ? 10 : (draft.platform === "x" || draft.platform === "bluesky") ? 4 : 1;
    const files = fsSync.readdirSync(preparedFolder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
      .slice(0, maxFiles)
      .map((entry) => path.join(preparedFolder, entry.name));
    if (!files.length || files.some((file) => !fsSync.existsSync(file))) return;

    const icon = nativeImage.createFromPath(files[0]);
    if (icon.isEmpty()) return;
    event.sender.startDrag({ file: files[0], files, icon });
  });
  handle("drafts:published", (_event, id: string, url?: string) => { assertNotPublishing(id); return markPublished(id, url); });
  handle("drafts:schedule", (_event, id: string, date: string) => { assertNotPublishing(id); return scheduleDraft(id, date); });

  handle("settings:get", () => getSettings());
  handle("settings:platforms", () => getPlatformDefaults());
  handle("settings:platform-save", (_event, platform, value) => savePlatformDefaults(platform, value));
  handle("settings:save-key", (_event, key: string) => saveDeepSeekKey(key));
  handle("settings:clear-key", () => clearDeepSeekKey());

  handle("external:open", async (_event, url: string) => {
    const parsed = new URL(url);
    const allowedHosts = new Set([
      "bsky.app",
      "www.facebook.com",
      "facebook.com",
      "www.instagram.com",
      "instagram.com",
      "x.com",
      "www.pinterest.com",
      "pinterest.com",
      "www.tiktok.com",
      "tiktok.com",
      "platform.deepseek.com"
    ]);
    if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
      throw new Error("不支持打开此外部地址。");
    }
    await shell.openExternal(url);
  });
  handle("clipboard:copy", (_event, text: string) => {
    clipboard.writeText(String(text || "").slice(0, 10000));
    return true;
  });
}

function checkScheduledDrafts() {
  void runDueScheduledDrafts();
  const now = Date.now();
  const due = getStore().drafts.filter((draft) =>
    draft.status === "scheduled" &&
    draft.scheduledAt &&
    new Date(draft.scheduledAt).getTime() <= now
  );
  if (!due.length) return;
  for (const draft of due) {
    draft.status = "reminder_due";
    draft.updatedAt = new Date().toISOString();
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: "Fanzy Reach Studio",
        body: `${draft.platform} 草稿已到提醒时间，请手动提交。`
      });
      notification.on("click", () => mainWindow?.show());
      notification.show();
    }
    mainWindow?.webContents.send("schedule:reminder", draft);
  }
  void persistStore();
}

function createWindow() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:"文件", submenu:[{label:"退出", role:"quit"}]},
    {label:"编辑", submenu:[{label:"撤销",role:"undo"},{label:"重做",role:"redo"},{type:"separator"},{label:"剪切",role:"cut"},{label:"复制",role:"copy"},{label:"粘贴",role:"paste"},{label:"全选",role:"selectAll"}]},
    {label:"视图", submenu:[{label:"重新加载",role:"reload"},{label:"开发者工具",role:"toggleDevTools"},{type:"separator"},{label:"实际大小",role:"resetZoom"},{label:"放大",role:"zoomIn"},{label:"缩小",role:"zoomOut"},{label:"全屏",role:"togglefullscreen"}]},
    {label:"窗口", submenu:[{label:"最小化",role:"minimize"},{label:"关闭",role:"close"}]}
  ]));
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#101116",
    title: "Fanzy Reach 发布工作室",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    void log({ source: "app", level: "error", step: "renderer.exited", message: `界面进程退出：${details.reason}，退出码 ${details.exitCode}` });
  });
  mainWindow.on("unresponsive",()=>{void log({source:"app",level:"warn",step:"performance.unresponsive",message:"程序窗口无响应"});});
  mainWindow.on("responsive",()=>{void log({source:"app",level:"info",step:"performance.responsive",message:"程序窗口恢复响应"});});

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  await initLogs();
  await initStore();
  await recoverPublishing();
  registerIpc();
  stopPerformanceMonitor = startPerformanceMonitor();
  createWindow();
  checkScheduledDrafts();
  reminderTimer = setInterval(checkScheduledDrafts, 30_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let closing = false;
app.on("before-quit", event => {
  if (closing) return;
  event.preventDefault();
  closing = true;
  stopPerformanceMonitor?.();
  if (reminderTimer) clearInterval(reminderTimer);
  void stopPublisher().then(() => log({ source: "app", level: "info", step: "app.stop", message: "程序退出，正在保存日志" })).then(flushLogs).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

