import type { ImageEditOptions } from "./image-edit";
type Crop = ImageEditOptions["crop"];
export type CropMode = "move" | "draw" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
export interface CropDrag { mode: CropMode; x: number; y: number; crop: Crop; }
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
export function dragCrop(d:CropDrag, x:number,y:number):Crop {
  x=clamp(x);y=clamp(y);const c=d.crop;
  if(d.mode==="move") return {...c,x:clamp(c.x+x-d.x,0,1-c.width),y:clamp(c.y+y-d.y,0,1-c.height)};
  if(d.mode==="draw") {
    const left=Math.min(clamp(d.x),x,.99),top=Math.min(clamp(d.y),y,.99);
    return {x:left,y:top,width:Math.max(.01,Math.abs(x-d.x)),height:Math.max(.01,Math.abs(y-d.y))};
  }
  let left=c.x,top=c.y,right=c.x+c.width,bottom=c.y+c.height;
  if(d.mode.includes("w"))left=clamp(c.x+x-d.x,0,right-.01);
  if(d.mode.includes("e"))right=clamp(right+x-d.x,left+.01,1);
  if(d.mode.includes("n"))top=clamp(c.y+y-d.y,0,bottom-.01);
  if(d.mode.includes("s"))bottom=clamp(bottom+y-d.y,top+.01,1);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function cropHit(c:Crop,x:number,y:number,tx:number,ty:number,free:boolean):CropMode {
  if(free){
    const nearX=x>=c.x-tx&&x<=c.x+c.width+tx,nearY=y>=c.y-ty&&y<=c.y+c.height+ty;
    const h=nearY?(Math.abs(x-c.x)<tx?"w":Math.abs(x-c.x-c.width)<tx?"e":""):"";
    const v=nearX?(Math.abs(y-c.y)<ty?"n":Math.abs(y-c.y-c.height)<ty?"s":""):"";
    if(h||v)return (v+h) as CropMode;
    if((c.width===1&&c.height===1)||x<c.x||x>c.x+c.width||y<c.y||y>c.y+c.height)return "draw";
  }
  return "move";
}
