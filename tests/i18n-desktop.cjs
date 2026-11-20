// npm run build && electron tests/i18n-desktop.cjs
// Fixture-only desktop test: never reads or mutates the user's store.
if (process.type === 'renderer') {
  require('./draft-workflow-desktop.cjs');
  Object.assign(window.reach, {
    getPlatformDefaults: async () => Object.fromEntries(['x','instagram','facebook','bluesky','pinterest','tiktok'].map(p => [p, {imagesPerDraft:1,hashtags:[],boardName:'',title:'',scheduleDelayMinutes:0}])),
    getLogs: async () => ({entries:[],directory:'fixture/logs',storageError:null}),
    onRunLog: () => () => {}, getGeneratedImage: async () => null
  });
} else {
  const { app, BrowserWindow } = require('electron');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  app.disableHardwareAcceleration();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fanzy-i18n-'));
  app.setPath('userData', profile);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:__filename,sandbox:false,contextIsolation:false}});
    const run = code => win.webContents.executeJavaScript(code, true);
    const waitFor = async code => {
      for(let i=0;i<100;i++) {if(await run(code)) return;await new Promise(r=>setTimeout(r,30));}
      throw Error('Timed out: '+code);
    };
    const changeLanguage = async language => {
      await run(`(()=>{const select=document.querySelector('.language-select select');select.value=${JSON.stringify(language)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await waitFor(`document.documentElement.lang === ${JSON.stringify(language)}`);
    };
    try {
      await win.loadFile(path.resolve('out/renderer/index.html'));
      await waitFor(`!!document.querySelector('#shared-caption')`);
      assert.equal(await run('document.documentElement.lang'),'zh-CN');
      await run(`(()=>{const editor=document.querySelector('#shared-caption');editor.focus();document.execCommand('insertText',false,'用户文案 日本語 한국어 English');editor.dispatchEvent(new InputEvent('input',{bubbles:true}));})()`);
      const headings = {
        en:['Media library','Publishing queue','Local scheduled tasks','Publishing history','Settings & accounts','Run logs'],
        ja:['素材ライブラリ','公開キュー','ローカル予約タスク','公開履歴','設定とアカウント','実行ログ'],
        ko:['미디어 라이브러리','게시 대기열','로컬 예약 작업','게시 기록','설정 및 계정','실행 로그']
      };
      for(const language of ['en','ja','ko']) {
        await changeLanguage(language);
        assert.equal(await run(`document.querySelector('#shared-caption').textContent`),'用户文案 日本語 한국어 English');
        for(let page=0;page<6;page++) {
          await run(`document.querySelectorAll('.nav-item')[${page}].click()`);
          await waitFor(`document.querySelector('h1')?.textContent === ${JSON.stringify(headings[language][page])}`);
        }
        await run(`document.querySelectorAll('.nav-item')[0].click()`);
        await waitFor(`!!document.querySelector('#shared-caption')`);
        assert.equal(await run(`document.querySelector('#shared-caption').textContent`),'用户文案 日本語 한국어 English');
        assert.equal(await run(`document.querySelector('.language-select select').getAttribute('aria-label')`), {en:'Interface language',ja:'表示言語',ko:'화면 언어'}[language]);
        // Capture the widest translation at a typical desktop size.
        if(language==='en') {
          win.showInactive();
          await run('window.scrollTo(0,0)');
          await new Promise(r=>setTimeout(r,250));
          fs.writeFileSync(path.join(profile,'english.png'),(await win.webContents.capturePage()).toPNG());
          win.hide();
        }
      }
      win.webContents.reload();
      await waitFor(`document.querySelector('h1')?.textContent === '미디어 라이브러리'`);
      assert.equal(await run(`document.querySelector('.language-select select').value`),'ko');
      await changeLanguage('zh-CN');
      await waitFor(`document.querySelector('h1')?.textContent === '素材库'`);
      await run(`localStorage.setItem('fanzy-reach.ui-language','invalid')`);
      win.webContents.reload();
      await waitFor(`document.querySelector('h1')?.textContent === '素材库'`);
      assert.equal(await run('document.documentElement.lang'),'zh-CN');
      console.log('PASS: all three languages across six pages, accessible selector, draft preservation, persistence, Chinese restoration, and invalid preference fallback');
      console.log('Screenshot: '+path.join(profile,'english.png'));
    } catch(error) {console.error(error);process.exitCode=1;}
    finally {win.destroy();app.exit(process.exitCode||0);}
  });
}
