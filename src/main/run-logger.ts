import { app, BrowserWindow } from "electron";
import path from "node:path";
import { LogStore, type LogInput } from "./log-store";

let store: LogStore;
export async function initLogs() {
  store = new LogStore(path.join(app.getPath("userData"), "logs"), entry => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("logs:entry", entry);
  });
  await store.init();
  await log({ source: "app", level: "info", step: "app.start", message: `程序启动 v${app.getVersion()}` });
}
export function log(input: LogInput) { return store?.write(input) || Promise.resolve(); }
export function protectLogSecret(value: string) { store?.protect(value); }
export function getLogs() { return store.snapshot(); }
export function flushLogs() { return store?.flush() || Promise.resolve(); }
export function errorDetail(error: unknown) { return error instanceof Error ? error.stack || error.message : String(error); }
