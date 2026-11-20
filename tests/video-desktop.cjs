// Isolated Electron renderer fixtures; no user files or platform connections.
if (process.type === 'renderer') {
  const common = {width:720,height:1280,size:10000,sha256:'fixture',createdAt:'2026-11-20',sourceFolders:['C:\\Videos']};
  const clip = { ...common, id:'clip', fileName:'clip.mp4', mimeType:'video/mp4', video:{duration:4,fps:30,codec:'h264',pixelFormat:'yuv420p'} };
  window.fixture = {previewed:null,created:null};
  window.reach = {
    listImages:async()=>[clip,{...clip,id:'long',fileName:'long.mp4',video:{...clip.video,duration:200}}, {...common,id:'photo',fileName:'photo.jpg',mimeType:'image/jpeg',sourceFolders:['C:\\Photos']}],
    listDrafts:async()=>[],getSettings:async()=>({hasDeepSeekKey:false,model:'fixture'}),getBrowserSettings:async()=>({showBrowser:false,channel:'chrome'}),
    onScheduleReminder:()=>()=>{},onPublishProgress:()=>()=>{},reportUiPerformance:async()=>{},reportRendererError:async()=>{},
    previewMedia:async id=>{window.fixture.previewed=id;},
    createDrafts:async(ids,platforms)=>{window.fixture.created={ids,platforms};return [];}
  };
} else {
  const {app,BrowserWindow}=require('electron');
  const fs=require('node:fs');
  const os=require('node:os');
  const path=require('node:path');
  const assert=require('node:assert/strict');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fanzy-video-ui-'));
  app.setPath('userData',profile);
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:__filename,sandbox:false,contextIsolation:false}});
    const evaluate=code=>win.webContents.executeJavaScript(code);
    const wait=async code=>{for(let i=0;i<100;i++){if(await evaluate(code)) return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+code);};
    const select=async(label,value)=>evaluate(`(()=>{const e=document.querySelector('select[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const click=async text=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
    try {
      await win.loadFile(path.resolve('out/renderer/index.html'));
      await wait(`document.querySelectorAll('.image-card').length===3`);
      await select('素材类型','video');
      await wait(`document.querySelectorAll('.image-card').length===2`);
      await select('按文件夹筛选','C:\\Photos');
      await wait(`document.querySelectorAll('.image-card').length===0`);
      await select('按文件夹筛选','C:\\Videos');
      await wait(`document.querySelectorAll('.image-card').length===2`);
      await click('long.mp4');
      await wait(`document.querySelector('[role="alert"]')?.textContent.includes('X · long.mp4')`);
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('创建草稿')).disabled`),true);
      await click('清空选择');
      await click('clip.mp4');
      await wait(`!document.querySelector('[role="alert"]')`);
      await click('播放所选视频');
      await wait(`window.fixture.previewed==='clip'`);
      await click('创建草稿');
      await wait(`window.fixture.created!==null`);
      assert.deepEqual(await evaluate('window.fixture.created.ids'),['clip']);
      assert.equal(await evaluate('window.fixture.created.platforms.length'),6);
      console.log('PASS: video/folder intersection, platform limit warnings, blocked invalid creation, preview and six-platform selection');
    } catch(error) { console.error(error);process.exitCode=1; }
    finally {win.destroy();app.quit();}
  });
}
