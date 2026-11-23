// Real Electron preload + IPC + HTTP backend. No mocked image result.
// Start npm run demo:server first. Add --real-generation to spend provider quota.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = path.resolve('backend/.local');
fs.mkdirSync(folder, { recursive: true });
const profile = fs.mkdtempSync(path.join(folder, 'desktop-test-'));
app.setPath('userData', profile);
const resumeIndex = process.argv.indexOf('--resume-task');
const resumeTask = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : null;
const registration = process.argv.includes('--register');
const newUsername = 'ui_' + Date.now();
const newPassword = 'desktop-test-password';
if (registration) {
  assert.match(process.env.FANZY_BACKEND_URL || '', /^http:\/\/127\.0\.0\.1:\d+$/);
}
if (resumeTask) {
  assert.match(resumeTask, /^[a-f0-9-]{36}$/);
  fs.writeFileSync(path.join(profile, 'reach-data.json'), JSON.stringify({ images: [], drafts: [], settings: { backendUrl: 'http://127.0.0.1:8787', backendPendingTask: { id: resumeTask } } }));
}
app.disableHardwareAcceleration();
let tested = false;
app.on('browser-window-created', (_event, win) => {
  if (tested) return; tested = true;
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code, true);
    const wait = async (code, timeout = 10000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
      throw Error('Timed out: ' + code);
    };
    const click = text => run(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
    const input = (id, text, tag = 'HTMLInputElement') => run(`(() => { const e = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(${tag}.prototype, 'value').set.call(e, ${JSON.stringify(text)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const screenshot = async name => fs.writeFileSync(path.join(folder, name), (await win.webContents.capturePage()).toPNG());
    try {
      await wait(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'AI 生成图片')`);
      await click('AI 生成图片');
      await wait(`!!document.querySelector('#backend-password')`);
      assert.equal(await run(`!!document.querySelector('#backend-url')`), false);
      assert.equal('backendUrl' in await run(`window.reach.getSettings()`), false);
      assert.equal(await run(`document.querySelector('#image-prompt').disabled`), true);
      assert.equal(await run(`window.reach.generateImage({mode:'generate',prompt:'blocked',size:'1328x1328'}).then(()=>false, e=>e.message.includes('登录'))`), true);
      await screenshot('desktop-logged-out.png');
      if (registration) {
        await click('没有账号？注册');
        await wait(`!!document.querySelector('#backend-confirm')`);
        await input('backend-user', newUsername);
        await input('backend-password', newPassword);
        await input('backend-confirm', 'mismatched-password');
        await click('注册并登录');
        await wait(`document.body.textContent.includes('两次输入的密码不一致。')`);
        await input('backend-confirm', newPassword);
        await click('注册并登录');
      } else {
        await input('backend-password', process.env.DEMO_PASSWORD || 'demo12345');
        await click('登录');
      }
      await wait(`!!document.querySelector('.backend-balance strong') && document.querySelector('.backend-balance strong').textContent !== '—'`);
      assert.equal(await run(`document.querySelector('.backend-account').textContent.includes('127.0.0.1')`), false);
      assert.equal((await run(`window.reach.getSettings()`)).hasVolcKeys, false);
      if (registration) assert.equal((await run(`window.reach.backendAccount()`)).user.balance, 0);
      if (process.argv.includes('--real-generation') || resumeTask) assert.equal((await run(`window.reach.backendAccount()`)).config.providerReady, true);
      await run(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('签到')).click()`);
      await wait(`Array.from(document.querySelectorAll('button')).some(b => b.textContent === '今日已签到' && b.disabled)`);
      const before = await run(`window.reach.backendAccount()`);
      await run(`window.reach.backendCheckin()`);
      assert.equal((await run(`window.reach.backendAccount()`)).user.balance, before.user.balance);
      await screenshot('desktop-logged-in.png');
      if (process.argv.includes('--real-generation') || resumeTask) {
        if (resumeTask) {
          await wait(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '继续查询' && !b.disabled)`);
          await click('继续查询');
          console.log('Resuming an existing real image through the desktop and backend; no new generation.');
        } else {
          assert.ok(before.user.balance >= before.config.cost, 'Insufficient demo credits for real generation');
          await input('image-prompt', '清晨森林中的玻璃小屋，薄雾，温暖阳光，宁静氛围，电影感构图，无文字', 'HTMLTextAreaElement');
          await wait(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('生成图片 ·') && !b.disabled)`);
          await run(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('生成图片 ·')).click()`);
          console.log('Submitted one real image from the desktop UI; waiting for provider.');
        }
        await wait(`!!document.querySelector('.backend-preview') || !!document.querySelector('[role=alert]')`, 240000);
        const preview = await run(`!!document.querySelector('.backend-preview')`);
        if (!preview) throw Error(await run(`document.querySelector('[role=alert]')?.textContent || document.body.innerText.slice(-500)`));
        await wait(`document.querySelector('.backend-preview').naturalWidth > 0`);
        await wait(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '保存到素材库' && !b.disabled)`);
        const after = await run(`window.reach.backendAccount()`);
        assert.equal(after.user.balance, before.user.balance - (resumeTask ? 0 : before.config.cost));
        await run(`document.querySelector('.backend-preview').scrollIntoView({block:'center'})`);
        await new Promise(resolve => setTimeout(resolve, 300));
        await screenshot('desktop-generated.png');
        await click('保存到素材库');
        await wait(`!document.querySelector('.backend-preview') && document.querySelectorAll('.image-card').length > 0`);
        assert.equal((await run(`window.reach.listImages()`)).length, 1);
        await screenshot('desktop-saved.png');
        console.log(`PASS: real desktop login, checkin, server authorization, ${resumeTask ? 'task recovery without extra charge' : 'billed image generation'}, preview and local asset save.`);
      } else console.log('PASS: real desktop login, checkin, balance display and unauthenticated IPC rejection (no generation).');
      await click('退出登录');
      await wait(`!!document.querySelector('#backend-password')`);
      assert.equal(await run(`document.querySelector('#image-prompt').disabled`), true);
      if (registration) {
        await click('没有账号？注册');
        await input('backend-user', newUsername.toUpperCase());
        await input('backend-password', newPassword);
        await input('backend-confirm', newPassword);
        await click('注册并登录');
        await wait(`document.body.textContent.includes('用户名已被使用')`);
        await click('已有账号，去登录');
        await input('backend-user', newUsername.toUpperCase());
        await input('backend-password', newPassword);
        await click('登录');
        await wait(`!!document.querySelector('.backend-balance strong')`);
        assert.equal((await run(`window.reach.backendAccount()`)).user.balance, before.user.balance);
        console.log('PASS: desktop registration, password confirmation, duplicate username, automatic login, checkin and case-insensitive relogin.');
      }
    } catch (error) { console.error(error.message); await screenshot('desktop-error.png'); process.exitCode = 1; }
    finally { app.quit(); }
  });
});
require('../out/main/index.js');
