import type { Draft, Platform, PlatformAccount } from "./types";
export const ACCOUNT_PLATFORMS: Platform[] = ["instagram", "x", "pinterest", "tiktok", "bluesky", "facebook"];
export const defaultAccountId = (platform: Platform) => `default-${platform}`;
export function migrateAccounts(data: { accounts?: PlatformAccount[]; drafts: Draft[] }) {
  let changed = false;
  data.accounts ??= [];
  for (const platform of ACCOUNT_PLATFORMS) {
    if (!data.accounts.some(a => a.id === defaultAccountId(platform))) {
      data.accounts.push({id:defaultAccountId(platform), platform, name:"", legacy:true}); changed = true;
    }
  }
  for (const draft of data.drafts) if (!draft.accountId) { draft.accountId = defaultAccountId(draft.platform); changed = true; }
  return changed;
}
