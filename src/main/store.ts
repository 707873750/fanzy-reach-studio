import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { Draft, ImageAsset, Platform, PlatformDefaultsMap } from "../shared/types";

export interface StoredImage extends ImageAsset {
  originalPath: string;
  thumbnailPath: string;
}

export interface StoredDraft extends Draft {}

export interface StoreData {
  images: StoredImage[];
  drafts: StoredDraft[];
  settings: {
    backendUrl?: string;
    backendTokenEncrypted?: string;
    backendUserId?: string;
    backendPendingTask?: { id: string };
    platformDefaults?: Partial<PlatformDefaultsMap>;
    // Legacy fields are retained in existing stores, but never read or sent.
    deepSeekKeyEncrypted?: string;
    model?: string;
    volcKeysEncrypted?: string;
    volcPendingTask?: { id: string; reqKey: string };
    showBrowser?: boolean;
    browserChannel?: "msedge" | "chrome" | "chromium";
  };
}

let data: StoreData;
let storeFile = "";
let writeChain: Promise<void> = Promise.resolve();

export function getAppPaths() {
  const base = app.getPath("userData");
  return {
    base,
    assets: path.join(base, "assets"),
    thumbnails: path.join(base, "thumbnails"),
    exports: path.join(base, "exports"),
    database: path.join(base, "reach-data.json")
  };
}

export async function initStore() {
  const paths = getAppPaths();
  await Promise.all([
    fs.mkdir(paths.assets, { recursive: true }),
    fs.mkdir(paths.thumbnails, { recursive: true }),
    fs.mkdir(paths.exports, { recursive: true })
  ]);
  storeFile = paths.database;
  try {
    const raw = await fs.readFile(storeFile, "utf8");
    data = JSON.parse(raw) as StoreData;
  } catch {
    data = { images: [], drafts: [], settings: {} };
    await persistStore();
  }
  data.images ??= [];
  data.drafts ??= [];
  data.settings ??= {};
  if ("zhipuKeyEncrypted" in data.settings) {
    delete data.settings.zhipuKeyEncrypted;
    await persistStore();
  }
}

export function getStore(): StoreData {
  if (!data) throw new Error("本地存储尚未初始化");
  return data;
}

export async function persistStore() {
  if (!storeFile || !data) return;
  const snapshot = JSON.stringify(data, null, 2);
  writeChain = writeChain.catch(() => {}).then(async () => {
    const temp = `${storeFile}.tmp`;
    await fs.writeFile(temp, snapshot, "utf8");
    await fs.rename(temp, storeFile);
  });
  await writeChain;
}

export function findImage(id: string) {
  return getStore().images.find((item) => item.id === id);
}

export function findDraft(id: string) {
  return getStore().drafts.find((item) => item.id === id);
}

export function updateDraftRecord(id: string, patch: Partial<StoredDraft>) {
  const draft = findDraft(id);
  if (!draft) throw new Error("未找到草稿");
  Object.assign(draft, patch, { updatedAt: new Date().toISOString() });
  return draft;
}

export function platformBatchSize(platform: Platform) {
  if (platform === "tiktok") return 35;
  if (platform === "instagram" || platform === "facebook") return 10;
  if (platform === "x" || platform === "bluesky") return 4;
  return 1;
}
