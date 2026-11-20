import { useEffect, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import type { Draft, ImageAsset, Platform } from "../../shared/types";
import { canDeleteDraft } from "../../shared/draft-lifecycle";
import { formatDate, t, useLanguage } from "./i18n";

export default function LocalSchedules({ tasks, images, platforms, busy, isLocked, onDelete, onCancel, onLogs }: {
  tasks: Draft[];
  images: ImageAsset[];
  platforms: Record<Platform, { label: string }>;
  busy: boolean;
  isLocked: (task: Draft) => boolean;
  onDelete: (ids: string[]) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onLogs: (id: string) => void;
}) {
  useLanguage();
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const deletable = tasks.filter(task => canDeleteDraft(task) && !isLocked(task));
  const selected = deletable.filter(task => checkedIds.includes(task.id));
  useEffect(() => {
    setCheckedIds(old => {
      const next = old.filter(id => tasks.some(task => task.id === id));
      return next.length === old.length ? old : next;
    });
  }, [tasks]);

  return <>
    <section className="page-heading">
      <div><div className="eyebrow">{t("内容发布")}</div><h1>{t("本地定时任务")}</h1><p>{t("共 {0} 条任务，按计划发布时间排序。", [tasks.length])}</p></div>
    </section>
    <div className="schedule-box local-schedule-help">
      <strong><CalendarClock size={16}/>{t("请保持电脑唤醒和程序运行。")}</strong>
      <p>{t("任务到时自动发布，需保持联网和平台登录有效。错过的任务会在恢复后补发；执行失败后请到发布队列查看。")}</p>
      <p>{t("删除任务会同时删除对应草稿，且不再自动发布；素材库内容保留。仅取消定时可保留草稿。")}</p>
    </div>
    {!tasks.length ? <section className="panel empty-state"><div className="empty-icon"><CalendarClock/></div><h3>{t("暂无本地定时任务")}</h3><p>{t("在发布队列提交定时草稿后，使用本地定时的任务会自动显示在这里。")}</p></section> : <section className="panel local-schedule-list">
      <div className="draft-bulk-actions">
        <button className="text-button" disabled={busy || !deletable.length} onClick={() => setCheckedIds(deletable.map(task => task.id))}>{t("全选")}</button>
        <button className="text-button" disabled={busy || !checkedIds.length} onClick={() => setCheckedIds([])}>{t("清空选择")}</button>
        <button className="button danger" disabled={busy || !selected.length} onClick={() => void onDelete(selected.map(task => task.id))}><Trash2 size={15}/>{t("删除所选任务（{0}）", [selected.length])}</button>
      </div>
      {tasks.map(task => {
        const locked = isLocked(task);
        const disabled = busy || locked || !canDeleteDraft(task);
        const image = images.find(item => item.id === task.imageIds[0]);
        const time = task.publishAt || task.xScheduledAt;
        return <article key={task.id} className="local-schedule-row" data-task-id={task.id}>
          <input type="checkbox" aria-label={t("选择本地定时任务 {0}", [task.id])} checked={checkedIds.includes(task.id)} disabled={disabled} onChange={event => setCheckedIds(old => event.target.checked ? [...old, task.id] : old.filter(id => id !== task.id))}/>
          <div className="local-schedule-thumb">{image?.thumbnailDataUrl ? <img src={image.thumbnailDataUrl} alt={image.fileName}/> : <CalendarClock size={23}/>}</div>
          <div className="local-schedule-main">
            <strong>{platforms[task.platform].label} · {task.title || t("未填写标题")}</strong>
            <p className="local-schedule-caption">{task.caption || t("未填写文案")}</p>
            <p className="local-schedule-time"><CalendarClock size={13}/>{time && Number.isFinite(Date.parse(time)) ? formatDate(time) : t("未设置发布时间")} · {t("{0} 项素材", [task.imageIds.length])}</p>
            {locked && <p className="muted">{t("任务正在执行或已锁定，暂不可删除。")}</p>}
            {task.browserPublish?.message && <p className="muted">{task.browserPublish.message}</p>}
          </div>
          <div className="local-schedule-actions">
            <button className="text-button" onClick={() => onLogs(task.id)}>{t("查看任务日志")}</button>
            <button className="button secondary small" disabled={disabled} onClick={() => void onCancel(task.id)}>{t("取消定时并保留草稿")}</button>
            <button className="button danger small" disabled={disabled} onClick={() => void onDelete([task.id])}><Trash2 size={15}/>{t("删除任务")}</button>
          </div>
        </article>;
      })}
    </section>}
  </>;
}
