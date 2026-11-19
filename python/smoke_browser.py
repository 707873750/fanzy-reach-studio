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
    window.platformDefaults=Object.fromEntries(['instagram','x','pinterest','tiktok'].map(p=>[p,{imagesPerDraft:p==='tiktok'?35:p==='instagram'?10:p==='x'?4:1,hashtags:[],boardName:'',title:'',scheduleDelayMinutes:0}]));
    window.logRows = [{id:'log-1',time:'2026-11-18T12:00:00.000Z',sessionId:'test',level:'info',source:'python',step:'job.leased',message:'任务已领取',draftId:'fixture',platform:'x'},
    {id:'log-2',time:'2026-11-18T12:00:01.000Z',sessionId:'test',level:'error',source:'page',step:'control.failed',message:'测试控件错误',draftId:'fixture',platform:'x',detail:'Fixture stack trace'}];
    window.reach = {
      getPlatformDefaults:async()=>JSON.parse(JSON.stringify(window.platformDefaults)),
      savePlatformDefaults:async(p,value)=>{window.platformDefaults[p]=value;return value;},
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
    page.get_by_role("button", name="发布队列").click()
    page.locator('.draft-row').click()
    page.get_by_label('X 定时发布时间',exact=False).fill('2030-06-15T12:34')
    page.get_by_role('button', name='保存修改').click()
    page.wait_for_function('window.savedPatch?.xScheduledAt')
    assert page.evaluate("new Date(window.savedPatch.xScheduledAt).getHours()") == 12
    assert page.evaluate("new Date(window.savedPatch.xScheduledAt).getMinutes()") == 34
    page.get_by_label('X 定时发布时间',exact=False).fill('')
    page.get_by_role('button', name='保存修改').click()
    page.wait_for_function('window.savedPatch?.xScheduledAt === null')
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="提交选中的 1 条").click()
    page.get_by_text("已发布 1/1 条；X 已排程 0 条。重试前请核对各任务结果。").wait_for()
    page.get_by_role("button", name="设置与账号").click()
    page.get_by_label('显示浏览器',exact=False).check()
    page.wait_for_function('window.browserSettings.showBrowser === true')
    page.get_by_text('Google Chrome（需已安装）', exact=True).wait_for()
    page.wait_for_function('window.browserSettings.channel === "chrome"')
    page.get_by_role('button',name='登录 X',exact=True).click()
    page.wait_for_function('window.loginPlatform === "x"')
    page.get_by_role('button',name='完成 X 登录 / 关闭窗口',exact=True).click()
    page.wait_for_function('window.closedPlatform === "x"')
    page.get_by_label('默认图板名称',exact=True).fill('test')
    page.get_by_role('button',name='保存 Pinterest 配置',exact=True).click()
    page.wait_for_function("window.platformDefaults.pinterest.boardName === 'test'")
    page.get_by_label('默认发布方式',exact=True).select_option('later')
    page.get_by_label('创建草稿后延后多少分钟',exact=True).fill('90')
    page.get_by_role('button',name='保存 X 配置',exact=True).click()
    page.wait_for_function('window.platformDefaults.x.scheduleDelayMinutes === 90')
    page.get_by_role('button',name='素材库',exact=True).click()
    page.get_by_role('button',name='设置与账号',exact=True).click()
    page.wait_for_function("document.getElementById('default-pinterest-board')?.value === 'test'")
    assert page.get_by_label('创建草稿后延后多少分钟',exact=True).input_value() == '90'
    assert page.locator('#default-instagram-images').input_value() == '10'
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
    # Creation choices retain both versions; the full payload crosses the preload API.
    page.evaluate("""window.reach.listImages=async()=>[{id:'image',fileName:'素材.jpg',width:100,height:100}];
      window.reach.createDrafts=async(ids,platforms,copy)=>{window.createdCopy={ids,platforms,copy};return [];};""")
    page.get_by_role('button', name='发布队列').click()
    page.get_by_role('button', name='刷新', exact=True).click()
    page.get_by_role('button', name='素材库', exact=True).click()
    page.locator('.image-card').click()
    page.get_by_label('统一文案',exact=True).fill('共用正文')
    page.get_by_label('X 文案方式',exact=True).select_option('independent')
    page.get_by_label('X 独立文案',exact=True).fill('X 独立正文')
    page.get_by_label('X 文案方式',exact=True).select_option('shared')
    page.get_by_label('X 文案方式',exact=True).select_option('independent')
    assert page.get_by_label('X 独立文案',exact=True).input_value() == 'X 独立正文'
    page.screenshot(path=str(ROOT / 'out/copy-options-smoke.png'), full_page=True)
    page.get_by_role('button',name='创建草稿',exact=True).click()
    page.wait_for_function('window.createdCopy')
    payload = page.evaluate('window.createdCopy')
    assert payload['ids'] == ['image']
    assert payload['copy']['sharedCaption'] == '共用正文'
    assert payload['copy']['platforms']['x'] == {'mode':'independent','caption':'X 独立正文'}
    assert payload['copy']['platforms']['instagram']['mode'] == 'shared'
    # Verify the queue sends a save before switching modes, protecting unsaved edits.
    page.evaluate("""window.queueDraft={id:'grouped',copyGroupId:'batch',platform:'x',imageIds:[],captionMode:'shared',sharedCaption:'统一正文',independentCaption:'独立备份',caption:'统一正文',title:'',altText:'',hashtags:[],status:'draft',updatedAt:'1'};
      window.modePatches=[];
      window.reach.listDrafts=async()=>[window.queueDraft];
      window.reach.updateDraft=async(id,patch)=>{window.modePatches.push(patch);Object.assign(window.queueDraft,patch);if(patch.captionMode)window.queueDraft.caption=patch.captionMode==='shared'?window.queueDraft.sharedCaption:window.queueDraft.independentCaption;window.queueDraft.updatedAt=String(window.modePatches.length);return window.queueDraft;};void 0;""")
    page.get_by_role('button', name='刷新',exact=True).click()
    page.locator('.draft-row').click()
    page.get_by_label('正文文案',exact=True).fill('未保存的统一正文')
    page.get_by_label('文案方式',exact=True).select_option('independent')
    page.wait_for_function("window.modePatches.length === 2")
    assert page.evaluate('window.modePatches[0].caption') == '未保存的统一正文'
    assert page.evaluate('window.modePatches[1].captionMode') == 'independent'
    page.wait_for_function("document.getElementById('draft-caption').value === '独立备份'")
    # Keep a publish request pending: unrelated controls must remain interactive.
    page.evaluate("""window.interactiveDrafts=[{...window.queueDraft,id:'active',copyGroupId:'locked'},
      {...window.queueDraft,id:'linked',copyGroupId:'locked'}, {...window.queueDraft,id:'free',copyGroupId:'free'}];
      window.reach.listDrafts=async()=>window.interactiveDrafts;
      window.reach.updateDraft=async(id,patch)=>{const draft=window.interactiveDrafts.find(d=>d.id===id);Object.assign(draft,patch,{updatedAt:String(Date.now())});return draft;};
      window.publishCalls=0;window.reach.publishDrafts=()=>{window.publishCalls++;return new Promise((resolve,reject)=>{window.finishPublish=resolve;window.failPublish=reject;});};void 0;""")
    page.get_by_role('button',name='刷新',exact=True).click()
    page.locator('.draft-row').first.click()
    page.locator('.draft-select-row input').first.check()
    page.get_by_role('button',name='提交选中的 1 条',exact=True).click()
    page.wait_for_function('window.publishCalls === 1')
    assert page.get_by_role('button',name='提交选中的 1 条',exact=True).is_disabled()
    assert page.get_by_label('正文文案',exact=True).is_disabled()
    page.locator('.draft-row').nth(1).click()
    assert page.get_by_label('正文文案',exact=True).is_disabled()
    page.locator('.draft-row').nth(2).click()
    page.get_by_label('正文文案',exact=True).fill('发布期间编辑其他草稿')
    page.get_by_role('button',name='保存修改',exact=True).click()
    page.wait_for_function("window.interactiveDrafts[2].caption === '发布期间编辑其他草稿'")
    page.get_by_role('button',name='素材库',exact=True).click()
    assert page.get_by_role('button',name='导入图片',exact=True).is_enabled()
    page.get_by_placeholder('搜索图片…').fill('素材')
    page.get_by_role('button',name='设置与账号',exact=True).click()
    assert page.get_by_role('button',name='保存 Pinterest 配置',exact=True).is_enabled()
    assert page.get_by_role('button',name='登录 X',exact=True).is_disabled()
    page.get_by_role('button',name='运行日志',exact=True).click()
    page.get_by_label('搜索步骤、错误或任务 ID').fill('control.failed')
    assert page.locator('.log-row').count() == 1
    page.evaluate("window.finishPublish([{...window.interactiveDrafts[0],status:'published'}])")
    page.get_by_text('已发布 1/1 条；X 已排程 0 条。重试前请核对各任务结果。',exact=True).wait_for()
    page.wait_for_function("!document.body.innerText.includes('正在后台发布')")
    page.get_by_role('button',name='发布队列',exact=False).click()
    page.locator('.draft-select-row input').first.check()
    page.get_by_role('button',name='提交选中的 1 条',exact=True).click()
    page.wait_for_function('window.publishCalls === 2')
    page.evaluate("window.failPublish(new Error('测试发布失败'))")
    page.get_by_text('测试发布失败',exact=True).wait_for()
    page.wait_for_function("!document.body.innerText.includes('正在后台发布')")
    assert page.get_by_role('button',name='提交选中的 1 条',exact=True).is_enabled()
    assert not errors, errors
    browser.close()
    server.shutdown()
    server.server_close()
print("PASS: publishing queue, Playwright settings, login controls and live logs")
