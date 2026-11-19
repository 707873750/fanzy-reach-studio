"""Offline renderer benchmark; no account, browser profile or publication is used."""
import json
import sys
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root / 'out/renderer')))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width':1440,'height':920})
        page.add_init_script("""window.uiSamples=[];window.longTasks=[];
          new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
          window.rows=Array.from({length:1000},(_,i)=>({id:String(i),time:new Date(1700000000000+i).toISOString(),sessionId:'benchmark',level:'info',source:'app',step:'benchmark',message:'本地模拟日志 '+i,detail:'x'.repeat(2000)}));
          window.reach={listImages:async()=>[],listDrafts:async()=>[],getSettings:async()=>({hasDeepSeekKey:false}),getBrowserSettings:async()=>({showBrowser:false,channel:'chrome'}),
            onScheduleReminder:()=>()=>{},onPublishProgress:()=>()=>{},reportRendererError:async()=>{},reportUiPerformance:async s=>window.uiSamples.push(s),
            getLogs:async()=>({entries:window.rows,directory:'fixture',storageError:null}),onRunLog:cb=>{window.logListener=cb;return ()=>{window.logListener=null;};}};
        """)
        page.goto(f'http://127.0.0.1:{server.server_port}')
        page.get_by_role('button', name='运行日志', exact=True).click()
        page.locator('.log-row').first.wait_for()
        initial_count = page.locator('.log-row').count()
        if initial_count <= 100:
            page.get_by_role('button',name='较早记录',exact=True).click()
            page.get_by_text('本地模拟日志 899',exact=True).wait_for()
            page.get_by_role('button',name='较新记录',exact=True).click()
        page.evaluate("""window.streamDone=false;let i=0;const timer=setInterval(()=>{
          for(let n=0;n<10;n++){i++;window.logListener({...window.rows[0],id:'stream'+i,time:new Date(1800000000000+i).toISOString()});}
          if(i>=1000){clearInterval(timer);window.streamDone=true;}
        },20);""")
        page.get_by_label('搜索步骤、错误或任务 ID').fill('benchmark')
        page.wait_for_function('window.streamDone')
        page.wait_for_timeout(750)
        stress = page.evaluate('({longTaskCount:window.longTasks.length,longTaskMaxMs:Math.max(0,...window.longTasks),longTaskTotalMs:window.longTasks.reduce((a,b)=>a+b,0)})')
        # Deliberate positive control: monitoring must detect an injected UI stall.
        if page.evaluate("typeof window.reach.reportUiPerformance === 'function'"):
            # Use a page task (not a DevTools evaluation task) so Long Tasks observes it.
            # 320ms guarantees >150ms heartbeat lateness even at the 100ms timer boundary.
            page.evaluate('window.stallDone=false;setTimeout(()=>{const end=performance.now()+320;while(performance.now()<end){}window.stallDone=true;},0)')
            page.wait_for_function('window.stallDone')
            page.wait_for_timeout(5500)
        result = {'renderedLogRows':initial_count, **stress, 'uiSamples':page.evaluate('window.uiSamples')}
        if result['uiSamples']:
            assert any(s['timerMaxMs']>=150 or s['longTaskMaxMs']>=150 for s in result['uiSamples']), 'injected stall was missed'
            assert initial_count<=100, 'too many log rows rendered'
        if len(sys.argv)>1:
            Path(sys.argv[1]).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result))
        browser.close()
finally:
    server.shutdown()
    server.server_close()
