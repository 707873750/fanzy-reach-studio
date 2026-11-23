import { accountLabel } from "./Accounts";
import type { PlatformAccount } from "../../shared/types";
import { defaultAccountId } from "../../shared/accounts";
import { t, useLanguage } from "./i18n";
import { formatDate } from "./i18n";
import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Copy, Trash2 } from "lucide-react";
import type { Draft, ImageAsset, Platform } from "../../shared/types";
import { canDeletePublishRecord } from "../../shared/draft-lifecycle";
import { cleanCaption } from "./rich-caption";
import { postUrl } from "../../shared/post-url";

function recordStatus(record: Draft) {
  return record.status === "platform_scheduled" || record.browserPublish?.state === "scheduled" ? t("平台已排程") : t("已发布");
}

export default function PublishHistory({ accounts = [], records, images, platforms, busy, isLocked, onDelete, onLogs }: {
  accounts?: PlatformAccount[];
  records: Draft[];
  images: ImageAsset[];
  platforms: Record<Platform, { label: string }>;
  busy: boolean;
  isLocked: (record: Draft) => boolean;
  onDelete: (ids: string[]) => Promise<void>;
  onLogs: (id: string) => void;
}) {
  useLanguage();
  const accountName=(d:Draft)=>accountLabel(accounts.find(a=>a.id===(d.accountId||defaultAccountId(d.platform))));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const [copyState, setCopyState] = useState<{id:string; message:string} | null>(null);
  const selected = records.find(record => record.id === selectedId) || records[0];
  const publishedUrl = selected ? postUrl(selected.platform, selected.publishedUrl) : null;
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
      <div><div className="eyebrow">{t("内容发布")}</div><h1>{t("发布记录")}</h1><p>{t("查看已发布和平台已确认排程的任务，共 {0} 条记录。", [records.length])}</p></div>
    </section>
    {pendingIds && <div className="delete-confirm" role="group" aria-label={t("确认删除发布记录")}>
      <p>{t("确定删除这 {0} 条本地发布记录？删除后无法恢复。平台上的帖子和排程、素材库图片及运行日志会保留；取消平台排程请前往对应平台操作。", [pendingIds.length])}</p>
      <div className="heading-actions"><button className="button danger small" disabled={busy || !canConfirm} onClick={confirmDelete}>{t("确认删除记录")}</button><button className="button secondary small" disabled={busy} onClick={() => setPendingIds(null)}>{t("取消")}</button></div>
    </div>}
    {!selected ? <section className="panel empty-state"><div className="empty-icon"><CheckCircle2/></div><h3>{t("暂无发布记录")}</h3><p>{t("发布成功或确认平台排程后，任务会自动移到这里。")}</p></section> : <div className="queue-layout">
      <section className="panel draft-list">
        <div className="panel-heading"><div><h2>{t("发布记录")}</h2><p>{t("按最近更新时间排序 · 已选 {0} 条", [checked.length])}</p></div></div>
        <div className="draft-bulk-actions">
          <button className="text-button" disabled={busy || !deletable.length} onClick={() => { setPendingIds(null); setCheckedIds(deletable.map(record => record.id)); }}>{t("全选")}</button>
          <button className="text-button" disabled={busy || !checkedIds.length} onClick={() => { setPendingIds(null); setCheckedIds([]); }}>{t("清空选择")}</button>
          <button className="button danger" disabled={busy || !checked.length} onClick={() => setPendingIds(checked.map(record => record.id))}><Trash2 size={15}/> {t("删除所选记录（{0}）", [checked.length])}</button>
        </div>
        {records.map(record => <div key={record.id} className="draft-select-row"><input type="checkbox" aria-label={t("选择 {0} 发布记录 {1}", [platforms[record.platform].label, record.id])} checked={checkedIds.includes(record.id)} disabled={busy || !canDeletePublishRecord(record) || isLocked(record)} onChange={event => { setPendingIds(null); setCheckedIds(old => event.target.checked ? [...old, record.id] : old.filter(id => id !== record.id)); }}/><button className={`draft-row ${selected.id === record.id ? "selected" : ""}`} onClick={() => setSelectedId(record.id)}>
          <div className="platform-icon"><CheckCircle2 size={18}/></div>
          <div className="draft-row-main"><strong>{platforms[record.platform].label} · {accountName(record)}</strong><span>{t("{0} 项素材 · {1}", [record.imageIds.length, recordStatus(record)])}</span><span>{formatDate(record.updatedAt)}</span></div>
          <span className={`status-dot ${record.status !== "platform_scheduled" && record.browserPublish?.state !== "scheduled" ? "published" : "scheduled"}`}/>
        </button></div>)}
      </section>
      <section className="panel draft-detail">
        <div className="detail-heading"><div><div className="eyebrow">{t("发布记录")}</div><h2>{platforms[selected.platform].label} · {accountName(selected)}</h2><p>{t("{0} · {1} 项素材", [recordStatus(selected), selected.imageIds.length])}</p></div><div className="heading-actions"><button className="text-button" onClick={() => onLogs(selected.id)}>{t("查看任务日志")}</button><button className="icon-button danger" title={t("删除当前发布记录")} aria-label={t("删除当前发布记录")} disabled={busy || !canDeletePublishRecord(selected) || isLocked(selected)} onClick={() => setPendingIds([selected.id])}><Trash2 size={17}/></button></div></div>
        <p className="muted">{t("记录更新时间：{0}", [formatDate(selected.updatedAt)])}</p>
        {(selected.publishAt || selected.xScheduledAt) && <p className="muted">{selected.scheduleMode === "local" ? t("本地计划时间") : t("平台排程时间")}：{formatDate((selected.publishAt || selected.xScheduledAt)!)}</p>}
        {selected.browserPublish?.message && <p className="muted">{selected.browserPublish.message}</p>}
        <div className="detail-images">{selected.imageIds.map(id => {
          const image = images.find(item => item.id === id);
          return image?.thumbnailDataUrl ? <img key={id} src={image.thumbnailDataUrl} alt={image.fileName}/> : null;
        })}</div>
        {selected.imageIds.some(id => !images.some(image => image.id === id)) && <p className="muted">{t("部分素材已从素材库删除，发布记录仍保留。")}</p>}
        {selected.title && <div className="field"><label>{t("帖子标题 / Pin 标题")}</label><p className="record-text">{selected.title}</p></div>}
        <div className="field"><label>{t("正文文案")}</label>{selected.captionHtml ? <div className="record-text caption-rich-record" onClick={event => event.preventDefault()} dangerouslySetInnerHTML={{__html:cleanCaption(selected.captionHtml)}}/> : <p className="record-text">{selected.caption || t("未填写文案")}</p>}</div>
        {selected.hashtags.length > 0 && <div className="field"><label>{t("话题标签")}</label><p className="record-text">{selected.hashtags.join(" ")}</p></div>}
        {selected.boardName && <div className="field"><label>{t("Pinterest 图板")}</label><p className="record-text">{selected.boardName}</p></div>}
        {selected.altText && <div className="field"><label>{t("图片替代说明")}</label><p className="record-text">{selected.altText}</p></div>}
        {publishedUrl ? <div className="field"><label htmlFor="published-post-url">{t("帖子地址")}</label><input id="published-post-url" readOnly value={publishedUrl} onFocus={event => event.currentTarget.select()}/><div className="heading-actions">
          <a className="button secondary record-link" href={publishedUrl} onClick={event => { event.preventDefault(); void window.reach.openExternal(publishedUrl); }}>{t("查看已发布帖子")}<ArrowUpRight size={15}/></a>
          <button className="button secondary" onClick={() => { const id=selected.id; void window.reach.copyText(publishedUrl).then(ok=>setCopyState({id,message:ok?t("帖子地址已复制"):t("复制失败，请选择地址手动复制")})).catch(()=>setCopyState({id,message:t("复制失败，请选择地址手动复制")})); }}><Copy size={15}/> {t("复制地址")}</button>
        </div>{copyState?.id===selected.id&&<p className="muted" role="status">{copyState.message}</p>}</div> : <p className="muted">{recordStatus(selected)===t("平台已排程")?t("平台已确认排程，尚未取得正式帖子地址。"):t("未取得真实帖子地址。平台未返回链接或此记录创建于旧版本，可前往平台查看。")}</p>}
      </section>
    </div>}
  </>;
}
