import crypto from "node:crypto";
import { getStore, persistStore } from "./store";
import { ACCOUNT_PLATFORMS, defaultAccountId } from "../shared/accounts";
import type { Platform } from "../shared/types";
export function listAccounts() { return (getStore().accounts || []).filter(a => !a.deletedAt); }
export function getAccount(platform: Platform, id?: string) {
  if (id !== undefined && (typeof id !== "string" || !id)) throw new Error("账号不存在或与平台不匹配");
  const account = listAccounts().find(a => a.id === (id ?? defaultAccountId(platform)) && a.platform === platform);
  if (!account) throw new Error("账号不存在或与平台不匹配");
  return account;
}
function accountName(name: string) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("账号名称需为 1 至 80 个字符");
  return name.trim();
}
export async function addAccount(platform: Platform, name: string) {
  if (!ACCOUNT_PLATFORMS.includes(platform)) throw new Error("无效的平台");
  if (listAccounts().filter(a => a.platform === platform).length >= 20) throw new Error("每个平台最多添加 20 个账号");
  const account = {id:crypto.randomUUID(), platform, name:accountName(name)};
  getStore().accounts!.push(account); await persistStore(); return account;
}
export async function renameAccount(id: string, name: string) {
  const account = listAccounts().find(a => a.id === id);
  if (!account) throw new Error("账号不存在或与平台不匹配");
  account.name = accountName(name); await persistStore();
}

export async function deleteAccount(id: string) {
  const account = listAccounts().find(a => a.id === id);
  if (!account) throw new Error("账号不存在或与平台不匹配");
  if (getStore().drafts.some(d => (d.accountId || defaultAccountId(d.platform)) === id)) {
    throw new Error("此账号仍有关联草稿、定时任务或发布记录。请先更换草稿账号，或移除关联任务和记录，再删除账号。");
  }
  // A tombstone prevents legacy migration from recreating removed default accounts.
  // Preserve browser files: the legacy directory can contain other accounts' profiles.
  account.deletedAt = new Date().toISOString();
  try { await persistStore(); } catch (error) { delete account.deletedAt; throw error; }
}
