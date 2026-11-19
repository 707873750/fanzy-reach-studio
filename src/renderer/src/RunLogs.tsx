import { useEffect, useMemo, useState } from "react";
import { Copy, FolderOpen, RefreshCw } from "lucide-react";
import type { RunLog } from "../../shared/types";

function mergeLogs(first: RunLog[], second: RunLog[]) {
  return [...new Map([...first, ...second].map(entry => [entry.id, entry])).values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-1000);
}

export default function RunLogs({ draftId = "" }: { draftId?: string }) {
  const [entries, setEntries] = useState<RunLog[]>([]);
  const [directory, setDirectory] = useState("");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [level, setLevel] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [search, setSearch] = useState(draftId);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const snapshot = await window.reach.getLogs();
      setEntries(old => mergeLogs(snapshot.entries, old));
      setDirectory(snapshot.directory);
      setStorageError(snapshot.storageError);
    } catch (error) { setNotice(error instanceof Error ? error.message : "读取日志失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    const off = window.reach.onRunLog(entry => {
      setEntries(old => mergeLogs(old, [entry]));
      if (entry.step === "logs.write_failed") setStorageError(entry.detail || entry.message);
    });
    setLoading(true);
    void window.reach.getLogs().then(snapshot => {
      if (!active) return;
      setEntries(old => mergeLogs(snapshot.entries, old));
      setDirectory(snapshot.directory);
      setStorageError(snapshot.storageError);
    }).catch(error => { if (active) setNotice(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; off(); };
  }, []);
  useEffect(() => setSearch(draftId), [draftId]);
  const filtered = useMemo(() => entries.filter(entry =>
    (level === "all" || entry.level === level) && (platform === "all" || entry.platform === platform) &&
    [entry.message, entry.step, entry.detail, entry.draftId, entry.jobId, entry.source].join(" ").toLowerCase().includes(search.toLowerCase())
  ), [entries, level, platform, search]);
  async function action(task: () => Promise<unknown>, success: string) {
    try { await task(); setNotice(success); } catch (error) { setNotice(error instanceof Error ? error.message : "操作失败"); }
  }
  return <>
    <section className="page-heading"><div><div className="eyebrow">DIAGNOSTICS</div><h1>运行日志</h1><p>实时查看发布步骤和错误。显示最近 1000 条，最新记录在上方；历史记录保存在日志文件中。</p></div></section>
    <section className="panel">
      <div className="heading-actions">
        <button className="button secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16}/> 刷新日志</button>
        <button className="button secondary" onClick={() => void action(() => window.reach.openLogFolder(), "日志文件夹已打开")}><FolderOpen size={16}/> 打开日志文件夹</button>
        <button className="button secondary" disabled={!filtered.length} onClick={() => void action(() => window.reach.copyText(filtered.map(entry => JSON.stringify(entry)).join("\n")), "已复制筛选后的日志（剪贴板最多 10000 字符，完整记录请打开日志文件夹）")}><Copy size={16}/> 复制筛选结果</button>
      </div>
      <p className="muted log-path">{directory || "正在读取日志目录…"}</p>
      <p className="muted">单个日志文件约 5 MB，最多保留 10 个历史文件。失败截图位于 screenshots 子目录，最多 50 张，可能包含账号和草稿内容。</p>
      {notice && <div className="notice" role="status">{notice}</div>}
      {storageError && <div className="notice log-storage-error" role="alert">日志文件保存失败，当前记录仅在内存中：{storageError}</div>}
      <div className="log-filters">
        <div className="field"><label htmlFor="log-level">级别</label><select id="log-level" value={level} onChange={e => setLevel(e.target.value)}><option value="all">全部级别</option><option value="info">信息</option><option value="warn">警告</option><option value="error">错误</option></select></div>
        <div className="field"><label htmlFor="log-platform">平台</label><select id="log-platform" value={platform} onChange={e => setPlatform(e.target.value)}><option value="all">全部平台</option><option value="x">X</option><option value="instagram">Instagram</option><option value="pinterest">Pinterest</option></select></div>
        <div className="field log-search"><label htmlFor="log-search">搜索步骤、错误或任务 ID</label><input id="log-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="例如 images.upload、任务 ID、未连接"/></div>
      </div>
      <p className="muted">当前匹配 {filtered.length} 条 · 时间使用本机时区 · 点击记录下方的详情查看错误堆栈和任务标识</p>
      <div className="log-list" aria-label="运行日志列表">
        {!filtered.length && <div className="empty-mini">{loading ? "正在读取…" : "没有匹配的日志。新操作产生的日志会自动出现。"}</div>}
        {[...filtered].reverse().map(entry => <article key={entry.id} className={`log-row log-${entry.level}`}>
          <div className="log-meta"><time dateTime={entry.time}>{new Date(entry.time).toLocaleString("zh-CN", { hour12: false })}</time><strong>{entry.level.toUpperCase()}</strong><span>{entry.source}</span>{entry.platform && <span>{entry.platform}</span>}<code>{entry.step}</code></div>
          <div className="log-message">{entry.message}</div>
          <details><summary>详情{entry.draftId ? ` · 草稿 ${entry.draftId.slice(0, 8)}` : ""}</summary><pre>{[entry.draftId && `草稿：${entry.draftId}`, entry.jobId && `执行：${entry.jobId}`, `会话：${entry.sessionId}`, entry.detail].filter(Boolean).join("\n")}</pre></details>
        </article>)}
      </div>
    </section>
  </>;
}
