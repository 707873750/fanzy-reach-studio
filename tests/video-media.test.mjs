import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';

const nativeRequire = createRequire(import.meta.url);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reach-video-'));
const data = { images: [], drafts: [], settings: {} };
const paths = Object.fromEntries(['assets','thumbnails','exports'].map(name => [name,path.join(root,name)]));
let saved;
const store = { getStore:()=>data, getAppPaths:()=>paths, findImage:id=>data.images.find(a=>a.id===id), findDraft:id=>data.drafts.find(d=>d.id===id), persistStore:async()=>{saved=JSON.parse(JSON.stringify(data));}, updateDraftRecord:(id,patch)=>Object.assign(store.findDraft(id),patch) };
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fsSync.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText, {
    exports, Buffer, console, process, setTimeout, clearTimeout,
    require:name=>name==='./store'?store:name==='electron'?{}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):nativeRequire(name)
  });
  return exports;
}
try {
  await Promise.all(Object.values(paths).map(dir=>fs.mkdir(dir)));
  const source = path.join(root,'video.mp4');
  await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=720x1280:r=30','-t','4','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true});
  const service = load('src/main/image-service.ts');
  load('src/shared/accounts.ts').migrateAccounts(data);
  const drafts = load('src/main/draft-service.ts');
  const rules = load('src/shared/video-rules.ts');
  const result = await service.importFiles([source],root);
  assert.deepEqual(Array.from(result.errors),[]);
  const asset = data.images[0];
  assert.equal(asset.video.codec,'h264'); assert.equal(asset.video.duration,4);
  assert.equal(asset.width,720); assert.equal(asset.height,1280);
  assert.ok((await service.listImages())[0].thumbnailDataUrl.startsWith('data:image/webp'));
  const platforms = Object.keys(rules.VIDEO_RULES);
  const created = await drafts.createDrafts([asset.id],platforms);
  assert.equal(created.length,6);
  assert.ok(created.every(d=>d.mediaType==='video'&&d.imageIds.length===1));
  for (const draft of created) {
    const prepared = await drafts.prepareDraft(draft.id,false);
    assert.equal(prepared.mediaType,'video');
    assert.equal(prepared.files.length,1);
    assert.equal(path.extname(prepared.files[0]),'.mp4');
    assert.deepEqual(await fs.readFile(prepared.files[0]),await fs.readFile(source),'never process video through Sharp or silently trim it');
  }
  for (const platform of platforms) {
    const rule = rules.VIDEO_RULES[platform];
    assert.ok(rules.videoIssues({...asset,size:rule.maxBytes+1},platform).length);
    assert.ok(rules.videoIssues({...asset,video:{...asset.video,duration:rule.maxSeconds+1}},platform).length);
    assert.equal(rules.videoIssues({...asset,video:{...asset.video,duration:rule.maxSeconds}},platform).length,0);
    assert.ok(rules.videoIssues({...asset,video:{...asset.video,codec:'hevc'}},platform).length);
  }
  assert.ok(rules.videoIssues({...asset,video:{...asset.video,duration:3.9}},'pinterest').length);
  assert.ok(rules.videoIssues({...asset,width:640},'instagram').length);
  assert.ok(rules.videoIssues({...asset,video:{...asset.video,fps:61}},'x').length);
  const photo = {id:'photo',mimeType:'image/jpeg'};
  assert.equal(JSON.stringify(rules.groupMedia([photo,asset,{...photo,id:'photo2'},asset],10)),JSON.stringify([['photo'],[asset.id],['photo2'],[asset.id]]));
  const count = data.drafts.length;
  asset.video.duration = 301;
  await assert.rejects(drafts.createDrafts([asset.id],['facebook','pinterest']),/Pinterest/);
  assert.equal(data.drafts.length,count,'invalid multi-platform batches must not leave partial drafts');
  asset.video.duration = 4;
  data.drafts = [];
  await service.deleteImage(asset.id);
  assert.equal(saved.images.length,0);
  await fs.access(source);
  console.log('PASS: real video import, metadata, thumbnail, six-platform exports, limits, mixed grouping and immediate deletion');
} finally {
  await fs.rm(root,{recursive:true,force:true});
}
