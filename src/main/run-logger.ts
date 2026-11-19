import { app, BrowserWindow } from "electron";
import path from "node:path";
import { LogStore, type LogInput } from "./log-store";

let store: LogStore;
let samples: LogStore;
const isSample = (step: string) => ["performance.ui", "performance.desktop", "performance.sample"].includes(step);
export async function initLogs() {
  store = new LogStore(path.join(app.getPath("userData"), "logs"), entry => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("logs:entry", entry);
  });
  await store.init(entry => !isSample(entry.step));
  samples = new LogStore(path.join(app.getPath("userData"), "logs", "performance"), entry => {
    if (entry.step === "logs.write_failed") void store.write({source:"app",level:"error",step:"logs.samples_write_failed",message:"性能采样日志写入失败",detail:entry.detail});
  });
  await samples.init();
  await log({ source: "app", level: "info", step: "app.start", message: `程序启动 v${app.getVersion()}` });
}
export function log(input: LogInput) { return (isSample(input.step) ? samples : store)?.write(input) || Promise.resolve(); }
export function protectLogSecret(value: string) { store?.protect(value); samples?.protect(value); }
export function getLogs() { return store.snapshot(); }
export async function flushLogs() { await samples?.flush(); await store?.flush(); }
export function errorDetail(error: unknown) { return error instanceof Error ? error.stack || error.message : String(error); }
