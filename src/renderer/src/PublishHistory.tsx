import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Trash2 } from "lucide-react";
import type { Draft, ImageAsset, Platform } from "../../shared/types";
import { canDeletePublishRecord } from "../../shared/draft-lifecycle";

function recordStatus(record: Draft) {
  return record.status === "platform_scheduled" || record.browserPublish?.state === "scheduled" ? "平台已排程" : "已发布";
}

export default function PublishHistory({ records, images, platforms, busy, isLocked, onDelete, onLogs }: {
  records: Draft[];
  images: ImageAsset[];
  platforms: Record<Platform, { label: string }>;
  busy: boolean;
  isLocked: (record: Draft) => boolean;
  onDelete: (ids: string[]) => Promise<void>;
  onLogs: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const selected = records.find(record => record.id === selectedId) || records[0];
  const deletable = records.filter(record => canDeletePublishRecord(record) && !isLocked(record));
  const checked = deletable.filter(record => checkedIds.includes(record.id));
  const canConfirm = Boolean(pendingIds?.length && pendingIds.every(id => deletable.some(record => record.id === id)));

  useEffect(() => {
    setCheckedIds(old => {
      const next = old.filter(id => records.some(record => record.id === id));
      return next.length === old.length ? old : next;
    });
    setPendingIds(old => old && old.some(id => !records.some(record => record.id === id)) ? null : old);
  }, [records]);

  const confirmDelete = () => {
    if (busy || !canConfirm || !pendingIds) return;
    const ids = [...pendingIds];
    setPendingIds(null);
    void onDelete(ids);
  };
  return <>
    <section className="page-heading">
      <div><div className="eyebrow">内容发布</div><h1>发布记录</h1><p>查看已发布和平台已确认排程的任务，共 {records.length} 条记录。</p></div>
    </section>
    {pendingIds && <div className="delete-confirm" role="group" aria-label="确认删除发布记录">
      <p>确定删除这 {pendingIds.length} 条本地发布记录？删除后无法恢复。平台上的帖子和排程、素材库图片及运行日志会保留；取消平台排程请前往对应平台操作。</p>
      <div className="heading-actions"><button className="button danger small" disabled={busy || !canConfirm} onClick={confirmDelete}>确认删除记录</button><button className="button secondary small" disabled={busy} onClick={() => setPendingIds(null)}>取消</button></div>
    </div>}
    {!selected ? <section className="panel empty-state"><div className="empty-icon"><CheckCircle2/></div><h3>暂无发布记录</h3><p>发布成功或确认平台排程后，任务会自动移到这里。</p></section> : <div className="queue-layout">
      <section className="panel draft-list">
        <div className="panel-heading"><div><h2>发布记录</h2><p>按最近更新时间排序 · 已选 {checked.length} 条</p></div></div>
        <div className="draft-bulk-actions">
          <button className="text-button" disabled={busy || !deletable.length} onClick={() => { setPendingIds(null); setCheckedIds(deletable.map(record => record.id)); }}>全选</button>
          <button className="text-button" disabled={busy || !checkedIds.length} onClick={() => { setPendingIds(null); setCheckedIds([]); }}>清空选择</button>
          <button className="button danger" disabled={busy || !checked.length} onClick={() => setPendingIds(checked.map(record => record.id))}><Trash2 size={15}/> 删除所选记录（{checked.length}）</button>
        </div>
        {records.map(record => <div key={record.id} className="draft-select-row"><input type="checkbox" aria-label={`选择 ${platforms[record.platform].label} 发布记录 ${record.id}`} checked={checkedIds.includes(record.id)} disabled={busy || !canDeletePublishRecord(record) || isLocked(record)} onChange={event => { setPendingIds(null); setCheckedIds(old => event.target.checked ? [...old, record.id] : old.filter(id => id !== record.id)); }}/><button className={`draft-row ${selected.id === record.id ? "selected" : ""}`} onClick={() => setSelectedId(record.id)}>
          <div className="platform-icon"><CheckCircle2 size={18}/></div>
          <div className="draft-row-main"><strong>{platforms[record.platform].label}</strong><span>{record.imageIds.length} 张图片 · {recordStatus(record)}</span><span>{new Date(record.updatedAt).toLocaleString()}</span></div>
          <span className={`status-dot ${recordStatus(record) === "已发布" ? "published" : "scheduled"}`}/>
        </button></div>)}
      </section>
      <section className="panel draft-detail">
        <div className="detail-heading"><div><div className="eyebrow">发布记录</div><h2>{platforms[selected.platform].label}</h2><p>{recordStatus(selected)} · {selected.imageIds.length} 张图片</p></div><div className="heading-actions"><button className="text-button" onClick={() => onLogs(selected.id)}>查看任务日志</button><button className="icon-button danger" title="删除当前发布记录" aria-label="删除当前发布记录" disabled={busy || !canDeletePublishRecord(selected) || isLocked(selected)} onClick={() => setPendingIds([selected.id])}><Trash2 size={17}/></button></div></div>
        <p className="muted">记录更新时间：{new Date(selected.updatedAt).toLocaleString()}</p>
        {selected.xScheduledAt && <p className="muted">平台排程时间：{new Date(selected.xScheduledAt).toLocaleString()}</p>}
        {selected.browserPublish?.message && <p className="muted">{selected.browserPublish.message}</p>}
        <div className="detail-images">{selected.imageIds.map(id => {
          const image = images.find(item => item.id === id);
          return image?.thumbnailDataUrl ? <img key={id} src={image.thumbnailDataUrl} alt={image.fileName}/> : null;
        })}</div>
        {selected.imageIds.some(id => !images.some(image => image.id === id)) && <p className="muted">部分图片已从素材库删除，发布记录仍保留。</p>}
        {selected.title && <div className="field"><label>帖子标题 / Pin 标题</label><p className="record-text">{selected.title}</p></div>}
        <div className="field"><label>正文文案</label><p className="record-text">{selected.caption || "未填写文案"}</p></div>
        {selected.hashtags.length > 0 && <div className="field"><label>话题标签</label><p className="record-text">{selected.hashtags.join(" ")}</p></div>}
        {selected.boardName && <div className="field"><label>Pinterest 图板</label><p className="record-text">{selected.boardName}</p></div>}
        {selected.altText && <div className="field"><label>图片替代说明</label><p className="record-text">{selected.altText}</p></div>}
        {selected.publishedUrl ? <a className="button secondary record-link" href={selected.publishedUrl} onClick={event => { event.preventDefault(); void window.reach.openExternal(selected.publishedUrl!); }}>查看已发布帖子 <ArrowUpRight size={15}/></a> : <p className="muted">未保存帖子链接</p>}
      </section>
    </div>}
  </>;
}
