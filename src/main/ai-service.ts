import { safeStorage } from "electron";
import sharp from "sharp";
import { getStore, findDraft, findImage, persistStore, updateDraftRecord } from "./store";
import type { Draft, Platform } from "../shared/types";
import { canEditCopy } from "../shared/draft-copy";

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

export async function generateCaption(draftId: string): Promise<Draft> {
  const draft = findDraft(draftId);
  if (!draft) throw new Error("未找到草稿");
  if (!canEditCopy(draft)) throw new Error("已提交的草稿不能生成文案，请先核对发布结果");
  const apiKey = await getApiKey();

  const imageParts: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string; detail: "low" } }> = [
    { type: "text", text: promptFor(draft.platform, draft.imageIds.length) }
  ];

  for (let index = 0; index < draft.imageIds.length; index++) {
    const image = findImage(draft.imageIds[index]);
    if (!image) continue;
    const bytes = await sharp(image.originalPath)
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

    const updated = updateDraftRecord(draftId, {
      title: parsed.title || "",
      caption: parsed.caption || "",
      captionMode: "independent",
      independentCaption: parsed.caption || "",
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      altText: parsed.alt_text || "",
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
