import sharp from "sharp";
import type { Platform } from "../shared/types";
import type { ImageEditOptions } from "../shared/image-edit";
export const PLATFORM_SIZES: Record<Platform, { width: number; height: number }> = {
  facebook:{width:2048,height:2048},bluesky:{width:1600,height:1600},instagram:{width:1080,height:1350},
  x:{width:1600,height:900},pinterest:{width:1000,height:1500},tiktok:{width:1080,height:1920}
};
export function renderPublishImage(input: string | Buffer, platform: Platform) {
  const size = PLATFORM_SIZES[platform];
  if (!size) throw new Error("无效的平台");
  return sharp(input).rotate().resize(size.width,size.height,{fit:"inside",withoutEnlargement:true,background:"#ffffff"})
    .flatten({background:"#ffffff"}).jpeg({quality:90,mozjpeg:true}).toBuffer();
}
export function validateImageEdit(value: ImageEditOptions): ImageEditOptions {
  const c=value?.crop, w=value?.watermark;
  const unit=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=1;
  if (!value || ![0,90,180,270].includes(value.rotation) || !c || !w ||
    ![c.x,c.y,c.width,c.height,w.x,w.y,w.opacity].every(unit) || c.width<.01 || c.height<.01 ||
    c.x+c.width>1.000001 || c.y+c.height>1.000001 || typeof w.text!=="string" || w.text.length>100 ||
    /[\x00-\x1f]/.test(w.text) || typeof w.size!=="number" || !Number.isFinite(w.size) || w.size<.01 || w.size>.2 || !/^#[0-9a-f]{6}$/i.test(w.color)) throw new Error("图片编辑参数无效");
  return {rotation:value.rotation,crop:{...c},watermark:{...w}};
}
const xml=(text:string)=>text.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export async function renderEditedImage(input: string | Buffer, options: ImageEditOptions) {
  const value=validateImageEdit(options);
  // Materialize EXIF orientation before an explicit rotation or crop.
  const oriented=await sharp(input,{animated:false,limitInputPixels:60_000_000}).rotate().png().toBuffer();
  const {data,info}=await sharp(oriented).rotate(value.rotation).png().toBuffer({resolveWithObject:true});
  const c=value.crop;
  const left=Math.min(info.width-1,Math.round(c.x*info.width)), top=Math.min(info.height-1,Math.round(c.y*info.height));
  const width=Math.max(1,Math.min(info.width-left,Math.round(c.width*info.width))), height=Math.max(1,Math.min(info.height-top,Math.round(c.height*info.height)));
  const cropped=await sharp(data).extract({left,top,width,height}).png().toBuffer();
  const w=value.watermark;
  if (!w.text.trim()) return cropped;
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${w.x*width}" y="${w.y*height}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${Math.max(1,w.size*width)}" fill="${w.color}" opacity="${w.opacity}">${xml(w.text)}</text></svg>`);
  return sharp(cropped).composite([{input:svg}]).png().toBuffer();
}
