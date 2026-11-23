import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { getStore, persistStore } from './store';
import { getSettings } from './settings-service';
import { importFiles } from './image-service';
import { IMAGE_PROMPT_LIMIT, IMAGE_SIZES, type GenerateImageRequest } from '../shared/image-generation';
import type { BackendAccount, CaptionRequest, CaptionResult } from '../shared/backend';

let busy = false;
let preview: { taskId: string; bytes: Buffer; dataUrl: string; extension: string } | undefined;
class BackendError extends Error { constructor(message: string, public status: number) { super(message); } }
function normalizeUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入后端地址。');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('后端地址格式不正确。'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('请使用 HTTPS 后端地址；本机 demo 可使用 http://127.0.0.1:8787。');
  }
  return url.origin;
}
function token() {
  const encrypted = getStore().settings.backendTokenEncrypted;
  if (!encrypted) throw new Error('请先登录，登录后才可使用 AI 功能。');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，请重新登录。');
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); }
  catch { throw new Error('登录凭证无法读取，请重新登录。'); }
}
async function request(endpoint: string, options: { body?: unknown; url?: string; anonymous?: boolean; image?: boolean; timeout?: number } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!options.anonymous) headers.Authorization = `Bearer ${token()}`;
  let response: Response;
  try {
    response = await fetch(`${normalizeUrl(options.url || getStore().settings.backendUrl || 'http://127.0.0.1:8787')}${endpoint}`, {
      method: options.body === undefined ? 'GET' : 'POST', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body), redirect: 'error', signal: AbortSignal.timeout(options.timeout ?? 55_000)
    });
  } catch { throw new Error('无法连接 AI 后端。请检查服务是否启动；已提交生图任务请继续查询。'); }
  const limit = options.image ? 20 * 1024 * 1024 : 256 * 1024;
  if (!response.body) throw new Error('后端返回空响应，请重试。');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) throw new Error('后端返回内容超过大小限制。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (options.image && response.ok) return bytes;
  let data: any;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('后端返回格式不正确，请检查地址。'); }
  if (!response.ok) {
    if (response.status === 401 && !options.anonymous) { delete getStore().settings.backendTokenEncrypted; await persistStore(); }
    throw new BackendError(typeof data.error === 'string' ? data.error.slice(0, 500) : '后端请求失败。', response.status);
  }
  return data;
}
export function assertBackendLogin() { token(); }
export async function backendCaption(input: CaptionRequest): Promise<CaptionResult> {
  try {
    return await request('/api/captions', { body: input, timeout: 130_000 });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : '文案生成失败。'} 原草稿已保留。`);
  }
}
async function authenticateBackend(username: unknown, password: unknown, register = false) {
  if (busy) throw new Error('请等待当前生图操作结束。');
  // Deployment configuration belongs to the main process, never the login form.
  // Persist the selected origin with the session so its token cannot be sent to
  // another server when the environment changes before the next login.
  const origin = normalizeUrl(process.env.FANZY_BACKEND_URL || import.meta.env.MAIN_VITE_BACKEND_URL || getStore().settings.backendUrl || 'http://127.0.0.1:8787');
  if (getStore().settings.backendPendingTask && origin !== getStore().settings.backendUrl) throw new Error('请先处理当前后端的待查询任务，再切换地址。');
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || Array.from(password).length > 128) throw new Error('请填写有效的账号和密码，密码最多 128 个字符。');
  if (register && (!/^[a-zA-Z0-9_]{3,32}$/.test(username.trim()) || Array.from(password).length < 8 || !password.trim())) throw new Error('用户名需为 3–32 位字母、数字或下划线，密码需为 8–128 个字符。');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存登录凭证。');
  const result = await request(register ? '/api/register' : '/api/login', { url: origin, anonymous: true, body: { username: username.trim(), password } });
  if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token)) throw new Error('后端返回无效登录凭证。');
  if (typeof result.account?.user?.id !== 'string') throw new Error('后端返回无效账号。');
  const encrypted = safeStorage.encryptString(result.token).toString('base64');
  if (result.account.user.id !== (getStore().settings.backendUserId || 'demo')) {
    delete getStore().settings.backendPendingTask;
    preview = undefined;
  }
  getStore().settings.backendUrl = origin;
  getStore().settings.backendUserId = result.account.user.id;
  getStore().settings.backendTokenEncrypted = encrypted;
  if (!getStore().settings.backendPendingTask && result.account?.activeTaskId) getStore().settings.backendPendingTask = { id: result.account.activeTaskId };
  await persistStore();
  return getSettings();
}
export const backendLogin = (username: unknown, password: unknown) => authenticateBackend(username, password);
export const backendRegister = (username: unknown, password: unknown) => authenticateBackend(username, password, true);
export async function backendLogout() {
  if (busy) throw new Error('请等待当前生图操作结束。');
  try { if (getStore().settings.backendTokenEncrypted) await request('/api/logout', { body: {} }); }
  finally { delete getStore().settings.backendTokenEncrypted; preview = undefined; await persistStore(); }
  return getSettings();
}
export async function backendAccount(): Promise<BackendAccount> {
  const result = await request('/api/me');
  if (!getStore().settings.backendPendingTask && result.activeTaskId) {
    getStore().settings.backendPendingTask = { id: result.activeTaskId }; await persistStore();
  }
  return result;
}
export async function backendCheckin(): Promise<BackendAccount> { return request('/api/checkin', { body: {} }); }
export function getGeneratedImage() {
  if (!getStore().settings.backendTokenEncrypted) return null;
  return preview ? { taskId: preview.taskId, dataUrl: preview.dataUrl } : null;
}
async function collect() {
  const task = getStore().settings.backendPendingTask;
  if (!task) throw new Error('没有待查询的生图任务。');
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = await request(`/api/tasks/${encodeURIComponent(task.id)}`);
    if (result.status === 'failed') {
      delete getStore().settings.backendPendingTask; await persistStore();
      throw new Error(result.error || '生图失败，积分已退回。');
    }
    if (result.status === 'uncertain') throw new Error(result.error || '提交结果未确认，请管理员核对任务。');
    if (result.status === 'succeeded') {
      const bytes: Buffer = await request(`/api/tasks/${encodeURIComponent(task.id)}/image`, { image: true });
      const metadata = await sharp(bytes).metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format || '')) throw new Error('后端返回的图片格式无法预览。');
      preview = { taskId: task.id, bytes, extension: metadata.format === 'jpeg' ? 'jpg' : metadata.format!, dataUrl: `data:image/${metadata.format};base64,${bytes.toString('base64')}` };
      return { taskId: preview.taskId, dataUrl: preview.dataUrl };
    }
    if (!['submitting', 'pending'].includes(result.status)) throw new Error('任务状态未确认，请稍后继续查询。');
    await delay(2000);
  }
  throw new Error('图片仍在生成，任务已保存，请稍后继续查询。');
}
export async function generateImage(input: GenerateImageRequest) {
  token(); // No local-key fallback: all generation requires backend authentication.
  if (busy) throw new Error('已有图片任务正在处理。');
  if (getStore().settings.backendPendingTask) throw new Error('已有待查询任务，请先继续查询或处理结果。');
  if (input?.mode !== 'generate') throw new Error('当前后端 demo 支持文生图。');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.trim().length > IMAGE_PROMPT_LIMIT || !IMAGE_SIZES.includes(input.size as typeof IMAGE_SIZES[number])) throw new Error('请检查图片描述和尺寸。');
  busy = true;
  try {
    const id = randomUUID();
    getStore().settings.backendPendingTask = { id }; await persistStore();
    try { await request('/api/tasks', { body: { id, prompt: input.prompt.trim(), size: input.size } }); }
    catch (error) {
      if (error instanceof BackendError && [400, 401, 402, 403, 409, 413, 503].includes(error.status)) {
        delete getStore().settings.backendPendingTask; await persistStore();
      }
      throw error;
    }
    return await collect();
  } finally { busy = false; }
}
export async function resumeImageTask() {
  token();
  if (busy) throw new Error('已有图片任务正在处理。');
  if (preview) return { taskId: preview.taskId, dataUrl: preview.dataUrl };
  busy = true; try { return await collect(); } finally { busy = false; }
}
export async function discardImageTask() {
  if (busy) throw new Error('请等待当前任务操作结束。');
  // Abandoning the local view never grants a refund or cancels an upstream job.
  delete getStore().settings.backendPendingTask; preview = undefined; await persistStore();
  return getSettings();
}
export async function saveGeneratedImage(taskId: string) {
  token();
  if (busy) throw new Error('已有图片任务正在处理。');
  if (!preview || preview.taskId !== taskId) throw new Error('预览已失效，请继续查询恢复图片。');
  busy = true; let directory: string | undefined;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanzy-server-'));
    const file = path.join(directory, `Fanzy-${taskId}.${preview.extension}`);
    await fs.writeFile(file, preview.bytes);
    const result = await importFiles([file]);
    if (result.errors.length) throw new Error('保存失败，预览已保留，请检查磁盘后重试。');
    delete getStore().settings.backendPendingTask; await persistStore(); preview = undefined;
    return { ...result, imported: result.imported.map(({ originalPath, thumbnailPath, ...asset }) => asset) };
  } finally {
    busy = false;
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
