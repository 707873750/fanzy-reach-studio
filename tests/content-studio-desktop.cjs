if(process.type==='renderer') {
 require('./caption-preview-desktop.cjs');
 const platforms=['x','instagram','facebook','bluesky','pinterest','tiktok'];
 const date=new Date();date.setHours(10,0,0,0);
 window.fixture.drafts=Array.from({length:18},(_,i)=>({...window.fixture.drafts[0],id:'day-'+i,platform:platforms[i%6],title:'Campaign '+(i+1),caption:'用户文案 日本語 한국어 English',publishAt:new Date(+date+i*600000).toISOString()}));
 Object.assign(window.reach,{getContentStyles:async()=>[{name:'My custom style',language:'English',tone:'Custom tone',audience:'My readers',brand:'My brand',forbidden:''}],saveContentStyles:async()=>{},updateAssetMeta:async()=>{},planDrafts:async()=>{}});
} else {
 const {app,BrowserWindow}=require('electron');const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
 app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-software-rasterizer');app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'fanzy-calendar-')));
 app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1600,height:1100,webPreferences:{backgroundThrottling:false,preload:__filename,sandbox:false,contextIsolation:false}});
 const run=async code=>{try{return await win.webContents.executeJavaScript(code,true);}catch(e){console.error(code);throw e;}};
 const wait=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout '+code);};
 const change=async language=>{await run(`(()=>{const select=document.querySelector('.language-select select');select.value=${JSON.stringify(language)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(`document.documentElement.lang===${JSON.stringify(language)}`);};
 try{
 await win.loadFile(path.resolve('out/renderer/index.html'));await wait(`!!document.querySelector('.image-card')`);
 await run(`document.querySelector('.nav-item').click()`);await wait(`document.querySelectorAll('.calendar-agenda-card').length===18`);
 assert.equal(await run(`document.querySelectorAll('.calendar-day.is-selected .calendar-preview').length`),2);
 assert.equal(await run(`document.querySelector('.calendar-day.is-selected .calendar-more').textContent`),'另有 16 条');
 const headings={en:'Content studio',ja:'コンテンツスタジオ',ko:'콘텐츠 스튜디오','zh-CN':'内容工作台'};
 for(const lang of ['en','ja','ko','zh-CN']){
 await change(lang);await wait(`document.querySelector('h1').textContent===${JSON.stringify(headings[lang])}`);
 assert.equal(await run(`document.querySelector('.content-studio input').value`),'My custom style');
 assert.equal(await run(`document.querySelectorAll('.calendar-agenda-card').length`),18);
 assert.equal(await run(`Array.from(document.querySelectorAll('.calendar-day')).every(e=>e.scrollWidth<=e.clientWidth+1)`),true);
 }
 win.showInactive();await run(`document.querySelector('.calendar-panel').scrollIntoView()`);
 await new Promise(r=>setTimeout(r,400));
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/calendar-month.png',(await win.webContents.capturePage()).toPNG());
 win.hide();win.setSize(1100,1000);await new Promise(r=>setTimeout(r,100));
 assert.equal(await run(`document.documentElement.scrollWidth<=window.innerWidth`),true);
 assert.equal(await run(`document.querySelector('.calendar-agenda').getBoundingClientRect().top>document.querySelector('.content-calendar').getBoundingClientRect().top`),true);
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='切换周视图').click()`);await wait(`document.querySelectorAll('.calendar-day').length===7`);
 await run(`document.querySelector('.calendar-day:not(.is-selected)').click()`);await wait(`document.querySelectorAll('.calendar-agenda-card').length===0`);
 await run(`document.querySelectorAll('.nav-item')[2].click()`);await wait(`!!document.querySelector('.draft-row')`);await run(`document.querySelector('.draft-row').click()`);await wait(`!!document.querySelector('.caption-tools')`);
 for(const [lang,label] of [['en','Generate three options'],['ja','3つの候補を生成'],['ko','후보 3개 생성'],['zh-CN','生成三个候选']]){await change(lang);await wait(`document.querySelector('.caption-tools button').textContent===${JSON.stringify(label)}`);assert.equal(await run(`document.querySelector('#draft-caption').textContent`),'用户文案 日本語 한국어 English');}
 console.log('PASS: four languages, preserved user data, 18 same-day posts, bounded summaries, full agenda, responsive layout and week view');win.destroy();app.exit(0);
 }catch(e){console.error(e);win.destroy();app.exit(1);}
 });
}
