import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, shell } from "electron";
import path from "node:path";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { initStore, getStore, persistStore, getAppPaths, findDraft } from "./store";
import { importFiles, listImages, deleteImage } from "./image-service";
import { createDrafts, listDrafts, deleteDraft, updateDraft, prepareDraft, markPublished, scheduleDraft } from "./draft-service";
import { generateCaption, saveDeepSeekKey, clearDeepSeekKey, getSettings } from "./ai-service";
import type { Platform } from "../shared/types";
import { assertNotPublishing, openPlatformBrowser, publishDrafts, resolvePublish, recoverPublishing, stopPublisher } from "./browser-publisher";

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
  ipcMain.handle("browser:open", (_event, platform: Platform) => openPlatformBrowser(platform));
  ipcMain.handle("browser:publish", (_event, ids: string[]) => publishDrafts(ids));
  ipcMain.handle("browser:resolve", (_event, id: string, published: boolean) => resolvePublish(id, published));
  ipcMain.handle("images:import-files", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select images",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }]
    });
    if (result.canceled) return { imported: [], duplicates: [], errors: [] };
    return importFiles(result.filePaths);
  });

  ipcMain.handle("images:import-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select image folder",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) {
      return { imported: [], duplicates: [], errors: [] };
    }
    const files = await walkImages(result.filePaths[0]);
    return importFiles(files);
  });

  ipcMain.handle("images:list", () => listImages());
  ipcMain.handle("images:delete", (_event, imageId: string) => deleteImage(imageId));

  ipcMain.handle("drafts:create", (_event, imageIds: string[], platforms: Platform[]) => {
    const allowed = ["instagram", "x", "pinterest"];
    if (!Array.isArray(imageIds) || !Array.isArray(platforms) || platforms.some((p) => !allowed.includes(p))) {
      throw new Error("Invalid draft request");
    }
    return createDrafts(imageIds, platforms);
  });
  ipcMain.handle("drafts:list", () => listDrafts());
  ipcMain.handle("drafts:delete", (_event, id: string) => { assertNotPublishing(id); return deleteDraft(id); });
  ipcMain.handle("drafts:update", (_event, id: string, patch) => { assertNotPublishing(id); return updateDraft(id, patch); });
  ipcMain.handle("drafts:generate", (_event, id: string) => { assertNotPublishing(id); return generateCaption(id); });
  ipcMain.handle("drafts:prepare", (_event, id: string) => { assertNotPublishing(id); return prepareDraft(id); });

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

    const maxFiles = draft.platform === "instagram" ? 10 : draft.platform === "x" ? 4 : 1;
    const files = fsSync.readdirSync(preparedFolder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
      .slice(0, maxFiles)
      .map((entry) => path.join(preparedFolder, entry.name));
    if (!files.length || files.some((file) => !fsSync.existsSync(file))) return;

    const icon = nativeImage.createFromPath(files[0]);
    if (icon.isEmpty()) return;
    event.sender.startDrag({ file: files[0], files, icon });
  });
  ipcMain.handle("drafts:published", (_event, id: string, url?: string) => { assertNotPublishing(id); return markPublished(id, url); });
  ipcMain.handle("drafts:schedule", (_event, id: string, date: string) => { assertNotPublishing(id); return scheduleDraft(id, date); });

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:save-key", (_event, key: string) => saveDeepSeekKey(key));
  ipcMain.handle("settings:clear-key", () => clearDeepSeekKey());

  ipcMain.handle("external:open", async (_event, url: string) => {
    const parsed = new URL(url);
    const allowedHosts = new Set([
      "www.instagram.com",
      "instagram.com",
      "x.com",
      "www.pinterest.com",
      "pinterest.com",
      "platform.deepseek.com"
    ]);
    if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
      throw new Error("This external destination is not allowed.");
    }
    await shell.openExternal(url);
  });
  ipcMain.handle("clipboard:copy", (_event, text: string) => {
    clipboard.writeText(String(text || "").slice(0, 10000));
    return true;
  });
}

function checkScheduledDrafts() {
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
        body: `Your ${draft.platform} draft is ready for manual publishing.`
      });
      notification.on("click", () => mainWindow?.show());
      notification.show();
    }
    mainWindow?.webContents.send("schedule:reminder", draft);
  }
  void persistStore();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#101116",
    title: "Fanzy Reach Studio",
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
  await initStore();
  await recoverPublishing();
  registerIpc();
  createWindow();
  checkScheduledDrafts();
  reminderTimer = setInterval(checkScheduledDrafts, 30_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopPublisher();
  if (reminderTimer) clearInterval(reminderTimer);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

