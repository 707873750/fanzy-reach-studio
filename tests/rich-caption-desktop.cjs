// npm run build && electron tests/rich-caption-desktop.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const ts = require('typescript');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-software-rasterizer');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fanzy-rich-caption-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false, webPreferences:{preload:path.resolve('tests/draft-workflow-desktop.cjs'), sandbox:false, contextIsolation:false}});
  const run = code => win.webContents.executeJavaScript(code, true);
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'));
    for (let i=0;i<100 && !await run('!!document.querySelector("#shared-caption")');i++) await new Promise(r=>setTimeout(r,30));
    assert.ok(await run('!!document.querySelector("#shared-caption[contenteditable=true]")'));
    await run(`window.edit=document.querySelector('#shared-caption'); edit.focus(); document.execCommand('insertText',false,'Visit'); edit.dispatchEvent(new InputEvent('input',{bubbles:true})); const range=document.createRange(); range.selectNodeContents(edit); getSelection().removeAllRanges(); getSelection().addRange(range); edit.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));`);
    await run(`Array.from(edit.parentElement.querySelectorAll('button')).find(b=>b.textContent==='粗体').click()`);
    assert.ok(await run(`!!edit.querySelector('b,strong')`));
    await run(`Array.from(edit.parentElement.querySelectorAll('button')).find(b=>b.textContent==='文字链接').click()`);
    await new Promise(r=>setTimeout(r,100));
    await run(`const input=edit.parentElement.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://example.com/'); input.dispatchEvent(new Event('input',{bubbles:true}));`);
    await new Promise(r=>setTimeout(r,100));
    await run(`Array.from(edit.parentElement.querySelectorAll('button')).find(b=>b.textContent==='确认').click()`);
    assert.equal(await run(`edit.querySelector('a')?.textContent`),'Visit');
    assert.equal(await run(`edit.querySelector('a')?.getAttribute('href')`),'https://example.com/');
    const source=fs.readFileSync('src/renderer/src/rich-caption.ts','utf8');
    const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    await run(`window.rich = (()=>{const exports={}; ${compiled}; return exports;})(); void 0`);
    assert.equal(await run(`rich.captionText(edit.innerHTML)`),'Visit（https://example.com/）');
    assert.equal(await run(`rich.cleanCaption('<img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:alert(1)">unsafe</a><b onclick="alert(1)">safe</b>')`),'unsafe<b>safe</b>');
    assert.equal(await run(`rich.captionText('<ol><li>One</li><li>Two</li></ol>')`),'1. One\n2. Two');
    assert.equal(await run(`rich.captionText('One<div>Two</div>')`),'One\nTwo');
    const copyCompiled=ts.transpileModule(fs.readFileSync('src/shared/draft-copy.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const module={exports:{}}; new Function('exports',copyCompiled)(module.exports);
    const {applyCaptionPatch}=module.exports;
    const a={id:'a',copyGroupId:'g',captionMode:'independent',caption:'own',captionHtml:'<i>own</i>',sharedCaption:'shared',sharedCaptionHtml:'<b>shared</b>',status:'draft'};
    const b={...a,id:'b',captionMode:'shared'};
    applyCaptionPatch([a,b],a,{captionMode:'shared'},'1'); assert.equal(a.captionHtml,'<b>shared</b>');
    applyCaptionPatch([a,b],a,{caption:'new',captionHtml:'<u>new</u>'},'2'); assert.equal(b.captionHtml,'<u>new</u>');
    applyCaptionPatch([a,b],a,{captionMode:'independent'},'3'); assert.equal(a.captionHtml,'<i>own</i>');
    assert.equal(JSON.parse(JSON.stringify(a)).captionHtml,'<i>own</i>');
    applyCaptionPatch([a,b],a,{caption:'plain'},'4'); assert.equal(a.captionHtml,undefined);
    console.log('PASS: rich editor bold and named links, safe HTML, text conversion, shared sync, independent restore and plain-text reset');
  } catch(error) { console.error(error); process.exitCode=1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
});
