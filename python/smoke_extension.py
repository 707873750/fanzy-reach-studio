"""Real unpacked-extension + Python-process test against intercepted fixture pages.
No requests reach any social platform and no real posts are sent.
"""
import json
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Queue
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = '''<!doctype html><meta charset="utf-8"><body>
<main><div data-testid="tweetTextarea_0" contenteditable="true">Existing home draft</div>
<input data-testid="fileInput" type="file" multiple onchange="window.backgroundUpload=true">
<div data-testid="attachments"><div data-testid="tweetPhoto">Old photo</div></div>
<button data-testid="tweetButtonInline" onclick="window.backgroundClick=true">Home Post</button></main>
<div role="dialog" aria-hidden="true"><div data-testid="tweetTextarea_0" contenteditable="true">Hidden composer</div><input data-testid="fileInput" type="file"></div>
<div role="dialog" aria-modal="true" id="composer" hidden>
<div data-testid="tweetTextarea_0"><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div></div>
<input data-testid="fileInput" type="file" multiple style="display:none" onchange="window.uploadedCount=this.files.length;this.value='';document.querySelector('#attachments').innerHTML='<div data-testid=tweetPhoto>Preview</div>'">
<div data-testid="attachments" id="attachments"></div>
<button data-testid="tweetButton" onclick="window.clicks=(window.clicks||0)+1;document.querySelector('#toast').textContent='Your post was sent'">Post</button>
</div><div data-testid="toast" id="toast"></div><script>setTimeout(()=>document.querySelector("#composer").hidden=false,500)</script></body>'''

INSTAGRAM = """<!doctype html><meta charset="utf-8"><body>
<button onclick="window.backgroundClick=true">下一步</button><button onclick="window.backgroundClick=true">分享</button>
<a href="#" onclick="document.querySelector('#ig-dialog').hidden=false"><svg aria-label="新貼文"></svg></a>
<div role="dialog" id="ig-dialog" hidden>
<input id="upload" hidden type="file" multiple onchange="document.querySelector('#next').hidden=false">
<button id="next" hidden onclick="window.steps=(window.steps||0)+1;if(window.steps===2){this.hidden=true;document.querySelector('#caption').hidden=false;document.querySelector('#share').hidden=false}">下一步</button>
<div id="caption" hidden contenteditable="true" aria-label="撰寫說明……"></div>
<button id="share" hidden onclick="window.clicks=(window.clicks||0)+1;document.querySelector('#success').textContent='你的貼文已分享。'">分享</button>
</div><span id="success"></span></body>"""
PINTEREST = """<!doctype html><body>
<input type="file"><input aria-label="Title"><textarea aria-label="Description"></textarea>
<button onclick="document.querySelector('#board').hidden=false">Choose a board</button>
<button id="board" hidden onclick="window.board='Art';this.hidden=true">Art</button>
<button onclick="window.clicks=(window.clicks||0)+1;document.querySelector('#success').textContent='Your Pin has been published.'">Publish</button>
<span id="success"></span></body>"""


def main():
    proc = subprocess.Popen([sys.executable, '-u', str(ROOT/'python/extension_bridge.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    messages = Queue()
    run_logs = []
    def read():
        for line in proc.stdout:
            entry = json.loads(line)
            if entry.get('type') == 'log':
                run_logs.append(entry)
            else:
                messages.put(entry)
    threading.Thread(target=read, daemon=True).start()
    def send(value):
        proc.stdin.write(json.dumps(value)+'\n'); proc.stdin.flush()
    try:
        send({'action':'connection'})
        connection = messages.get(timeout=10)
        with tempfile.TemporaryDirectory() as folder, sync_playwright() as p:
            extension = str(ROOT/'extension')
            context = p.chromium.launch_persistent_context(str(Path(folder)/'profile'), channel='msedge', headless=True, args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
            fixture_modes = {'x': FIXTURE}
            context.route('https://x.com/**', lambda route: route.fulfill(content_type='text/html', body=fixture_modes['x']))
            context.route('https://www.instagram.com/**', lambda route: route.fulfill(content_type='text/html', body=INSTAGRAM))
            context.route('https://www.pinterest.com/**', lambda route: route.fulfill(content_type='text/html', body=PINTEREST))
            context.add_cookies([{'name':'existing_session','value':'fixture-session','url':'https://x.com'}])
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            extension_id = worker.url.split('/')[2]
            popup = context.new_page()
            popup.goto(f'chrome-extension://{extension_id}/popup.html')
            popup.locator('#pairing').fill(connection['pairing'])
            popup.locator('#connect').click()
            popup.wait_for_function("document.querySelector('#status').textContent.includes('已配对')", timeout=10000)
            file = Path(folder)/'test.jpg'; file.write_bytes(b'fixture image')
            for platform_name, host in [('x','x.com'),('instagram','www.instagram.com'),('pinterest','www.pinterest.com')]:
                send({'action':'publish','platform':platform_name,'files':[str(file)],'caption':'Existing session test 中文','title':'Title','hashtags':[],'altText':'','boardName':'Art'})
                # Pump Playwright's loop to service route callbacks for fixture pages.
                deadline = __import__('time').monotonic()+35
                while messages.empty() and __import__('time').monotonic()<deadline:
                    popup.wait_for_timeout(100)
                checkpoint = messages.get(timeout=2)
                assert checkpoint == {'type':'submitting'}, checkpoint
                active_id = worker.evaluate("async () => (await chrome.storage.local.get('activeJob')).activeJob.id")
                platform = next(page for page in context.pages if page.url.startswith('https://'+host+'/'))
                assert platform.evaluate('window.clicks || 0') == 0
                assert (platform.evaluate('window.uploadedCount') if platform_name == 'x' else platform.locator('input[type=file]').evaluate('e=>e.files.length')) == 1
                assert not platform.evaluate('Boolean(window.backgroundClick)')
                if platform_name == 'x':
                    assert 'existing_session=fixture-session' in platform.evaluate('document.cookie')
                    assert 'Existing session test 中文' in platform.locator('#composer [contenteditable=true]').inner_text()
                    assert platform.locator('main [contenteditable=true]').inner_text() == 'Existing home draft'
                    assert not platform.evaluate('Boolean(window.backgroundUpload || window.backgroundClick)')
                if platform_name == 'pinterest':
                    assert platform.evaluate('window.board') == 'Art'
                send({'ack':'persisted'})
                deadline = __import__('time').monotonic()+15
                while messages.empty() and __import__('time').monotonic()<deadline:
                    popup.wait_for_timeout(100)
                result = messages.get(timeout=2)
                assert result['state'] == 'succeeded', result
                assert platform.evaluate('window.clicks') == 1
                # Calling the submit phase again cannot click the platform twice.
                duplicate = worker.evaluate("""async ({host,id,platform}) => {
                  const tabs = await chrome.tabs.query({});
                  const tab = tabs.find(t => t.url?.startsWith('https://'+host+'/'));
                  const result = await chrome.scripting.executeScript({target:{tabId:tab.id},func:async (id,platform) => {
                    try { await globalThis.fanzyPublisher('submit',{id,platform}); return false; }
                    catch { return true; }
                  },args:[id,platform]});
                  return result[0].result;
                }""",{'host':host,'id':active_id,'platform':platform_name})
                assert duplicate and platform.evaluate('window.clicks') == 1
            # X native scheduling: no final click until the durable checkpoint.
            target = (datetime.now(timezone.utc)+timedelta(days=7)).replace(second=0,microsecond=0)
            selectors = ''.join('<label>'+label+'<select>'+''.join(f'<option>{value}</option>' for value in values)+'</select></label>' for label, values in [
                ('Year', range(target.year-1,target.year+3)), ('Month',range(1,13)), ('Day',range(1,32)),
                ('Hour',range(24)), ('Minute',range(60))])
            schedule_dialog = '<div role="dialog" id="schedule-dialog" hidden>'+selectors+'''<button onclick="this.parentElement.hidden=true;document.querySelector('[data-testid=tweetButton]').textContent='Schedule'">Confirm</button></div>'''
            fixture_modes['x'] = FIXTURE.replace('<div data-testid="attachments" id="attachments">', '''<button aria-label="Schedule post" onclick="document.querySelector('#schedule-dialog').hidden=false">Schedule time</button><div data-testid="attachments" id="attachments">''').replace('Your post was sent', 'Your post will be sent on the selected date').replace('</body>',schedule_dialog+'</body>')
            send({'action':'publish','platform':'x','files':[str(file)],'caption':'Scheduled fixture','hashtags':[], 'xScheduledAt':target.isoformat()})
            deadline = __import__('time').monotonic()+35
            while messages.empty() and __import__('time').monotonic()<deadline:
                popup.wait_for_timeout(100)
            assert not messages.empty(), run_logs[-15:]
            checkpoint = messages.get(timeout=2)
            assert checkpoint == {'type':'submitting'}, (checkpoint, run_logs[-15:])
            newest = [page for page in context.pages if page.url.startswith('https://x.com/')][-1]
            assert newest.evaluate('window.clicks || 0') == 0
            assert newest.locator('#schedule-dialog select').evaluate_all('(nodes)=>nodes.map(n=>Number(n.value))') == newest.evaluate('(iso)=>{const d=new Date(iso);return [d.getFullYear(),d.getMonth()+1,d.getDate(),d.getHours(),d.getMinutes()]}',target.isoformat())
            send({'ack':'persisted'})
            deadline = __import__('time').monotonic()+15
            while messages.empty() and __import__('time').monotonic()<deadline:
                popup.wait_for_timeout(100)
            scheduled = messages.get(timeout=2)
            assert scheduled['state'] == 'succeeded' and target.isoformat() in scheduled['message'], scheduled
            assert newest.evaluate('window.clicks') == 1
            assert any(entry['step']=='schedule.ready' for entry in run_logs)
            # Two genuine visible composers remain ambiguous: do not pick the first.
            fixture_modes['x'] = FIXTURE.replace('id="composer" hidden', 'id="composer"').replace('</body>', '<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true">Another composer</div></div></body>')
            send({'action':'publish','platform':'x','files':[str(file)],'caption':'Do not submit','hashtags':[]})
            deadline = __import__('time').monotonic()+35
            while messages.empty() and __import__('time').monotonic()<deadline:
                popup.wait_for_timeout(100)
            ambiguous = messages.get(timeout=2)
            assert ambiguous['state'] == 'needs_attention' and 'X 发帖弹窗' in ambiguous['message'], ambiguous
            newest = [page for page in context.pages if page.url.startswith('https://x.com/')][-1]
            assert newest.evaluate('window.clicks || 0') == 0
            # Account restriction must stop before filling/uploading or checkpointing.
            fixture_modes['x'] = FIXTURE.replace('<main>', '<h2>Your account is suspended 您的帳戶已被暫停</h2><main>')
            send({'action':'publish','platform':'x','files':[str(file)],'caption':'Do not submit','hashtags':[]})
            deadline = __import__('time').monotonic()+35
            while messages.empty() and __import__('time').monotonic()<deadline:
                popup.wait_for_timeout(100)
            restricted = messages.get(timeout=2)
            assert restricted['state'] == 'needs_attention' and '账号已被暂停' in restricted['message'], restricted
            newest = [page for page in context.pages if page.url.startswith('https://x.com/')][-1]
            assert newest.evaluate('window.clicks || window.uploadedCount || 0') == 0
            steps = {entry['step'] for entry in run_logs}
            assert {'bridge.ready','connection.paired','job.queued','job.leased','asset.transfer','control.wait','content.fill','images.upload','submit.click','submit.checkpoint_saved','submit.success','control.failed'} <= steps, steps
            assert any(entry.get('source') == 'page' and entry.get('jobId') for entry in run_logs)
            assert not any('Existing session test' in entry.get('message','') for entry in run_logs)
            # Revocation invalidates the old extension connection.
            send({'action':'reset_connection'})
            reset = messages.get(timeout=5)
            assert reset['pairing'] != connection['pairing'] and not reset['connected']
            context.close()
        print('PASS: real extension pairing, existing browser session reuse, all platforms, scoped X composer with duplicate controls, ambiguous-dialog rejection and checkpoint-before-click')
    finally:
        proc.stdin.close()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()

if __name__ == '__main__':
    main()
