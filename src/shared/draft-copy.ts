import type { Draft, DraftPatch } from "./types";

export function canEditCopy(draft: Draft) {
  return draft.status !== "published" && draft.status !== "platform_scheduled" &&
    !["running", "uncertain", "succeeded", "scheduled"].includes(draft.browserPublish?.state || "");
}

// Keep both versions, and materialize the chosen caption for existing publishers.
export function applyCaptionPatch(drafts: Draft[], draft: Draft, patch: DraftPatch, now: string) {
  const previousMode = draft.captionMode || "independent";
  const mode = patch.captionMode || previousMode;
  if (mode !== "shared" && mode !== "independent") throw new Error("无效的文案模式");
  if (mode === "shared" && !draft.copyGroupId) throw new Error("此草稿没有关联批次，请从素材库创建关联草稿后使用统一文案");
  if (patch.captionHtml !== undefined && (typeof patch.captionHtml !== "string" || patch.captionHtml.length > 100000)) throw new Error("无效的富文本文案");
  if (previousMode === "independent") { draft.independentCaption = draft.caption; draft.independentCaptionHtml = draft.captionHtml; }
  draft.captionMode = mode;
  // A mode switch never overwrites the saved version with the old editor's value.
  const text = mode !== previousMode ? undefined : patch.caption;
  const html = mode !== previousMode ? undefined : patch.captionHtml;
  if (mode === "shared") {
    const shared = typeof text === "string" ? text.slice(0, 5000) : draft.sharedCaption || "";
    const sharedHtml = typeof text === "string" ? html : draft.sharedCaptionHtml;
    for (const peer of drafts) {
      if (peer.copyGroupId !== draft.copyGroupId || !canEditCopy(peer)) continue;
      peer.sharedCaption = shared;
      peer.sharedCaptionHtml = sharedHtml;
      if (peer.captionMode === "shared") { peer.caption = shared; peer.captionHtml = sharedHtml; }
      peer.updatedAt = now;
    }
    draft.caption = shared;
    draft.captionHtml = sharedHtml;
  } else {
    draft.caption = typeof text === "string" ? text.slice(0, 5000) : draft.independentCaption ?? draft.caption;
    draft.captionHtml = typeof text === "string" ? html : draft.independentCaptionHtml;
    draft.independentCaption = draft.caption;
    draft.independentCaptionHtml = draft.captionHtml;
  }
  draft.updatedAt = now;
}
