import { useState } from "react";
import type { Platform, PlatformAccount } from "../../shared/types";
import { t, useLanguage, formatDate } from "./i18n";
export const accountLabel = (account?: PlatformAccount) => account?.name || t("默认账号");
export default function Accounts({accounts, busy, run, platforms}: {accounts:PlatformAccount[];busy:boolean;run:(message:string, fn:()=>Promise<void>)=>Promise<void>;platforms:Record<Platform,{label:string}>}) {
  useLanguage();
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState("");
  const [pendingDelete, setPendingDelete] = useState("");
  const [newName, setNewName] = useState("");
  return <section className="panel account-panel"><h2>{t("平台账号")}</h2>
    <p className="muted">{t("每个账号使用独立登录环境。默认账号沿用原有登录状态和草稿。")}</p>
    <p className="muted">{t("账号名称是本地备注。保存登录前，请在浏览器中核对用户名；不要在同一个账号窗口中切换身份。")}</p>
    <div className="account-add"><select aria-label={t("平台")} value={platform} disabled={busy} onChange={e=>setPlatform(e.target.value as Platform)}>{Object.entries(platforms).map(([id,p])=><option key={id} value={id}>{p.label}</option>)}</select><input aria-label={t("账号名称")} placeholder={t("账号名称")} maxLength={80} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/><button className="button primary" disabled={busy||!name.trim()} onClick={()=>void run(t("正在保存账号…"),async()=>{await window.reach.addAccount(platform,name);setName("");})}>{t("添加账号")}</button></div>
    <div className="account-grid">{accounts.map(a=><article className="account-card" key={a.id}><strong>{platforms[a.platform].label} · {accountLabel(a)}</strong><small>{a.sessionSavedAt?t("登录配置已保存于 {0}",[formatDate(a.sessionSavedAt)]):a.legacy?t("沿用原有登录环境"):t("尚未保存登录配置")}</small><small>{t("发布时检查登录有效性")}</small>
      {editing===a.id?<div className="account-add"><input aria-label={t("账号名称")} value={newName} maxLength={80} disabled={busy} onChange={e=>setNewName(e.target.value)}/><button className="button secondary" disabled={busy||!newName.trim()} onClick={()=>void run(t("正在保存账号…"),async()=>{await window.reach.renameAccount(a.id,newName);setEditing("");})}>{t("保存")}</button><button className="text-button" disabled={busy} onClick={()=>setEditing("")}>{t("取消")}</button></div>:<button className="text-button" disabled={busy} onClick={()=>{setEditing(a.id);setNewName(accountLabel(a));}}>{t("重命名账号")}</button>}
      <div className="settings-actions"><button className="button secondary" disabled={busy} onClick={()=>void run(t("正在打开登录窗口…"),()=>window.reach.openPlatformBrowser(a.platform,false,a.id))}>{t("登录")}</button><button className="button secondary" disabled={busy} onClick={()=>void run(t("正在保存登录配置…"),()=>window.reach.closePlatformBrowser(a.platform,a.id))}>{t("完成登录 / 关闭窗口")}</button><button className="text-button" disabled={busy} onClick={()=>void run(t("正在打开登录窗口…"),()=>window.reach.openPlatformBrowser(a.platform,true,a.id))}>{t("查看账号")}</button></div>
      {pendingDelete===a.id?<div className="delete-confirm" role="group" aria-label={t("确认删除账号")}><p>{t("确定删除账号“{0}”？账号将从列表移除，本地浏览器文件保留，不会注销平台账号。",[accountLabel(a)])}</p><p>{t("有关联草稿、定时任务或发布记录的账号暂不能删除。")}</p><div className="settings-actions"><button className="button danger" disabled={busy} onClick={()=>void run(t("正在删除账号…"),async()=>{await window.reach.deleteAccount(a.id);setPendingDelete("");})}>{t("确认删除账号")}</button><button className="button secondary" disabled={busy} onClick={()=>setPendingDelete("")}>{t("取消")}</button></div></div>:<button className="text-button danger" disabled={busy} onClick={()=>setPendingDelete(a.id)}>{t("删除账号")}</button>}
    </article>)}</div></section>;
}
