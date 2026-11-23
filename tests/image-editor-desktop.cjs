if(process.type==='renderer') {
 require('./i18n-desktop.cjs');
 const {ipcRenderer}=require('electron');
 window.fixture.images=ipcRenderer.sendSync('fixture-images');
 window.fixture.drafts[0].imageIds=['original','second'];
 Object.assign(window.reach,{
  listImages:()=>ipcRenderer.invoke('fixture:list'),
  previewImageEdit:(id,options)=>ipcRenderer.invoke('fixture:edit-preview',id,options),
  saveImageEdit:async(id,options)=>{const saved=await ipcRenderer.invoke('fixture:edit-save',id,options);window.fixture.saved=saved;return saved;},
  previewPublishImage:async(id,platform)=>{window.fixture.previewTarget={id,platform};return ipcRenderer.invoke('fixture:publish-preview',id,platform);},
  updateDraft:async(id,patch)=>{const d=window.fixture.drafts.find(d=>d.id===id);Object.assign(d,patch,{updatedAt:new Date().toISOString()});return structuredClone(d);}
 });
} else {
 const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs'),fsp=require('fs/promises'),os=require('os'),path=require('path'),assert=require('assert/strict'),sharp=require('sharp'),vm=require('vm'),ts=require('typescript');
 app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-software-rasterizer');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fanzy-image-ui-'));app.setPath('userData',path.join(root,'user'));
 app.whenReady().then(async()=>{
 const paths={assets:path.join(root,'assets'),thumbnails:path.join(root,'thumbs')};for(const p of Object.values(paths))fs.mkdirSync(p);
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><defs><linearGradient id="g"><stop stop-color="#c17459"/><stop offset="1" stop-color="#4a577c"/></linearGradient></defs><rect width="960" height="720" fill="url(#g)"/><circle cx="680" cy="210" r="100" fill="#f4c67c"/><path d="M0 720 L280 280 L540 640 L740 390 L960 720" fill="#303e52"/><text x="60" y="110" font-size="40" fill="white">WEEKEND NOTES</text></svg>');
 const bytes=await sharp(svg).png().toBuffer();
 const data={images:[],drafts:[]};for(const id of ['original','second']){const file=path.join(paths.assets,id+'.png');fs.writeFileSync(file,bytes);data.images.push({id,originalPath:file,thumbnailPath:file,fileName:id+'.png',mimeType:'image/png',width:960,height:720,size:bytes.length,sha256:id,createdAt:'2026-01-01'});}
 const store={getStore:()=>data,getAppPaths:()=>paths,findImage:id=>data.images.find(a=>a.id===id),persistStore:async()=>{}};
 const modules=new Map();function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,Buffer,process,console,require:n=>n==='./store'?store:n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n)});return exports;}
 const service=load('src/main/image-editor.ts');const list=async()=>data.images.map(({originalPath,thumbnailPath,...safe})=>({...safe,thumbnailDataUrl:'data:image/png;base64,'+fs.readFileSync(thumbnailPath).toString('base64')}));
 ipcMain.on('fixture-images',(event)=>{event.returnValue=data.images.map(({originalPath,thumbnailPath,...safe})=>({...safe,thumbnailDataUrl:'data:image/png;base64,'+bytes.toString('base64')}));});
 ipcMain.handle('fixture:list',list);ipcMain.handle('fixture:edit-preview',(_e,...args)=>service.previewImageEdit(...args));ipcMain.handle('fixture:edit-save',(_e,...args)=>service.saveImageEdit(...args));ipcMain.handle('fixture:publish-preview',(_e,...args)=>service.previewPublishImage(...args));
 const win=new BrowserWindow({show:false,width:1450,height:1100,webPreferences:{backgroundThrottling:false,preload:__filename,sandbox:false,contextIsolation:false}});
 const run=async code=>{try{return await win.webContents.executeJavaScript(code,true);}catch(e){console.error(code);throw e;}};
 const wait=async code=>{for(let i=0;i<200;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timeout '+code);};
 const click=async text=>run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
 const change=async(selector,value,isSelect=false)=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${isSelect?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${isSelect?"'change'":"'input'"},{bubbles:true}));})()`);
 try{
  await win.loadFile(path.resolve('out/renderer/index.html'));await wait(`document.querySelectorAll('.image-card').length===2`);await run(`document.querySelector('.image-card').click()`);await click('编辑所选图片');await wait(`!!document.querySelector('.edit-stage>img')`);
  win.showInactive();
  const dragCrop=async(start,end)=>{
    const r=await run(`(()=>{const r=document.querySelector('.edit-stage canvas').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};})()`);
    const point=p=>({x:Math.round(r.x+r.w*p[0]),y:Math.round(r.y+r.h*p[1])});
    win.webContents.sendInputEvent({type:'mouseMove',...point(start)});
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point(start)});
    win.webContents.sendInputEvent({type:'mouseMove',...point(end),button:'left'});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point(end)});
    await new Promise(r=>setTimeout(r,80));
  };
  const cropValues=()=>run(`Array.from(document.querySelectorAll('.edit-range output')).slice(0,4).map(e=>parseInt(e.textContent))`);
  await dragCrop([.2,.2],[.7,.7]);let values=await cropValues();assert.ok(Math.abs(values[0]-50)<=2&&Math.abs(values[1]-50)<=2,'draw a new crop directly');
  await dragCrop([.45,.45],[.55,.55]);values=await cropValues();assert.ok(Math.abs(values[2]-30)<=2&&Math.abs(values[3]-30)<=2,'move crop directly');
  await dragCrop([.8,.8],[.9,.9]);values=await cropValues();assert.ok(Math.abs(values[0]-60)<=2&&Math.abs(values[1]-60)<=2,'resize crop corner directly');
  win.hide();
  assert.equal(data.images.length,2);await click('关闭');assert.equal(data.images.length,2);
  await click('编辑所选图片');await wait(`!!document.querySelector('.edit-stage>img')`);
  for(const [lang,heading] of [['en','Image editor'],['ja','画像編集'],['ko','이미지 편집'],['zh-CN','图片编辑']]){await change('.language-select select',lang,true);await wait(`document.querySelector('#image-editor-heading').textContent===${JSON.stringify(heading)}`);}
  await click('顺时针旋转 90°');await wait(`!!document.querySelector('.edit-stage canvas')&&!document.querySelector('.edit-controls').disabled`);
  await change('.edit-controls select','1',true);await change('.edit-controls input[maxlength]','FANZY · 日本語');await wait(`!document.querySelector('.image-editor footer button').disabled`);
  win.showInactive();await new Promise(r=>setTimeout(r,250));fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/image-editor.png',(await win.webContents.capturePage()).toPNG());win.hide();
  await click('保存为新素材');await wait(`!document.querySelector('dialog')&&document.querySelectorAll('.image-card').length===3`);
  assert.deepEqual(fs.readFileSync(path.join(paths.assets,'original.png')),bytes);assert.equal(data.images[0].width,720);assert.equal(data.images[0].height,720);assert.equal(data.images[0].editOptions.watermark.text,'FANZY · 日本語');
  await run(`document.querySelectorAll('.nav-item')[2].click()`);await wait(`!!document.querySelector('.draft-row')`);await run(`document.querySelector('.draft-row').click()`);await wait(`!!document.querySelector('.social-media')`);
  for(const platform of ['instagram','x','pinterest','tiktok','bluesky','facebook']){await change('.publish-preview select',platform,true);await wait(`document.querySelector('.social-${platform} .social-media')?.complete`);assert.equal(await run(`window.fixture.drafts[0].platform`),'x');}
  await change('.publish-preview select','instagram',true);await wait(`!!document.querySelector('.social-instagram .social-media')`);
  await click('向后移动');assert.deepEqual(await run(`window.fixture.drafts[0].imageIds`),['original','second']);await click('保存修改');await wait(`window.fixture.drafts[0].imageIds[0]==='second'`);
  win.showInactive();await run(`document.querySelector('.publish-preview').scrollIntoView()`);await new Promise(r=>setTimeout(r,250));fs.writeFileSync('artifacts/publish-preview.png',(await win.webContents.capturePage()).toPNG());win.hide();
  win.setSize(1100,900);await new Promise(r=>setTimeout(r,100));assert.equal(await run(`document.documentElement.scrollWidth<=window.innerWidth`),true);
  console.log('PASS: real image pipeline in Electron, original retained, cancel/save copy, four editor languages, six platform previews, target unchanged, explicit order save and responsive layout');win.destroy();app.exit(0);
 }catch(e){console.error(e);win.destroy();app.exit(1);}
 });
}
