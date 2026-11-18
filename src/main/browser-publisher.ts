import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { findDraft, getAppPaths, getStore, persistStore, updateDraftRecord } from "./store";
import { prepareDraft } from "./draft-service";
import type { Draft, Platform } from "../shared/types";

type Result = { state: "opened" | "succeeded" | "needs_attention" | "uncertain"; message?: string; url?: string };
let worker: ChildProcessWithoutNullStreams | undefined;
let pending: { resolve: (r: Result) => void; reject: (e: Error) => void; checkpoint: () => Promise<void> } | undefined;
let busy = false;
const locked = new Set<string>();

export function assertNotPublishing(id: string) {
  if (locked.has(id)) throw new Error("This draft is in the publishing queue. Wait for the batch to finish.");
}

function notify(draft: Draft) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("publish:progress", draft);
}

async function record(id: string, state: NonNullable<Draft["browserPublish"]>["state"], message: string, submittedAt?: string) {
  const draft = updateDraftRecord(id, { browserPublish: { state, message, submittedAt } });
  await persistStore();
  notify(draft);
}

function getWorker() {
  if (worker) return worker;
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const localPython = path.join(base, ".venv", "Scripts", "python.exe");
  const configured = process.env.FANZY_PYTHON || (existsSync(localPython) ? localPython : undefined);
  const child = spawn(configured || "py", [...(configured ? [] : ["-3"]), "-u", path.join(base, "python", "publisher.py"), path.join(getAppPaths().base, "browser-profiles")], {
    windowsHide: true, stdio: "pipe", env: { ...process.env, PYTHONIOENCODING: "utf-8" }
  });
  worker = child;
  const fail = () => {
    if (worker !== child) return;
    worker = undefined;
    pending?.reject(new Error("Python publisher stopped. Install Python 3.10+, python/requirements.txt and Microsoft Edge. Set FANZY_PYTHON to the interpreter path if needed."));
    pending = undefined;
  };
  child.on("error", fail);
  child.on("exit", fail);
  child.stdin.on("error", fail);
  child.stderr.resume(); // never forward browser diagnostics containing user data
  createInterface({ input: child.stdout }).on("line", (line) => {
    void (async () => {
      if (!pending) return;
      const message = JSON.parse(line);
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
    })().catch((error) => { pending?.reject(error); pending = undefined; child.kill(); });
  });
  return child;
}

async function request(payload: object, checkpoint = async () => {}) {
  const child = getWorker();
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = undefined;
      child.kill();
      reject(new Error("Browser publishing timed out. Review the browser and task status before retrying."));
    }, 240_000);
    pending = {
      resolve: (result) => { clearTimeout(timer); resolve(result); },
      reject: (error) => { clearTimeout(timer); reject(error); }, checkpoint
    };
    child.stdin.write(JSON.stringify(payload) + "\n");
  });
}

export async function openPlatformBrowser(platform: Platform) {
  if (!["instagram", "x", "pinterest"].includes(platform)) throw new Error("Invalid platform");
  if (busy) throw new Error("Wait for the current browser operation to finish");
  busy = true;
  try {
    const result = await request({ action: "login", platform });
    if (result.state !== "opened") throw new Error(result.message || "Could not open browser");
  } finally { busy = false; }
}

export async function publishDrafts(ids: string[]) {
  if (busy) throw new Error("A publishing batch is already running");
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== "string")) throw new Error("Select 1–100 drafts");
  const drafts = [...new Set(ids)].map((id) => {
    const draft = findDraft(id);
    if (!draft) throw new Error("Draft no longer exists");
    if (draft.status === "published" || ["running", "uncertain", "succeeded"].includes(draft.browserPublish?.state || "")) throw new Error("Resolve previous publication results before retrying");
    return draft;
  });
  busy = true;
  drafts.forEach((draft) => locked.add(draft.id));
  const blocked = new Set<Platform>();
  try {
    for (const draft of drafts) {
      if (blocked.has(draft.platform)) {
        await record(draft.id, "needs_attention", "An earlier task on this platform needs attention. This task was not submitted.");
        continue;
      }
      let submittedAt: string | undefined;
      try {
        await record(draft.id, "running", "Preparing images and opening platform…");
        const { folder } = await prepareDraft(draft.id, false);
        const files = (await fs.readdir(folder)).filter((file) => /^\d+-.*\.jpg$/.test(file)).sort().map((file) => path.join(folder, file));
        if (files.length !== draft.imageIds.length) throw new Error("Prepared image count does not match draft");
        const result = await request({ action: "publish", ...draft, files }, async () => {
          submittedAt = new Date().toISOString();
          await record(draft.id, "uncertain", "Submitting. Do not retry until the result is verified.", submittedAt);
        });
        if (result.state === "succeeded") {
          updateDraftRecord(draft.id, { status: "published", publishedUrl: result.url || null });
          await record(draft.id, "succeeded", result.message || "Published", submittedAt);
        } else {
          await record(draft.id, submittedAt ? "uncertain" : "needs_attention", result.message || "Review browser", submittedAt);
          blocked.add(draft.platform);
        }
      } catch (error) {
        await record(draft.id, submittedAt ? "uncertain" : "needs_attention", error instanceof Error ? error.message : "Browser operation failed", submittedAt);
        blocked.add(draft.platform);
      }
    }
    return drafts;
  } finally { locked.clear(); busy = false; }
}

export async function resolvePublish(id: string, published: boolean) {
  assertNotPublishing(id);
  if (typeof published !== "boolean") throw new Error("Invalid resolution");
  const draft = findDraft(id);
  if (!draft || draft.browserPublish?.state !== "uncertain") throw new Error("No uncertain publication to resolve");
  if (published) {
    updateDraftRecord(id, { status: "published" });
    await record(id, "succeeded", "Publication confirmed manually by the user.");
  } else {
    await record(id, "needs_attention", "User verified that no post was published. Retry is now available.");
  }
}

export async function recoverPublishing() {
  for (const draft of getStore().drafts) {
    if (draft.browserPublish?.state === "running") {
      draft.browserPublish = { state: "needs_attention", message: "App closed before submission. Review the browser before retrying." };
    }
  }
  await persistStore();
}

export function stopPublisher() { worker?.kill(); }
