export type Platform = "instagram" | "x" | "pinterest" | "tiktok" | "bluesky" | "facebook";
export interface PlatformDefaults {
  imagesPerDraft: number;
  tiktokPrivacy?: "public" | "self_only";
  hashtags: string[];
  boardName: string;
  title: string;
  scheduleDelayMinutes: number;
}
export type PlatformDefaultsMap = Record<Platform, PlatformDefaults>;
export interface CopyOptions {
  sharedCaption: string;
  sharedCaptionHtml?: string;
  platforms: Partial<Record<Platform, { mode: "shared" | "independent"; caption: string; captionHtml?: string }>>;
}
export type DraftPatch = Partial<Pick<Draft, "title" | "caption" | "captionHtml" | "altText" | "hashtags" | "boardName" | "xScheduledAt" | "publishAt" | "captionMode" | "tiktokPrivacy">>;
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
export type DraftStatus = "draft" | "ready" | "scheduled" | "local_scheduled" | "prepared" | "published" | "reminder_due" | "platform_scheduled";

export interface ImageAsset {
  id: string;
  fileName: string;
  sourceFolders?: string[];
  video?: { duration: number; fps: number; codec: string; audioCodec?: string; pixelFormat: string };
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
  mediaType?: "image" | "video";
  title: string;
  caption: string;
  captionHtml?: string;
  sharedCaptionHtml?: string;
  independentCaptionHtml?: string;
  copyGroupId?: string;
  captionMode?: "shared" | "independent";
  sharedCaption?: string;
  independentCaption?: string;
  hashtags: string[];
  altText: string;
  status: DraftStatus;
  scheduledAt: string | null;
  preparedFolder: string | null;
  publishedUrl: string | null;
  createdAt: string;
  updatedAt: string;
  boardName?: string;
  tiktokPrivacy?: "public" | "self_only";
  xScheduledAt?: string | null;
  publishAt?: string | null;
  scheduleMode?: "native" | "local" | null;
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
  reportUiPerformance: (sample: Record<string, number | boolean>) => Promise<void>;
  getPlatformDefaults: () => Promise<PlatformDefaultsMap>;
  savePlatformDefaults: (platform: Platform, value: PlatformDefaults) => Promise<PlatformDefaults>;
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
  previewMedia: (id: string) => Promise<void>;
  createDrafts: (imageIds: string[], platforms: Platform[], copy?: CopyOptions) => Promise<Draft[]>;
  listDrafts: () => Promise<Draft[]>;
  deleteDraft: (draftId: string) => Promise<void>;
  deleteDrafts: (draftIds: string[]) => Promise<number>;
  deletePublishRecords: (recordIds: string[]) => Promise<number>;
  updateDraft: (draftId: string, patch: DraftPatch) => Promise<Draft>;
  generateCaption: (draftId: string) => Promise<Draft>;
  generateSharedCaption: (draftIds: string[]) => Promise<Draft[]>;
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
