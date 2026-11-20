import { t, useLanguage } from "./i18n";
import { formatDate } from "./i18n";
import { memo, useEffect, useMemo, useState } from "react";
import { Copy, FolderOpen, RefreshCw } from "lucide-react";
import type { RunLog } from "../../shared/types";

const LogRow = memo(function LogRow({entry}: {entry: RunLog}) {
  useLanguage();
  return <article className={`log-row log-${entry.level}`}>
    <div className="log-meta"><time dateTime={entry.time}>{formatDate(entry.time)}</time><strong>{{info:t("信息"),warn:t("警告"),error:t("错误")}[entry.level]}</strong><span>{{app:t("程序"),python:t("Python 后端"),extension:t("浏览器扩展"),page:t("平台页面")}[entry.source]}</span>{entry.platform && <span>{{instagram:"Instagram",x:"X",pinterest:"Pinterest",tiktok:"TikTok",bluesky:"Bluesky",facebook:"Facebook"}[entry.platform]}</span>}<code>{entry.step}</code></div>
    <div className="log-message">{entry.message}</div>
    <details><summary>{t("详情{0}", [entry.draftId ? t(" · 草稿 {0}", [entry.draftId.slice(0, 8)]) : ""])}</summary><pre>{[entry.draftId && t("草稿：{0}", [entry.draftId]), entry.jobId && t("执行：{0}", [entry.jobId]), t("会话：{0}", [entry.sessionId]), entry.detail].filter(Boolean).join("\n")}</pre></details>
  </article>;
});

function mergeLogs(first: RunLog[], second: RunLog[]) {
  return [...new Map([...first, ...second].map(entry => [entry.id, entry])).values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-1000);
}

export default function RunLogs({ draftId = "" }: { draftId?: string }) {
  useLanguage();
  const [entries, setEntries] = useState<RunLog[]>([]);
  const [directory, setDirectory] = useState("");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [level, setLevel] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [search, setSearch] = useState(draftId);
  const [loading, setLoading] = useState(false);
  const [pageIndex,setPageIndex] = useState(0);

  async function refresh() {
    setLoading(true);
    try {
      const snapshot = await window.reach.getLogs();
      setEntries(old => mergeLogs(snapshot.entries, old));
      setDirectory(snapshot.directory);
      setStorageError(snapshot.storageError);
    } catch (error) { setNotice(error instanceof Error ? error.message : t("读取日志失败")); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    let pending: RunLog[] = [];
    // Bound both React commits and temporary memory during a burst of page events.
    const flush = () => {
      if (!pending.length) return;
      const batch=pending;pending=[];
      setEntries(old=>mergeLogs(old,batch));
    };
    const timer=window.setInterval(flush,250);
    const off = window.reach.onRunLog(entry => {
      pending.push(entry);
      if (pending.length>1000) pending=pending.slice(-1000);
      if (entry.step === "logs.write_failed") setStorageError(entry.detail || entry.message);
    });
    setLoading(true);
    void window.reach.getLogs().then(snapshot => {
      if (!active) return;
      setEntries(old => mergeLogs(snapshot.entries, old));
      setDirectory(snapshot.directory);
      setStorageError(snapshot.storageError);
    }).catch(error => { if (active) setNotice(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; off();clearInterval(timer);pending=[]; };
  }, []);
  useEffect(() => setSearch(draftId), [draftId]);
  const filtered = useMemo(() => entries.filter(entry =>
    (level === "all" || entry.level === level) && (platform === "all" || entry.platform === platform) &&
    [entry.message, entry.step, entry.detail, entry.draftId, entry.jobId, entry.source].join(" ").toLowerCase().includes(search.toLowerCase())
  ), [entries, level, platform, search]);
  useEffect(()=>setPageIndex(0),[level,platform,search]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/100));
  const currentPage=Math.min(pageIndex,pageCount-1);
  const visibleEntries=[...filtered].reverse().slice(currentPage*100,(currentPage+1)*100);
  async function action(task: () => Promise<unknown>, success: string) {
    try { await task(); setNotice(success); } catch (error) { setNotice(error instanceof Error ? error.message : t("操作失败")); }
  }
  return <>
    <section className="page-heading"><div><div className="eyebrow">{t("问题排查")}</div><h1>{t("运行日志")}</h1><p>{t("最近 1000 条可搜索，每页显示 100 条，新日志每 250 毫秒合并刷新；完整记录保存在日志文件中。")}</p></div></section>
    <section className="panel">
      <div className="heading-actions">
        <button className="button secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16}/> {t("刷新日志")}</button>
        <button className="button secondary" onClick={() => void action(() => window.reach.openLogFolder(), t("日志文件夹已打开"))}><FolderOpen size={16}/> {t("打开日志文件夹")}</button>
        <button className="button secondary" disabled={!filtered.length} onClick={() => void action(() => window.reach.copyText(filtered.map(entry => JSON.stringify(entry)).join("\n")), t("已复制筛选后的日志（剪贴板最多 10000 字符，完整记录请打开日志文件夹）"))}><Copy size={16}/> {t("复制筛选结果")}</button>
      </div>
      <p className="muted log-path">{directory || t("正在读取日志目录…")}</p>
      <p className="muted">{t("单个日志文件约 5 MB，最多保留 10 个历史文件。失败截图位于 screenshots 子目录，最多 50 张，可能包含账号和草稿内容。")}</p>
      {notice && <div className="notice" role="status">{notice}</div>}
      {storageError && <div className="notice log-storage-error" role="alert">{t("日志文件保存失败，当前记录仅在内存中：{0}", [storageError])}</div>}
      <div className="log-filters">
        <div className="field"><label htmlFor="log-level">{t("级别")}</label><select id="log-level" value={level} onChange={e => setLevel(e.target.value)}><option value="all">{t("全部级别")}</option><option value="info">{t("信息")}</option><option value="warn">{t("警告")}</option><option value="error">{t("错误")}</option></select></div>
        <div className="field"><label htmlFor="log-platform">{t("平台")}</label><select id="log-platform" value={platform} onChange={e => setPlatform(e.target.value)}><option value="all">{t("全部平台")}</option><option value="x">X</option><option value="instagram">Instagram</option><option value="pinterest">Pinterest</option><option value="tiktok">TikTok</option><option value="facebook">Facebook</option><option value="bluesky">Bluesky</option></select></div>
        <div className="field log-search"><label htmlFor="log-search">{t("搜索步骤、错误或任务 ID")}</label><input id="log-search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("例如 images.upload、任务 ID、未连接")}/></div>
      </div>
      <p className="muted">{t("当前匹配 {0} 条 · 时间使用本机时区 · 点击记录下方的详情查看错误堆栈和任务标识", [filtered.length])}</p>
      <div className="heading-actions"><button className="button secondary" disabled={currentPage===0} onClick={()=>setPageIndex(currentPage-1)}>{t("较新记录")}</button><span className="muted">{t("第 {0} / {1} 页", [currentPage+1, pageCount])}</span><button className="button secondary" disabled={currentPage+1>=pageCount} onClick={()=>setPageIndex(currentPage+1)}>{t("较早记录")}</button></div>
      <p className="muted">{t("性能采样单独保存在日志文件夹的 performance 子目录，不在此列表刷屏。点击“打开日志文件夹”后进入该目录查看。窗口无响应、GPU 退出等异常仍显示在运行日志中。")}</p>
      <div className="log-list" aria-label={t("运行日志列表")}>
        {!filtered.length && <div className="empty-mini">{loading ? t("正在读取…") : t("没有匹配的日志。新操作产生的日志会自动出现。")}</div>}
        {visibleEntries.map(entry => <LogRow key={entry.id} entry={entry}/>)}
      </div>
    </section>
  </>;
}
