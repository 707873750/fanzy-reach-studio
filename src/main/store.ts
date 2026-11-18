import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { Draft, ImageAsset, Platform } from "../shared/types";

export interface StoredImage extends ImageAsset {
  originalPath: string;
  thumbnailPath: string;
}

export interface StoredDraft extends Draft {}

export interface StoreData {
  images: StoredImage[];
  drafts: StoredDraft[];
  settings: {
    deepSeekKeyEncrypted?: string;
    model?: string;
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
    data = { images: [], drafts: [], settings: { model: "deepseek-flash" } };
    await persistStore();
  }
  data.images ??= [];
  data.drafts ??= [];
  data.settings ??= { model: "deepseek-flash" };
  data.settings.model ??= "deepseek-flash";
}

export function getStore(): StoreData {
  if (!data) throw new Error("Local store has not been initialized");
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
  if (!draft) throw new Error("Draft not found");
  Object.assign(draft, patch, { updatedAt: new Date().toISOString() });
  return draft;
}

export function platformBatchSize(platform: Platform) {
  if (platform === "instagram") return 10;
  if (platform === "x") return 4;
  return 1;
}
