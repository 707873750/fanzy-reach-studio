if (process.type === 'renderer') {
  require('./draft-workflow-desktop.cjs');
  window.reach.getSettings=async()=>({backendLoggedIn:true});
  window.reach.previewCaption=async(id,input)=>{
    window.fixture.request={id,input};
    if(window.fixture.defer) return new Promise(resolve=>{window.fixture.resolve=resolve;});
    if(window.fixture.fail) throw Error('模拟网络故障');
    return input.action==='variants'?['候选一','候选二','候选三']:input.action==='translate'?['Translated text']:['Short'];
  };
} else {
 const {app,BrowserWindow}=require('electron');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
 app.disableHardwareAcceleration();app.commandLine.appendSwitch("disable-software-rasterizer");app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'fanzy-preview-')));
 app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{preload:__filename,sandbox:false,contextIsolation:false}});
  const run=async code=>{try{return await win.webContents.executeJavaScript(code,true);}catch(e){console.error("Failed expression:",code);throw e;}};
  const wait=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout: '+code);};
  const click=async text=>run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
  try {
   await win.loadFile(path.resolve('out/renderer/index.html'));
   await wait(`!!document.querySelector('.image-card')`);await click('发布队列');
   await wait(`!!document.querySelector('.draft-row')`);await run(`document.querySelector('.draft-row').click()`);
   await wait(`!!document.querySelector('#draft-caption')`);
   const original=await run(`document.querySelector('#draft-caption').textContent`);
   await click('生成三个候选');await wait(`document.querySelectorAll('.caption-candidates article').length===3`);
   assert.equal(await run(`document.querySelector('#draft-caption').textContent`),original);
   await run(`document.querySelectorAll('.caption-candidates article button')[1].click()`);
   await wait(`document.querySelector('#draft-caption').textContent==='候选二'`);
   assert.equal(await run(`fixture.drafts.find(d=>d.id===fixture.request.id).caption`),original);
   await click('翻译');await wait(`document.querySelector('.caption-candidates')?.textContent.includes('Translated text')`);
   assert.equal(await run(`fixture.request.input.text`),'候选二');await click('放弃预览');
   await click('缩短');await wait(`document.querySelector('.caption-candidates')?.textContent.includes('Short')`);
   await click('采用此文案');await wait(`document.querySelector('#draft-caption').textContent==='Short'`);
   await run(`fixture.fail=true`);await click('翻译');await wait(`document.querySelector('.caption-tools [role=alert]')?.textContent.includes('模拟网络故障')`);
   assert.equal(await run(`document.querySelector('#draft-caption').textContent`),'Short');
   await run(`fixture.fail=false;fixture.defer=true`);await click('翻译');await wait(`!!fixture.resolve`);await click('取消等待');
   await run(`fixture.resolve(['STALE'])`);await new Promise(r=>setTimeout(r,80));assert.equal(await run(`!!document.querySelector('.caption-candidates')`),false);
   await click('翻译');await wait(`!!document.querySelector('.caption-tools [role=status]')`);
   await run(`const editor=document.querySelector('#draft-caption');editor.textContent='Manually edited';editor.dispatchEvent(new InputEvent('input',{bubbles:true}));`);
   await wait(`!document.querySelector('.caption-tools [role=status]')`);
   await run(`fixture.resolve(['STALE'])`);await new Promise(r=>setTimeout(r,80));
   assert.equal(await run(`document.querySelector('#draft-caption').textContent`),'Manually edited');
   assert.equal(await run(`!!document.querySelector('.caption-candidates')`),false);
   console.log('PASS: three choices, explicit adoption, no autosave, translation, shortening, failure preservation, cancellation and stale-result invalidation');
   win.destroy();app.exit(0);
  }catch(e){console.error(e);console.error(await run('document.body.innerText'));win.destroy();app.exit(1);}
 });
}
