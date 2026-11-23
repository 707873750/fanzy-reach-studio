import { cropHit, dragCrop, type CropDrag } from "../../shared/crop-drag";
import { useEffect, useRef, useState } from "react";
import type { ImageAsset } from "../../shared/types";
import { emptyImageEdit, type ImageEditOptions, type ImagePreview } from "../../shared/image-edit";
import { t, useLanguage } from "./i18n";
const errorText=(error:unknown)=>String(error).replace(/^Error: /,"").replace(/^Error invoking remote method [^:]+: (?:Error: )?/,"");
export default function ImageEditor({image,images,onClose,onSaved}:{image:ImageAsset;images:ImageAsset[];onClose:()=>void;onSaved:(image:ImageAsset)=>Promise<void>}) {
  useLanguage();
  const source=images.find(a=>a.id===image.editSourceId);
  const sourceId=source?.id||image.id;
  const [options,setOptions]=useState<ImageEditOptions>(()=>source&&image.editOptions?structuredClone(image.editOptions):emptyImageEdit());
  const [base,setBase]=useState<ImagePreview>(), [result,setResult]=useState<ImagePreview>();
  const [error,setError]=useState(""),[saving,setSaving]=useState(false),[pending,setPending]=useState(true),[ratio,setRatio]=useState(0);
  const canvas=useRef<HTMLCanvasElement>(null), bitmap=useRef<HTMLImageElement | undefined>(undefined), dragging=useRef<CropDrag|null>(null);
  const latest=useRef(options);latest.current=options;
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  useEffect(()=>{let active=true;setBase(undefined);const value=emptyImageEdit();value.rotation=options.rotation;
    window.reach.previewImageEdit(sourceId,value).then(data=>{if(active)setBase(data);}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};
  },[sourceId,options.rotation]);
  useEffect(()=>{let active=true;setPending(true);setError("");const timer=setTimeout(()=>{
    window.reach.previewImageEdit(sourceId,options).then(data=>{if(active){setResult(data);setPending(false);}}).catch(e=>{if(active){setError(errorText(e));setPending(false);}});
  },250);return()=>{active=false;clearTimeout(timer);};},[sourceId,options]);
  function draw() {
    const node=canvas.current,img=bitmap.current;if(!node||!img)return;
    const ctx=node.getContext("2d")!;ctx.clearRect(0,0,node.width,node.height);ctx.drawImage(img,0,0,node.width,node.height);
    const c=latest.current.crop,x=c.x*node.width,y=c.y*node.height,w=c.width*node.width,h=c.height*node.height;
    ctx.fillStyle="rgba(0,0,0,.6)";ctx.beginPath();ctx.rect(0,0,node.width,node.height);ctx.rect(x,y,w,h);ctx.fill("evenodd");
    ctx.strokeStyle="#b5a4ff";ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,w-2,h-2);
    if(!ratio){
      const bounds=node.getBoundingClientRect(),sx=8*node.width/(bounds.width||node.width),sy=8*node.height/(bounds.height||node.height);
      ctx.fillStyle="#ffffff";for(const [hx,hy] of [[x,y],[x+w/2,y],[x+w,y],[x,y+h/2],[x+w,y+h/2],[x,y+h],[x+w/2,y+h],[x+w,y+h]])ctx.fillRect(hx-sx/2,hy-sy/2,sx,sy);
    }
    ctx.strokeStyle="rgba(255,255,255,.4)";ctx.lineWidth=1;for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(x+w*i/3,y);ctx.lineTo(x+w*i/3,y+h);ctx.moveTo(x,y+h*i/3);ctx.lineTo(x+w,y+h*i/3);ctx.stroke();}
  }
  useEffect(()=>{if(!base)return;let active=true;const img=new Image();img.onload=()=>{if(!active)return;bitmap.current=img;draw();};img.src=base.dataUrl;return()=>{active=false;};},[base]);
  useEffect(()=>{draw();},[options,base,ratio]);
  function crop(width:number,height:number) {setOptions(o=>({...o,crop:{x:Math.min(o.crop.x,1-width),y:Math.min(o.crop.y,1-height),width,height}}));}
  function selectRatio(value:number) {setRatio(value);if(!base||!value)return;const relative=value/(base.width/base.height);crop(Math.min(1,relative),Math.min(1,1/relative));}
  function resize(width:number) {if(ratio&&base){const height=width*(base.width/base.height)/ratio;if(height>1){crop(ratio/(base.width/base.height),1);}else crop(width,height);}else crop(width,options.crop.height);}
  const range=(label:string,value:number,min:number,max:number,change:(n:number)=>void)=><label className="edit-range">{t(label)}<input type="range" min={min} max={max} step={.01} value={value} onChange={e=>change(Number(e.target.value))}/><output>{Math.round(value*100)}%</output></label>;
  const watermark=(patch:Partial<ImageEditOptions["watermark"]>)=>setOptions(o=>({...o,watermark:{...o.watermark,...patch}}));
  return <dialog ref={dialog} className="image-editor-dialog" onCancel={e=>{e.preventDefault();if(!saving)onClose();}} aria-labelledby="image-editor-heading"><div className="image-editor">
    <header><div><h2 id="image-editor-heading">{t("图片编辑")}</h2><p>{image.fileName}</p></div><button className="button secondary" disabled={saving} onClick={onClose}>{t("关闭")}</button></header>
    <p className="muted">{t("原图保持不变，保存为新的素材副本。动图仅编辑第一帧。")}</p>
    <div className="image-editor-layout"><section className="edit-stage"><h3>{t("裁剪区域")}</h3><p className="muted">{ratio?t("拖动裁剪框调整位置，也可使用下方滑块。"):t("拖动整图或框外重新框选；拖动框内移动，拖动边角缩放。")}</p>
      {base?<canvas ref={canvas} width={Math.round(Math.min(760,760*base.width/base.height))} height={Math.round(Math.min(760,760*base.height/base.width))} aria-label={t("拖动裁剪区域")} onPointerDown={e=>{if(saving||e.button!==0)return;e.preventDefault();const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
        dragging.current={mode:cropHit(options.crop,x,y,10/r.width,10/r.height,!ratio),x,y,crop:{...options.crop}};e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
        if(dragging.current){const crop=dragCrop(dragging.current,x,y);setOptions(o=>({...o,crop}));return;}
        const mode=cropHit(options.crop,x,y,10/r.width,10/r.height,!ratio);e.currentTarget.style.cursor=mode==="draw"?"crosshair":mode==="move"?"grab":`${mode}-resize`;
      }} onPointerUp={e=>{dragging.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{dragging.current=null;}} onLostPointerCapture={()=>{dragging.current=null;}}/>:<p>{t("正在生成预览…")}</p>}
      <h3>{t("编辑效果")}</h3>{result&&<img className={pending?"preview-pending":""} src={result.dataUrl} alt={t("编辑效果")}/>}<p role="status">{pending?t("正在生成预览…"):result?`${result.width} × ${result.height}`:""}</p>
    </section><fieldset disabled={saving||!base} className="edit-controls"><label>{t("裁剪比例")}<select value={ratio} onChange={e=>selectRatio(Number(e.target.value))}><option value={0}>{t("自由裁剪")}</option><option value={1}>1:1</option><option value={.8}>4:5</option><option value={9/16}>9:16</option><option value={16/9}>16:9</option></select></label>
    <button className="button secondary" onClick={()=>{setRatio(0);setOptions(o=>({...o,rotation:((o.rotation+90)%360) as ImageEditOptions["rotation"],crop:emptyImageEdit().crop}));}}>{t("顺时针旋转 90°")}</button>
    {range("裁剪宽度",options.crop.width,.01,1,resize)}{!ratio&&range("裁剪高度",options.crop.height,.01,1,h=>crop(options.crop.width,h))}
    {range("水平位置",options.crop.x,0,1-options.crop.width,x=>setOptions(o=>({...o,crop:{...o.crop,x}})))}
    {range("垂直位置",options.crop.y,0,1-options.crop.height,y=>setOptions(o=>({...o,crop:{...o.crop,y}})))}
    <h3>{t("文字水印")}</h3><label>{t("水印文字")}<input maxLength={100} value={options.watermark.text} onChange={e=>watermark({text:e.target.value})} placeholder={t("留空不添加水印")}/></label>
    <label>{t("文字颜色")}<input type="color" value={options.watermark.color} onChange={e=>watermark({color:e.target.value})}/></label>
    {range("文字大小",options.watermark.size,.01,.2,size=>watermark({size}))}{range("水印不透明度",options.watermark.opacity,0,1,opacity=>watermark({opacity}))}
    {range("水印水平位置",options.watermark.x,0,1,x=>watermark({x}))}{range("水印垂直位置",options.watermark.y,0,1,y=>watermark({y}))}
    <button className="button secondary" onClick={()=>{setOptions(emptyImageEdit());setRatio(0);}}>{t("重置编辑")}</button>
    <p className="muted">{t("请检查水印是否超出边缘，预览显示最终裁剪效果。")}</p>
    </fieldset></div><p role="alert" className="edit-error">{t(error)}</p><footer><button className="button primary" disabled={saving||pending||!result||!!error} onClick={async()=>{setSaving(true);setError("");try{const saved=await window.reach.saveImageEdit(sourceId,options);await onSaved(saved);}catch(e){setError(errorText(e));}finally{setSaving(false);}}}>{saving?t("正在保存副本…"):t("保存为新素材")}</button></footer>
  </div></dialog>;
}
