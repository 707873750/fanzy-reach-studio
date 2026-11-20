import type { Platform, PlatformDefaults, PlatformDefaultsMap } from "./types";

export function defaultPlatformSettings(): PlatformDefaultsMap {
  const common = {hashtags: [], boardName: "", title: "", scheduleDelayMinutes: 0};
  return {
    facebook: {...common, hashtags: [], imagesPerDraft: 10},
    bluesky: {...common, hashtags: [], imagesPerDraft: 4},
    instagram: {...common, hashtags: [], imagesPerDraft: 10},
    x: {...common, hashtags: [], imagesPerDraft: 4},
    pinterest: {...common, hashtags: [], imagesPerDraft: 1},
    tiktok: {...common, hashtags: [], imagesPerDraft: 35, tiktokPrivacy: "self_only"}
  };
}

export function validatePlatformDefaults(platform: Platform, input: PlatformDefaults): PlatformDefaults {
  if (!["instagram", "x", "pinterest", "tiktok", "bluesky", "facebook"].includes(platform)) throw new Error("无效的平台");
  if (!input || typeof input !== "object") throw new Error("无效的平台配置");
  if (input?.tiktokPrivacy !== undefined && !["public", "self_only"].includes(input.tiktokPrivacy)) throw new Error("无效的 TikTok 隐私选项");
  const max = defaultPlatformSettings()[platform].imagesPerDraft;
  if (!Number.isInteger(input.imagesPerDraft) || input.imagesPerDraft < 1 || input.imagesPerDraft > max) throw new Error(`每条草稿的图片数量须为 1 至 ${max}`);
  if (!Array.isArray(input.hashtags) || input.hashtags.length > 30 || input.hashtags.some(tag => typeof tag !== "string" || tag.length > 100 || /\s/.test(tag))) throw new Error("最多保存 30 个话题标签，每个不超过 100 个字符且不能含空格");
  if (typeof input.boardName !== "string" || input.boardName.length > 200 || typeof input.title !== "string" || input.title.length > 100) throw new Error("图板名称最多 200 字符，默认标题最多 100 字符");
  if (!Number.isInteger(input.scheduleDelayMinutes) || (input.scheduleDelayMinutes !== 0 && (input.scheduleDelayMinutes < 10 || input.scheduleDelayMinutes > 10080))) throw new Error("定时延后分钟数须为 10 至 10080，或填 0 表示立即发布");
  return {
    imagesPerDraft: input.imagesPerDraft,
    ...(platform === "tiktok" ? {tiktokPrivacy: input.tiktokPrivacy || "self_only"} : {}),
    hashtags: [...new Set(input.hashtags.map(tag => tag.trim()).filter(Boolean))],
    boardName: platform === "pinterest" ? input.boardName.trim() : "",
    title: platform === "pinterest" ? input.title : "",
    scheduleDelayMinutes: input.scheduleDelayMinutes
  };
}

export function readPlatformDefaults(stored?: Partial<PlatformDefaultsMap>): PlatformDefaultsMap {
  const result = defaultPlatformSettings();
  for (const platform of Object.keys(result) as Platform[]) {
    try { result[platform] = validatePlatformDefaults(platform, {...result[platform], ...stored?.[platform]}); }
    catch { /* Old or invalid entries use safe defaults for this platform only. */ }
  }
  return result;
}
