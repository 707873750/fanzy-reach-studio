import { backendCaption, assertBackendLogin } from "./backend-service";
import crypto from "node:crypto";
import sharp from "sharp";
import { getStore, findDraft, findImage, persistStore, updateDraftRecord } from "./store";
import type { Draft } from "../shared/types";
import { canEditCopy } from "../shared/draft-copy";
import { assertNotPublishing } from "./browser-publisher";

export async function generateSharedCaption(ids: string[]): Promise<Draft[]> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string")) throw new Error("请选择 1 至 100 条草稿");
  const unique = [...new Set(ids)];
  await generateCaption(unique[0], unique);
  return unique.map(id => findDraft(id)!);
}

export async function generateCaption(draftId: string, sharedIds?: string[]): Promise<Draft> {
  assertNotPublishing(draftId);
  const draft = findDraft(draftId);
  if (!draft) throw new Error("未找到草稿");
  if (!canEditCopy(draft)) throw new Error("已提交的草稿不能生成文案，请先核对发布结果");
  const version = draft.updatedAt;
  const sharedDrafts = sharedIds?.map(id => {
    assertNotPublishing(id);
    const item = findDraft(id);
    if (!item || !canEditCopy(item)) throw new Error("所选草稿包含不可编辑项");
    return {item, version:item.updatedAt};
  });
  const imageIds = sharedDrafts ? [...new Set(sharedDrafts.flatMap(({item}) => item.imageIds))] : draft.imageIds;
  if (imageIds.length > 35) throw new Error("统一生成每次最多使用 35 张不同图片，请减少所选草稿");
  assertBackendLogin();
  const hasVideo = imageIds.some(id => findImage(id)?.mimeType?.startsWith("video/"));

  const images: string[] = [];

  for (const imageId of imageIds) {
    const image = findImage(imageId);
    if (!image) throw new Error("草稿中的图片已不存在");
    const bytes = await sharp(image.mimeType?.startsWith("video/") ? image.thumbnailPath : image.originalPath)
      .rotate()
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    const base64 = bytes.toString("base64");
    images.push(`data:image/jpeg;base64,${base64}`);
  }

  const parsed = await backendCaption({
    images,
    platforms: sharedDrafts ? [...new Set(sharedDrafts.map(({item}) => item.platform))] : [draft.platform],
    shared: Boolean(sharedDrafts), hasVideo, style: getStore().settings.contentStyles?.[0]
  });

  if (!parsed || typeof parsed.caption !== "string" || !parsed.caption.trim() ||
      [parsed.title, parsed.alt_text].some(value => value !== undefined && typeof value !== "string") ||
      (parsed.hashtags !== undefined && (!Array.isArray(parsed.hashtags) || parsed.hashtags.some(tag => typeof tag !== "string")))) {
    throw new Error("AI 返回的文案格式无效，原草稿已保留");
  }
  assertNotPublishing(draftId);
  const current = findDraft(draftId);
  if (!current || !canEditCopy(current) || current.updatedAt !== version) throw new Error("生成期间草稿已修改或开始发布，未覆盖现有内容");

  if (sharedDrafts) {
    for (const {item, version} of sharedDrafts) {
      assertNotPublishing(item.id);
      const live = findDraft(item.id);
      if (!live || !canEditCopy(live) || live.updatedAt !== version) throw new Error("生成期间所选草稿发生变化，未覆盖任何文案");
    }
    const copyGroupId = crypto.randomUUID();
    for (const {item} of sharedDrafts) updateDraftRecord(item.id, {
      copyGroupId, captionMode:"shared", sharedCaption:parsed.caption, caption:parsed.caption,
      captionHtml:undefined, sharedCaptionHtml:undefined,
      independentCaptionHtml:item.captionMode === "shared" ? item.independentCaptionHtml : item.captionHtml,
      independentCaption:item.captionMode === "shared" ? item.independentCaption : item.caption,
      status:"ready"
    });
    await persistStore();
    return findDraft(draftId)!;
  }

  const updated = updateDraftRecord(draftId, {
    title: parsed.title || "",
    caption: parsed.caption || "",
    captionMode: "independent",
    captionHtml: undefined, independentCaptionHtml: undefined,
    independentCaption: parsed.caption || "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    altText: hasVideo ? "" : parsed.alt_text || "",
    status: "ready"
  });
  await persistStore();
  return updated;
}

// Preview operations never persist a draft. The editor applies a chosen result explicitly.
export async function previewCaption(id: string, input: import("../shared/backend").CaptionPreviewInput): Promise<string[]> {
  if (typeof id !== "string" || !input || !["variants", "translate", "shorten"].includes(input.action) ||
      typeof input.text !== "string" || input.text.length > 5000 ||
      (input.action !== "variants" && !input.text.trim()) ||
      (input.action === "translate" && (typeof input.language !== "string" || !input.language.trim() || input.language.length > 80)) ||
      (input.action === "shorten" && (!Number.isInteger(input.maxLength) || input.maxLength! < 10 || input.maxLength! > 5000))) throw new Error("请检查原文、目标语言和长度（10–5000字符）");
  assertNotPublishing(id);
  const draft = findDraft(id);
  if (!draft || !canEditCopy(draft)) throw new Error("当前草稿不可编辑");
  const version = draft.updatedAt;
  assertBackendLogin();
  const images: string[] = [];
  const hasVideo = draft.imageIds.some(imageId => findImage(imageId)?.mimeType.startsWith("video/"));
  if (input.action === "variants") {
    if (draft.imageIds.length > 35) throw new Error("每次最多35张素材");
    for (const imageId of draft.imageIds) {
      const image = findImage(imageId);
      if (!image) throw new Error("素材已不存在");
      const bytes = await sharp(image.mimeType.startsWith("video/") ? image.thumbnailPath : image.originalPath).rotate().resize(768,768,{fit:"inside",withoutEnlargement:true}).jpeg({quality:72}).toBuffer();
      images.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
    }
  }
  const result = await backendCaption({ images, platforms:[draft.platform], shared:draft.captionMode === "shared", hasVideo,
    style:getStore().settings.contentStyles?.[0], action:input.action, text:input.text, language:input.language, maxLength:input.maxLength });
  assertNotPublishing(id);
  const current = findDraft(id);
  if (!current || !canEditCopy(current) || current.updatedAt !== version) throw new Error("生成期间草稿已改变，请重新生成");
  const choices = input.action === "variants" ? result.candidates : [result.caption];
  if (!Array.isArray(choices) || choices.length !== (input.action === "variants" ? 3 : 1) ||
      choices.some(s => typeof s !== "string" || !s.trim() || s.length > 5000) ||
      (input.action === "variants" && new Set(choices.map(s=>s.trim())).size !== 3) ||
      (input.action === "shorten" && choices.some(s => Array.from(s).length > input.maxLength! || Array.from(s).length >= Array.from(input.text).length))) throw new Error("AI 结果无效或未达到缩短要求，原文保留");
  return choices;
}
