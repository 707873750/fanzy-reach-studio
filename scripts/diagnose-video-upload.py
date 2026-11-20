"""Local pre-submit diagnosis. Never grants the publisher a submit checkpoint."""
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'python'))
from publisher import Publisher
from playwright.async_api import async_playwright


async def main():
    source = Path(os.environ['APPDATA']) / 'fanzy-reach-studio'
    data = json.loads((source / 'reach-data.json').read_text(encoding='utf-8'))
    output = ROOT / 'build' / 'video-diagnostics'
    output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        async def inspect(platform):
            with tempfile.TemporaryDirectory(prefix='reach-video-diagnose-') as temp:
                draft = next(d for d in data['drafts'] if d['platform'] == platform and d.get('mediaType') == 'video')
                profile = Path(temp) / 'chrome' / platform
                profile.mkdir(parents=True)
                shutil.copy2(source / 'browser-profiles' / 'chrome' / platform / 'fanzy-session.bin', profile / 'fanzy-session.bin')
                context = None
                async def setup(ctx, job):
                    nonlocal context
                    context = ctx
                events = []
                def event(entry):
                    if entry.get('step') != 'performance.sample':
                        events.append({key: entry.get(key) for key in ('step', 'message', 'detail') if key != 'detail' or entry.get('step') in ('control.failed', 'page.error')})
                runner = Publisher(playwright, event, context_setup=setup)
                original_capture = runner.capture_result
                async def capture_result(page, request, job, pending=False):
                    await snapshot()
                    await original_capture(page, request, job, pending)
                runner.capture_result = capture_result
                captured = False
                async def snapshot():
                    nonlocal captured
                    if captured or not context or not context.pages:
                        return
                    captured = True
                    page = context.pages[0]
                    state = await page.evaluate('''()=>({
                      videos:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,width:v.videoWidth,height:v.videoHeight,paused:v.paused,preload:v.preload,hasSource:!!(v.src||v.currentSrc),rects:v.getClientRects().length,hidden:!!v.closest('[aria-hidden="true"],[inert]'),error:v.error?.code})),
                      buttons:[...document.querySelectorAll('button,[role="button"]')].filter(b=>b.getClientRects().length).map(b=>({label:(b.getAttribute('aria-label')||b.innerText||'').slice(0,100),disabled:!!b.disabled||b.getAttribute('aria-disabled')==='true'})).slice(-45),
                      progress:[...document.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].map(e=>({visible:!!e.getClientRects().length,label:e.getAttribute('aria-label'),value:e.getAttribute('aria-valuenow'),parents:[e,e.parentElement,e.parentElement?.parentElement].filter(Boolean).map(n=>({tag:n.tagName,testid:n.getAttribute('data-testid'),class:n.className}))})),
                      fields:[...document.querySelectorAll('textarea,[contenteditable],input:not([type=password]):not([type=hidden])')].map(e=>({tag:e.tagName,visible:!!e.getClientRects().length,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),placeholder:e.getAttribute('placeholder'),class:e.className})),
                      headings:[...document.querySelectorAll('h1,h2,h3,[role=heading]')].map(e=>e.innerText),
                      uploadLabels:[...document.querySelectorAll('span,p,div')].filter(e=>e.children.length===0&&e.getClientRects().length&&/上传|检查|视频|upload|video|check/i.test(e.textContent)).map(e=>({text:e.textContent.slice(0,180),class:e.className})).slice(-40),
                      frames:[...document.querySelectorAll('iframe')].map(e=>({title:e.title}))
                    })''')
                    state['events'] = events
                    if platform == 'facebook':
                        # Read the already-loaded request schema, never execute a mutation.
                        state['creationSchema'] = await page.evaluate('''()=>{try {
                          const query=require('ComposerStoryCreateMutation.graphql');
                          const paths=[];
                          const walk=(nodes,path)=>{for(const n of nodes||[]){const next=n.name?[...path,n.alias||n.name]:path;
                            if(n.name&&next.length<7)paths.push({path:next.join('.'),kind:n.kind});
                            if(next.length<7)walk(n.selections,next);}};
                          walk(query.operation?.selections,[]);return paths;
                        }catch(e){return {error:String(e)}}}''')
                    (output / (platform + '.json')).write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
                    await page.screenshot(path=str(output / (platform + '.png')), full_page=True, timeout=10000)
                    print(platform, 'captured', [e['step'] for e in events[-5:]], flush=True)
                async def deny():
                    await snapshot()
                    return False
                job = {**draft, 'files': [str(source / 'exports' / draft['id'] / '01-video.mp4')], 'profilesRoot': temp, 'channel': 'chrome', 'artifactsRoot': str(output)}
                task = asyncio.create_task(runner.publish(job, deny))
                try:
                    done, _ = await asyncio.wait([task], timeout=150)
                    if not done:
                        await snapshot()
                        task.cancel()
                    results = await asyncio.gather(task, return_exceptions=True)
                    print(platform, 'result', results, flush=True)
                finally:
                    await runner.close()
        await asyncio.gather(*(inspect(platform) for platform in (sys.argv[1:] or ('instagram', 'x', 'tiktok'))))


asyncio.run(main())
