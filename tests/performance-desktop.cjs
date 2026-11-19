// Real Electron process metrics, isolated temporary profile, no platform requests.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fanzy-perf-'));
app.setPath('userData',root);
app.whenReady().then(async()=>{
  const entries=[];
  const source=fs.readFileSync('src/main/performance-monitor.ts','utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  let listener;
  const electron={app,ipcMain:{handle:(name,fn)=>{listener=fn;ipcMain.handle(name,fn);},removeHandler:name=>ipcMain.removeHandler(name)}};
  const sandbox={exports:{},require:name=>name==='electron'?electron:name==='./run-logger'?{log:async e=>entries.push(e)}:require(name),setInterval,clearInterval};
  vm.runInNewContext(compiled,sandbox);
  const monitor=sandbox.exports;
  const stop=monitor.startPerformanceMonitor();monitor.setPerformancePublishing(true);
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
  await win.loadURL('data:text/html,<p>Local performance fixture</p>');
  const timeout=setTimeout(()=>{throw Error('performance test timeout');},15000);
  try {
    const event={sender:win.webContents};
    const sample={visible:true,visibilityChanged:false,windowMs:5000,frameCount:250,frameMaxMs:220,frameP95Ms:17,timerMaxMs:210,longTaskCount:1,longTaskMaxMs:210,inputDelayMaxMs:180};
    listener(event,sample);listener(event,sample);
    assert.equal(entries.filter(e=>e.step==='performance.ui').length,1,'rate limited');
    assert.equal(entries.find(e=>e.step==='performance.ui').level,'warn');
    await new Promise(r=>setTimeout(r,200));
    const end=performance.now()+220;while(performance.now()<end){}
    await new Promise(r=>setTimeout(r,5100));
    const desktop=entries.filter(e=>e.step==='performance.desktop').map(e=>JSON.parse(e.detail));
    assert.ok(desktop.some(e=>e.mainLoopMaxMs>=150));
    assert.ok(desktop.some(e=>e.processes.some(p=>p.type==='GPU')));
    assert.ok(entries.some(e=>e.step==='performance.gpu_info'));
    app.emit('child-process-gone',{}, {type:'GPU',reason:'crashed',exitCode:1});
    assert.ok(entries.some(e=>e.step==='performance.gpu_exit'));
    console.log(JSON.stringify({result:'PASS',mainLoopMaxMs:Math.max(...desktop.map(e=>e.mainLoopMaxMs)),processTypes:desktop[0].processes.map(p=>p.type),uiRateLimit:true,gpuInfo:true,gpuExit:true}));
  } finally {clearTimeout(timeout);stop();win.destroy();app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
app.on('will-quit',()=>{try{fs.rmSync(root,{recursive:true,force:true});}catch{}});
