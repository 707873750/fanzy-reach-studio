import { BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import path from "node:path";
import { findDraft, getAppPaths, getStore, persistStore, updateDraftRecord } from "./store";
import { prepareDraft } from "./draft-service";
import type { BrowserSettings, Draft, Platform } from "../shared/types";
import { postUrl } from "../shared/post-url";

import { log, errorDetail } from "./run-logger";
import { setPerformancePublishing } from "./performance-monitor";
import { publisherCommand, macSessionKey } from "./publisher-runtime";

type Result = { state: "opened" | "succeeded" | "needs_attention" | "uncertain" | "local_scheduled"; message?: string; url?: string };
let busy = false;
const locked = new Set<string>();
let activeBatch: { cancelled: boolean; platforms: Set<Platform>; done: Promise<void>; finish: () => void; shutdown?: Promise<unknown> } | undefined;

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

export function getPublishBatch(): string[] { return activeBatch ? [...locked] : []; }
function notifyBatch() {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("publish:batch", getPublishBatch());
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

function createPlatformClient() {
  let intentionallyStopping = false;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let pending: { resolve: (r: Result) => void; reject: (e: Error) => void; checkpoint: () => Promise<void> } | undefined;
  function getWorker() {
    if (worker) return worker;
    const { command, args } = publisherCommand();
    const sessionKey = macSessionKey();
    const child = spawn(command, args, {
      windowsHide: true, stdio: "pipe", env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });
    worker = child;
    void log({ source: "app", level: "info", step: "python.start", message: "启动 Python Playwright 发布进程" });
    const fail = () => {
      if (worker !== child) return;
      worker = undefined;
      pending?.reject(new Error(intentionallyStopping ? "发布任务已中断，请核对任务状态后再重试。" : "发布进程意外停止，请查看运行日志中的具体错误后重试。"));
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
          if (pending === current && !intentionallyStopping) child.stdin.write(JSON.stringify({ ack: "persisted" }) + "\n");
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
    if (sessionKey) child.stdin.write(JSON.stringify({ action: "configure_session", key: sessionKey }) + "\n");
    return child;
  }

  async function request(payload: { mediaType?: unknown; [key: string]: unknown }, checkpoint = async () => {}) {
    const child = getWorker();
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending = undefined;
        if (worker === child) worker = undefined;
        child.kill();
        void log({ source: "app", level: "error", step: "task.timeout", message: "等待浏览器或 Python 超时，已终止发布进程" });
        reject(new Error("浏览器发布超时，重试前请核对平台和任务状态。"));
      }, payload.mediaType === "video" ? 960_000 : 240_000);
      pending = {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); }, checkpoint
      };
      child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  async function stop(timeout = 90000) {
    intentionallyStopping = true;
    const child = worker;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        child.kill();
        pending?.reject(new Error("发布任务已中断，请核对任务状态后再重试。"));
        pending = undefined;
        resolve();
      }, timeout);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }

  return {request, stop};
}

const clients = new Map<Platform, ReturnType<typeof createPlatformClient>>();
function request(payload: {platform: Platform; [key: string]: unknown}, checkpoint = async () => {}) {
  let client = clients.get(payload.platform);
  if (!client) { client = createPlatformClient(); clients.set(payload.platform, client); }
  return client.request(payload, checkpoint);
}

export async function openPlatformBrowser(platform: Platform) {
  if (!["instagram", "x", "pinterest", "tiktok", "bluesky", "facebook"].includes(platform)) throw new Error("无效的平台");
  if (busy) throw new Error("请等待当前浏览器操作完成");
  busy = true;
  try {
    void log({ source: "app", level: "info", step: "account.inspect", message: "请求打开平台账号页面", platform });
    const result = await request({ action: "login", platform, ...browserOptions() });
    if (result.state !== "opened") throw new Error(result.message || "无法打开浏览器");
  } finally { busy = false; }
}

export async function closePlatformBrowser(platform: Platform) {
  if (!["instagram", "x", "pinterest", "tiktok", "bluesky", "facebook"].includes(platform)) throw new Error("无效的平台");
  if (busy) throw new Error("请等待当前浏览器操作完成");
  busy = true;
  try {
    const result = await request({ action: "close_login", platform, ...browserOptions() });
    if (result.state !== "opened") throw new Error(result.message || "无法关闭登录窗口");
  } finally { busy = false; }
}

export async function publishDrafts(ids: string[], localDue = false) {
  if (busy) throw new Error("已有发布批次正在运行");
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== "string")) throw new Error("请选择 1 至 100 条草稿");
  const drafts = [...new Set(ids)].map((id) => {
    const draft = findDraft(id);
    if (!draft) throw new Error("草稿已不存在");
    if (draft.status === "published" || ["running", "uncertain", "succeeded", "scheduled"].includes(draft.browserPublish?.state || "")) throw new Error("重试前请先核对之前的发布结果");
    const time = Date.parse(draft.publishAt || draft.xScheduledAt || "");
    if (localDue && (draft.status !== "local_scheduled" || !Number.isFinite(time) || time > Date.now())) throw new Error("本地任务尚未到期");
    if (!localDue && draft.status === "local_scheduled") throw new Error("任务已进入本地队列，请取消后重新提交");
    if (!localDue && (draft.publishAt || draft.xScheduledAt) && (!Number.isFinite(time) || time < Date.now()+300000)) throw new Error("定时发布时间必须至少在 5 分钟以后");
    return draft;
  });
  busy = true;
  let finish!: () => void;
  const batch = { cancelled: false, platforms: new Set<Platform>(), done: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish(), shutdown: undefined as Promise<unknown> | undefined };
  activeBatch = batch;
  drafts.forEach((draft) => locked.add(draft.id));
  notifyBatch();
  setPerformancePublishing(true);
  void log({ source: "app", level: "info", step: "batch.start", message: `开始跨平台并行发布，共 ${drafts.length} 条草稿；同平台依次执行` });
  const blocked = new Set<Platform>();
  const groups = new Map<Platform, Draft[]>();
  for (const draft of drafts) groups.set(draft.platform, [...(groups.get(draft.platform) || []), draft]);
  try {
    const results = await Promise.allSettled([...groups.values()].map(async platformDrafts => {
      for (const draft of platformDrafts) {
        if (batch.cancelled) {
          await record(draft.id, "needs_attention", "本次发布已停止，此任务尚未提交，可重新选择发布。");
          continue;
        }
        if (blocked.has(draft.platform)) {
          await record(draft.id, "needs_attention", "此平台的上一条任务需要处理，当前任务尚未提交。");
          continue;
        }
        let submittedAt: string | undefined;
        try {
          const publishAt = draft.publishAt || draft.xScheduledAt;
          if (!localDue && publishAt && ["tiktok", "bluesky", "facebook"].includes(draft.platform)) {
            updateDraftRecord(draft.id, {status:"local_scheduled", publishAt, scheduleMode:"local", browserPublish:undefined});
            await persistStore(); notify(draft); continue;
          }
          const nativeScheduledAt = !localDue ? publishAt : null;
          updateDraftRecord(draft.id, {scheduleMode: nativeScheduledAt ? "native" : localDue ? "local" : null});
          if (localDue) updateDraftRecord(draft.id, {status:"ready"});
          await record(draft.id, "running", "正在准备素材并打开平台…");
          if (batch.cancelled) throw new Error("本次发布已停止，此任务尚未提交。");
          const { files, mediaType } = await prepareDraft(draft.id, false);
          if (batch.cancelled) throw new Error("本次发布已停止，此任务尚未提交。");
          void log({ source: "app", level: "info", step: "images.prepared", message: `已准备 ${draft.imageIds.length} 项平台素材`, draftId: draft.id, platform: draft.platform });
          if (files.length !== draft.imageIds.length) throw new Error("已准备的素材数量与草稿不一致");
          batch.platforms.add(draft.platform);
          const result = await request({ action: "publish", ...draft, mediaType, xScheduledAt: draft.platform === "x" ? nativeScheduledAt : null, nativeScheduledAt, files, ...browserOptions() }, async () => {
            if (batch.cancelled) throw new Error("本次发布已停止，未允许提交。");
            submittedAt = new Date().toISOString();
            await record(draft.id, "uncertain", "正在提交，确认结果前请勿重试。", submittedAt);
          });
          if (result.state === "local_scheduled" && nativeScheduledAt && !submittedAt) {
            updateDraftRecord(draft.id, {status:"local_scheduled", publishAt:nativeScheduledAt, scheduleMode:"local", browserPublish:undefined});
            await persistStore(); notify(draft);
            void log({source:"app",level:"info",step:"schedule.local",message:result.message || "无可用原生排程，已转为本地定时",draftId:draft.id,platform:draft.platform});
          } else if (result.state === "succeeded") {
            updateDraftRecord(draft.id, { status: nativeScheduledAt ? "platform_scheduled" : "published", publishedUrl: nativeScheduledAt ? null : postUrl(draft.platform, result.url) });
            await record(draft.id, nativeScheduledAt ? "scheduled" : "succeeded", result.message || "发布成功", submittedAt);
          } else {
            await record(draft.id, submittedAt ? "uncertain" : "needs_attention", result.message || "请检查浏览器页面", submittedAt);
            blocked.add(draft.platform);
          }
        } catch (error) {
          void log({ source: "app", level: submittedAt ? "warn" : "error", step: submittedAt ? "task.uncertain" : "task.failed", message: submittedAt ? "已提交，结果待确认" : "发布任务失败", detail: errorDetail(error), draftId: draft.id, platform: draft.platform });
          await record(draft.id, submittedAt ? "uncertain" : "needs_attention", batch.cancelled ? submittedAt ? "发布已中断，提交结果待确认，请到平台核对后再操作。" : "本次发布已停止，此任务尚未提交，可重新选择发布。" : submittedAt ? "已提交，结果待确认" : error instanceof Error ? error.message : "浏览器操作失败", submittedAt);
          blocked.add(draft.platform);
        }
      }
    }));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
    return drafts;
  } finally {
    await batch.shutdown;
    locked.clear(); busy = false; activeBatch = undefined; batch.finish();
    notifyBatch();
    setPerformancePublishing(false);
    void log({ source: "app", level: "info", step: "batch.finished", message: `批次${batch.cancelled ? "已停止" : "结束"}：${drafts.filter(d => d.status === "published").length}/${drafts.length} 已发布` });
  }
}

export async function cancelPublishBatch() {
  const batch = activeBatch;
  if (!batch) return;
  if (!batch.cancelled) {
    batch.cancelled = true;
    void log({ source: "app", level: "warn", step: "batch.cancel", message: "用户停止本次发布；已提交的任务需要核对平台结果。" });
    const running = [...batch.platforms].flatMap(platform => {
      const client = clients.get(platform);
      clients.delete(platform);
      return client ? [client] : [];
    });
    batch.shutdown = Promise.all(running.map(client => client.stop(10000)));
  }
  await batch.done;
}

export async function resolvePublish(id: string, published: boolean) {
  assertNotPublishing(id);
  if (typeof published !== "boolean") throw new Error("无效的核对结果");
  const draft = findDraft(id);
  if (!draft || draft.browserPublish?.state !== "uncertain") throw new Error("没有待核对的发布任务");
  if (published) {
    const native = draft.scheduleMode === "native" || (!draft.scheduleMode && draft.xScheduledAt);
    updateDraftRecord(id, { status: native ? "platform_scheduled" : "published" });
    await record(id, native ? "scheduled" : "succeeded", native ? "用户已在平台确认排程存在。" : "用户已手动确认发布成功。");
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


let stopping = false;
export async function runDueScheduledDrafts() {
  if (busy || stopping) return;
  const due = getStore().drafts.filter(draft => draft.status === "local_scheduled" && !draft.browserPublish &&
    Number.isFinite(Date.parse(draft.publishAt || "")) && Date.parse(draft.publishAt!) <= Date.now()).slice(0,100);
  if (!due.length) return;
  try { await publishDrafts(due.map(draft => draft.id), true); }
  catch (error) { void log({source:"app",level:"error",step:"schedule.failed",message:"本地定时执行失败，请检查任务状态",detail:errorDetail(error)}); }
}

export async function stopPublisher() {
  stopping = true;
  await Promise.all([...clients.values()].map(client => client.stop()));
  clients.clear();
}
