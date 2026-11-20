import { app, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

export function publisherCommand() {
  if (app.isPackaged) {
    const command = path.join(process.resourcesPath, "publisher", process.platform === "win32" ? "fanzy-publisher.exe" : "fanzy-publisher");
    if (!existsSync(command)) throw new Error("安装包缺少发布组件，请重新安装完整版本。");
    return { command, args: [] as string[] };
  }
  const base = app.getAppPath();
  const localPython = path.join(base, ".venv", ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
  const configured = process.env.FANZY_PYTHON || (existsSync(localPython) ? localPython : undefined);
  return {
    command: configured || (process.platform === "win32" ? "py" : "python3"),
    args: [...(!configured && process.platform === "win32" ? ["-3"] : []), "-u", path.join(base, "python", "publisher.py")]
  };
}

// The application has a single-instance lock. All platform workers share this
// key; only the OS-encrypted value is persisted, never the plaintext key.
export function macSessionKey(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  if (!safeStorage.isEncryptionAvailable()) throw new Error("无法访问 macOS 钥匙串，请解锁钥匙串后重试。");
  const base = app.getPath("userData");
  const file = path.join(base, "session-key.enc");
  if (existsSync(file)) return safeStorage.decryptString(readFileSync(file));
  const key = randomBytes(32).toString("base64");
  mkdirSync(base, { recursive: true });
  const temporary = file + ".tmp";
  writeFileSync(temporary, safeStorage.encryptString(key), { mode: 0o600 });
  renameSync(temporary, file);
  return key;
}
