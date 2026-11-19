export type Platform = "instagram" | "x" | "pinterest";
export interface BrowserSettings { showBrowser: boolean; channel: "msedge" | "chrome" | "chromium"; }
export interface RunLog {
  id: string;
  time: string;
  sessionId: string;
  level: "info" | "warn" | "error";
  source: "app" | "python" | "extension" | "page";
  step: string;
  message: string;
  draftId?: string;
  jobId?: string;
  platform?: Platform;
  detail?: string;
}
export interface LogSnapshot { entries: RunLog[]; directory: string; storageError: string | null; }
export type DraftStatus = "draft" | "ready" | "scheduled" | "prepared" | "published" | "reminder_due" | "platform_scheduled";

export interface ImageAsset {
  id: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  createdAt: string;
  thumbnailDataUrl?: string;
}

export interface Draft {
  id: string;
  platform: Platform;
  imageIds: string[];
  title: string;
  caption: string;
  hashtags: string[];
  altText: string;
  status: DraftStatus;
  scheduledAt: string | null;
  preparedFolder: string | null;
  publishedUrl: string | null;
  createdAt: string;
  updatedAt: string;
  boardName?: string;
  xScheduledAt?: string | null;
  browserPublish?: { state: "running" | "needs_attention" | "uncertain" | "succeeded" | "scheduled"; message: string; submittedAt?: string };
}

export interface SettingsView {
  hasDeepSeekKey: boolean;
  model: string;
}

export interface ImportResult {
  imported: ImageAsset[];
  duplicates: string[];
  errors: string[];
}

export interface CreateDraftResult {
  drafts: Draft[];
}

export interface ReachApi {
  reportRendererError: (message: string, detail?: string) => Promise<void>;
  getLogs: () => Promise<LogSnapshot>;
  openLogFolder: () => Promise<void>;
  onRunLog: (callback: (entry: RunLog) => void) => () => void;
  copyText: (text: string) => Promise<boolean>;
  getBrowserSettings: () => Promise<BrowserSettings>;
  saveBrowserSettings: (settings: BrowserSettings) => Promise<BrowserSettings>;
  closePlatformBrowser: (platform: Platform) => Promise<void>;
  openPlatformBrowser: (platform: Platform) => Promise<void>;
  publishDrafts: (ids: string[]) => Promise<Draft[]>;
  resolvePublish: (id: string, published: boolean) => Promise<void>;
  onPublishProgress: (callback: (draft: Draft) => void) => () => void;
  importImages: () => Promise<ImportResult>;
  importFolder: () => Promise<ImportResult>;
  listImages: () => Promise<ImageAsset[]>;
  deleteImage: (imageId: string) => Promise<void>;
  createDrafts: (imageIds: string[], platforms: Platform[]) => Promise<Draft[]>;
  listDrafts: () => Promise<Draft[]>;
  deleteDraft: (draftId: string) => Promise<void>;
  updateDraft: (draftId: string, patch: Partial<Pick<Draft, "title" | "caption" | "altText" | "hashtags" | "boardName" | "xScheduledAt">>) => Promise<Draft>;
  generateCaption: (draftId: string) => Promise<Draft>;
  getSettings: () => Promise<SettingsView>;
  saveDeepSeekKey: (apiKey: string) => Promise<SettingsView>;
  clearDeepSeekKey: () => Promise<SettingsView>;
  prepareDraft: (draftId: string) => Promise<{ draft: Draft; folder: string }>;
  startFileDrag: (draftId: string) => void;
  markPublished: (draftId: string, publishedUrl?: string) => Promise<Draft>;
  scheduleDraft: (draftId: string, scheduledAt: string) => Promise<Draft>;
  openExternal: (url: string) => Promise<void>;
  onScheduleReminder: (callback: (draft: Draft) => void) => () => void;
}
