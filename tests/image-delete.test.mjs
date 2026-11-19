import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const nativeRequire = createRequire(import.meta.url);
const lifecycleSource = await fs.readFile('src/shared/draft-lifecycle.ts','utf8');
const lifecycleCompiled = ts.transpileModule(lifecycleSource, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const lifecycle = await import('data:text/javascript;base64,' + Buffer.from(lifecycleCompiled).toString('base64'));
const image = {id:'image', fileName:'source.jpg', originalPath:'/library/assets/image.jpg', thumbnailPath:'/library/thumbnails/image.webp'};
let data, removed, saved, failure;
const sandbox = {exports:{}, require:name => {
  if (name === './store') return {getStore:()=>data, persistStore:async()=>{saved=JSON.stringify(data);}};
  if (name === '../shared/draft-lifecycle') return lifecycle;
  if (name === 'node:fs/promises') return {rm:async (file, options)=>{
    assert.equal(options.force, true);
    if (file === failure) throw Error('Access denied');
    removed.push(file);
  }};
  if (name === 'sharp') return ()=>{};
  return nativeRequire(name);
}};
const compiled = ts.transpileModule(await fs.readFile('src/main/image-service.ts','utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
vm.runInNewContext(compiled, sandbox);
const reset = drafts => {data={images:[{...image}],drafts};removed=[];saved=null;failure=null;};
for (const status of ['draft','ready','prepared','scheduled','reminder_due']) {
  reset([{id:'task',imageIds:['image'],status}]);
  await assert.rejects(sandbox.exports.deleteImage('image'), /未完成的草稿/);
  assert.equal(data.images.length,1);
  assert.equal(removed.length,0);
  assert.equal(saved,null);
}
const records = [
  {id:'completed',imageIds:['image'],status:'published'},
  {id:'platform-scheduled',imageIds:['image'],status:'platform_scheduled'},
  {id:'legacy-success',imageIds:['image'],status:'prepared',browserPublish:{state:'succeeded'}},
  {id:'legacy-scheduled',imageIds:['image'],status:'prepared',browserPublish:{state:'scheduled'}}
];
for (const record of records) {
  reset([record]);
  const historyBefore = JSON.stringify(data.drafts);
  await sandbox.exports.deleteImage('image');
  assert.deepEqual(removed,[image.originalPath,image.thumbnailPath]);
  assert.equal(JSON.parse(saved).images.length,0);
  assert.equal(JSON.stringify(data.drafts),historyBefore,'preserve the complete publishing record');
}
for (const state of ['running','uncertain','needs_attention']) {
  reset([...records, {id:'unfinished',imageIds:['image'],status:'prepared',browserPublish:{state}}]);
  await assert.rejects(sandbox.exports.deleteImage('image'), /未完成的草稿/);
  assert.equal(data.images.length,1,'an unfinished draft still protects a shared image');
  assert.equal(removed.length,0);
  assert.equal(saved,null);
}
reset([]);
failure=image.originalPath;
await assert.rejects(sandbox.exports.deleteImage('image'), /Access denied/);
assert.equal(data.images.length,1,'failed file removal keeps the library record available for retry');
assert.equal(saved,null);
failure=null;
await sandbox.exports.deleteImage('image');
assert.equal(data.images.length,0);
reset([]);
await sandbox.exports.deleteImage('missing');
assert.equal(removed.length,0);
assert.equal(data.images.length,1);
console.log('PASS: occupied asset protection, library-only file deletion, preserved history, failed removal retry and stale IDs');
