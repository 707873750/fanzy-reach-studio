import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { findImage, getAppPaths, getStore, persistStore, type StoredImage } from "./store";
import { renderEditedImage, renderPublishImage, validateImageEdit } from "./image-render";
import type { ImageEditOptions, ImagePreview } from "../shared/image-edit";
import type { Platform } from "../shared/types";
function source(id:string) {
  const image=findImage(id);
  if (!image || !image.mimeType.startsWith("image/")) throw new Error("请选择可编辑的图片");
  return image;
}
function processingError(error:unknown):never {
  if(error instanceof Error && ["图片编辑参数无效","无效的平台"].includes(error.message)) throw error;
  throw new Error("图片处理失败，请检查素材文件或稍后重试。",{cause:error});
}
async function preview(data:Buffer):Promise<ImagePreview> {
  const meta=await sharp(data).metadata();
  const bytes=await sharp(data).resize(1200,1200,{fit:"inside",withoutEnlargement:true}).png().toBuffer();
  return {dataUrl:`data:image/png;base64,${bytes.toString("base64")}`,width:meta.width!,height:meta.height!};
}
export async function previewImageEdit(id:string, options:ImageEditOptions) {
  return preview(await renderEditedImage(source(id).originalPath,options).catch(processingError));
}
export async function saveImageEdit(id:string, options:ImageEditOptions) {
  const original=source(id), edit=validateImageEdit(options);
  const data=await renderEditedImage(original.originalPath,edit).catch(processingError), metadata=await sharp(data).metadata();
  const newId=crypto.randomUUID(), paths=getAppPaths();
  const originalPath=path.join(paths.assets,`${newId}.png`), thumbnailPath=path.join(paths.thumbnails,`${newId}.webp`);
  const image:StoredImage={id:newId,fileName:`${path.parse(original.fileName).name}-edited.png`,mimeType:"image/png",width:metadata.width!,height:metadata.height!,size:data.length,
    sha256:crypto.createHash("sha256").update(data).digest("hex"),createdAt:new Date().toISOString(),originalPath,thumbnailPath,
    sourceFolders:[...(original.sourceFolders||[])],tags:[...(original.tags||[])],editSourceId:id,editOptions:edit};
  try {
    await fs.writeFile(originalPath,data,{flag:"wx"});
    await sharp(data).resize(360,360,{fit:"inside",withoutEnlargement:true}).webp({quality:78}).toFile(thumbnailPath);
    getStore().images.unshift(image);
    await persistStore();
  } catch(error) {
    getStore().images=getStore().images.filter(a=>a.id!==newId);
    await Promise.allSettled([fs.rm(originalPath,{force:true}),fs.rm(thumbnailPath,{force:true})]);
    processingError(error);
  }
  const {originalPath:_original,thumbnailPath:_thumbnail,...safe}=image;
  return safe;
}
const cache=new Map<string,ImagePreview>();
export async function previewPublishImage(id:string, platform:Platform) {
  const image=source(id), key=`${image.id}:${image.sha256}:${platform}`;
  if(cache.has(key)) return cache.get(key)!;
  const result=await preview(await renderPublishImage(image.originalPath,platform).catch(processingError));
  if(cache.size>=12) cache.delete(cache.keys().next().value!);
  cache.set(key,result); return result;
}
