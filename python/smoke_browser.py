"""Offline integration smoke test. Does NOT contact or publish to any platform."""
import json
import tempfile
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
with sync_playwright() as p, tempfile.TemporaryDirectory() as folder:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    draft = {"id": "fixture", "platform": "x", "imageIds": [], "title": "Test", "caption": "Hello", "hashtags": [], "altText": "", "status": "draft", "scheduledAt": None, "preparedFolder": None, "publishedUrl": None, "createdAt": "2026-01-01", "updatedAt": "2026-01-01"}
    page.add_init_script("""window.browserSettings = {showBrowser:false,channel:"chrome"};
    window.logRows = [{id:'log-1',time:'2026-11-18T12:00:00.000Z',sessionId:'test',level:'info',source:'python',step:'job.leased',message:'任务已领取',draftId:'fixture',platform:'x'},
    {id:'log-2',time:'2026-11-18T12:00:01.000Z',sessionId:'test',level:'error',source:'page',step:'control.failed',message:'测试控件错误',draftId:'fixture',platform:'x',detail:'Fixture stack trace'}];
    window.reach = {
      getLogs: async () => ({entries:window.logRows,directory:'C:/test/logs',storageError:null}),
      onRunLog: callback => {window.logListener=callback;return ()=>{window.logListener=null;};},
      openLogFolder: async () => {window.logFolderOpened=true;},
      reportRendererError: async () => {},
      getBrowserSettings: async () => window.browserSettings,
      saveBrowserSettings: async (value) => (window.browserSettings=value),
      closePlatformBrowser: async (platform) => {window.closedPlatform=platform;},
      copyText: async (text) => { window.copiedPairing = text; return true; },
      openExtensionFolder: async () => {},
      listImages: async () => [], listDrafts: async () => [DRAFT],
      getSettings: async () => ({hasDeepSeekKey:false,model:'test'}),
      onScheduleReminder: () => () => {}, onPublishProgress: () => () => {},
      openPlatformBrowser: async (platform) => {window.loginPlatform=platform;}, updateDraft: async (id, patch) => {window.savedPatch=patch;return DRAFT;},
      publishDrafts: async () => [{...DRAFT,status:'published'}]
    };""".replace("DRAFT", json.dumps(draft)))
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT / "out/renderer")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page.goto(f"http://127.0.0.1:{server.server_port}")
    page.get_by_role("button", name="Publishing Queue").click()
    page.locator('.draft-row').click()
    page.get_by_label('X 定时发布时间',exact=False).fill('2030-06-15T12:34')
    page.get_by_role('button', name='Save changes').click()
    page.wait_for_function('window.savedPatch?.xScheduledAt')
    assert page.evaluate("new Date(window.savedPatch.xScheduledAt).getHours()") == 12
    assert page.evaluate("new Date(window.savedPatch.xScheduledAt).getMinutes()") == 34
    page.get_by_label('X 定时发布时间',exact=False).fill('')
    page.get_by_role('button', name='Save changes').click()
    page.wait_for_function('window.savedPatch?.xScheduledAt === null')
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="Submit 1 selected").click()
    page.get_by_text("1/1 published; 0 scheduled on X. Review individual results before retrying.").wait_for()
    page.get_by_role("button", name="Settings & Accounts").click()
    page.get_by_label('显示浏览器',exact=False).check()
    page.wait_for_function('window.browserSettings.showBrowser === true')
    page.get_by_text('Google Chrome（需已安装）', exact=True).wait_for()
    page.wait_for_function('window.browserSettings.channel === "chrome"')
    page.get_by_role('button',name='登录 X',exact=True).click()
    page.wait_for_function('window.loginPlatform === "x"')
    page.get_by_role('button',name='完成 X 登录 / 关闭窗口',exact=True).click()
    page.wait_for_function('window.closedPlatform === "x"')
    page.get_by_role('button', name='运行日志', exact=True).click()
    page.get_by_text('测试控件错误', exact=True).wait_for()
    assert page.locator('.log-row').count() == 2
    page.get_by_label('级别', exact=True).select_option('error')
    assert page.locator('.log-row').count() == 1
    page.locator('.log-row summary').click()
    page.get_by_text('Fixture stack trace', exact=False).wait_for()
    page.get_by_label('级别', exact=True).select_option('all')
    page.evaluate("window.logListener({id:'log-3',time:'2026-11-18T12:00:02.000Z',sessionId:'test',level:'info',source:'extension',step:'submit.success',message:'实时日志到达',draftId:'fixture',platform:'x'})")
    page.get_by_text('实时日志到达', exact=True).wait_for()
    assert page.locator('.log-row').count() == 3
    page.get_by_label('搜索步骤、错误或任务 ID').fill('control.failed')
    assert page.locator('.log-row').count() == 1
    page.get_by_role('button',name='复制筛选结果').click()
    assert 'control.failed' in page.evaluate('window.copiedPairing')
    page.get_by_role('button',name='打开日志文件夹').click()
    assert page.evaluate('window.logFolderOpened')
    assert not errors, errors
    browser.close()
    server.shutdown()
    server.server_close()
print("PASS: publishing queue, Playwright settings, login controls and live logs")
