// Run after npm run build: electron tests/local-schedules-desktop.cjs
// Isolated fixtures; never accesses real tasks, accounts, or publishing services.
if (process.type === 'renderer') {
  require('./draft-workflow-desktop.cjs');
  const fixture = window.fixture;
  const base = fixture.drafts[0];
  fixture.drafts.push(...['later', 'earlier', 'cancel', 'locked'].map((id, index) => ({
    ...base, id, title:`定时内容 ${id}`, caption:'本地定时发布测试文案', status:'local_scheduled', scheduleMode:'local',
    publishAt:`2030-01-0${index === 0 ? 5 : index}T10:00:00Z`
  })));
  fixture.localDeleted = [];
  window.reach.deleteLocalScheduledDrafts = async ids => {
    if (fixture.failLocalDelete) throw Error('测试：任务删除失败');
    fixture.localDeleted.push(ids);
    fixture.drafts = fixture.drafts.filter(d => !ids.includes(d.id));
    return ids.length;
  };
  window.reach.updateDraft = async (id, patch) => {
    const draft = fixture.drafts.find(d => d.id === id);
    Object.assign(draft, patch, {status:'draft',scheduleMode:null});
    return structuredClone(draft);
  };
} else {
  const {app, BrowserWindow} = require('electron');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  app.disableHardwareAcceleration();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fanzy-local-schedules-'));
  app.setPath('userData', profile);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:__filename,sandbox:false,contextIsolation:false}});
    const run = code => win.webContents.executeJavaScript(code);
    const waitFor = async code => {
      for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw Error(`Timed out: ${code}`);
    };
    const click = text => run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
    const rowClick = (id, text) => run(`Array.from(document.querySelector('[data-task-id="${id}"]').querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
    try {
      await win.loadFile(path.resolve('out/renderer/index.html'));
      await waitFor(`document.querySelectorAll('.nav-count')[1]?.textContent==='4'`);
      await click('发布队列');
      await waitFor(`document.querySelectorAll('.draft-select-row').length===3`);
      await click('本地定时任务');
      await waitFor(`document.querySelectorAll('.local-schedule-row').length===4`);
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('.local-schedule-row')).map(row=>row.dataset.taskId)`), ['earlier','cancel','locked','later']);
      win.showInactive();
      await new Promise(resolve => setTimeout(resolve, 300));
      fs.writeFileSync(path.join(profile,'local-schedules.png'),(await win.webContents.capturePage()).toPNG());
      console.log('Screenshot: '+path.join(profile,'local-schedules.png'));
      win.hide();
      await run(`window.fixture.batch(['locked'])`);
      await waitFor(`document.querySelector('[data-task-id="locked"] input').disabled`);
      assert.equal(await run(`Array.from(document.querySelector('[data-task-id="locked"]').querySelectorAll('.button')).every(b=>b.disabled)`), true);
      await click('全选');
      await waitFor(`document.querySelectorAll('.local-schedule-row input:checked').length===3`);
      await click('清空选择');
      await waitFor(`document.querySelectorAll('.local-schedule-row input:checked').length===0`);
      await run(`window.fixture.batch([])`);
      await run(`window.fixture.failLocalDelete=true`);
      await rowClick('earlier','删除任务');
      await waitFor(`document.querySelector('.notice')?.textContent.includes('任务删除失败') && !document.querySelector('.busy-bar')`);
      assert.equal(await run(`document.querySelectorAll('.local-schedule-row').length`),4);
      await run(`window.fixture.failLocalDelete=false`);
      await rowClick('earlier','删除任务');
      await waitFor(`document.querySelectorAll('.local-schedule-row').length===3 && !document.querySelector('.busy-bar')`);
      assert.deepEqual(await run('window.fixture.localDeleted'),[['earlier']]);
      await rowClick('cancel','取消定时并保留草稿');
      await waitFor(`document.querySelector('h1')?.textContent==='发布队列' && document.querySelectorAll('.draft-select-row').length===4`);
      assert.equal(await run(`window.fixture.drafts.find(d=>d.id==='cancel').publishAt`),null);
      await click('本地定时任务');
      await waitFor(`document.querySelectorAll('.local-schedule-row').length===2`);
      // A task starting in the background moves to the queue and loses its selection.
      await click('全选');
      await run(`(()=>{const d=window.fixture.drafts.find(d=>d.id==='locked');d.status='ready';d.browserPublish={state:'running',message:'正在发布'};window.fixture.progress(structuredClone(d));})()`);
      await waitFor(`document.querySelectorAll('.local-schedule-row').length===1 && document.querySelectorAll('.local-schedule-row input:checked').length===1`);
      await click('删除所选任务');
      await waitFor(`document.querySelector('.empty-state')?.textContent.includes('暂无本地定时任务') && !document.querySelector('.busy-bar')`);
      assert.deepEqual(await run('window.fixture.localDeleted'),[['earlier'],['later']]);
      assert.equal(await run(`document.querySelector('.nav-item.active .nav-count').textContent`),'0');
      assert.equal(await run(`window.fixture.images.length`),3);
      assert.equal(await run(`window.fixture.drafts.filter(d=>['published','platform-scheduled','locked','cancel'].includes(d.id)).length`),4);
      console.log('PASS: local task separation, time ordering, locks, single-click deletion, failure retry, cancel to draft, progress cleanup, bulk deletion and empty state');
    } finally { win.destroy(); }
    app.quit();
  }).catch(error => {console.error(error); app.exit(1);});
}
