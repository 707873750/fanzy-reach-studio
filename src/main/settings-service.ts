import { getStore } from "./store";

export function getSettings() {
  return {
    backendLoggedIn: Boolean(getStore().settings.backendTokenEncrypted),
    hasVolcKeys: Boolean(getStore().settings.volcKeysEncrypted),
    hasPendingImageTask: Boolean(getStore().settings.backendPendingTask)
  };
}
