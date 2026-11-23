if(process.type==='renderer') {
 require('./i18n-desktop.cjs');
 const ps=['instagram','x','pinterest','tiktok','bluesky','facebook'];
 window.fixture.accounts=ps.map(platform=>({id:`default-${platform}`,platform,name:'',legacy:true}));
 window.fixture.accounts.push({id:'brand-b',platform:'x',name:'Brand B 日本語'});
 Object.assign(window.reach,{
 listAccounts:async()=>structuredClone(window.fixture.accounts),
 addAccount:async(platform,name)=>{window.fixture.accounts.push({id:'new-account',platform,name});},
 deleteAccount:async id=>{window.fixture.accounts=window.fixture.accounts.filter(a=>a.id!==id);window.fixture.deletedAccount=id;},
 renameAccount:async(id,name)=>{window.fixture.accounts.find(a=>a.id===id).name=name;},
 openPlatformBrowser:async(...args)=>{window.fixture.open=args;},
 closePlatformBrowser:async(...args)=>{window.fixture.close=args;},
 updateDraft:async(id,patch)=>{const d=window.fixture.drafts.find(d=>d.id===id);Object.assign(d,patch,{updatedAt:new Date().toISOString()});return structuredClone(d);},
 createDrafts:async(...args)=>{window.fixture.created=args;return [];}
 });
} else {
 const {app,BrowserWindow}=require('electron'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
 app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-software-rasterizer');app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'fanzy-accounts-ui-')));
 app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{backgroundThrottling:false,preload:__filename,sandbox:false,contextIsolation:false}});
 const run=async code=>{try{return await win.webContents.executeJavaScript(code,true);}catch(e){console.error(code);throw e;}};
 const wait=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout '+code);};
 const click=async text=>run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
 const input=async(selector,value)=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 try {
 await win.loadFile(path.resolve('out/renderer/index.html'));await wait(`!!document.querySelector('.image-card')`);
 await run(`document.querySelectorAll('.nav-item')[5].click()`);await wait(`document.querySelectorAll('.account-card').length===7`);
 for(const [lang,label] of [['en','Add account'],['ja','アカウントを追加'],['ko','계정 추가'],['zh-CN','添加账号']]) {
 await run(`(()=>{const e=document.querySelector('.language-select select');e.value=${JSON.stringify(lang)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await wait(`document.querySelector('.account-add button').textContent===${JSON.stringify(label)}`);
 assert.ok(await run(`document.querySelector('.account-grid').textContent.includes('Brand B 日本語')`));
 }
 win.showInactive();await run(`document.querySelector('.account-panel').scrollIntoView()`);await new Promise(r=>setTimeout(r,250));fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/accounts.png',(await win.webContents.capturePage()).toPNG());win.hide();
 await input('.account-add input','New brand');await click('添加账号');await wait(`document.querySelectorAll('.account-card').length===8`);
 await run(`document.querySelector('.account-card:last-child .settings-actions button').click()`);await wait(`!!window.fixture.open`);assert.deepEqual(await run(`window.fixture.open`),['instagram',false,'new-account']);
 await run(`document.querySelector('.account-card:last-child .settings-actions button:nth-child(2)').click()`);await wait(`!!window.fixture.close`);assert.deepEqual(await run(`window.fixture.close`),['instagram','new-account']);
 await run(`document.querySelectorAll('.nav-item')[2].click()`);await wait(`!!document.querySelector('.draft-row')`);await run(`document.querySelector('.draft-row').click()`);await wait(`!!document.querySelector('#draft-account')`);
 const original=await run(`document.querySelector('#draft-caption').textContent`);
 await run(`(()=>{const e=document.querySelector('#draft-account');e.value='brand-b';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('保存修改');await wait(`window.fixture.drafts[0].accountId==='brand-b'`);
 assert.equal(await run(`window.fixture.drafts[0].caption`),original);
 assert.ok(await run(`document.querySelector('.draft-row').textContent.includes('Brand B 日本語')`));
 await run(`document.querySelectorAll('.nav-item')[1].click()`);await wait(`document.querySelectorAll('.account-targets input').length===8`);
 assert.equal(await run(`document.querySelectorAll('.account-targets input:checked').length`),6);
 await run(`document.querySelectorAll('.nav-item')[5].click()`);await wait(`document.querySelectorAll('.account-card').length===8`);
 await run(`Array.from(document.querySelector('.account-card:last-child').querySelectorAll('button')).find(b=>b.textContent==='删除账号').click()`);await wait(`!!document.querySelector('.account-card .delete-confirm')`);
 await click('取消');assert.equal(await run(`window.fixture.deletedAccount`),undefined);
 await run(`Array.from(document.querySelector('.account-card:last-child').querySelectorAll('button')).find(b=>b.textContent==='删除账号').click()`);await click('确认删除账号');await wait(`document.querySelectorAll('.account-card').length===7`);
 assert.equal(await run(`window.fixture.deletedAccount`),'new-account');
 console.log('PASS: confirmed/cancelled deletion, account management, account-specific login IPC, four languages, draft reassignment preserving copy, multiple account creation selectors');win.destroy();app.exit(0);
 }catch(e){console.error(e);win.destroy();app.exit(1);}
 });
}
