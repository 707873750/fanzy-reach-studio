// Run after npm run build: electron tests/draft-workflow-desktop.cjs
// Isolated fixture data; no access to the user's store or publishing services.
if (process.type === 'renderer') {
  const make = (id, extra = {}) => ({id, platform:'x', imageIds:[], title:id, caption:`文案 ${id}`, hashtags:[], altText:'', status:'draft', scheduledAt:null, preparedFolder:null, publishedUrl:null, createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z', ...extra});
  const fixture = window.fixture = {
    drafts:[make('plain'), make('failed', {browserPublish:{state:'needs_attention',message:'尚未提交'}}), make('uncertain', {browserPublish:{state:'uncertain',message:'请核对结果'}}), make('published', {status:'published'}), make('platform-scheduled', {status:'platform_scheduled',xScheduledAt:'2030-01-01T00:00:00Z'})],
    images:['free-a','free-b','blocked'].map(id=>({id,fileName:`${id}.jpg`,width:800,height:600})),
    deletedImages:[], imageBlocked:true,
    deleted:[], deletedRecords:[], failRecordDelete:false, progress:()=>{}
  };
  window.reach = {
    listImages:async()=>structuredClone(fixture.images), listDrafts:async()=>structuredClone(fixture.drafts),
    deleteImage:async id=>{if(id==='blocked' && fixture.imageBlocked) throw Error('图片正被草稿使用');fixture.deletedImages.push(id);fixture.images=fixture.images.filter(image=>image.id!==id);},
    getSettings:async()=>({hasDeepSeekKey:false,model:'deepseek-flash'}),
    getBrowserSettings:async()=>({showBrowser:false,channel:'chrome'}),
    onScheduleReminder:()=>()=>{}, onPublishProgress:fn=>{fixture.progress=fn;return()=>{};},
    reportUiPerformance:async()=>{}, reportRendererError:async()=>{},
    deleteDrafts:async ids=>{fixture.deleted.push([...ids]);fixture.drafts=fixture.drafts.filter(d=>!ids.includes(d.id));return ids.length;},
    deletePublishRecords:async ids=>{if(fixture.failRecordDelete) throw Error('测试：记录删除失败');fixture.deletedRecords.push([...ids]);fixture.drafts=fixture.drafts.filter(d=>!ids.includes(d.id));return ids.length;},
    markPublished:async id=>{const draft=fixture.drafts.find(d=>d.id===id);draft.status='published';return structuredClone(draft);}
  };
} else {
  const {app,BrowserWindow}=require('electron');
  const assert=require('node:assert/strict');
  const fs=require('node:fs');
  const os=require('node:os');
  const path=require('node:path');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fanzy-draft-workflow-'));
  app.setPath('userData',profile);
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:__filename,sandbox:false,contextIsolation:false}});
    const evaluate=code=>win.webContents.executeJavaScript(code);
    const waitFor=async code=>{
      for(let i=0;i<100;i++) {if(await evaluate(code)) return;await new Promise(resolve=>setTimeout(resolve,30));}
      throw Error(`Timed out: ${code}`);
    };
    const click=async text=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);};
    try {
      await win.loadFile(path.resolve('out/renderer/index.html'));
      await waitFor(`document.querySelector('.stat-card:last-child strong')?.textContent==='3'`);
      await click('全选');
      await waitFor(`document.querySelectorAll('.image-card[aria-pressed="true"]').length===3`);
      await click('清空选择');
      await waitFor(`document.querySelectorAll('.image-card[aria-pressed="true"]').length===0`);
      const search=async value=>evaluate(`(()=>{const input=document.querySelector('.search-box input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await search('free-');
      await waitFor(`document.querySelectorAll('.image-card').length===2`);
      await click('全选当前结果');
      await waitFor(`document.querySelectorAll('.image-card[aria-pressed="true"]').length===2`);
      await click('删除所选');
      await waitFor(`document.querySelector('.delete-confirm')?.textContent.includes('选中的 2 张')`);
      await click('取消');
      await waitFor(`!document.querySelector('.delete-confirm')`);
      assert.equal(await evaluate('window.fixture.deletedImages.length'),0);
      await search('');
      await waitFor(`document.querySelectorAll('.image-card').length===3`);
      await click('全选');
      await waitFor(`document.querySelectorAll('.image-card[aria-pressed="true"]').length===3`);
      await click('删除所选');
      await waitFor(`document.querySelector('.delete-confirm')?.textContent.includes('选中的 3 张')`);
      await click('确认删除素材');
      await waitFor(`document.querySelectorAll('.image-card').length===1 && !document.querySelector('.busy-bar')`);
      assert.equal(await evaluate(`document.querySelector('.image-card').getAttribute('aria-pressed')`),'true');
      assert.ok(await evaluate(`document.querySelector('.notice').textContent.includes('已删除 2 张素材') && document.querySelector('.notice').textContent.includes('1 张未删除')`));
      assert.deepEqual(await evaluate('window.fixture.deletedImages'),['free-a','free-b']);
      await evaluate('window.fixture.imageBlocked=false');
      await click('删除所选');
      await waitFor(`!!document.querySelector('.delete-confirm')`);
      await click('确认删除素材');
      await waitFor(`document.querySelectorAll('.image-card').length===0 && document.querySelector('.stat-card:nth-child(2) strong')?.textContent==='0'`);
      assert.ok(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('删除所选')).disabled`));
      console.log('PASS: library select all, filtered selection, clear, delete cancellation, mixed batch results and retry cleanup');
      await click('发布队列');
      await waitFor(`document.querySelectorAll('.draft-select-row').length===3`);
      assert.equal(await evaluate(`document.querySelectorAll('.draft-select-row input:disabled').length`),1);
      await click('发布记录');
      await waitFor(`document.querySelectorAll('.draft-row').length===2`);
      assert.equal(await evaluate(`document.querySelectorAll('.draft-detail input,.draft-detail textarea').length`),0,'history is read only');
      assert.ok(await evaluate(`document.querySelector('.draft-list').textContent.includes('平台已排程')`));
      await click('发布队列');
      await waitFor(`document.querySelectorAll('.draft-select-row').length===3`);
      await click('全选可删除草稿');
      await waitFor(`document.querySelectorAll('.draft-select-row input:checked').length===2`);
      await click('批量删除');
      await waitFor(`!!document.querySelector('.delete-confirm')`);
      await click('取消');
      await waitFor(`!document.querySelector('.delete-confirm')`);
      assert.equal(await evaluate('window.fixture.deleted.length'),0);
      // A successful progress update immediately removes the task and its selection.
      await evaluate(`(()=>{const d=window.fixture.drafts.find(d=>d.id==='plain');d.status='published';window.fixture.progress(structuredClone(d));})()`);
      await waitFor(`document.querySelectorAll('.draft-select-row').length===2 && document.querySelectorAll('.draft-select-row input:checked').length===1`);
      await click('批量删除');
      await waitFor(`document.querySelector('.delete-confirm')?.textContent.includes('这 1 条')`);
      await click('确认删除');
      await waitFor(`document.querySelectorAll('.draft-select-row').length===1 && !document.querySelector('.delete-confirm')`);
      assert.deepEqual(await evaluate('window.fixture.deleted'),[['failed']]);
      assert.equal(await evaluate(`document.querySelector('.draft-select-row input').disabled`),true);
      // Manual completion also moves the task out of the detail panel and queue.
      await evaluate(`document.querySelector('.draft-row').click()`);
      await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('标记为已发布'))`);
      await click('标记为已发布');
      await waitFor(`document.querySelectorAll('.draft-select-row').length===0 && !!document.querySelector('.empty-mini')`);
      await click('发布记录');
      await waitFor(`document.querySelectorAll('.draft-row').length===4`);
      console.log('PASS: Electron history separation, read-only detail, selection, cancel/delete, progress cleanup and manual completion');
      await click('全选');
      await waitFor(`document.querySelectorAll('.draft-select-row input:checked').length===4`);
      await click('删除所选记录');
      await waitFor(`document.querySelector('.delete-confirm')?.textContent.includes('这 4 条')`);
      assert.ok(await evaluate(`document.querySelector('.delete-confirm').textContent.includes('平台上的帖子和排程')`));
      await click('取消');
      await waitFor(`!document.querySelector('.delete-confirm')`);
      assert.equal(await evaluate('window.fixture.deletedRecords.length'),0);
      await evaluate('window.fixture.failRecordDelete=true');
      await click('删除所选记录');
      await waitFor(`!!document.querySelector('.delete-confirm')`);
      await click('确认删除记录');
      await waitFor(`document.querySelector('.notice')?.textContent.includes('记录删除失败') && !document.querySelector('.busy-bar')`);
      assert.equal(await evaluate(`document.querySelectorAll('.draft-select-row input:checked').length`),4);
      assert.equal(await evaluate(`document.querySelectorAll('.draft-row').length`),4);
      await evaluate('window.fixture.failRecordDelete=false');
      await click('清空选择');
      await waitFor(`document.querySelectorAll('.draft-select-row input:checked').length===0`);
      await evaluate(`document.querySelector('[aria-label="删除当前发布记录"]').click()`);
      await waitFor(`document.querySelector('.delete-confirm')?.textContent.includes('这 1 条')`);
      await click('确认删除记录');
      await waitFor(`document.querySelectorAll('.draft-row').length===3 && !document.querySelector('.busy-bar')`);
      assert.equal(await evaluate('window.fixture.deletedRecords[0].length'),1);
      await click('全选');
      await waitFor(`document.querySelectorAll('.draft-select-row input:checked').length===3`);
      await click('删除所选记录');
      await waitFor(`document.querySelector('.delete-confirm')?.textContent.includes('这 3 条')`);
      await click('确认删除记录');
      await waitFor(`document.querySelector('.empty-state')?.textContent.includes('暂无发布记录') && !document.querySelector('.busy-bar')`);
      assert.equal(await evaluate('window.fixture.deletedRecords[1].length'),3);
      assert.equal(await evaluate(`document.querySelector('.nav-item.active .nav-count').textContent`),'0');
      console.log('PASS: history select all, cancel, failed deletion retry, single deletion, bulk deletion and empty state');
    } finally {win.destroy();}
    app.quit();
  }).catch(error=>{console.error(error);app.exit(1);});
  app.on('will-quit',()=>{
    if(path.dirname(profile)===path.resolve(os.tmpdir()) && path.basename(profile).startsWith('fanzy-draft-workflow-')) {
      try {fs.rmSync(profile,{recursive:true,force:true});} catch {}
    }
  });
}
