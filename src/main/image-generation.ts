import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { setTimeout as delay } from "node:timers/promises";
import { getStore, persistStore, findImage } from "./store";
import { getSettings } from "./ai-service";
import { importFiles } from "./image-service";
import { IMAGE_SIZES, IMAGE_PROMPT_LIMIT, type GenerateImageRequest } from "../shared/image-generation";
import { signVisualRequest } from "./volc-signing";

let generating = false;
let editUpload: { id: string; bytes: Buffer } | undefined;

export async function normalizeEditImage(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > 5 * 1024 * 1024) throw new Error("底图不能超过 5 MB。");
  let metadata: sharp.Metadata;
  try { metadata = await sharp(bytes).metadata(); }
  catch { throw new Error("无法读取图片内容，文件可能损坏或格式不受支持。请重新导出为 PNG/JPEG 后上传。"); }
  const { width = 0, height = 0, format, pages = 1 } = metadata;
  if (pages > 1) throw new Error("暂不支持动态或多页底图，请先导出一张静态图片。");
  if (!["jpeg", "png", "webp", "avif", "heif", "gif", "tiff"].includes(format || "")) throw new Error(`检测到实际格式为 ${format || "未知"}，请导出为 PNG/JPEG 后上传；仅修改扩展名不会转换格式。`);
  if (!width || !height || width > 4096 || height > 4096 || Math.max(width / height, height / width) > 3) throw new Error("底图宽高不能超过 4096，长短边比例不能超过 3。");
  if (format === "jpeg" || format === "png") return bytes;
  let converted: Buffer;
  try { converted = await sharp(bytes).rotate().png().toBuffer(); }
  catch { throw new Error(`无法将 ${format} 图片转换成 PNG，请在图片软件中导出为 PNG/JPEG 后上传。`); }
  if (converted.length > 5 * 1024 * 1024) throw new Error("图片转成 PNG 后超过 5 MB，请压缩或导出为 JPEG 后上传。");
  return converted;
}

// Called only with a native file-picker result, never a renderer-supplied path.
export async function loadEditImage(filePath: string) {
  if (generating) throw new Error("请等待当前图片任务完成。");
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("请选择图片文件。");
  if (stat.size > 5 * 1024 * 1024) throw new Error("底图不能超过 5 MB。");
  const bytes = await normalizeEditImage(await fs.readFile(filePath));
  const thumbnail = await sharp(bytes).rotate().resize(440, 360, { fit: "inside", withoutEnlargement: true }).webp().toBuffer();
  const id = randomUUID();
  editUpload = { id, bytes };
  return { id, fileName: path.basename(filePath), thumbnailDataUrl: `data:image/webp;base64,${thumbnail.toString("base64")}` };
}
let preview: { taskId: string; bytes: Buffer; dataUrl: string } | undefined;
export function getGeneratedImage() {
  return preview ? { taskId: preview.taskId, dataUrl: preview.dataUrl } : null;
}
export async function saveGeneratedImage(taskId: string) {
  if (generating) throw new Error("已有图片任务正在处理。");
  if (!preview || preview.taskId !== taskId) throw new Error("预览已失效，请重新查询任务。");
  generating = true;
  let temporary: string | undefined;
  try {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "fanzy-volc-"));
    const file = path.join(temporary, `Volc-${taskId}.jpg`);
    await fs.writeFile(file, preview.bytes);
    const result = await importFiles([file]);
    if (result.errors.length) throw new Error("图片保存失败，请检查磁盘后再次保存，预览已保留。");
    delete getStore().settings.volcPendingTask;
    await persistStore();
    preview = undefined;
    return { ...result, imported: result.imported.map(({ originalPath, thumbnailPath, ...asset }) => asset) };
  } finally {
    generating = false;
    if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}
const MAX_BYTES = 20 * 1024 * 1024;
const KEYS = { generate: "high_aes_general_v30l_zt2i", edit: "seededit_v3.0" };

export async function saveVolcKeys(ak: unknown, sk: unknown) {
  for (const value of [ak, sk]) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 512 || /\s/.test(value.trim())) throw new Error("请输入有效的火山 Access Key ID 和 Secret Access Key。");
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，无法保存密钥。");
  getStore().settings.volcKeysEncrypted = safeStorage.encryptString(JSON.stringify({ ak: (ak as string).trim(), sk: (sk as string).trim() })).toString("base64");
  await persistStore();
  return getSettings();
}
export async function clearVolcKeys() {
  if (generating) throw new Error("请等待当前图片任务完成后移除密钥。");
  delete getStore().settings.volcKeysEncrypted;
  await persistStore();
  return getSettings();
}
function credentials(): { ak: string; sk: string } {
  const encrypted = getStore().settings.volcKeysEncrypted;
  if (!encrypted) throw new Error("请先在设置中保存火山引擎 AK/SK，并开通视觉智能服务。");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用。");
  try { return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "base64"))); }
  catch { throw new Error("无法读取火山密钥，请在设置中重新保存。"); }
}
async function request(action: string, data: object, keys: { ak: string; sk: string }) {
  const body = JSON.stringify(data);
  const signed = signVisualRequest(action, body, keys.ak, keys.sk);
  let response: Response;
  let payload: any;
  try {
    response = await fetch(signed.url, { method: "POST", headers: signed.headers, body, redirect: "error", signal: AbortSignal.timeout(45_000) });
    if (!response.body) throw new Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      length += chunk.length;
      if (length > 30 * 1024 * 1024) throw new Error();
      chunks.push(chunk);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error(action === "CVSync2AsyncSubmitTask" ? "火山任务提交响应未确认，请先在控制台核对调用记录，避免重复生成。" : "查询火山任务失败，请检查网络后点击「继续查询」，无需重新生成。");
  }
  if (!response.ok || payload.code !== 10000) {
    const code = String(payload.code ?? payload.ResponseMetadata?.Error?.Code ?? response.status).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const hint = response.status === 401 || response.status === 403 ? "请检查 AK/SK、视觉智能权限及服务开通状态。" : response.status === 429 ? "请求限流，请稍后重试查询。" : [50411, 50412, 50413, 50511, 50512].includes(payload.code) ? "图片或文字未通过服务审核，请调整内容。" : "请检查服务权限、可用额度及请求参数。";
    throw new Error(`火山接口返回错误（${code}）。${hint}`);
  }
  return payload.data;
}
async function collect(keys: { ak: string; sk: string }) {
  const task = getStore().settings.volcPendingTask;
  if (!task) throw new Error("没有待查询的图片任务。");
  for (let attempt = 0; attempt < 90; attempt++) {
    const data = await request("CVSync2AsyncGetResult", { req_key: task.reqKey, task_id: task.id, req_json: JSON.stringify({ return_url: false }) }, keys);
    if (data?.status === "not_found" || data?.status === "expired") {
      delete getStore().settings.volcPendingTask;
      await persistStore();
      throw new Error("图片任务已过期或不存在，请重新生成。");
    }
    if (data?.status === "done") {
      const encoded = data.binary_data_base64?.[0];
      if (typeof encoded !== "string" || !encoded.length || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("火山未返回有效图片数据，请核对任务结果。");
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("生成图片超过本地保存上限。");
      const metadata = await sharp(bytes).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || "")) throw new Error("无法预览返回的图片格式。");
      preview = { taskId: task.id, bytes, dataUrl: `data:image/${metadata.format};base64,${encoded}` };
      return { taskId: preview.taskId, dataUrl: preview.dataUrl };
    }
    if (!["in_queue", "generating"].includes(data?.status)) throw new Error("火山返回未知任务状态，任务已保留，请稍后继续查询。");
    await delay(2000);
  }
  throw new Error("任务仍在处理中，已保存任务记录，请稍后点击「继续查询」。");
}
export async function resumeImageTask() {
  if (generating) throw new Error("已有图片任务正在处理。");
  if (preview) return { taskId: preview.taskId, dataUrl: preview.dataUrl };
  const keys = credentials();
  generating = true;
  try { return await collect(keys); } finally { generating = false; }
}
export async function discardImageTask() {
  if (generating) throw new Error("请等待当前查询结束。");
  delete getStore().settings.volcPendingTask;
  await persistStore();
  preview = undefined;
  return getSettings();
}
export async function generateImage(input: GenerateImageRequest) {
  if (!input || !["generate", "edit"].includes(input.mode)) throw new Error("请选择文生图或图片编辑。");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.trim().length > IMAGE_PROMPT_LIMIT) throw new Error(`请输入 1–${IMAGE_PROMPT_LIMIT} 字符的描述。`);
  if (generating) throw new Error("已有图片任务正在处理。");
  if (getStore().settings.volcPendingTask) throw new Error("已有待查询任务，请先继续查询或放弃该任务记录。");
  const keys = credentials();
  generating = true;
  try {
    const body: Record<string, unknown> = { req_key: KEYS[input.mode], prompt: input.prompt.trim(), seed: -1 };
    if (input.mode === "generate") {
      if (!IMAGE_SIZES.includes(input.size as typeof IMAGE_SIZES[number])) throw new Error("不支持的图片尺寸。");
      [body.width, body.height] = input.size.split("x").map(Number);
    } else {
      let bytes: Buffer;
      if (input.uploadId !== undefined) {
        if (typeof input.uploadId !== "string" || !editUpload || input.uploadId !== editUpload.id) throw new Error("本地底图已失效，请重新上传。");
        bytes = editUpload.bytes;
      } else {
      if (typeof input.imageId !== "string") throw new Error("请选择一张底图。");
      const image = findImage(input.imageId);
      if (!image || !["image/jpeg", "image/png"].includes(image.mimeType)) throw new Error("底图只支持素材库中的 JPEG 或 PNG 图片。");
      const stat = await fs.stat(image.originalPath);
      if (stat.size > 5 * 1024 * 1024) throw new Error("底图不能超过 5 MB。");
        bytes = await fs.readFile(image.originalPath);
      }
      bytes = await normalizeEditImage(bytes);
      const scale = input.scale ?? 0.5;
      if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0 || scale > 1) throw new Error("编辑强度必须在 0 到 1 之间。");
      body.binary_data_base64 = [bytes.toString("base64")];
      body.scale = scale;
    }
    const data = await request("CVSync2AsyncSubmitTask", body, keys);
    if (typeof data?.task_id !== "string" || !/^[\w-]{1,128}$/.test(data.task_id)) throw new Error("火山未返回有效任务编号，请在控制台核对调用记录。");
    getStore().settings.volcPendingTask = { id: data.task_id, reqKey: KEYS[input.mode] };
    await persistStore();
    return await collect(keys);
  } finally { generating = false; }
}
