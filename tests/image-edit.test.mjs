import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=await fs.mkdtemp(path.join(os.tmpdir(),'fanzy-edit-'));
const data={images:[],drafts:[],settings:{}},paths={assets:path.join(root,'assets'),thumbnails:path.join(root,'thumbnails'),exports:path.join(root,'exports')};
let failSave=false;
const store={getStore:()=>data,getAppPaths:()=>paths,findImage:id=>data.images.find(a=>a.id===id),findDraft:id=>data.drafts.find(d=>d.id===id),persistStore:async()=>{if(failSave)throw Error('fixture disk failure');},updateDraftRecord:(id,patch)=>Object.assign(store.findDraft(id),patch)};
const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fsSync.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,Buffer,process,console,require:n=>n==='./store'?store:n==='electron'?{}:n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n)});return exports;}
try {
 await Promise.all(Object.values(paths).map(p=>fs.mkdir(p)));
 const pixels=Buffer.alloc(480*320*3);for(let y=0;y<320;y++)for(let x=0;x<480;x++)pixels[(y*480+x)*3+(x<240?0:2)]=255;
 const input=await sharp(pixels,{raw:{width:480,height:320,channels:3}}).png().toBuffer();const file=path.join(paths.assets,'original.png');await fs.writeFile(file,input);
 data.images.push({id:'original',originalPath:file,thumbnailPath:file,fileName:'original.png',mimeType:'image/png',width:480,height:320,sha256:'original',size:input.length,createdAt:'original'});
 const render=load('src/main/image-render.ts'),edit=load('src/main/image-editor.ts'),empty=load('src/shared/image-edit.ts').emptyImageEdit;
 const options=empty();options.crop={x:.5,y:0,width:.5,height:1};
 const cropped=await render.renderEditedImage(input,options);let metadata=await sharp(cropped).metadata();assert.equal(metadata.width,240);assert.equal(metadata.height,320);
 const pixel=await sharp(cropped).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.deepEqual([...pixel.slice(0,3)],[0,0,255]);
 options.rotation=90;options.crop=empty().crop;metadata=await sharp(await render.renderEditedImage(input,options)).metadata();assert.equal(metadata.width,320);assert.equal(metadata.height,480);
 const oriented=await sharp(input).jpeg().withMetadata({orientation:6}).toBuffer();metadata=await sharp(await render.renderEditedImage(oriented,empty())).metadata();assert.equal(metadata.width,320);assert.equal(metadata.height,480);
 options.rotation=0;options.watermark.text='Brand <tag> & 日本語 한국어';options.watermark.y=.5;
 const marked=await render.renderEditedImage(input,options);assert.notDeepEqual(marked,await render.renderEditedImage(input,empty()));
 for(const invalid of [null,{...empty(),rotation:45},{...empty(),crop:{x:.8,y:0,width:.5,height:1}},{...empty(),crop:{x:0,y:0,width:NaN,height:1}},{...empty(),watermark:{...empty().watermark,text:'x'.repeat(101)}}]) await assert.rejects(render.renderEditedImage(input,invalid),/参数无效/);
 const saved=await edit.saveImageEdit('original',options);assert.notEqual(saved.id,'original');assert.equal(saved.editSourceId,'original');assert.equal(saved.originalPath,undefined);assert.deepEqual(await fs.readFile(file),input);assert.equal(data.images.length,2);
 const draftService=load('src/main/draft-service.ts');
 for(const platform of Object.keys(render.PLATFORM_SIZES)){
   const d={id:'draft-'+platform,platform,imageIds:[saved.id],caption:'Copy',title:'',hashtags:[],altText:'',status:'draft'};data.drafts.push(d);
   const snapshot=JSON.stringify(data.drafts);const preview=await edit.previewPublishImage(saved.id,platform);assert.equal(JSON.stringify(data.drafts),snapshot,'preview cannot mutate drafts');
   const exported=await draftService.prepareDraft(d.id,false);const expected=await render.renderPublishImage(data.images[0].originalPath,platform);
   assert.deepEqual(await fs.readFile(exported.files[0]),expected,'preview and publisher share export rendering');assert.equal(preview.width,480);assert.equal(preview.height,320);
 }
 const d={id:'order',platform:'x',imageIds:['original',saved.id],status:'draft'};data.drafts.push(d);await draftService.updateDraft(d.id,{imageIds:[saved.id,'original']});assert.equal(d.imageIds[0],saved.id);
 await assert.rejects(draftService.updateDraft(d.id,{imageIds:['original','original']}),/顺序/);d.status='local_scheduled';await assert.rejects(draftService.updateDraft(d.id,{imageIds:['original',saved.id]}),/取消/);
 failSave=true;const count=data.images.length,files=await fs.readdir(paths.assets);await assert.rejects(edit.saveImageEdit('original',empty()));assert.equal(data.images.length,count);assert.deepEqual(await fs.readdir(paths.assets),files);
 assert.deepEqual(await fs.readFile(file),input);await assert.rejects(edit.previewImageEdit('missing',empty()));
 console.log('PASS: EXIF, rotation, precise crop pixels, escaped multilingual watermark, validation, original preservation, save rollback, six-platform export parity, read-only preview and order protection');
}finally{await fs.rm(root,{recursive:true,force:true});}
