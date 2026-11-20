import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { clipboard, shell } from "electron";
import { getAppPaths, getStore, findDraft, findImage, persistStore, updateDraftRecord } from "./store";
import type { CopyOptions, Draft, DraftPatch, Platform } from "../shared/types";
import { applyCaptionPatch, canEditCopy } from "../shared/draft-copy";
import { readPlatformDefaults } from "../shared/platform-defaults";
import { canDeleteDraft, canDeletePublishRecord } from "../shared/draft-lifecycle";
import { assertVideoCompatible, assertVideoCaption, groupMedia, isVideo } from "../shared/video-rules";

const PLATFORM_URLS: Record<Platform, string> = {
  facebook: "https://www.facebook.com/",
  bluesky: "https://bsky.app/intent/compose",
  instagram: "https://www.instagram.com/",
  x: "https://x.com/compose/post",
  pinterest: "https://www.pinterest.com/",
  tiktok: "https://www.tiktok.com/tiktokstudio/upload"
};

const PLATFORM_SIZES: Record<Platform, { width: number; height: number }> = {
  facebook: { width: 2048, height: 2048 },
  bluesky: { width: 1600, height: 1600 },
  instagram: { width: 1080, height: 1350 },
  x: { width: 1600, height: 900 },
  pinterest: { width: 1000, height: 1500 },
  tiktok: { width: 1080, height: 1920 }
};

export async function createDrafts(imageIds: string[], platforms: Platform[], copy?: CopyOptions) {
  if (!imageIds.length) throw new Error("请至少选择一张图片");
  if (!platforms.length) throw new Error("请至少选择一个平台");
  if (imageIds.length > 500) throw new Error("每批最多选择 500 张图片");

  const store = getStore();
  const validIds = imageIds.filter((id) => store.images.some((image) => image.id === id));
  if (!validIds.length) throw new Error("所选图片已不存在");
  const assets = [...new Set(validIds)].map(id => store.images.find(image => image.id === id)!);
  // Validate the whole batch before adding any draft to the persistent store.
  for (const platform of new Set(platforms)) for (const asset of assets) assertVideoCompatible(asset, platform);

  const created: Draft[] = [];
  const defaults = readPlatformDefaults(store.settings.platformDefaults);
  const createdTime = Date.now();
  if (copy && (typeof copy.sharedCaption !== "string" || !copy.platforms)) throw new Error("无效的文案配置");
  if (copy?.sharedCaptionHtml !== undefined && (typeof copy.sharedCaptionHtml !== "string" || copy.sharedCaptionHtml.length > 100000)) throw new Error("无效的富文本文案");
  const copyGroupId = crypto.randomUUID();
  const sharedCaption = (copy?.sharedCaption || "").slice(0, 5000);
  for (const platform of new Set(platforms)) {
    const option = copy?.platforms[platform];
    if (option?.captionHtml !== undefined && (typeof option.captionHtml !== "string" || option.captionHtml.length > 100000)) throw new Error("无效的富文本文案");
    if (option && (!["shared", "independent"].includes(option.mode) || typeof option.caption !== "string")) throw new Error("无效的平台文案配置");
  }
  for (const platform of new Set(platforms)) {
    const config = defaults[platform];
    const size = config.imagesPerDraft;
    for (const group of groupMedia(assets, size)) {
      const now = new Date().toISOString();
      const draft: Draft = {
        id: crypto.randomUUID(),
        platform,
        imageIds: group,
        mediaType: isVideo(assets.find(asset => asset.id === group[0])!) ? "video" : "image",
        title: config.title,
        tiktokPrivacy: platform === "tiktok" ? config.tiktokPrivacy : undefined,
        boardName: platform === "pinterest" ? config.boardName : undefined,
        xScheduledAt: platform === "x" && config.scheduleDelayMinutes ? new Date(createdTime + config.scheduleDelayMinutes * 60000).toISOString() : null,
        publishAt: config.scheduleDelayMinutes ? new Date(createdTime + config.scheduleDelayMinutes * 60000).toISOString() : null,
        copyGroupId,
        captionMode: copy?.platforms[platform]?.mode || "independent",
        sharedCaption,
        sharedCaptionHtml: copy?.sharedCaptionHtml,
        independentCaptionHtml: copy?.platforms[platform]?.captionHtml,
        captionHtml: copy?.platforms[platform]?.mode === "shared" ? copy.sharedCaptionHtml : copy?.platforms[platform]?.captionHtml,
        independentCaption: (copy?.platforms[platform]?.caption || "").slice(0, 5000),
        caption: copy?.platforms[platform]?.mode === "shared" ? sharedCaption : (copy?.platforms[platform]?.caption || "").slice(0, 5000),
        hashtags: [...config.hashtags],
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

export async function updateDraft(draftId: string, patch: DraftPatch) {
  if (patch.publishAt === undefined && patch.xScheduledAt !== undefined) patch = {...patch, publishAt:patch.xScheduledAt};
  const allowed: Partial<Draft> = {};
  const existing = findDraft(draftId);
  if (!existing) throw new Error("未找到草稿");
  if (!canEditCopy(existing)) throw new Error("请先核对发布结果；已发布或已排程的草稿不能修改");
  if (existing.browserPublish?.state === "scheduled") throw new Error("该任务已提交到 X，请在 X 的已排程帖子中修改或取消");
  if (patch.xScheduledAt !== undefined) {
    if (["running", "uncertain", "succeeded"].includes(existing.browserPublish?.state || "") && patch.xScheduledAt !== existing.xScheduledAt) throw new Error("请先核对已有发布结果，再修改排程");
    if (patch.xScheduledAt === null) allowed.xScheduledAt = null;
    else {
      const time = new Date(patch.xScheduledAt).getTime();
      if (typeof patch.xScheduledAt !== "string" || existing.platform !== "x" || !Number.isFinite(time) || time < Date.now() + 300000) throw new Error("X 定时发布时间必须至少在 5 分钟以后");
      allowed.xScheduledAt = new Date(time).toISOString();
    }
  }
  if (patch.tiktokPrivacy !== undefined) {
    if (existing.platform !== "tiktok" || !["public", "self_only"].includes(patch.tiktokPrivacy)) throw new Error("无效的 TikTok 隐私设置");
    allowed.tiktokPrivacy = patch.tiktokPrivacy;
  }
  if (patch.publishAt !== undefined) {
    const time = patch.publishAt === null ? null : Date.parse(patch.publishAt);
    const unchanged = patch.publishAt === (existing.publishAt || existing.xScheduledAt || null);
    if (time !== null && (typeof patch.publishAt !== "string" || !Number.isFinite(time) || (!unchanged && time < Date.now() + 300000))) throw new Error("定时发布时间必须至少在 5 分钟以后");
    allowed.publishAt = time === null ? null : new Date(time).toISOString();
    allowed.xScheduledAt = existing.platform === "x" ? allowed.publishAt : null;
    if (!unchanged) {
      allowed.scheduleMode = null;
      allowed.browserPublish = undefined;
      if (existing.status === "local_scheduled") allowed.status = "draft";
    }
  }
  if (typeof patch.boardName === "string") allowed.boardName = patch.boardName.trim().slice(0, 200);
  if (typeof patch.title === "string") allowed.title = patch.title.slice(0, 200);
  if (typeof patch.altText === "string") allowed.altText = patch.altText.slice(0, 1000);
  if (Array.isArray(patch.hashtags)) allowed.hashtags = patch.hashtags.filter((tag) => typeof tag === "string").slice(0, 30);
  if (patch.caption !== undefined || patch.captionHtml !== undefined || patch.captionMode !== undefined) applyCaptionPatch(getStore().drafts, existing, patch, new Date().toISOString());
  const draft = updateDraftRecord(draftId, allowed);
  await persistStore();
  return draft;
}

export async function deleteDraft(draftId: string) {
  await deleteDrafts([draftId]);
}

export async function deleteDrafts(draftIds: string[]) {
  if (!Array.isArray(draftIds) || !draftIds.length || draftIds.some(id => typeof id !== "string" || !id)) {
    throw new Error("请选择要删除的草稿");
  }
  const store = getStore();
  const ids = new Set(draftIds);
  for (const id of ids) {
    const draft = store.drafts.find(item => item.id === id);
    if (!draft) throw new Error("部分草稿已不存在，请刷新后重试");
    if (!canDeleteDraft(draft)) throw new Error("已发布、已排程、正在发布或结果待确认的任务不能删除，请刷新并核对结果");
  }
  store.drafts = store.drafts.filter((draft) => !ids.has(draft.id));
  await persistStore();
  return ids.size;
}

export async function deletePublishRecords(recordIds: string[]) {
  if (!Array.isArray(recordIds) || !recordIds.length || recordIds.some(id => typeof id !== "string" || !id)) {
    throw new Error("请选择要删除的发布记录");
  }
  const store = getStore();
  const ids = new Set(recordIds);
  for (const id of ids) {
    const record = store.drafts.find(item => item.id === id);
    if (!record) throw new Error("部分发布记录已不存在，请刷新后重试");
    if (!canDeletePublishRecord(record)) throw new Error("只能删除已发布或平台已确认排程的记录，请等待发布完成并核对结果");
  }
  store.drafts = store.drafts.filter(record => !ids.has(record.id));
  await persistStore();
  return ids.size;
}

export async function prepareDraft(draftId: string, interactive = true) {
  const draft = findDraft(draftId);
  if (!draft) throw new Error("未找到草稿");
  if (interactive && draft.status === "local_scheduled") throw new Error("请先取消本地定时，再准备手动发布素材");
  if (!draft.imageIds.length) throw new Error("草稿中没有图片");
  const assets = draft.imageIds.map(id => { const asset = findImage(id); if (!asset) throw new Error("草稿中的素材已不存在"); return asset; });
  const videoDraft = assets.some(isVideo);
  if (videoDraft && assets.length !== 1) throw new Error("视频草稿只允许一个视频，不能混合图片");
  if (videoDraft) assertVideoCaption(draft);
  for (const asset of assets) assertVideoCompatible(asset, draft.platform);

  const outputFolder = path.join(getAppPaths().exports, draft.id);
  await fs.mkdir(outputFolder, { recursive: true });
  const size = PLATFORM_SIZES[draft.platform];
  const files: string[] = [];

  for (let index = 0; index < draft.imageIds.length; index++) {
    const image = findImage(draft.imageIds[index]);
    if (!image) throw new Error(`未找到图片： ${draft.imageIds[index]}`);
    if (isVideo(image)) {
      const { inspectVideo } = await import("./video-service");
      const metadata = await inspectVideo(image.originalPath);
      assertVideoCompatible({ ...image, ...metadata, size: (await fs.stat(image.originalPath)).size }, draft.platform);
      const target = path.join(outputFolder, "01-video.mp4");
      await fs.copyFile(image.originalPath, target);
      files.push(target);
      continue;
    }
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
    files.push(path.join(outputFolder, outputName));
  }

  const captionText = [
    draft.title,
    draft.caption,
    draft.hashtags.join(" "),
    draft.altText ? `\n图片替代说明：${draft.altText}` : ""
  ].filter(Boolean).join("\n\n");

  await fs.writeFile(path.join(outputFolder, "caption.txt"), captionText, "utf8");
  await fs.writeFile(
    path.join(outputFolder, "README.txt"),
    `Fanzy Reach 发布素材包\n平台：${draft.platform}\n图片数量：${draft.imageIds.length}\n\n请在平台官网上传已准备的图片，核对文案后完成发布。\n`,
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
  return { draft: updated, folder: outputFolder, files, mediaType: videoDraft ? "video" as const : "image" as const };
}

export async function markPublished(draftId: string, publishedUrl?: string) {
  if (publishedUrl && !/^https:\/\/\S+/i.test(publishedUrl)) {
    throw new Error("帖子链接必须以 https:// 开头");
  }
  const draft = updateDraftRecord(draftId, {
    status: "published",
    publishedUrl: publishedUrl?.trim() || null
  });
  await persistStore();
  return draft;
}

export async function scheduleDraft(draftId: string, scheduledAt: string) {
  const existing = findDraft(draftId);
  if (!existing || !canEditCopy(existing) || existing.status === "local_scheduled") throw new Error("请先取消定时发布或核对发布状态，再设置提醒");
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new Error("请选择未来的日期和时间");
  }
  const draft = updateDraftRecord(draftId, {
    status: "scheduled",
    scheduledAt: date.toISOString()
  });
  await persistStore();
  return draft;
}
