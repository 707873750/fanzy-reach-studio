import { contextBridge, ipcRenderer } from "electron";
import type { BrowserSettings, Draft, ImageAsset, ImportResult, Platform, SettingsView, RunLog, LogSnapshot } from "../shared/types";

const api = {
  reportRendererError: (message: string, detail?: string): Promise<void> => ipcRenderer.invoke("logs:renderer-error", message, detail),
  getLogs: (): Promise<LogSnapshot> => ipcRenderer.invoke("logs:list"),
  openLogFolder: (): Promise<void> => ipcRenderer.invoke("logs:folder"),
  onRunLog: (callback: (entry: RunLog) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: RunLog) => callback(entry);
    ipcRenderer.on("logs:entry", listener);
    return () => ipcRenderer.removeListener("logs:entry", listener);
  },
  getBrowserSettings: (): Promise<BrowserSettings> => ipcRenderer.invoke("browser:settings"),
  saveBrowserSettings: (settings: BrowserSettings): Promise<BrowserSettings> => ipcRenderer.invoke("browser:settings-save", settings),
  closePlatformBrowser: (platform: Platform): Promise<void> => ipcRenderer.invoke("browser:close", platform),
  openPlatformBrowser: (platform: Platform): Promise<void> => ipcRenderer.invoke("browser:open", platform),
  publishDrafts: (ids: string[]): Promise<Draft[]> => ipcRenderer.invoke("browser:publish", ids),
  resolvePublish: (id: string, published: boolean): Promise<void> => ipcRenderer.invoke("browser:resolve", id, published),
  onPublishProgress: (callback: (draft: Draft) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, draft: Draft) => callback(draft);
    ipcRenderer.on("publish:progress", listener);
    return () => ipcRenderer.removeListener("publish:progress", listener);
  },
  importImages: (): Promise<ImportResult> =>
    ipcRenderer.invoke("images:import-files"),
  importFolder: (): Promise<ImportResult> =>
    ipcRenderer.invoke("images:import-folder"),
  listImages: (): Promise<ImageAsset[]> =>
    ipcRenderer.invoke("images:list"),
  deleteImage: (id: string): Promise<void> =>
    ipcRenderer.invoke("images:delete", id),
  createDrafts: (ids: string[], platforms: Platform[]): Promise<Draft[]> =>
    ipcRenderer.invoke("drafts:create", ids, platforms),
  listDrafts: (): Promise<Draft[]> =>
    ipcRenderer.invoke("drafts:list"),
  deleteDraft: (id: string): Promise<void> =>
    ipcRenderer.invoke("drafts:delete", id),
  updateDraft: (id: string, patch: Partial<Pick<Draft, "title" | "caption" | "altText" | "hashtags" | "boardName" | "xScheduledAt">>): Promise<Draft> =>
    ipcRenderer.invoke("drafts:update", id, patch),
  generateCaption: (id: string): Promise<Draft> =>
    ipcRenderer.invoke("drafts:generate", id),
  getSettings: (): Promise<SettingsView> =>
    ipcRenderer.invoke("settings:get"),
  saveDeepSeekKey: (key: string): Promise<SettingsView> =>
    ipcRenderer.invoke("settings:save-key", key),
  clearDeepSeekKey: (): Promise<SettingsView> =>
    ipcRenderer.invoke("settings:clear-key"),
  prepareDraft: (id: string): Promise<{ draft: Draft; folder: string }> =>
    ipcRenderer.invoke("drafts:prepare", id),
  startFileDrag: (id: string): void => {
    ipcRenderer.send("files:start-drag", id);
  },
  markPublished: (id: string, url?: string): Promise<Draft> =>
    ipcRenderer.invoke("drafts:published", id, url),
  scheduleDraft: (id: string, date: string): Promise<Draft> =>
    ipcRenderer.invoke("drafts:schedule", id, date),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("external:open", url),
  copyText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke("clipboard:copy", text),
  onScheduleReminder: (callback: (draft: Draft) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, draft: Draft) => callback(draft);
    ipcRenderer.on("schedule:reminder", listener);
    return () => ipcRenderer.removeListener("schedule:reminder", listener);
  }
};

contextBridge.exposeInMainWorld("reach", api);
