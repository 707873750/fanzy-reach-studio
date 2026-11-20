import { safeStorage } from "electron";
import crypto from "node:crypto";
import sharp from "sharp";
import { getStore, findDraft, findImage, persistStore, updateDraftRecord } from "./store";
import type { Draft, Platform } from "../shared/types";
import { canEditCopy } from "../shared/draft-copy";
import { assertNotPublishing } from "./browser-publisher";

async function getApiKey() {
  const encrypted = getStore().settings.deepSeekKeyEncrypted;
  if (!encrypted) throw new Error("请先在设置中添加 DeepSeek API 密钥。");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows 安全凭据存储不可用。");
  }
  return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
}

function promptFor(platform: Platform, imageCount: number) {
  const common = `You are a professional social media copywriter. Analyze the attached image(s), describe only visible facts, do not invent products, people, locations, claims or offers. Write natural English copy. Return valid JSON only. There are ${imageCount} image(s).`;
  if (platform === "bluesky") {
    return `${common}
Create one Bluesky post under 280 characters including hashtags. Output JSON:
{"title":"","caption":"...","hashtags":[],"alt_text":""}
Keep it concise. Do not invent claims or links.`;
  }
  if (platform === "facebook") {
    return `Write a natural English Facebook photo post for ${imageCount} images. Return JSON with caption, title (empty string), hashtags (up to 3), alt_text (empty string). Describe visible facts only.`;
  }
  if (platform === "instagram") {
    return `${common}
Create one Instagram carousel caption. Output JSON:
{"title":"","caption":"","hashtags":["#tag1","#tag2"],"alt_text":"A concise accessible description of the image set."}
Caption should be engaging and conversational. Use 3-8 relevant hashtags. Do not add a fake link or unsupported claims.`;
  }
  if (platform === "tiktok") {
    return `${common}
Create a TikTok photo carousel caption. Output JSON:
{"title":"Short title under 90 characters","caption":"Natural description under 3000 characters","hashtags":["#tag1","#tag2"],"alt_text":""}
Use 3-5 relevant hashtags. Do not invent music, trends or unsupported claims.`;
  }
  if (platform === "x") {
    return `${common}
Create one X post. Keep the post concise and within 260 characters including hashtags where possible. Output JSON:
{"title":"","caption":"...","hashtags":[],"alt_text":"..."}
Do not add unsupported claims or engagement bait.`;
  }
  return `${common}
Create a Pinterest Pin. Output JSON:
{"title":"SEO-friendly title under 100 characters","caption":"Useful natural description under 500 characters","hashtags":[],"alt_text":"Accessible image description"}
Use descriptive keywords naturally. Do not keyword-stuff.`;
}

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
  const apiKey = await getApiKey();
  const hasVideo = imageIds.some(id => findImage(id)?.mimeType?.startsWith("video/"));

  const imageParts: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string; detail: "low" } }> = [
    { type: "text", text: sharedDrafts ? `Write one concise natural English social media caption suitable for all these platforms: ${[...new Set(sharedDrafts.map(({item}) => item.platform))].join(', ')}. Base it only on visible facts in the attached images. Do not invent claims. Keep it under 240 characters. Return JSON with caption (nonempty string), title (empty string), hashtags (empty array), alt_text (empty string).` : promptFor(draft.platform, draft.imageIds.length) }
  ];

  for (const imageId of imageIds) {
    const image = findImage(imageId);
    if (!image) throw new Error("草稿中的图片已不存在");
    const bytes = await sharp(image.mimeType?.startsWith("video/") ? image.thumbnailPath : image.originalPath)
      .rotate()
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    const base64 = bytes.toString("base64");
    imageParts.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "low" }
    });
  }

  const controller = new AbortController();
  if (hasVideo) imageParts[0].text += " Some images are video cover frames only. Do not infer motion, events, speech or audio beyond the visible still frame. Return an empty alt_text for video.";
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: getStore().settings.model || "deepseek-flash",
        messages: [{ role: "user", content: imageParts }],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 1200
      }),
      signal: controller.signal
    }).catch((error: unknown) => {
      if (controller.signal.aborted) {
        throw new Error("连接 DeepSeek 超时（120 秒），原草稿已保留，请稍后重新生成。");
      }
      const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
      const code = typeof cause?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(cause.code)
        ? `（${cause.code}）` : "";
      throw new Error(`无法连接 DeepSeek${code}，原草稿已保留。请检查网络或代理连接后重新生成。`);
    });

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(body.error?.message || `DeepSeek 接口错误： ${response.status}`);
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI 返回了空内容");

    const parsed = JSON.parse(content) as {
      title?: string;
      caption?: string;
      hashtags?: string[];
      alt_text?: string;
    };

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
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveDeepSeekKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key.startsWith("sk-") || key.length < 20) {
    throw new Error("请输入有效的 DeepSeek API 密钥。");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows 安全凭据存储不可用。");
  }
  const encrypted = safeStorage.encryptString(key);
  getStore().settings.deepSeekKeyEncrypted = encrypted.toString("base64");
  await persistStore();
  return getSettings();
}

export async function clearDeepSeekKey() {
  delete getStore().settings.deepSeekKeyEncrypted;
  await persistStore();
  return getSettings();
}

export function getSettings() {
  return {
    hasDeepSeekKey: Boolean(getStore().settings.deepSeekKeyEncrypted),
    model: getStore().settings.model || "deepseek-flash"
  };
}
