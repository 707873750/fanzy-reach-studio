export interface ImageEditOptions {
  rotation: 0 | 90 | 180 | 270;
  crop: { x: number; y: number; width: number; height: number };
  watermark: { text: string; x: number; y: number; size: number; opacity: number; color: string };
}
export interface ImagePreview { dataUrl: string; width: number; height: number; }
export const emptyImageEdit = (): ImageEditOptions => ({rotation:0,crop:{x:0,y:0,width:1,height:1},watermark:{text:"",x:.5,y:.9,size:.05,opacity:.8,color:"#ffffff"}});
