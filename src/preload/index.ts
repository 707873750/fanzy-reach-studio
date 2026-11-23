import type { GenerateImageRequest, GeneratedImagePreview, EditImageUpload } from "../shared/image-generation";
import { contextBridge, ipcRenderer } from "electron";
import type { PlatformDefaults, PlatformDefaultsMap } from "../shared/types";
import type { BrowserSettings, CopyOptions, DraftPatch, Draft, ImageAsset, ImportResult, Platform, SettingsView, RunLog, LogSnapshot } from "../shared/types";

const api = {
  previewImageEdit: (id: string, options: import("../shared/image-edit").ImageEditOptions) => ipcRenderer.invoke("images:edit-preview",id,options),
  saveImageEdit: (id: string, options: import("../shared/image-edit").ImageEditOptions) => ipcRenderer.invoke("images:edit-save",id,options),
  previewPublishImage: (id: string, platform: Platform) => ipcRenderer.invoke("images:publish-preview",id,platform),
  listAccounts: () => ipcRenderer.invoke("accounts:list"),
  addAccount: (platform: Platform, name: string) => ipcRenderer.invoke("accounts:add", platform, name),
  deleteAccount: (id: string) => ipcRenderer.invoke("accounts:delete", id),
  renameAccount: (id: string, name: string) => ipcRenderer.invoke("accounts:rename", id, name),
  previewCaption: (id: string, input: import("../shared/backend").CaptionPreviewInput): Promise<string[]> => ipcRenderer.invoke("drafts:preview-caption", id, input),
 getContentStyles: () => ipcRenderer.invoke("content:styles"),
 saveContentStyles: (s: import("../shared/types").ContentStyle[]) => ipcRenderer.invoke("content:save-styles", s),
 updateAssetMeta: (ids: string[], tags: string[], favorite: boolean) => ipcRenderer.invoke("content:assets", ids, tags, favorite),
 planDrafts: (ids: string[], start: string, minutes: number) => ipcRenderer.invoke("content:plan", ids, start, minutes),
  backendLogin: (username: string, password: string): Promise<SettingsView> => ipcRenderer.invoke('backend:login', username, password),
  backendRegister: (username: string, password: string): Promise<SettingsView> => ipcRenderer.invoke('backend:register', username, password),
  backendLogout: (): Promise<SettingsView> => ipcRenderer.invoke('backend:logout'),
  backendAccount: (): Promise<import('../shared/backend').BackendAccount> => ipcRenderer.invoke('backend:account'),
  backendCheckin: (): Promise<import('../shared/backend').BackendAccount> => ipcRenderer.invoke('backend:checkin'),
  saveVolcKeys: (ak: string, sk: string): Promise<SettingsView> => ipcRenderer.invoke("settings:volc-save", ak, sk),
  clearVolcKeys: (): Promise<SettingsView> => ipcRenderer.invoke("settings:volc-clear"),
  pickEditImage: (): Promise<EditImageUpload | null> => ipcRenderer.invoke("images:pick-edit"),
  getGeneratedImage: (): Promise<GeneratedImagePreview | null> => ipcRenderer.invoke("images:generated"),
  saveGeneratedImage: (taskId: string): Promise<ImportResult> => ipcRenderer.invoke("images:save-generated", taskId),
  resumeImageTask: (): Promise<GeneratedImagePreview> => ipcRenderer.invoke("images:resume"),
  discardImageTask: (): Promise<SettingsView> => ipcRenderer.invoke("images:discard"),
  generateImage: (input: GenerateImageRequest): Promise<GeneratedImagePreview> => ipcRenderer.invoke("images:generate", input),
  reportUiPerformance: (sample: Record<string, number | boolean>): Promise<void> => ipcRenderer.invoke("performance:ui", sample),
  getPlatformDefaults: (): Promise<PlatformDefaultsMap> => ipcRenderer.invoke("settings:platforms"),
  savePlatformDefaults: (platform: Platform, value: PlatformDefaults): Promise<PlatformDefaults> => ipcRenderer.invoke("settings:platform-save", platform, value),
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
  closePlatformBrowser: (platform: Platform, accountId?: string): Promise<void> => ipcRenderer.invoke("browser:close", platform, accountId),
  openPlatformBrowser: (platform: Platform, viewOnly = false, accountId?: string): Promise<void> => ipcRenderer.invoke("browser:open", platform, viewOnly, accountId),
  publishDrafts: (ids: string[]): Promise<Draft[]> => ipcRenderer.invoke("browser:publish", ids),
  cancelPublishBatch: (): Promise<void> => ipcRenderer.invoke("browser:cancel-publish"),
  getPublishBatch: (): Promise<string[]> => ipcRenderer.invoke("browser:publish-batch"),
  onPublishBatch: (callback: (ids: string[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ids: string[]) => callback(ids);
    ipcRenderer.on("publish:batch", listener);
    return () => ipcRenderer.removeListener("publish:batch", listener);
  },
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
  previewMedia: (id: string): Promise<void> => ipcRenderer.invoke("images:preview", id),
  createDrafts: (ids: string[], platforms: Platform[], copy?: CopyOptions, accountIds?: string[]): Promise<Draft[]> =>
    ipcRenderer.invoke("drafts:create", ids, platforms, copy, accountIds),
  listDrafts: (): Promise<Draft[]> =>
    ipcRenderer.invoke("drafts:list"),
  deleteDraft: (id: string): Promise<void> =>
    ipcRenderer.invoke("drafts:delete", id),
  deleteDrafts: (ids: string[]): Promise<number> =>
    ipcRenderer.invoke("drafts:delete-many", ids),
  deleteLocalScheduledDrafts: (ids: string[]): Promise<number> =>
    ipcRenderer.invoke("drafts:delete-local-scheduled", ids),
  deletePublishRecords: (ids: string[]): Promise<number> =>
    ipcRenderer.invoke("history:delete", ids),
  updateDraft: (id: string, patch: DraftPatch): Promise<Draft> =>
    ipcRenderer.invoke("drafts:update", id, patch),
  generateCaption: (id: string): Promise<Draft> =>
    ipcRenderer.invoke("drafts:generate", id),
  generateSharedCaption: (ids: string[]): Promise<Draft[]> =>
    ipcRenderer.invoke("drafts:generate-shared", ids),
  getSettings: (): Promise<SettingsView> =>
    ipcRenderer.invoke("settings:get"),
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
