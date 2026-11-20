import type { Draft } from "./types";

export function isPublishRecord(draft: Draft) {
  return draft.status === "published" || draft.status === "platform_scheduled" ||
    ["succeeded", "scheduled"].includes(draft.browserPublish?.state || "");
}

export function canDeleteDraft(draft: Draft) {
  return !isPublishRecord(draft) && !["running", "uncertain"].includes(draft.browserPublish?.state || "");
}

export function isLocalScheduledDraft(draft: Draft) {
  return draft.status === "local_scheduled" && !isPublishRecord(draft);
}

export function canDeletePublishRecord(draft: Draft) {
  // Manual completion may retain an older uncertain browser result.
  return isPublishRecord(draft) && draft.browserPublish?.state !== "running";
}
