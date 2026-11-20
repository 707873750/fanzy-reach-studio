"""Real headless browser, intercepted fixtures only; never contacts platforms."""
import tempfile
import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from pathlib import Path
from datetime import datetime, timedelta, timezone
from playwright.async_api import async_playwright
from publisher import Publisher
import session_store
from smoke_extension import FIXTURE, INSTAGRAM, PINTEREST


class PlaywrightPublishingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.playwright = await async_playwright().start()
        self.events = []
        self.fixture = {'x': FIXTURE, 'instagram': INSTAGRAM, 'pinterest': PINTEREST}
        self.launches = []
        async def setup(context, job):
            self.context = context
            async def route(request):
                if request.request.is_navigation_request():
                    await request.fulfill(content_type='text/html; charset=utf-8', body=self.fixture[job['platform']])
                else:
                    await request.abort()
            await context.route('**/*', route)
        self.runner = Publisher(self.playwright, self.events.append, context_setup=setup)
        original = self.runner.launch
        async def launch(job, visible=False, restore_session=True):
            self.launches.append(visible)
            # Login UI uses visible=True in production; tests never show windows.
            context = await original(job, visible=False, restore_session=restore_session)
            return context
        self.runner.launch = launch
        self.native_calls = []
        async def native_login(profile, url):
            self.native_calls.append((profile, url))
            platform = profile.name
            job = {**self.job, 'platform':platform}
            context = await self.runner.launch(job, restore_session=False)
            await context.pages[0].goto(url)
            return context
        self.runner.native_login_factory = native_login
        image = Path(self.temp.name)/'image.jpg'
        image.write_bytes(b'test fixture')
        self.job = {'id':'fixture','action':'publish','platform':'x','files':[str(image)],
                    'caption':'PRIVATE fixture caption', 'hashtags':[], 'boardName':'Art',
                    'channel':'chrome','profilesRoot':self.temp.name+'/profiles',
                    'artifactsRoot':self.temp.name+'/screenshots'}

    async def asyncTearDown(self):
        await self.runner.close()
        await self.playwright.stop()
        self.temp.cleanup()

    async def checkpoint(self):
        page = self.context.pages[0]
        self.assertEqual(await page.evaluate('window.clicks || 0'), 0)
        return True

    async def test_native_pinterest_schedule(self):
        self.fixture['pinterest'] = PINTEREST.replace('>Publish</button>', '>Schedule</button>').replace('Your Pin has been published.', 'Your Pin has been scheduled.').replace('</body>', '''
          <input type="checkbox" aria-label="Publish at a later date">
          <input type="date" aria-label="Date"><input type="time" aria-label="Time"></body>''')
        target = datetime.now(timezone.utc) + timedelta(hours=2)
        async def checkpoint():
            page = self.context.pages[0]
            expected = await page.evaluate('(iso)=>{const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}', target.isoformat())
            self.assertEqual(await page.locator('input[type=date]').input_value(), expected[:10])
            self.assertEqual(await page.locator('input[type=time]').input_value(), expected[11:])
            return await self.checkpoint()
        result = await self.runner.publish({**self.job, 'platform':'pinterest', 'nativeScheduledAt':target.isoformat()}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)
        self.assertIn(target.isoformat(), result['message'])

    async def test_missing_native_schedule_falls_back_without_submission(self):
        for platform in ('instagram', 'pinterest'):
            with self.subTest(platform=platform):
                checkpoint = AsyncMock(return_value=True)
                result = await self.runner.publish({**self.job, 'platform':platform, 'nativeScheduledAt':(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat()}, checkpoint)
                self.assertEqual(result['state'], 'local_scheduled', result)
                checkpoint.assert_not_awaited()

    async def test_unknown_native_picker_falls_back_without_submission(self):
        self.fixture['pinterest'] = PINTEREST.replace('</body>', '<button>Publish at a later date</button><input aria-label="Date"></body>')
        checkpoint = AsyncMock(return_value=True)
        result = await self.runner.publish({**self.job, 'platform':'pinterest', 'nativeScheduledAt':(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat()}, checkpoint)
        self.assertEqual(result['state'], 'local_scheduled', result)
        checkpoint.assert_not_awaited()

    async def test_platforms_and_visible_setting(self):
        for platform in ('x', 'instagram', 'pinterest'):
            result = await self.runner.publish({**self.job,'platform':platform,'showBrowser':platform=='instagram'}, self.checkpoint)
            self.assertEqual(result['state'],'succeeded',result)
        self.assertEqual(self.launches,[False,True,False])
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events),3)
        samples = [e for e in self.events if e['step']=='performance.sample']
        self.assertGreaterEqual(len(samples), 3)
        self.assertTrue(all('jsHeapMB' in e['detail'] for e in samples))
        self.assertTrue(all('gpuCounterStatus' in e['detail'] for e in samples))
        self.assertFalse(any('PRIVATE fixture caption' in e['message'] for e in self.events))

    async def test_x_navigation_denied_never_submits(self):
        async def setup(context, job):
            await context.route('**/*', lambda route: route.fulfill(
                status=403, content_type='text/html', body='<h1>Forbidden</h1>'))
        self.runner.context_setup = setup
        async def checkpoint():
            self.fail('Navigation denial must never reach submission')
        result = await self.runner.publish(self.job, checkpoint)
        self.assertEqual(result['state'], 'needs_attention', result)
        self.assertIn('HTTP 403', result['message'])
        self.assertIn('尚未上传或发送', result['message'])
        self.assertTrue(any(e['step']=='page.http' and '403' in e['message'] for e in self.events))
        self.assertFalse(any(e['step'] in ('asset.load','submit.click') for e in self.events))

    async def test_gpu_sampling_failure_does_not_fail_publish(self):
        with patch('gpu_stats.GpuSampler.sample',side_effect=RuntimeError('fixture counter failure')):
            result=await self.runner.publish(self.job,self.checkpoint)
        self.assertEqual(result['state'],'succeeded',result)
        samples=[e for e in self.events if e['step']=='performance.sample']
        self.assertTrue(any('unavailable:RuntimeError' in e['detail'] for e in samples))

    async def test_x_preview_without_attachments_wrapper(self):
        self.fixture['x'] = FIXTURE.replace('<div data-testid="attachments" id="attachments">', '<div id="attachments">')
        result = await self.runner.publish(self.job, self.checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)
        self.assertTrue(any(e['step']=='images.preview_ready' for e in self.events))

    async def test_pinterest_chinese_fields_and_board(self):
        self.fixture['pinterest'] = PINTEREST.replace(
            '<input aria-label="Title"><textarea aria-label="Description"></textarea>',
            '<input placeholder="简要描述你的 Pin 图"><div role="combobox" contenteditable="true" aria-label="描述你的 Pin 图"></div><input placeholder="搜索标签">'
        ).replace('Choose a board', '图板\n选择一块图板').replace(
            '<button id="board"', '<button role="option" id="board"')
        async def checkpoint():
            page = self.context.pages[0]
            self.assertEqual(await page.locator('input[placeholder="简要描述你的 Pin 图"]').input_value(), 'Pin title')
            self.assertEqual(await page.locator('[contenteditable]').inner_text(), self.job['caption'])
            self.assertEqual(await page.locator('input[placeholder="搜索标签"]').input_value(), '')
            self.assertEqual(await page.evaluate('window.board'), 'Art')
            return await self.checkpoint()
        result = await self.runner.publish({**self.job, 'platform':'pinterest', 'title':'Pin title'}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)

    async def test_pinterest_alt_text_variants(self):
        for mode in ('direct', 'more', 'expanded', 'more_button', 'visual_details'):
            hidden = '' if mode=='expanded' else 'hidden'
            alt = f'<textarea id="alt" aria-label="替代文字" {hidden}></textarea>'
            if mode=='visual_details':
                alt = '<textarea id="alt" placeholder="描述你 Pin 图的视觉详细信息" hidden></textarea>'
            show = "setTimeout(()=>document.querySelector('#alt').hidden=false,300)"
            if mode=='direct':
                alt += f'<button onclick="{show}">添加替代文本</button>'
            elif mode in ('more', 'visual_details'):
                alt += f'<div role="button" onclick="window.expanded=(window.expanded||0)+1;{show}">更多选项</div>'
            elif mode=='more_button':
                alt += f'<button id="add-alt" hidden onclick="{show}">Add alt text</button><button onclick="document.querySelector(\'#add-alt\').hidden=false">More options</button>'
            self.fixture['pinterest'] = PINTEREST.replace('</body>', alt+'</body>')
            async def checkpoint():
                page = self.context.pages[0]
                self.assertEqual(await page.locator('#alt').input_value(), 'PRIVATE alt fixture')
                if mode=='more':
                    self.assertEqual(await page.evaluate('window.expanded'), 1)
                return await self.checkpoint()
            result = await self.runner.publish({**self.job,'platform':'pinterest','altText':'PRIVATE alt fixture'}, checkpoint)
            self.assertEqual(result['state'],'succeeded',(mode,result))
        self.assertFalse(any('PRIVATE alt fixture' in e.get('message','') for e in self.events))

    async def test_pinterest_board_search_and_missing(self):
        for missing in (False, True):
            original='<button id="board" hidden onclick="window.board=\'Art\';this.hidden=true">Art</button>'
            results = '<p>未找到图板</p>' if missing else '<button onclick="window.board=\'Art\'">Art</button>'
            panel='<section id="board" hidden><input aria-label="通过你的图板搜索" oninput="document.querySelector(\'#results\').hidden=false"><div id="results" hidden>'+results+'</div></section>'
            self.fixture['pinterest']=PINTEREST.replace(original,panel)
            async def checkpoint():
                self.assertFalse(missing, 'Missing board must not submit')
                self.assertEqual(await self.context.pages[0].get_by_label('通过你的图板搜索').input_value(), 'Art')
                return await self.checkpoint()
            result=await self.runner.publish({**self.job,'platform':'pinterest'},checkpoint)
            self.assertEqual(result['state'],'needs_attention' if missing else 'succeeded',result)
            if missing:
                self.assertIn('未找到目标图板',result['message'])

    async def test_pinterest_remembered_board_picker(self):
        for remembered in ('Art', 'Different board'):
            self.fixture['pinterest']=PINTEREST.replace(
                '<button onclick="document.querySelector(\'#board\').hidden=false">Choose a board</button>',
                '<button data-test-id="board-dropdown-select-button" onclick="window.pickerOpened=true;document.querySelector(\'#board\').hidden=false">图板\n'+remembered+'</button>')
            async def checkpoint():
                page=self.context.pages[0]
                self.assertTrue(await page.evaluate('window.pickerOpened'))
                self.assertEqual(await page.evaluate('window.board'),'Art')
                return await self.checkpoint()
            result=await self.runner.publish({**self.job,'platform':'pinterest'},checkpoint)
            self.assertEqual(result['state'],'succeeded',result)

    async def test_pinterest_transient_chinese_confirmation(self):
        original="document.querySelector('#success').textContent='Your Pin has been published.'"
        self.fixture['pinterest']=PINTEREST.replace(original,"setTimeout(()=>{document.querySelector('#success').textContent='你的 Pin 图已发布！';setTimeout(()=>{document.querySelector('#success').textContent='';document.body.insertAdjacentHTML('beforeend','<div role=dialog>找到喜欢的，立刻收藏起来。立即安装</div>');},40);},20)")
        result=await self.runner.publish({**self.job,'platform':'pinterest'},self.checkpoint)
        self.assertEqual(result['state'],'succeeded',result)
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events),1)

    async def test_pinterest_create_response_confirms_under_promo(self):
        async def checkpoint():
            await self.checkpoint()
            await self.context.route('**/resource/PinResource/create/',lambda route:route.fulfill(json={'resource_response':{'status':'success','data':{'id':'123456789012345'}}}))
            await self.context.pages[0].evaluate("() => {document.querySelector('button:last-of-type').onclick=()=>{window.clicks=(window.clicks||0)+1;fetch('/resource/PinResource/create/',{method:'POST'});document.body.insertAdjacentHTML('beforeend','<div role=dialog>安装扩展程序</div>');};}")
            return True
        result=await self.runner.publish({**self.job,'platform':'pinterest'},checkpoint)
        self.assertEqual(result['state'],'succeeded',result)
        self.assertEqual(result['url'],'https://www.pinterest.com/pin/123456789012345/')
        self.assertFalse(any(e['step']=='task.failed' for e in self.events))

    async def test_pinterest_promo_without_evidence_stays_pending(self):
        from publisher import ADAPTER_PATH
        adapter=Path(self.temp.name)/'short-confirmation.js'
        adapter.write_text(ADAPTER_PATH.read_text(encoding='utf-8').replace('Date.now()+45000','Date.now()+800'),encoding='utf-8')
        original="document.querySelector('#success').textContent='Your Pin has been published.'"
        self.fixture['pinterest']=PINTEREST.replace(original,"document.querySelector('#success').textContent='';document.body.insertAdjacentHTML('beforeend','<div role=dialog>找到喜欢的，立刻收藏起来。立即安装</div>')")
        with patch('publisher.ADAPTER_PATH',adapter):
            result=await self.runner.publish({**self.job,'platform':'pinterest'},self.checkpoint)
        self.assertEqual(result,{'state':'uncertain','message':'已提交，结果待确认'})
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events),1)
        self.assertFalse(any(e['step'] in ('task.failed','control.failed','submit.success') for e in self.events))
        self.assertTrue(any(e['step']=='confirmation.screenshot' for e in self.events))

    async def test_login_profile_reuse_and_lock(self):
        profile = self.runner.profile(self.job)
        profile.mkdir(parents=True)
        session_store.save(profile, {'cookies': [], 'origins': [{'origin':'https://x.com', 'localStorage':[{'name':'test-session','value':'stale'}]}]})
        await self.runner.login(self.job)
        self.assertEqual(len(self.native_calls), 1)
        self.assertEqual(self.context.pages[0].url, 'https://x.com/i/flow/login')
        await self.context.add_cookies([{'name':'saved_session','value':'fixture','domain':'x.com','path':'/','expires':(datetime.now(timezone.utc)+timedelta(days=1)).timestamp()}])
        await self.context.pages[0].evaluate("localStorage.setItem('test-session','saved-local')")
        blocked = await self.runner.publish(self.job, self.checkpoint)
        self.assertEqual(blocked['state'],'needs_attention')
        self.assertIn('登录窗口',blocked['message'])
        await self.runner.close_login(self.job)
        async def checkpoint():
            self.assertIn('saved_session=fixture',await self.context.pages[0].evaluate('document.cookie'))
            self.assertEqual(await self.context.pages[0].evaluate("localStorage.getItem('test-session')"),'saved-local')
            return await self.checkpoint()
        result = await self.runner.publish(self.job,checkpoint)
        self.assertEqual(result['state'],'succeeded',result)
        ciphertext = (self.runner.profile(self.job)/'fanzy-session.bin').read_bytes()
        self.assertNotIn(b'saved_session',ciphertext)
        self.assertNotIn(b'saved-local',ciphertext)

    async def test_login_platforms_and_close_failure(self):
        for platform in ('x', 'instagram', 'pinterest'):
            job = {**self.job, 'platform':platform}
            await self.runner.login(job)
            with self.assertRaisesRegex(ValueError, '已有登录会话'):
                await self.runner.login(job)
            window = self.runner.logins[str(self.runner.profile(job))]
            close = window.close
            window.close = AsyncMock(side_effect=RuntimeError('close blocked'))
            with self.assertRaisesRegex(RuntimeError, 'close blocked'):
                await self.runner.close_login(job)
            self.assertIn(str(self.runner.profile(job)), self.runner.logins)
            window.close = close
            await self.runner.close_login(job)
            self.assertNotIn(str(self.runner.profile(job)), self.runner.logins)
        self.assertEqual([p.name for p, _ in self.native_calls], ['x','instagram','pinterest'])

    async def test_login_does_not_snapshot_periodically(self):
        save = AsyncMock(wraps=self.runner.save_session)
        self.runner.save_session = save
        await self.runner.login(self.job)
        await asyncio.sleep(2.5)
        save.assert_not_awaited()
        await self.runner.close_login(self.job)
        save.assert_awaited_once()

    async def test_instagram_continue_labels(self):
        for label in ('继续', '繼續', 'Continue'):
            # Include a same-named background control: only the dialog may advance.
            self.fixture['instagram'] = INSTAGRAM.replace('下一步',label).replace("window.steps=(window.steps||0)+1;", "window.steps=(window.steps||0)+1;document.querySelector('#ig-dialog').dataset.steps=window.steps;")
            async def checkpoint():
                page = self.context.pages[0]
                self.assertEqual(await page.evaluate('window.steps'),2)
                self.assertFalse(await page.evaluate('Boolean(window.backgroundClick)'))
                return await self.checkpoint()
            result = await self.runner.publish({**self.job,'platform':'instagram'},checkpoint)
            self.assertEqual(result['state'],'succeeded',(label,result))

    async def test_instagram_create_retries_ignored_click(self):
        self.fixture['instagram'] = INSTAGRAM.replace("document.querySelector('#ig-dialog').hidden=false", "window.createClicks=(window.createClicks||0)+1;if(!event.isTrusted)throw Error('Requires real click');if(window.createClicks===1)return;document.querySelector('#ig-dialog').hidden=false")
        async def checkpoint():
            self.assertEqual(await self.context.pages[0].evaluate('window.createClicks'),2)
            return await self.checkpoint()
        result = await self.runner.publish({**self.job,'platform':'instagram'},checkpoint)
        self.assertEqual(result['state'],'succeeded',result)
        steps = [e['step'] for e in self.events]
        self.assertLess(steps.index('instagram.create.opened'),steps.index('asset.load'))

    async def test_instagram_add_caption_fields(self):
        original='<div id="caption" hidden contenteditable="true" aria-label="撰寫說明……"></div>'
        variants=[
            '<div id="caption" hidden contenteditable="true" aria-label="添加配文..."></div>',
            '<div id="caption" hidden contenteditable="" aria-placeholder="添加配文…"></div>',
            '<textarea id="caption" hidden placeholder="添加配文..."></textarea>',
        ]
        for field in variants:
            self.fixture['instagram']=INSTAGRAM.replace('下一步','继续').replace(original,field).replace('<body>','<body><textarea aria-label="添加配文...">Unrelated background text</textarea>')
            async def checkpoint():
                page=self.context.pages[0]
                self.assertEqual(await page.locator('#caption').evaluate('(node)=>node.value ?? node.textContent'),self.job['caption'])
                self.assertEqual(await page.locator('body > textarea').input_value(),'Unrelated background text')
                return await self.checkpoint()
            result=await self.runner.publish({**self.job,'platform':'instagram'},checkpoint)
            self.assertEqual(result['state'],'succeeded',(field,result))

    async def test_instagram_accessibility_with_icon_and_delayed_fields(self):
        for tag, count, expanded in [('button',1,False),('div role="button"',2,False),('summary',1,True)]:
            closing=tag.split()[0]
            inputs=''.join('<input class="alt-field" placeholder="编写替代文字...">' for _ in range(count))
            panel=f'''<div id="accessibility" hidden><{tag} aria-expanded="{'true' if expanded else 'false'}" onclick="window.altClicks=(window.altClicks||0)+1;this.setAttribute('aria-expanded','true');setTimeout(()=>document.querySelector('#alt-fields').hidden=false,500)"><span>辅助功能</span><svg aria-label="向下箭头"></svg></{closing}><div id="alt-fields" {'' if expanded else 'hidden'}>{inputs}</div></div>'''
            self.fixture['instagram']=INSTAGRAM.replace('下一步','继续').replace('撰寫說明……','添加配文...').replace("document.querySelector('#share').hidden=false", "document.querySelector('#share').hidden=false;document.querySelector('#accessibility').hidden=false").replace('</div><span id="success">',panel+'</div><span id="success">')
            async def checkpoint():
                page=self.context.pages[0]
                self.assertEqual(await page.locator('.alt-field').evaluate_all('(nodes)=>nodes.map(n=>n.value)'),['PRIVATE alt text']*count)
                self.assertEqual(await page.evaluate('window.altClicks || 0'),0 if expanded else 1)
                return await self.checkpoint()
            result=await self.runner.publish({**self.job,'platform':'instagram','altText':'PRIVATE alt text','files':self.job['files']*count},checkpoint)
            self.assertEqual(result['state'],'succeeded',(tag,result))
        self.assertFalse(any('PRIVATE alt text' in e['message'] for e in self.events))

    async def test_instagram_create_waits_for_loading_dialog(self):
        self.fixture['instagram'] = INSTAGRAM.replace("document.querySelector('#ig-dialog').hidden=false", "window.createClicks=(window.createClicks||0)+1;document.querySelector('#loading').hidden=false;setTimeout(()=>{document.querySelector('#loading').remove();document.querySelector('#ig-dialog').hidden=false},6500)").replace('</body>','<div id="loading" role="dialog" hidden>Loading</div></body>')
        async def checkpoint():
            self.assertEqual(await self.context.pages[0].evaluate('window.createClicks'),1)
            return await self.checkpoint()
        result = await self.runner.publish({**self.job,'platform':'instagram'},checkpoint)
        self.assertEqual(result['state'],'succeeded',result)

    async def test_instagram_create_stops_after_three_noops(self):
        self.fixture['instagram'] = INSTAGRAM.replace("document.querySelector('#ig-dialog').hidden=false", "window.createClicks=(window.createClicks||0)+1")
        async def forbidden():
            self.fail('No dialog must mean no submission')
        result = await self.runner.publish({**self.job,'platform':'instagram'},forbidden)
        self.assertEqual(result['state'],'needs_attention',result)
        self.assertIn('点击 3 次',result['message'])
        self.assertEqual(sum(e['step']=='instagram.create.click' for e in self.events),3)
        self.assertFalse(any(e['step'] in ('asset.load','images.upload','submit.click') for e in self.events))
        self.assertTrue(any(e['step']=='failure.screenshot' for e in self.events))

    async def test_denied_checkpoint_never_clicks_and_saves_screenshot(self):
        async def denied():
            await self.checkpoint()
            return False
        result = await self.runner.publish(self.job, denied)
        self.assertEqual(result['state'],'uncertain')
        self.assertFalse(any(e['step']=='submit.click' for e in self.events))
        self.assertEqual(len(list(Path(self.job['artifactsRoot']).glob('*.png'))),1)

    async def test_suspended_account_stops_before_checkpoint(self):
        self.fixture['x'] = FIXTURE.replace('<main>','<h2>Your account is suspended</h2><main>')
        async def forbidden():
            self.fail('Restricted account must not request submission')
        result = await self.runner.publish(self.job, forbidden)
        self.assertEqual(result['state'],'needs_attention')
        self.assertIn('账号已被暂停',result['message'])
        self.assertTrue(any(e['step']=='failure.screenshot' for e in self.events))

    async def test_page_loss_after_submit_stays_uncertain(self):
        self.fixture['x'] = FIXTURE.replace("document.querySelector('#toast').textContent='Your post was sent'", "location.href='https://x.com/login'")
        result = await self.runner.publish(self.job, self.checkpoint)
        self.assertEqual(result['state'],'uncertain',result)
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events),1)
        self.assertFalse(any(e['step']=='submit.success' for e in self.events))

    async def test_cancel_closes_browser_before_submission(self):
        import asyncio
        reached = asyncio.Event()
        async def pause_before_submit():
            reached.set()
            await asyncio.Event().wait()
        operation = asyncio.create_task(self.runner.publish(self.job,pause_before_submit))
        await asyncio.wait_for(reached.wait(),30)
        operation.cancel()
        await asyncio.gather(operation, return_exceptions=True)
        self.assertFalse(self.context.pages)
        self.assertFalse(any(e['step']=='submit.click' for e in self.events))

    async def test_native_x_schedule(self):
        target = (datetime.now(timezone.utc)+timedelta(days=7)).replace(second=0,microsecond=0)
        fields = ''.join('<label>'+label+'<select>'+''.join(f'<option>{value}</option>' for value in values)+'</select></label>' for label,values in [
            ('Year',range(target.year-1,target.year+3)),('Month',range(1,13)),('Day',range(1,32)),('Hour',range(24)),('Minute',range(60))])
        dialog = '<div role="dialog" id="schedule-dialog" hidden>'+fields+'''<button onclick="this.parentElement.hidden=true;document.querySelector('[data-testid=tweetButton]').textContent='Schedule'">Confirm</button></div>'''
        self.fixture['x'] = FIXTURE.replace('<div data-testid="attachments" id="attachments">','''<button aria-label="Schedule post" onclick="document.querySelector('#schedule-dialog').hidden=false">Schedule time</button><div data-testid="attachments" id="attachments">''').replace('Your post was sent','Your post will be sent on the selected date').replace('</body>',dialog+'</body>')
        async def checkpoint():
            page = self.context.pages[0]
            actual = await page.locator('#schedule-dialog select').evaluate_all('(nodes)=>nodes.map(n=>Number(n.value))')
            expected = await page.evaluate('(iso)=>{const d=new Date(iso);return [d.getFullYear(),d.getMonth()+1,d.getDate(),d.getHours(),d.getMinutes()]}',target.isoformat())
            self.assertEqual(actual,expected)
            return await self.checkpoint()
        result = await self.runner.publish({**self.job,'xScheduledAt':target.isoformat()},checkpoint)
        self.assertEqual(result['state'],'succeeded',result)
        self.assertIn(target.isoformat(),result['message'])
        self.assertTrue(any(e['step']=='schedule.ready' for e in self.events))


if __name__ == '__main__':
    unittest.main()
