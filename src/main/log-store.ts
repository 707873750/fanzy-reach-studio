import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { RunLog, LogSnapshot } from "../shared/types";

export type LogInput = Omit<RunLog, "id" | "time" | "sessionId">;

export class LogStore {
  private entries: RunLog[] = [];
  private chain: Promise<void> = Promise.resolve();
  private bytes = 0;
  private secrets = new Set<string>();
  private sessionId = crypto.randomUUID();
  private storageError: string | null = null;
  constructor(readonly directory: string, private publish: (entry: RunLog) => void = () => {}, private maxBytes = 5 * 1024 * 1024, private backups = 10) {}
  private file(index = 0) { return path.join(this.directory, index ? `runtime.${index}.jsonl` : "runtime.jsonl"); }
  protect(value: string) { if (value.length >= 8) this.secrets.add(value); }
  redact(value: string) {
    let text = String(value);
    for (const secret of this.secrets) text = text.split(secret).join("[REDACTED]");
    return text.replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[\w-]+/g, "[REDACTED]")
      .replace(/(["']?(?:token|api[_ -]?key|authorization|cookie|password|caption|altText)["']?\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,}]+)/gi, "$1[REDACTED]")
      .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/gi, "$1?[REDACTED]")
      .replace(/[A-Za-z0-9+/=_-]{100,}/g, "[LONG DATA REDACTED]").slice(0, 6000);
  }
  async init(include: (entry: RunLog) => boolean = () => true) {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const history: RunLog[] = [];
      for (let index = 0; index <= this.backups && history.length < 1000; index++) {
        try {
          const raw = await fs.readFile(this.file(index), "utf8");
          if (index === 0 && raw && !raw.endsWith("\n")) await fs.appendFile(this.file(), "\n", "utf8");
          const parsed: RunLog[] = [];
          for (const line of raw.split("\n")) {
            try {
              const entry = JSON.parse(line);
              if (!include(entry)) continue;
              if (typeof entry.id === "string" && typeof entry.time === "string" && Number.isFinite(Date.parse(entry.time)) && typeof entry.message === "string" && typeof entry.step === "string" && typeof entry.sessionId === "string" && ["info", "warn", "error"].includes(entry.level) && ["app", "python", "extension", "page"].includes(entry.source) && [entry.draftId, entry.jobId, entry.detail].every(value => value === undefined || typeof value === "string")) parsed.push(entry);
            } catch { /* tolerate a truncated last line */ }
          }
          history.unshift(...parsed.slice(-1000));
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      this.entries = history.slice(-1000);
      this.bytes = await fs.stat(this.file()).then(stat => stat.size).catch(() => 0);
    } catch (error) { this.failure(error); }
  }
  private emit(entry: RunLog) {
    this.entries.push(entry);
    this.entries = this.entries.slice(-1000);
    try { this.publish(entry); } catch { /* window may be closing */ }
  }
  private failure(error: unknown) {
    this.storageError = this.redact(error instanceof Error ? error.message : String(error));
    this.emit({ id: crypto.randomUUID(), time: new Date().toISOString(), sessionId: this.sessionId, level: "error", source: "app", step: "logs.write_failed", message: "日志文件写入失败；当前日志暂存于内存。", detail: this.storageError });
  }
  write(input: LogInput) {
    const entry: RunLog = { source: input.source, level: input.level, platform: input.platform,
      draftId: typeof input.draftId === "string" ? input.draftId.slice(0, 80) : undefined, jobId: typeof input.jobId === "string" ? input.jobId.slice(0, 80) : undefined,
      id: crypto.randomUUID(), time: new Date().toISOString(), sessionId: this.sessionId,
      step: this.redact(input.step).slice(0, 100), message: this.redact(input.message), detail: input.detail ? this.redact(input.detail) : undefined };
    this.emit(entry);
    this.chain = this.chain.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const line = JSON.stringify(entry) + "\n";
      if (this.bytes && this.bytes + Buffer.byteLength(line) > this.maxBytes) {
        await fs.rm(this.file(this.backups), { force: true });
        for (let index = this.backups - 1; index >= 0; index--) {
          try { await fs.rename(this.file(index), this.file(index + 1)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        this.bytes = 0;
      }
      await fs.appendFile(this.file(), line, "utf8");
      this.bytes += Buffer.byteLength(line);
      this.storageError = null;
    }).catch(error => this.failure(error));
    return this.chain;
  }
  async snapshot(): Promise<LogSnapshot> { await this.chain; return { entries: [...this.entries], directory: this.directory, storageError: this.storageError }; }
  async flush() { await this.chain; }
}
