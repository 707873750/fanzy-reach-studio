import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { getAppPaths, getStore, persistStore, type StoredImage } from "./store";
import { isPublishRecord } from "../shared/draft-lifecycle";

const ALLOWED = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

async function sha256(filePath: string) {
  const hash = crypto.createHash("sha256");
  const stream = await fs.readFile(filePath);
  hash.update(stream);
  return hash.digest("hex");
}

async function importOne(sourcePath: string) {
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error("所选路径不是文件");
  if (stat.size > MAX_FILE_BYTES) throw new Error("图片超过 50 MB 限制");

  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED.has(ext)) throw new Error("不支持此图片格式");

  const hash = await sha256(sourcePath);
  const existing = getStore().images.find((image) => image.sha256 === hash);
  if (existing) return { duplicate: existing.fileName };

  const metadata = await sharp(sourcePath, { animated: false }).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("无法读取图片信息");
  }

  const id = crypto.randomUUID();
  const safeExt = metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const destination = path.join(getAppPaths().assets, `${id}${safeExt}`);
  const thumbnailPath = path.join(getAppPaths().thumbnails, `${id}.webp`);

  await fs.copyFile(sourcePath, destination);
  await sharp(destination)
    .rotate()
    .resize(360, 360, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(thumbnailPath);

  const image: StoredImage = {
    id,
    fileName: path.basename(sourcePath),
    mimeType: `image/${metadata.format === "jpg" ? "jpeg" : metadata.format}`,
    width: metadata.width,
    height: metadata.height,
    size: stat.size,
    sha256: hash,
    originalPath: destination,
    thumbnailPath,
    createdAt: new Date().toISOString()
  };

  getStore().images.unshift(image);
  await persistStore();
  return { image };
}

export async function importFiles(filePaths: string[]) {
  const imported: StoredImage[] = [];
  const duplicates: string[] = [];
  const errors: string[] = [];

  for (const filePath of filePaths.slice(0, 500)) {
    try {
      const result = await importOne(filePath);
      if ("image" in result && result.image) imported.push(result.image);
      if ("duplicate" in result && result.duplicate) duplicates.push(result.duplicate);
    } catch (error) {
      errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : "Import failed"}`);
    }
  }
  return { imported, duplicates, errors };
}

export async function listImages() {
  const images = getStore().images;
  return Promise.all(images.map(async (image) => {
    let thumbnailDataUrl: string | undefined;
    try {
      const bytes = await fs.readFile(image.thumbnailPath);
      thumbnailDataUrl = `data:image/webp;base64,${bytes.toString("base64")}`;
    } catch {
      thumbnailDataUrl = undefined;
    }
    const { originalPath: _originalPath, thumbnailPath: _thumbnailPath, ...safe } = image;
    return { ...safe, thumbnailDataUrl };
  }));
}

export async function deleteImage(imageId: string) {
  const store = getStore();
  const image = store.images.find((item) => item.id === imageId);
  if (!image) return;
  if (store.drafts.some((draft) => draft.imageIds.includes(imageId) && !isPublishRecord(draft))) {
    throw new Error("图片仍被未完成的草稿使用，请先删除或完成相关草稿；发布记录不会阻止删除素材。");
  }
  await Promise.all([
    fs.rm(image.originalPath, { force: true }),
    fs.rm(image.thumbnailPath, { force: true })
  ]);
  store.images = store.images.filter((item) => item.id !== imageId);
  await persistStore();
}
