import { useEffect, useState } from "react";
import type { Platform, PlatformDefaults, PlatformDefaultsMap } from "../../shared/types";
import { defaultPlatformSettings } from "../../shared/platform-defaults";

const labels = {instagram:"Instagram",x:"X",pinterest:"Pinterest",tiktok:"TikTok",bluesky:"Bluesky",facebook:"Facebook"};
function PlatformCard({platform,initial}: {platform:Platform;initial:PlatformDefaults}) {
  const [value,setValue]=useState(initial);
  const [tags,setTags]=useState(initial.hashtags.join(" "));
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  const change=(patch:Partial<PlatformDefaults>)=>{setValue(old=>({...old,...patch}));setNotice("有未保存的修改");};
  const id=(field:string)=>`default-${platform}-${field}`;
  async function save() {
    setSaving(true);setNotice("");
    try {
      const saved=await window.reach.savePlatformDefaults(platform,{...value,hashtags:tags.split(/\s+/).filter(Boolean)});
      setValue(saved);setTags(saved.hashtags.join(" "));setNotice("已保存，下次创建草稿时自动使用。重启后仍然有效。");
    } catch(error) {setNotice(error instanceof Error?error.message:"保存失败");}
    finally {setSaving(false);}
  }
  return <section className="panel settings-panel" aria-label={`${labels[platform]} 默认配置`}>
    <h2>{labels[platform]} 默认配置</h2>
    <fieldset disabled={saving} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {platform!=="pinterest" && <div className="field"><label htmlFor={id("images")}>每条草稿的图片数量</label><input id={id("images")} type="number" min={1} max={platform==="tiktok"?35:(platform==="x"||platform==="bluesky")?4:10} value={Number.isNaN(value.imagesPerDraft)?"":value.imagesPerDraft} onChange={e=>change({imagesPerDraft:e.target.valueAsNumber})}/><small>新建草稿时按此数量分组，最后一组可不足此数量。</small></div>}
      {platform==="bluesky" && <small>当前支持每条 1–4 张图片，正文、标题和话题合计最多 300 字符。请先登录 Bluesky；收到本次帖子链接后自动确认发布成功。</small>}
      {platform==="facebook" && <small>每条支持 1–10 张图片。请先登录 Facebook 并选定发布身份及受众，发布时沿用页面设置。定时发布需保持程序运行；暂不支持群组、Reels 和自动填写替代文本。</small>}
      {platform==="tiktok" && <small>TikTok 图片轮播最多 35 张，按比例缩放至 1080 × 1920 以内。自动发布需要账号的网页端提供图片上传入口；仅支持视频时请使用手机端发布。</small>}
      {platform==="tiktok" && <div className="field"><label htmlFor={id("privacy")}>默认谁可以看</label><select id={id("privacy")} value={value.tiktokPrivacy || "self_only"} onChange={e=>change({tiktokPrivacy:e.target.value as "public" | "self_only"})}><option value="self_only">仅自己</option><option value="public">所有人</option></select></div>}
      {platform==="pinterest" && <>
        <p className="muted">每张图片创建一条 Pin 草稿。</p>
        <div className="field"><label htmlFor={id("board")}>默认图板名称</label><input id={id("board")} maxLength={200} value={value.boardName} onChange={e=>change({boardName:e.target.value})} placeholder="填写现有图板的完整名称"/></div>
        <div className="field"><label htmlFor={id("title")}>默认 Pin 标题（可选）</label><input id={id("title")} maxLength={100} value={value.title} onChange={e=>change({title:e.target.value})}/></div>
      </>}
      {<>
        <div className="field"><label htmlFor={id("schedule")}>默认发布方式</label><select id={id("schedule")} value={value.scheduleDelayMinutes===0?"now":"later"} onChange={e=>change({scheduleDelayMinutes:e.target.value==="now"?0:60})}><option value="now">提交草稿时立即发布</option><option value="later">定时发布（原生优先）</option></select></div>
        {value.scheduleDelayMinutes!==0 && <div className="field"><label htmlFor={id("delay")}>创建草稿后延后多少分钟</label><input id={id("delay")} type="number" min={10} max={10080} value={Number.isNaN(value.scheduleDelayMinutes)?"":value.scheduleDelayMinutes} onChange={e=>change({scheduleDelayMinutes:e.target.valueAsNumber})}/></div>}
        <p className="muted">在创建草稿时计算定时时间，同一批次的草稿使用同一时间。需要在发布队列手动提交；提交时仍须距离该时间至少 5 分钟。原生排程不可用时转为本地任务，需保持电脑唤醒、程序运行、网络和登录有效。</p>
      </>}
      <div className="field"><label htmlFor={id("tags")}>默认话题标签（可选）</label><input id={id("tags")} value={tags} onChange={e=>{setTags(e.target.value);setNotice("有未保存的修改");}} placeholder="#话题一 #话题二"/><small>空格分隔，最多 30 个。不影响统一正文；AI 生成会重新生成标签和标题。</small></div>
      <div className="settings-actions"><button className="button primary" onClick={()=>void save()}>{saving?"正在保存…":`保存 ${labels[platform]} 配置`}</button><button className="button secondary" onClick={()=>{setValue(defaultPlatformSettings()[platform]);setTags("");setNotice("已恢复初始值，点击保存后生效。");}}>恢复初始值</button></div>
      {notice && <p role="status" className="muted">{notice}</p>}
    </fieldset>
  </section>;
}
export default function PlatformSettings() {
  const [values,setValues]=useState<PlatformDefaultsMap|null>(null);
  const [error,setError]=useState("");
  const load=()=>{setError("");void window.reach.getPlatformDefaults().then(setValues).catch(e=>setError(e.message||"读取配置失败"));};
  useEffect(load,[]);
  return <>
    <section className="panel settings-panel"><h2>各平台独立配置</h2><p className="muted">分别保存在本机，创建新草稿时自动带入。修改默认配置不会覆盖已有草稿；每条草稿仍可单独调整。</p>{!values&&!error&&<p>正在读取配置…</p>}{error&&<><p role="alert">{error}</p><button className="button secondary" onClick={load}>重新读取配置</button></>}</section>
    {values&&(["instagram","x","pinterest","tiktok","bluesky","facebook"] as Platform[]).map(platform=><PlatformCard key={platform} platform={platform} initial={values[platform]}/>)}
  </>;
}
