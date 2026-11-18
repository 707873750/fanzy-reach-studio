import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { clipboard, shell } from "electron";
import { getAppPaths, getStore, findDraft, findImage, persistStore, platformBatchSize, updateDraftRecord } from "./store";
import type { Draft, Platform } from "../shared/types";

const PLATFORM_URLS: Record<Platform, string> = {
  instagram: "https://www.instagram.com/",
  x: "https://x.com/compose/post",
  pinterest: "https://www.pinterest.com/"
};

const PLATFORM_SIZES: Record<Platform, { width: number; height: number }> = {
  instagram: { width: 1080, height: 1350 },
  x: { width: 1600, height: 900 },
  pinterest: { width: 1000, height: 1500 }
};

export async function createDrafts(imageIds: string[], platforms: Platform[]) {
  if (!imageIds.length) throw new Error("Select at least one image");
  if (!platforms.length) throw new Error("Select at least one platform");
  if (imageIds.length > 500) throw new Error("Maximum 500 images per batch");

  const store = getStore();
  const validIds = imageIds.filter((id) => store.images.some((image) => image.id === id));
  if (!validIds.length) throw new Error("Selected images are no longer available");

  const created: Draft[] = [];
  for (const platform of platforms) {
    const size = platformBatchSize(platform);
    for (let index = 0; index < validIds.length; index += size) {
      const group = validIds.slice(index, index + size);
      const now = new Date().toISOString();
      const draft: Draft = {
        id: crypto.randomUUID(),
        platform,
        imageIds: group,
        title: "",
        caption: "",
        hashtags: [],
        altText: "",
        status: "draft",
        scheduledAt: null,
        preparedFolder: null,
        publishedUrl: null,
        createdAt: now,
        updatedAt: now
      };
      store.drafts.unshift(draft);
      created.push(draft);
    }
  }
  await persistStore();
  return created;
}

export async function listDrafts() {
  return getStore().drafts;
}

export async function updateDraft(draftId: string, patch: Partial<Pick<Draft, "title" | "caption" | "altText" | "hashtags" | "boardName">>) {
  const allowed: Partial<Draft> = {};
  if (typeof patch.boardName === "string") allowed.boardName = patch.boardName.trim().slice(0, 200);
  if (typeof patch.title === "string") allowed.title = patch.title.slice(0, 200);
  if (typeof patch.caption === "string") allowed.caption = patch.caption.slice(0, 5000);
  if (typeof patch.altText === "string") allowed.altText = patch.altText.slice(0, 1000);
  if (Array.isArray(patch.hashtags)) allowed.hashtags = patch.hashtags.filter((tag) => typeof tag === "string").slice(0, 30);
  const draft = updateDraftRecord(draftId, allowed);
  await persistStore();
  return draft;
}

export async function deleteDraft(draftId: string) {
  const store = getStore();
  store.drafts = store.drafts.filter((draft) => draft.id !== draftId);
  await persistStore();
}

export async function prepareDraft(draftId: string, interactive = true) {
  const draft = findDraft(draftId);
  if (!draft) throw new Error("Draft not found");
  if (!draft.imageIds.length) throw new Error("Draft has no images");

  const outputFolder = path.join(getAppPaths().exports, draft.id);
  await fs.mkdir(outputFolder, { recursive: true });
  const size = PLATFORM_SIZES[draft.platform];

  for (let index = 0; index < draft.imageIds.length; index++) {
    const image = findImage(draft.imageIds[index]);
    if (!image) throw new Error(`Image not found: ${draft.imageIds[index]}`);
    const outputName = `${String(index + 1).padStart(2, "0")}-${path.parse(image.fileName).name.replace(/[^\w-]/g, "_")}.jpg`;
    await sharp(image.originalPath)
      .rotate()
      .resize(size.width, size.height, {
        fit: "inside",
        withoutEnlargement: true,
        background: "#ffffff"
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(path.join(outputFolder, outputName));
  }

  const captionText = [
    draft.title,
    draft.caption,
    draft.hashtags.join(" "),
    draft.altText ? `\nAlt text: ${draft.altText}` : ""
  ].filter(Boolean).join("\n\n");

  await fs.writeFile(path.join(outputFolder, "caption.txt"), captionText, "utf8");
  await fs.writeFile(
    path.join(outputFolder, "README.txt"),
    `Fanzy Reach Studio assisted publishing package\nPlatform: ${draft.platform}\nImages: ${draft.imageIds.length}\n\nUpload the prepared images on the official platform website. Review the caption and confirm publication yourself.\n`,
    "utf8"
  );

  if (interactive) {
  clipboard.writeText(captionText);
  await shell.openPath(outputFolder);

  // X Share Intent can prefill text, but it cannot attach local files.
  // The user must drag the prepared images into the composer and click Post.
  if (draft.platform === "x") {
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", captionText);
    await shell.openExternal(intent.toString());
  } else {
    await shell.openExternal(PLATFORM_URLS[draft.platform]);
  }
  }

  const updated = updateDraftRecord(draftId, {
    status: "prepared",
    preparedFolder: outputFolder
  });
  await persistStore();
  return { draft: updated, folder: outputFolder };
}

export async function markPublished(draftId: string, publishedUrl?: string) {
  if (publishedUrl && !/^https:\/\/\S+/i.test(publishedUrl)) {
    throw new Error("Post URL must start with https://");
  }
  const draft = updateDraftRecord(draftId, {
    status: "published",
    publishedUrl: publishedUrl?.trim() || null
  });
  await persistStore();
  return draft;
}

export async function scheduleDraft(draftId: string, scheduledAt: string) {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new Error("Choose a future date and time");
  }
  const draft = updateDraftRecord(draftId, {
    status: "scheduled",
    scheduledAt: date.toISOString()
  });
  await persistStore();
  return draft;
}
