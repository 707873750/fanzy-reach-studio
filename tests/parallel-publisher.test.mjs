import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {createInterface} from 'node:readline';
import ts from 'typescript';

const source=await fs.readFile('src/main/browser-publisher.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
let drafts=[], spawned=[], active=new Set(), maximum=0, starts=[], finished=[], failPlatform, crashPlatform, fallbackPlatform, lockedDuringCompletion=false;
const events=[];
const holdBefore = new Set(), holdAfter = new Set();
let prepareGate;
const waitFor = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};
const urlModule={exports:{}};
vm.runInNewContext(ts.transpileModule(await fs.readFile('src/shared/post-url.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:urlModule.exports,URL});
const store={
  findDraft:id=>drafts.find(d=>d.id===id),
  getAppPaths:()=>({base:'/fixture'}),
  getStore:()=>({settings:{},drafts}),
  persistStore:async()=>{},
  updateDraftRecord:(id,patch)=>Object.assign(store.findDraft(id),patch)
};
function spawn() {
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;
  let job;
  const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');
  child.stdin=new Writable({write(chunk,encoding,done){
    const message=JSON.parse(chunk.toString());
    if(message.ack) {
      assert.equal(message.ack,'persisted');
      assert.equal(store.findDraft(job.id).browserPublish.state,'uncertain');
      if (holdAfter.has(job.id)) { done(); return; }
      setTimeout(()=>{
        active.delete(job.platform);finished.push(job.id);
        assert.throws(()=>api.assertNotPublishing(job.id));lockedDuringCompletion=true;
        emit({type:'result',state:job.platform===failPlatform?'needs_attention':'succeeded',url:job.platform==='x'?'https://x.com/i/status/123456789':'https://www.tiktok.com/tiktokstudio/content'});
      },15);
    } else if(message.action==='publish') {
      job=message;
      assert.ok(!active.has(job.platform),'same platform must never overlap');
      active.add(job.platform);maximum=Math.max(maximum,active.size);starts.push(job.id);
      if(job.platform===fallbackPlatform && job.nativeScheduledAt) {active.delete(job.platform);emit({type:'result',state:'local_scheduled'});done();return;}
      if(store.findDraft(job.id).scheduleMode==='local') {assert.equal(job.nativeScheduledAt,null);assert.equal(job.xScheduledAt,null);}
      if(job.platform===crashPlatform) {active.delete(job.platform);emit({type:'fatal',message:'fixture process failure'});done();return;}
      if (!holdBefore.has(job.id)) emit({type:'submitting'});
    } else emit({type:'result',state:'opened'});
    done();
  }});
  child.kill=()=>{if(job) active.delete(job.platform);child.exitCode=1;child.emit('exit',1,null);};
  child.stdin.on('finish',()=>{if(job) active.delete(job.platform);child.exitCode=0;child.emit('exit',0,null);});
  spawned.push(child);return child;
}
const dependencies={
  electron:{app:{isPackaged:false,getAppPath:()=>'/fixture'},BrowserWindow:{getAllWindows:()=>[]}},
  'node:child_process':{spawn},'node:readline':{createInterface},
  'node:fs/promises':{readdir:async()=>['01-photo.jpg']},'node:fs':{existsSync:()=>true},'node:path':path,
  './store':store,'./draft-service':{prepareDraft:async id=>{if(prepareGate) await prepareGate;return {folder:'/fixture/'+id, files:['/fixture/'+id+'/01-photo.jpg'], mediaType:'image'};}},
  './publisher-runtime':{publisherCommand:()=>({command:'fixture-python',args:[]}),macSessionKey:()=>undefined},
  './run-logger':{log:async e=>events.push(e),errorDetail:String},
  '../shared/post-url':urlModule.exports,
  './performance-monitor':{setPerformancePublishing:()=>{}}
};
const sandbox={exports:{},require:name=>{assert.ok(name in dependencies,name);return dependencies[name];},process:{env:{}},setTimeout,clearTimeout};
vm.runInNewContext(compiled,sandbox);
const api=sandbox.exports;
const make=(id,platform)=>({id,platform,imageIds:['photo'],status:'draft'});
drafts=[make('x1','x'),make('x2','x'),make('t1','tiktok'),make('t2','tiktok')];
await api.openPlatformBrowser('x');await api.closePlatformBrowser('x');
const batch=api.publishDrafts(drafts.map(d=>d.id));
await assert.rejects(api.publishDrafts(['x1']),/已有发布批次/);
await batch;
assert.equal(spawned.length,2,'login and publishing reuse the same platform worker');
assert.equal(maximum,2,'different platforms overlap');
assert.ok(starts.indexOf('x2')>starts.indexOf('t1'));
assert.ok(drafts.every(d=>d.status==='published'));
assert.ok(drafts.filter(d=>d.platform==='x').every(d=>d.publishedUrl==='https://x.com/i/status/123456789'));
assert.ok(drafts.filter(d=>d.platform==='tiktok').every(d=>d.publishedUrl===null),'never store an upload/management page as the post URL');
assert.ok(lockedDuringCompletion);
api.assertNotPublishing('x1');

starts=[];finished=[];failPlatform='x';
drafts=[make('xf1','x'),make('xf2','x'),make('tf1','tiktok'),make('tf2','tiktok')];
await api.publishDrafts(drafts.map(d=>d.id));
assert.ok(!starts.includes('xf2'),'failed platform stops its later tasks');
assert.equal(store.findDraft('xf1').browserPublish.state,'uncertain');
assert.equal(store.findDraft('xf2').browserPublish.state,'needs_attention');
assert.equal(store.findDraft('tf2').status,'published','other platform continues');
failPlatform=undefined;crashPlatform='x';starts=[];
drafts=[make('xc1','x'),make('xc2','x'),make('tc1','tiktok'),make('tc2','tiktok')];
await api.publishDrafts(drafts.map(d=>d.id));
assert.equal(store.findDraft('xc1').browserPublish.state,'needs_attention');
assert.ok(!starts.includes('xc2'));
assert.equal(store.findDraft('tc2').status,'published');
crashPlatform=undefined; starts=[];
const future=new Date(Date.now()+3600000).toISOString();
drafts=[{...make('facebook-local','facebook'),publishAt:future}];
await api.publishDrafts(['facebook-local']);
assert.equal(store.findDraft('facebook-local').status,'local_scheduled');
assert.ok(!starts.includes('facebook-local'));
store.findDraft('facebook-local').publishAt=new Date(Date.now()-1000).toISOString();
await api.runDueScheduledDrafts();
assert.equal(store.findDraft('facebook-local').status,'published');
assert.equal(starts.filter(id=>id==='facebook-local').length,1);
drafts=[{...make('local','bluesky'),publishAt:future},{...make('native','x'),publishAt:future}];
await api.publishDrafts(['local','native']);
assert.equal(store.findDraft('local').status,'local_scheduled');
assert.ok(!starts.includes('local'),'future local jobs must not open a browser');
assert.equal(store.findDraft('native').status,'platform_scheduled');
assert.equal(store.findDraft('native').publishedUrl,null,'scheduled records must not contain a premature public permalink');
await assert.rejects(api.publishDrafts(['local']),/本地队列/);
await api.runDueScheduledDrafts();
assert.ok(!starts.includes('local'),'future jobs are not due');
store.findDraft('local').publishAt=new Date(Date.now()-1000).toISOString();
await Promise.all([api.runDueScheduledDrafts(),api.runDueScheduledDrafts()]);
await api.runDueScheduledDrafts();
assert.equal(starts.filter(id=>id==='local').length,1,'overlapping ticks publish exactly once');
assert.equal(store.findDraft('local').status,'published');
fallbackPlatform='pinterest'; starts=[];
drafts=[{...make('fallback','pinterest'),publishAt:future}];
await api.publishDrafts(['fallback']);
assert.equal(drafts[0].status,'local_scheduled');
assert.equal(drafts[0].scheduleMode,'local');
assert.equal(drafts[0].browserPublish,undefined,'fallback occurs before checkpoint');
drafts[0].publishAt=new Date(Date.now()-1000).toISOString();
failPlatform='pinterest';
await api.runDueScheduledDrafts();
assert.equal(drafts[0].browserPublish.state,'uncertain');
await api.runDueScheduledDrafts();
assert.equal(starts.length,2,'uncertain local publication must never auto-retry');
failPlatform=undefined; fallbackPlatform=undefined; starts=[];
drafts=[make('stop-before','x'),make('stop-next','x'),make('stop-after','tiktok'),make('stop-later','tiktok'),make('stop-complete','bluesky')];
holdBefore.add('stop-before'); holdAfter.add('stop-after');
const cancelledBatch=api.publishDrafts(drafts.map(d=>d.id));
await waitFor(()=>starts.includes('stop-before') && drafts[2].browserPublish?.state==='uncertain' && drafts[4].status==='published');
assert.equal(api.getPublishBatch().length,5);
await Promise.all([api.cancelPublishBatch(),api.cancelPublishBatch(),cancelledBatch]);
assert.equal(drafts[0].browserPublish.state,'needs_attention');
assert.equal(drafts[2].browserPublish.state,'uncertain');
assert.ok(drafts[2].browserPublish.submittedAt,'retain submission checkpoint for interrupted task');
assert.ok(!starts.includes('stop-next') && !starts.includes('stop-later'),'stop all queued platform tasks');
assert.ok(drafts[1].browserPublish.message.includes('尚未提交'));
assert.equal(drafts[4].status,'published','keep already confirmed successes when cancelling');
assert.equal(api.getPublishBatch().length,0);
drafts.forEach(d=>api.assertNotPublishing(d.id));
await assert.rejects(api.publishDrafts(['stop-after']),/核对/);
await api.publishDrafts(['stop-next']);
assert.equal(drafts[1].status,'published','a new batch works after cancellation');
await api.cancelPublishBatch(); // Idle cancellation is harmless.

let releasePreparation;
prepareGate=new Promise(resolve=>{releasePreparation=resolve;});
drafts=[make('stop-preparing','x')]; starts=[];
const preparingBatch=api.publishDrafts(['stop-preparing']);
await waitFor(()=>drafts[0].browserPublish?.state==='running');
const stopPreparing=api.cancelPublishBatch();
releasePreparation();
await Promise.all([preparingBatch,stopPreparing]);
prepareGate=undefined;
assert.equal(starts.length,0,'cancellation during preparation never launches a worker');
assert.equal(drafts[0].browserPublish.state,'needs_attention');
await api.stopPublisher();
assert.ok(spawned.every(child=>child.exitCode!==null));
console.log('PASS: concurrency, ordering, checkpoint isolation, cancellation before/after submission and preparation, queued tasks stopped, restart after cancellation, login reuse and shutdown');
