import type { Draft, ImageAsset, Platform } from "./types";

// Web composer compatibility profile, reviewed 2026-11-20. Account-specific
// entitlements are still enforced by each website. See VIDEO-SUPPORT.md.
export const VIDEO_RULES: Record<Platform, { label: string; maxSeconds: number; maxBytes: number; minSeconds: number; note: string }> = {
  x: { label: "X", minSeconds: 0.5, maxSeconds: 140, maxBytes: 512_000_000, note: "普通账号：最长 140 秒、512 MB；暂不启用 Premium 长视频额度。" },
  bluesky: { label: "Bluesky", minSeconds: 0, maxSeconds: 600, maxBytes: 300_000_000, note: "最长 10 分钟、300 MB；须验证邮箱，账号额度以平台为准。" },
  pinterest: { label: "Pinterest", minSeconds: 4, maxSeconds: 300, maxBytes: 1_000_000_000, note: "4 秒至 5 分钟；应用上限 1 GB；需选择图板，推荐竖屏。" },
  instagram: { label: "Instagram", minSeconds: 3, maxSeconds: 180, maxBytes: 1_000_000_000, note: "应用兼容范围：3 秒至 3 分钟、1 GB，至少 720p、30 fps，画幅 9:16 至 1.91:1；更长视频请在官网确认账号支持。" },
  tiktok: { label: "TikTok", minSeconds: 3, maxSeconds: 600, maxBytes: 1_000_000_000, note: "应用兼容范围：3 秒至 10 分钟、1 GB；账号实际时长及上传额度以 Studio 为准。" },
  facebook: { label: "Facebook", minSeconds: 0, maxSeconds: 14400, maxBytes: 1_000_000_000, note: "应用兼容范围：最长 4 小时、1 GB；新版视频按 Reels 发布，实际入口与账号权限以平台为准。" }
};

export const isVideo = (asset: Pick<ImageAsset, "mimeType">) => Boolean(asset.mimeType?.startsWith("video/"));

export function videoIssues(asset: ImageAsset, platform: Platform): string[] {
  if (!isVideo(asset)) return [];
  const rule = VIDEO_RULES[platform];
  const errors: string[] = [];
  const video = asset.video;
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || !Number.isFinite(video.fps) || video.fps <= 0 || asset.width <= 0 || asset.height <= 0) return ["无法读取有效视频信息，请重新导入"];
  if (asset.size > rule.maxBytes) errors.push(`超过 ${rule.maxBytes / 1_000_000} MB 上限`);
  if (video.duration < rule.minSeconds || video.duration > rule.maxSeconds) errors.push(`时长须为 ${rule.minSeconds || "大于 0"}–${rule.maxSeconds} 秒`);
  if (!/\.(mp4|m4v)$/i.test(asset.fileName) || video.codec !== "h264" || (video.audioCodec && video.audioCodec !== "aac") || video.pixelFormat !== "yuv420p") errors.push("请导出 MP4 / H.264（8 位 yuv420p），音频使用 AAC 或无音轨");
  const ratio = asset.width / asset.height;
  if (platform === "instagram") {
    if (Math.min(asset.width, asset.height) < 720 || video.fps < 29.9) errors.push("至少 720p、30 fps");
    if (ratio < 9 / 16 - 0.001 || ratio > 1.91) errors.push("画幅须在 9:16 至 1.91:1 之间");
  }
  if (platform === "x") {
    if (video.fps > 60.01 || ratio < 1 / 2.39 || ratio > 2.39 || Math.min(asset.width, asset.height) < 32 || Math.max(asset.width, asset.height) > 1920 || Math.min(asset.width, asset.height) > 1200) errors.push("须为 32×32 至 1920×1200（或竖屏）、不超过 60 fps，画幅 1:2.39 至 2.39:1");
  }
  return errors;
}

export function assertVideoCompatible(asset: ImageAsset, platform: Platform) {
  const errors = videoIssues(asset, platform);
  if (errors.length) throw new Error(`${VIDEO_RULES[platform].label} · ${asset.fileName}：${errors.join("；")}`);
}

export function assertVideoCaption(draft: Draft) {
  if (draft.altText) throw new Error("视频不使用图片替代文本，请清空替代文本后发布");
  const text = [draft.platform === "pinterest" ? "" : draft.title, draft.caption, draft.hashtags.join(" ")].filter(Boolean).join("\n\n");
  const limits: Record<Platform, number> = { x: 280, bluesky: 300, instagram: 2200, tiktok: 4000, pinterest: 800, facebook: 63206 };
  const length = draft.platform === "bluesky" ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length : [...text].length;
  if (length > limits[draft.platform]) throw new Error(`${VIDEO_RULES[draft.platform].label}：视频文案及标签合计超过应用 ${limits[draft.platform]} 字符校验上限`);
  if (draft.platform === "pinterest" && [...draft.title].length > 100) throw new Error("Pinterest 视频标题最多 100 字符");
}

export function groupMedia(assets: ImageAsset[], imageBatchSize: number): string[][] {
  const groups: string[][] = [];
  let photos: string[] = [];
  const flush = () => { if (photos.length) groups.push(photos); photos = []; };
  for (const asset of assets) {
    if (isVideo(asset)) { flush(); groups.push([asset.id]); }
    else { photos.push(asset.id); if (photos.length >= imageBatchSize) flush(); }
  }
  flush();
  return groups;
}
