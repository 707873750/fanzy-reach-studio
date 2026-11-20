import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import sharp from "sharp";
import { setTimeout as delay } from "node:timers/promises";
import { getAppPaths, getStore, persistStore, type StoredImage } from "./store";
import { isPublishRecord } from "../shared/draft-lifecycle";

const ALLOWED = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// libvips caches file-backed operations across all Sharp instances, including
// AI previews and publish exports. Release their handles when processing ends
// so Windows can delete the library files immediately afterwards.
sharp.cache(false);

async function removeImageFile(filePath: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rm(filePath, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") throw error;
      if (attempt >= 3) {
        throw new Error("图片文件仍被占用或没有删除权限。请等待发布或图片处理结束，关闭相关预览窗口后重试；若仍失败，请完全退出并重新打开应用。", { cause: error });
      }
      await delay(150 * (attempt + 1));
    }
  }
}

async function sha256(filePath: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function importOne(sourcePath: string, sourceFolder?: string) {
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error("所选路径不是文件");
  const ext = path.extname(sourcePath).toLowerCase();
  const videoFile = [".mp4", ".mov", ".m4v", ".webm"].includes(ext);
  if (stat.size > (videoFile ? 1_000_000_000 : MAX_FILE_BYTES)) throw new Error(videoFile ? "视频超过应用 1 GB 导入上限" : "图片超过 50 MB 限制");
  if (!ALLOWED.has(ext) && !videoFile) throw new Error("不支持此素材格式");

  const hash = await sha256(sourcePath);
  const existing = getStore().images.find((image) => image.sha256 === hash);
  if (existing) {
    if (sourceFolder && !existing.sourceFolders?.includes(sourceFolder)) {
      existing.sourceFolders = [...(existing.sourceFolders || []), sourceFolder];
      await persistStore();
    }
    return { duplicate: existing.fileName };
  }

  if (videoFile) {
    const { inspectVideo, makeVideoThumbnail } = await import("./video-service");
    const metadata = await inspectVideo(sourcePath);
    const id = crypto.randomUUID();
    const destination = path.join(getAppPaths().assets, `${id}${ext}`);
    const thumbnailPath = path.join(getAppPaths().thumbnails, `${id}.webp`);
    try {
      await fs.copyFile(sourcePath, destination);
      await makeVideoThumbnail(destination, thumbnailPath);
    } catch (error) {
      await Promise.allSettled([fs.rm(destination, { force: true }), fs.rm(thumbnailPath, { force: true })]);
      throw error;
    }
    const image: StoredImage = { id, fileName: path.basename(sourcePath), sourceFolders: sourceFolder ? [sourceFolder] : [],
      mimeType: ext === ".mov" ? "video/quicktime" : ext === ".webm" ? "video/webm" : "video/mp4",
      ...metadata, size: stat.size, sha256: hash, originalPath: destination, thumbnailPath, createdAt: new Date().toISOString() };
    getStore().images.unshift(image);
    await persistStore();
    return { image };
  }

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
    sourceFolders: sourceFolder ? [sourceFolder] : [],
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

export async function importFiles(filePaths: string[], sourceFolder?: string) {
  const imported: StoredImage[] = [];
  const duplicates: string[] = [];
  const errors: string[] = [];

  for (const filePath of filePaths.slice(0, 500)) {
    try {
      const result = await importOne(filePath, sourceFolder ? path.resolve(sourceFolder) : undefined);
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
  // Keep the thumbnail intact if the original is still locked. force:true
  // also allows retrying after the original was removed but thumbnail failed.
  await removeImageFile(image.originalPath);
  await removeImageFile(image.thumbnailPath);
  store.images = store.images.filter((item) => item.id !== imageId);
  await persistStore();
}
