import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { findDraft, getAppPaths, getStore, persistStore, updateDraftRecord } from "./store";
import { prepareDraft } from "./draft-service";
import type { BrowserSettings, Draft, Platform } from "../shared/types";

import { log, errorDetail } from "./run-logger";
import { setPerformancePublishing } from "./performance-monitor";

type Result = { state: "opened" | "succeeded" | "needs_attention" | "uncertain"; message?: string; url?: string };
let worker: ChildProcessWithoutNullStreams | undefined;
let pending: { resolve: (r: Result) => void; reject: (e: Error) => void; checkpoint: () => Promise<void> } | undefined;
let busy = false;
const locked = new Set<string>();

export function getBrowserSettings(): BrowserSettings {
  return { showBrowser: getStore().settings.showBrowser === true, channel: "chrome" };
}
export async function saveBrowserSettings(value: BrowserSettings) {
  if (busy) throw new Error("请等待当前浏览器操作完成");
  if (typeof value.showBrowser !== "boolean" || value.channel !== "chrome") throw new Error("登录和发布统一使用 Google Chrome");
  getStore().settings.showBrowser = value.showBrowser;
  getStore().settings.browserChannel = value.channel;
  await persistStore();
  return getBrowserSettings();
}
function browserOptions() {
  return { ...getBrowserSettings(), profilesRoot: path.join(getAppPaths().base, "browser-profiles"), artifactsRoot: path.join(getAppPaths().base, "logs", "screenshots") };
}

export function assertNotPublishing(id: string) {
  if (locked.has(id)) throw new Error("草稿正在发布队列中，请等待当前批次完成。");
}

function notify(draft: Draft) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("publish:progress", draft);
}

async function record(id: string, state: NonNullable<Draft["browserPublish"]>["state"], message: string, submittedAt?: string) {
  const draft = updateDraftRecord(id, { browserPublish: { state, message, submittedAt } });
  await persistStore();
  void log({ source: "app", level: state === "uncertain" || state === "needs_attention" ? "warn" : "info", step: `task.${state}`, message, draftId: id, platform: draft.platform });
  notify(draft);
}

function getWorker() {
  if (worker) return worker;
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const localPython = path.join(base, ".venv", "Scripts", "python.exe");
  const configured = process.env.FANZY_PYTHON || (existsSync(localPython) ? localPython : undefined);
  const child = spawn(configured || "py", [...(configured ? [] : ["-3"]), "-u", path.join(base, "python", "publisher.py")], {
    windowsHide: true, stdio: "pipe", env: { ...process.env, PYTHONIOENCODING: "utf-8" }
  });
  worker = child;
  void log({ source: "app", level: "info", step: "python.start", message: "启动 Python Playwright 发布进程" });
  const fail = () => {
    if (worker !== child) return;
    worker = undefined;
    pending?.reject(new Error("Python 发布进程已停止，请检查 Python 3.10 及以上版本和 Playwright 安装，必要时通过 FANZY_PYTHON 设置解释器路径。"));
    pending = undefined;
  };
  child.on("error", error => { void log({ source: "app", level: "error", step: "python.spawn_failed", message: "Python 启动失败", detail: errorDetail(error) }); fail(); });
  child.on("exit", (code, signal) => { void log({ source: "python", level: code === 0 ? "info" : "error", step: "python.exit", message: `Python 进程退出，退出码：${code}，信号：${signal || "无"}` }); fail(); });
  child.stdin.on("error", error => { void log({ source: "app", level: "error", step: "python.pipe_error", message: "Python 通信管道错误", detail: errorDetail(error) }); fail(); });
  createInterface({ input: child.stderr }).on("line", line => { void log({ source: "python", level: "error", step: "python.stderr", message: line }); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    void (async () => {
      if (worker !== child) return;
      const message = JSON.parse(line);
      if (message.type === "log") {
        void log({ source: ["page", "extension"].includes(message.source) ? message.source : "python", level: ["warn", "error"].includes(message.level) ? message.level : "info",
          step: String(message.step || "python.event"), message: String(message.message || ""), detail: typeof message.detail === "string" ? message.detail : undefined,
          draftId: message.draftId, jobId: message.jobId, platform: message.platform });
        return;
      }
      if (!pending) return;
      if (message.type === "submitting") {
        const current = pending;
        await current.checkpoint();
        if (pending === current) child.stdin.write(JSON.stringify({ ack: "persisted" }) + "\n");
      } else if (message.type === "result") {
        const current = pending;
        pending = undefined;
        current.resolve(message);
      } else if (message.type === "fatal") {
        throw new Error(message.message);
      }
    })().catch((error) => {
      if (worker !== child) return;
      worker = undefined;
      void log({ source: "app", level: "error", step: "python.protocol_error", message: "Python 通信处理失败", detail: errorDetail(error) });
      pending?.reject(error); pending = undefined; child.kill();
    });
  });
  return child;
}

async function request(payload: object, checkpoint = async () => {}) {
  const child = getWorker();
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = undefined;
      if (worker === child) worker = undefined;
      child.kill();
      void log({ source: "app", level: "error", step: "task.timeout", message: "等待浏览器或 Python 超时，已终止发布进程" });
      reject(new Error("浏览器发布超时，重试前请核对平台和任务状态。"));
    }, 240_000);
    pending = {
      resolve: (result) => { clearTimeout(timer); resolve(result); },
      reject: (error) => { clearTimeout(timer); reject(error); }, checkpoint
    };
    child.stdin.write(JSON.stringify(payload) + "\n");
  });
}

export async function openPlatformBrowser(platform: Platform) {
  if (!["instagram", "x", "pinterest", "tiktok"].includes(platform)) throw new Error("无效的平台");
  if (busy) throw new Error("请等待当前浏览器操作完成");
  busy = true;
  try {
    void log({ source: "app", level: "info", step: "account.inspect", message: "请求打开平台账号页面", platform });
    const result = await request({ action: "login", platform, ...browserOptions() });
    if (result.state !== "opened") throw new Error(result.message || "无法打开浏览器");
  } finally { busy = false; }
}

export async function closePlatformBrowser(platform: Platform) {
  if (!["instagram", "x", "pinterest", "tiktok"].includes(platform)) throw new Error("无效的平台");
  if (busy) throw new Error("请等待当前浏览器操作完成");
  busy = true;
  try {
    const result = await request({ action: "close_login", platform, ...browserOptions() });
    if (result.state !== "opened") throw new Error(result.message || "无法关闭登录窗口");
  } finally { busy = false; }
}

export async function publishDrafts(ids: string[]) {
  if (busy) throw new Error("已有发布批次正在运行");
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== "string")) throw new Error("请选择 1 至 100 条草稿");
  const drafts = [...new Set(ids)].map((id) => {
    const draft = findDraft(id);
    if (!draft) throw new Error("草稿已不存在");
    if (draft.status === "published" || ["running", "uncertain", "succeeded", "scheduled"].includes(draft.browserPublish?.state || "")) throw new Error("重试前请先核对之前的发布结果");
    if (draft.xScheduledAt && (draft.platform !== "x" || !Number.isFinite(Date.parse(draft.xScheduledAt)) || Date.parse(draft.xScheduledAt) < Date.now()+300000)) throw new Error("X 定时发布时间必须至少在 5 分钟以后，请重新设置");
    return draft;
  });
  busy = true;
  drafts.forEach((draft) => locked.add(draft.id));
  setPerformancePublishing(true);
  void log({ source: "app", level: "info", step: "batch.start", message: `开始批量发布，共 ${drafts.length} 条草稿` });
  const blocked = new Set<Platform>();
  try {
    for (const draft of drafts) {
      if (blocked.has(draft.platform)) {
        await record(draft.id, "needs_attention", "此平台的上一条任务需要处理，当前任务尚未提交。");
        continue;
      }
      let submittedAt: string | undefined;
      try {
        await record(draft.id, "running", "正在准备图片并打开平台…");
        const { folder } = await prepareDraft(draft.id, false);
        void log({ source: "app", level: "info", step: "images.prepared", message: `已准备 ${draft.imageIds.length} 张平台图片`, draftId: draft.id, platform: draft.platform });
        const files = (await fs.readdir(folder)).filter((file) => /^\d+-.*\.jpg$/.test(file)).sort().map((file) => path.join(folder, file));
        if (files.length !== draft.imageIds.length) throw new Error("已准备的图片数量与草稿不一致");
        const result = await request({ action: "publish", ...draft, files, ...browserOptions() }, async () => {
          submittedAt = new Date().toISOString();
          await record(draft.id, "uncertain", "正在提交，确认结果前请勿重试。", submittedAt);
        });
        if (result.state === "succeeded") {
          updateDraftRecord(draft.id, { status: draft.xScheduledAt ? "platform_scheduled" : "published", publishedUrl: result.url || null });
          await record(draft.id, draft.xScheduledAt ? "scheduled" : "succeeded", result.message || "发布成功", submittedAt);
        } else {
          await record(draft.id, submittedAt ? "uncertain" : "needs_attention", result.message || "请检查浏览器页面", submittedAt);
          blocked.add(draft.platform);
        }
      } catch (error) {
        void log({ source: "app", level: submittedAt ? "warn" : "error", step: submittedAt ? "task.uncertain" : "task.failed", message: submittedAt ? "已提交，结果待确认" : "发布任务失败", detail: errorDetail(error), draftId: draft.id, platform: draft.platform });
        await record(draft.id, submittedAt ? "uncertain" : "needs_attention", submittedAt ? "已提交，结果待确认" : error instanceof Error ? error.message : "浏览器操作失败", submittedAt);
        blocked.add(draft.platform);
      }
    }
    return drafts;
  } finally { locked.clear(); busy = false; setPerformancePublishing(false); void log({ source: "app", level: "info", step: "batch.finished", message: `批次结束：${drafts.filter(d => d.status === "published").length}/${drafts.length} 已发布` }); }
}

export async function resolvePublish(id: string, published: boolean) {
  assertNotPublishing(id);
  if (typeof published !== "boolean") throw new Error("无效的核对结果");
  const draft = findDraft(id);
  if (!draft || draft.browserPublish?.state !== "uncertain") throw new Error("没有待核对的发布任务");
  if (published) {
    updateDraftRecord(id, { status: draft.xScheduledAt ? "platform_scheduled" : "published" });
    await record(id, draft.xScheduledAt ? "scheduled" : "succeeded", draft.xScheduledAt ? "用户已在 X 确认排程存在。" : "用户已手动确认发布成功。");
  } else {
    await record(id, "needs_attention", "用户已确认未发布，现在可以重试。");
  }
}

export async function recoverPublishing() {
  for (const draft of getStore().drafts) {
    if (draft.browserPublish?.state === "running") {
      draft.browserPublish = { state: "needs_attention", message: "程序在提交前关闭，重试前请核对浏览器。" };
    }
  }
  await persistStore();
}

export async function stopPublisher() {
  const child = worker;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 90000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
}
