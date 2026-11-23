import { useEffect, useState } from "react";
import type { Draft, ImageAsset, Platform } from "../../shared/types";
import type { ImagePreview } from "../../shared/image-edit";
import { t, useLanguage } from "./i18n";
const labels:Record<Platform,string>={instagram:"Instagram",x:"X",pinterest:"Pinterest",tiktok:"TikTok",bluesky:"Bluesky",facebook:"Facebook"};
export default function PublishPreview({draft,images,accountName,order,onOrder,disabled}:{draft:Draft;images:ImageAsset[];accountName:string;order:string[];onOrder:(ids:string[])=>void;disabled:boolean}) {
  useLanguage();
  const [platform,setPlatform]=useState(draft.platform),[index,setIndex]=useState(0),[expanded,setExpanded]=useState(false);
  const [preview,setPreview]=useState<ImagePreview>(),[error,setError]=useState(""),[loading,setLoading]=useState(false),[drag,setDrag]=useState<number>();
  const id=order[index],image=images.find(a=>a.id===id),video=image?.mimeType.startsWith("video/");
  useEffect(()=>{setIndex(0);setExpanded(false);},[draft.id]);
  useEffect(()=>{let active=true;setPreview(undefined);setError("");if(!id||video){setLoading(false);return;}setLoading(true);
    window.reach.previewPublishImage(id,platform).then(data=>{if(active)setPreview(data);}).catch(e=>{if(active)setError(String(e).replace(/^Error: /,"").replace(/^Error invoking remote method [^:]+: (?:Error: )?/,""));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[id,platform,video]);
  function move(from:number,to:number){if(disabled||from===to||to<0||to>=order.length)return;const next=[...order];next.splice(to,0,next.splice(from,1)[0]);onOrder(next);setIndex(to);}
  const caption=[(platform==="pinterest"||(platform==="tiktok"&&!video))?"":draft.title,draft.caption,draft.hashtags.join(" ")].filter(Boolean).join("\n\n");
  return <section className="publish-preview"><header><h3>{t("发布预览")}</h3><select aria-label={t("预览平台")} value={platform} onChange={e=>{setPlatform(e.target.value as Platform);setExpanded(false);}}>{Object.entries(labels).map(([p,label])=><option key={p} value={p}>{label}</option>)}</select></header>
    <p className="muted">{t("平台样式为模拟预览。图片使用实际发布处理逻辑，平台压缩、字体和折叠效果可能不同。")}</p>
    {platform!==draft.platform&&<p className="preview-note">{t("仅比较显示效果，实际发布目标仍为 {0}。",[labels[draft.platform]])}</p>}
    <article className={`social-preview social-${platform}`}><div className="social-account"><span className="social-avatar">{labels[platform][0]}</span><div><strong>{platform===draft.platform?accountName:t("示例账号")}</strong><small>{labels[platform]} · {t("帖子预览")}</small></div></div>
      {(platform==="pinterest"||(platform==="tiktok"&&!video))&&draft.title&&<h4>{draft.title}</h4>}
      {loading?<div className="preview-placeholder">{t("正在生成预览…")}</div>:video?<div className="preview-placeholder">{image?.thumbnailDataUrl&&<img src={image.thumbnailDataUrl} alt={t("视频封面")}/>}<p>{t("视频仅展示封面")}</p></div>:preview?<img className="social-media" src={preview.dataUrl} alt={draft.altText||t("发布图片")}/>:<p role="alert">{t(error)||t("没有可预览的图片")}</p>}
      <div className="preview-pagination"><button disabled={index===0} onClick={()=>setIndex(i=>i-1)} aria-label={t("上一张")}>‹</button><span>{order.length?index+1:0} / {order.length}{preview?` · ${preview.width} × ${preview.height}`:""}</span><button disabled={index>=order.length-1} onClick={()=>setIndex(i=>i+1)} aria-label={t("下一张")}>›</button></div>
      <p className={`social-caption ${expanded?"":"is-collapsed"}`}>{caption||t("未填写文案")}</p>{caption.length>120&&<button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?t("收起文案"):t("展开文案")}</button>}
    </article><div className="preview-order">{order.map((mediaId,i)=><button type="button" key={mediaId} className={i===index?"selected":""} draggable={!disabled} onDragStart={()=>setDrag(i)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag!==undefined)move(drag,i);setDrag(undefined);}} onDragEnd={()=>setDrag(undefined)} onClick={()=>setIndex(i)} aria-label={t("查看第 {0} 张",[i+1])}>{images.find(a=>a.id===mediaId)?.thumbnailDataUrl?<img src={images.find(a=>a.id===mediaId)!.thumbnailDataUrl} alt=""/>:<span>{i+1}</span>}<small>{i+1}</small></button>)}</div>
    <div className="heading-actions"><button className="button secondary small" disabled={disabled||index===0} onClick={()=>move(index,index-1)}>{t("向前移动")}</button><button className="button secondary small" disabled={disabled||index>=order.length-1} onClick={()=>move(index,index+1)}>{t("向后移动")}</button></div><p className="muted">{t("拖动缩略图调整顺序，点击保存修改后生效。预览不会提交发布。")}</p>
  </section>;
}
