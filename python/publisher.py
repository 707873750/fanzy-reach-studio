"""Persistent-profile Playwright worker. JSON lines are the stdout protocol."""
import asyncio
import base64
import json
import queue
import re
import sys
import threading
import traceback
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from adapters import URLS, validate
import session_store
from native_login import NativeChrome
from performance_stats import system_sample
from pinterest_confirmation import PinterestConfirmation
from tiktok_confirmation import TikTokConfirmation
from bluesky_confirmation import BlueskyConfirmation

ADAPTER_PATH = Path(__file__).with_name('page_adapter.js')
CHANNELS = ('msedge', 'chrome', 'chromium')
LOGIN_URLS = {
    'facebook': 'https://www.facebook.com/',
    'bluesky': 'https://bsky.app/',
    'x': 'https://x.com/i/flow/login',
    'instagram': 'https://www.instagram.com/',
    'pinterest': 'https://www.pinterest.com/',
    'tiktok': 'https://www.tiktok.com/login',
}


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


class Publisher:
    def __init__(self, playwright, output=emit, context_setup=None, native_login_factory=None):
        self.playwright = playwright
        self.output = output
        self.logins = {}
        self.login_requests = {}
        self.context_setup = context_setup
        self.native_login_factory = native_login_factory or NativeChrome.start

    def log(self, step, message, job=None, level='info', detail=None, source='python'):
        entry = dict(type='log', source=source, step=step, message=message, level=level)
        if job:
            entry.update(draftId=job.get('id'), jobId=job.get('jobId'), platform=job.get('platform'))
        if detail:
            entry['detail'] = detail
        self.output(entry)

    def profile(self, request):
        platform, channel = request.get('platform'), request.get('channel', 'chrome')
        if platform not in URLS or channel not in CHANNELS:
            raise ValueError('不支持的平台或浏览器')
        return Path(request['profilesRoot']).resolve() / channel / platform

    async def launch(self, request, visible=False, restore_session=True):
        profile = self.profile(request)
        if str(profile) in self.logins:
            raise ValueError('该平台登录窗口仍打开，请先点击“完成登录 / 关闭窗口”保存登录状态')
        profile.mkdir(parents=True, exist_ok=True)
        self.log('browser.launch', '启动可见浏览器' if visible else '启动无头浏览器', request)
        try:
            context = await self.playwright.chromium.launch_persistent_context(
                str(profile), channel=request.get('channel', 'chrome'), headless=not visible,
                args=['--autoplay-policy=user-gesture-required'],
                viewport={'width': 1440, 'height': 1000}, timeout=30000)
        except Exception as error:
            raise RuntimeError('浏览器启动失败。请确认所选浏览器已安装，且该平台的专用窗口已关闭。Chromium 需运行 python -m playwright install chromium。') from error
        try:
            if self.context_setup:
                await self.context_setup(context, request)
            state = session_store.load(profile) if restore_session else None
            if state:
                await context.set_storage_state(state)
                self.log('session.restored', '已恢复加密保存的登录状态', request)
            return context
        except Exception as error:
            await context.close()
            raise RuntimeError('登录状态恢复失败，请使用保存配置的同一个系统用户运行程序，并允许访问系统密钥存储') from error

    async def save_session(self, context, request):
        state = await asyncio.wait_for(context.storage_state(indexed_db=True), timeout=10)
        session_store.save(self.profile(request), state)

    async def login(self, request):
        if request.get('channel', 'chrome') != 'chrome':
            raise ValueError('普通浏览器登录与发布请统一使用 Chrome')
        profile = self.profile(request)
        key = str(profile)
        if key in self.logins:
            raise ValueError('该平台已有登录会话，请先点击完成登录保存后再打开')
        self.log('login.native_launch', '使用普通 Chrome 打开专用登录窗口（不启用 Playwright）', request)
        window = await self.native_login_factory(profile, LOGIN_URLS[request['platform']])
        self.logins[key] = window
        self.login_requests[key] = request
        self.log('login.open', '请在普通 Chrome 中登录；完成后点击程序中的“完成登录 / 关闭窗口”保存完整登录快照', request)
        return {'state': 'opened'}

    async def close_login(self, request):
        key = str(self.profile(request))
        window = self.logins.get(key)
        if not window:
            raise ValueError('没有待保存的登录窗口，请先点击该平台登录')
        self.log('login.native_close', '正常关闭专用 Chrome，等待配置写入磁盘', request)
        await window.close()
        self.logins.pop(key)
        context = None
        try:
            # Never overwrite the freshly logged-in native profile with an old snapshot.
            context = await self.launch(request, restore_session=False)
            page = context.pages[0] if context.pages else await context.new_page()
            home = 'https://' + urlsplit(URLS[request['platform']]).netloc + '/'
            await page.goto(home, wait_until='domcontentloaded', timeout=15000)
            await self.save_session(context, request)
        except Exception:
            self.logins[key] = window  # Keep a retryable save operation, even after manual close.
            raise
        finally:
            if context:
                await context.close()
        self.login_requests.pop(key, None)
        self.log('login.saved', '窗口已关闭，配置已保存；实际登录有效性将在发布时检查', request)
        return {'state': 'opened'}

    async def open_instagram_composer(self, page, job, phase):
        """Native actionable click + bounded effect checks; never retries publication."""
        self.log('instagram.create.wait', '等待 Instagram 创建入口就绪、稳定且未被遮挡', job)
        loop = asyncio.get_running_loop()
        deadline = loop.time()+35
        attempts = 0
        retry_at = 0
        ready_since = None
        while loop.time() < deadline:
            state = await phase('instagram_open_state')
            if state == 'open':
                self.log('instagram.create.opened', f'已确认图片上传弹窗打开（创建点击 {attempts} 次），允许继续上传', job)
                return
            if state != 'ready':
                ready_since = None
                await asyncio.sleep(0.2)
                continue
            if loop.time() < retry_at:
                await asyncio.sleep(0.2)
                continue
            if attempts >= 3:
                break
            # Presence alone does not mean hydration finished. Require a continuous
            # ready interval, then Playwright checks visibility/stability/hit target.
            if ready_since is None:
                ready_since = loop.time()
            if loop.time()-ready_since < 1:
                await asyncio.sleep(0.2)
                continue
            control = page.locator('[data-fanzy-create="instagram"]')
            try:
                await control.click(trial=True, timeout=2000)
            except Exception:
                ready_since = None
                await asyncio.sleep(0.2)
                continue
            if await phase('instagram_open_state') != 'ready':
                ready_since = None
                continue
            attempts += 1
            self.log('instagram.create.click', f'点击 Instagram 创建入口（{attempts}/3）', job)
            try:
                await control.click(timeout=2000)
            except Exception as error:
                self.log('instagram.create.click_failed', '创建点击未完成，将先检查弹窗状态', job, 'warn', str(error))
            retry_at = loop.time()+5
            ready_since = None
            self.log('instagram.create.confirm', '等待上传弹窗确认；至少 5 秒内不重复点击', job)
        raise ValueError(f'Instagram 创建入口点击 {attempts} 次后仍未打开上传弹窗，已停止；未上传或发布。请查看失败截图，或打开可见浏览器检查页面加载/遮挡情况')

    async def capture_result(self, page, request, job, pending=False):
        if not page or page.is_closed():
            return
        try:
            folder = Path(request['artifactsRoot']).resolve()
            folder.mkdir(parents=True, exist_ok=True)
            screenshot = folder / (job['jobId']+'.png')
            await page.screenshot(path=str(screenshot), timeout=5000)
            self.log('confirmation.screenshot' if pending else 'failure.screenshot',
                     ('待确认截图已保存：' if pending else '失败截图已保存：')+str(screenshot), job, 'warn')
            for old in sorted(folder.glob('*.png'), key=lambda f: f.stat().st_mtime, reverse=True)[50:]:
                old.unlink()
        except Exception as error:
            self.log('confirmation.screenshot_failed' if pending else 'failure.screenshot_failed', '无法保存诊断截图', job, 'warn', str(error))

    async def publish(self, request, checkpoint):
        validate(request)
        job = {**request, 'jobId': uuid.uuid4().hex, 'fileCount': len(request['files'])}
        job.setdefault('id', job['jobId'])
        job.setdefault('hashtags', [])
        context = page = monitor = confirmation = None
        checkpoint_requested = False
        self.log('job.start', '开始 Playwright 发布任务', job)
        try:
            async def execute():
                nonlocal context, page, monitor, checkpoint_requested, confirmation
                context = await self.launch(job, visible=job.get('showBrowser') is True)
                page = context.pages[0] if context.pages else await context.new_page()
                if job['platform'] == 'bluesky':
                    confirmation = BlueskyConfirmation(page, job)
                elif job['platform'] == 'pinterest' and not job.get('nativeScheduledAt'):
                    confirmation = PinterestConfirmation(page)
                elif job['platform'] == 'tiktok':
                    confirmation = TikTokConfirmation(page, lambda detail: self.log('tiktok.confirmation_response', '本次提交后的响应结构（不记录正文、凭据或查询参数）', job, detail=detail))
                monitor = asyncio.create_task(self.monitor_page(page, job))
                page.on('pageerror', lambda error: self.log('page.error', '平台页面脚本异常', job, 'error', str(error)))
                page.on('requestfailed', lambda req: self.log('network.failed', '网络请求失败：'+urlsplit(req.url).netloc, job, 'warn', req.failure))
                async def trace(source, entry):
                    if confirmation and entry.get('step') == 'submit.click':
                        confirmation.armed = True
                    self.log(str(entry.get('step', 'page.event')), str(entry.get('message', '')), job,
                             entry.get('level', 'info'), entry.get('detail'), source='page')
                await page.expose_binding('fanzyTrace', trace)
                if job['platform'] == 'bluesky':
                    async def bluesky_input(source, action):
                        if source['frame'] != page.main_frame or checkpoint_requested:
                            raise ValueError('Invalid Bluesky input phase')
                        root = page.locator('[data-testid="composePostView"]')
                        if action == 'text':
                            editor = root.locator('[contenteditable="true"]')
                            await editor.fill(confirmation.expected)
                        elif action == 'images':
                            async with page.expect_file_chooser(timeout=15000) as chooser:
                                await root.locator('[data-testid="openMediaBtn"], [data-testid="openGalleryBtn"]').click()
                            await (await chooser.value).set_files(job['files'])
                        elif action == 'alt' and job.get('altText'):
                            for index in range(job['fileCount']):
                                await root.locator('[data-testid="altTextButton"]').nth(index).click()
                                dialog = page.get_by_role('dialog').filter(has=page.locator('textarea'))
                                await dialog.locator('textarea').fill(job['altText'])
                                await dialog.get_by_role('button', name=re.compile(r'^(Save|保存|儲存)$')).click()
                                await dialog.wait_for(state='hidden')
                        else:
                            raise ValueError('Invalid Bluesky input action')
                    await page.expose_binding('fanzyBlueskyInput', bluesky_input)
                if job['platform'] == 'tiktok':
                    async def type_tiktok(source, field):
                        if source['frame'] != page.main_frame or checkpoint_requested or field not in ('title', 'description'):
                            raise ValueError('Invalid TikTok input phase')
                        text = job.get('title', '') if field == 'title' else '\n\n'.join(part for part in [job.get('caption', ''), ' '.join(job['hashtags'])] if part)
                        control = page.locator('[data-fanzy-native-field="'+field+'"]')
                        if await control.count() != 1:
                            raise ValueError('TikTok 输入框已变化')
                        self.log('tiktok.native_input', '使用浏览器原生输入填写 '+field+'（不记录正文）', job)
                        await control.click()
                        await control.press('ControlOrMeta+A')
                        if text:
                            for index, line in enumerate(text.replace('\r\n', '\n').split('\n')):
                                if index:
                                    await page.keyboard.press('Shift+Enter')
                                if line:
                                    await page.keyboard.insert_text(line)
                        else:
                            await control.press('Backspace')
                    await page.expose_binding('fanzyTikTokInput', type_tiktok)
                if job['platform'] == 'facebook':
                    async def facebook_input(source):
                        if source['frame'] != page.main_frame or urlsplit(page.url).netloc != 'www.facebook.com':
                            raise ValueError('Invalid Facebook input source')
                        editor = page.locator('[data-fanzy-facebook-editor="true"]')
                        if await editor.count() != 1:
                            raise ValueError('Facebook 文案框已变化')
                        await editor.click()
                        await editor.press('ControlOrMeta+A')
                        await editor.press('Backspace')
                        text = '\n\n'.join(part for part in [job.get('title', ''), job.get('caption', ''), ' '.join(job['hashtags'])] if part)
                        for index, line in enumerate(text.replace('\r\n', '\n').split('\n')):
                            if index:
                                await page.keyboard.press('Shift+Enter')
                            if line:
                                await page.keyboard.insert_text(line)
                    await page.expose_binding('fanzyFacebookInput', facebook_input)
                self.log('page.open', '打开平台发布页面', job)
                await self.open_publish_page(page, job)
                expected = urlsplit(URLS[job['platform']]).netloc
                if urlsplit(page.url).netloc != expected or any(part in urlsplit(page.url).path for part in ('/login', '/accounts/login', '/challenge', '/checkpoint', '/i/flow')):
                    raise ValueError('登录已失效或平台要求验证，请打开该平台登录窗口处理后重试')
                # Capture a fresh adapter for each new job; never replace it mid-job.
                await page.evaluate(ADAPTER_PATH.read_text(encoding='utf-8'))
                async def phase(name, extra=None):
                    return await page.evaluate('([phase,job,extra])=>globalThis.fanzyPublisher(phase,job,extra)', [name, job, extra])
                await phase('begin')
                if job['platform'] == 'instagram':
                    await self.open_instagram_composer(page, job, phase)
                for index, file in enumerate(request['files']):
                    path = Path(file)
                    self.log('asset.load', f'读取图片 {index+1}/{job["fileCount"]}', job)
                    await phase('asset', {'name': path.name, 'type': 'image/jpeg', 'data': base64.b64encode(path.read_bytes()).decode('ascii')})
                prepared = await phase('prepare')
                if prepared and prepared.get('state') == 'local_scheduled':
                    return prepared
                checkpoint_requested = True
                self.log('submit.checkpoint_requested', '等待桌面端保存提交检查点', job)
                if not await checkpoint():
                    raise ValueError('未获得持久化提交许可，已停止发布')
                self.log('submit.checkpoint_saved', '提交检查点已保存', job)
                result = await phase('submit')
                if confirmation and getattr(confirmation, 'confirmed', False):
                    self.log('submit.success', 'TikTok 本次发布接口已确认接收提交', job)
                    return {'state':'succeeded','message':'TikTok 已确认接收作品；审核状态与可见范围请以平台为准。'}
                if confirmation and confirmation.url:
                    return {'state':'succeeded','message':'Bluesky 已确认发布。' if job['platform']=='bluesky' else 'Pinterest 已确认创建 Pin。','url':confirmation.url}
                if result and result.get('state') == 'uncertain':
                    self.log('task.uncertain', '已提交，结果待确认', job, 'warn')
                    await self.capture_result(page, request, job, pending=True)
                    return {'state':'uncertain','message':'已提交，结果待确认'}
                return {'state': 'succeeded', 'message': ('平台已确认定时排程：'+(job.get('nativeScheduledAt') or job['xScheduledAt'])+'。修改或取消请前往平台。') if (job.get('nativeScheduledAt') or job.get('xScheduledAt')) else ('TikTok 已确认提交作品；审核状态与可见范围请以平台为准。' if job['platform']=='tiktok' else '平台已显示发布成功确认。')}
            return await asyncio.wait_for(execute(), timeout=180)
        except Exception as error:
            if confirmation and getattr(confirmation, 'confirmed', False):
                self.log('submit.success', 'TikTok 本次发布接口已确认接收提交', job)
                return {'state':'succeeded','message':'TikTok 已确认接收作品；审核状态与可见范围请以平台为准。'}
            if confirmation and confirmation.url:
                self.log('submit.success','平台已返回本次发布的帖子链接',job)
                return {'state':'succeeded','message':'Bluesky 已确认发布。' if job['platform']=='bluesky' else 'Pinterest 已确认创建 Pin。','url':confirmation.url}
            message = str(error) or '发布任务超时，请检查网络、登录或平台页面'
            self.log('task.uncertain' if checkpoint_requested else 'task.failed', '已提交，结果待确认' if checkpoint_requested else message, job, 'warn' if checkpoint_requested else 'error', traceback.format_exc())
            await self.capture_result(page, request, job, pending=checkpoint_requested)
            return {'state': 'uncertain' if checkpoint_requested else 'needs_attention', 'message': '已提交，结果待确认' if checkpoint_requested else message}
        finally:
            if confirmation:
                await confirmation.close()
            if monitor:
                monitor.cancel()
                await asyncio.gather(monitor, return_exceptions=True)
            if context:
                try:
                    await self.save_session(context, job)
                except Exception as error:
                    self.log('session.save_failed', '登录状态快照保存失败', job, 'warn', str(error))
                try:
                    await context.close()
                    self.log('browser.closed', '浏览器已关闭，登录配置已保存', job)
                except Exception as error:
                    self.log('browser.close_failed', str(error), job, 'warn')

    async def monitor_page(self, page, job):
        """Low-rate diagnostic counters, never page content or form values."""
        session = None
        from gpu_stats import GpuSampler
        gpu = None
        try:
            initializing = asyncio.create_task(asyncio.to_thread(GpuSampler))
            try:
                gpu = await asyncio.shield(initializing)
            except asyncio.CancelledError:
                gpu = await initializing
                raise
            session = await page.context.new_cdp_session(page)
            await session.send('Performance.enable')
            previous = None
            system_previous = None
            while True:
                response = await session.send('Performance.getMetrics')
                metrics = {item['name']: item['value'] for item in response['metrics']}
                now = asyncio.get_running_loop().time()
                cpu = None if previous is None else max(0, metrics.get('TaskDuration', 0)-previous[1]) / max(now-previous[0], .001)*100
                previous = (now, metrics.get('TaskDuration', 0))
                heap = metrics.get('JSHeapUsedSize', 0)/1048576
                system, system_previous = system_sample(system_previous)
                gpu_started = asyncio.get_running_loop().time()
                try:
                    gpu_metrics = await asyncio.to_thread(gpu.sample)
                except Exception as error:
                    gpu_metrics = {'gpuCounterStatus': 'unavailable:' + type(error).__name__}
                gpu_metrics['gpuSampleMs'] = round((asyncio.get_running_loop().time()-gpu_started)*1000, 1)
                detail = json.dumps({**system, **gpu_metrics, 'pageMainThreadBusyPercent': None if cpu is None else round(cpu,1),
                                     'jsHeapMB':round(heap,1), 'domNodes':metrics.get('Nodes',0),
                                     'openPages':len(page.context.pages)})
                self.log('performance.sample', '性能采样：整机 CPU / 内存 / GPU 最忙引擎及发布页面主线程', job,
                         'warn' if (cpu is not None and cpu>80) or gpu_metrics.get('gpuBusiestEnginePercent',0)>90 else 'info', detail)
                await asyncio.sleep(5)
        except Exception as error:
            self.log('performance.unavailable', '无法读取页面性能指标，不影响发布', job, 'warn', type(error).__name__)
        finally:
            if gpu:
                # close() uses the same lock as sample() if cancellation leaves it running.
                await asyncio.to_thread(gpu.close)
            if session:
                try:
                    await session.detach()
                except Exception:
                    pass

    async def open_publish_page(self, page, job):
        """Report document failures without retrying or reaching submission."""
        status = None
        def response_received(response):
            nonlocal status
            if response.request.is_navigation_request() and response.frame == page.main_frame:
                status = response.status
                self.log('page.http', f'平台主页面响应：HTTP {status}', job,
                         'warn' if status >= 400 else 'info')
        page.on('response', response_received)
        try:
            response = await page.goto(URLS[job['platform']], wait_until='domcontentloaded', timeout=45000)
            if response and response.status >= 400:
                status = response.status
                raise RuntimeError(f'HTTP {status}')
        except Exception as error:
            if status in (401, 403, 429):
                raise ValueError(
                    f'平台拒绝打开发布页面（HTTP {status}），尚未上传或发送。'
                    '请在设置中打开该平台登录窗口，检查是否能正常访问并完成登录或验证；'
                    '如可见窗口正常，可开启“显示浏览器”后重试。'
                    '若窗口也无法访问，请先检查网络或平台限制。'
                ) from error
            raise
        finally:
            page.remove_listener('response', response_received)

    async def close(self):
        async def finish(request):
            try:
                await self.close_login(request)
            except Exception as error:
                self.log('session.save_failed', '退出时无法保存登录快照', request, 'error', str(error))
        await asyncio.gather(*(finish(request) for request in list(self.login_requests.values())))
        self.logins.clear()


async def main():
    incoming = queue.Queue()
    disconnected = asyncio.Event()
    loop = asyncio.get_running_loop()
    def read():
        try:
            for line in sys.stdin:
                incoming.put(json.loads(line))
        finally:
            incoming.put(None)
            loop.call_soon_threadsafe(disconnected.set)
    threading.Thread(target=read, daemon=True).start()
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        emit({'type': 'fatal', 'message': '缺少 Playwright。请运行 python -m pip install -r python/requirements.txt'})
        return
    async with async_playwright() as playwright:
        publisher = Publisher(playwright)
        publisher.log('python.ready', 'Playwright 发布服务已启动')
        try:
            while True:
                request = await asyncio.to_thread(incoming.get)
                if request is None:
                    break
                try:
                    action = request.get('action')
                    if action == 'configure_session':
                        session_store.configure_key(request['key'])
                        continue
                    elif action == 'login':
                        result = await publisher.login(request)
                    elif action == 'close_login':
                        result = await publisher.close_login(request)
                    elif action == 'publish':
                        async def checkpoint():
                            emit({'type': 'submitting'})
                            try:
                                ack = await asyncio.to_thread(incoming.get, True, 20)
                                if ack is None:
                                    incoming.put(None)
                                return ack == {'ack': 'persisted'}
                            except queue.Empty:
                                return False
                        operation = asyncio.create_task(publisher.publish(request, checkpoint))
                        shutdown = asyncio.create_task(disconnected.wait())
                        done, _ = await asyncio.wait((operation, shutdown), return_when=asyncio.FIRST_COMPLETED)
                        if shutdown in done:
                            operation.cancel()
                            await asyncio.gather(operation, return_exceptions=True)
                            publisher.log('task.interrupted', '桌面应用已退出，发布操作已中止；若已提交请核对平台结果', request, 'warn')
                            break
                        shutdown.cancel()
                        await asyncio.gather(shutdown, return_exceptions=True)
                        result = await operation
                    else:
                        raise ValueError('未知浏览器操作')
                    emit({'type': 'result', **result})
                except Exception as error:
                    publisher.log('request.failed', str(error), request, 'error', traceback.format_exc())
                    emit({'type': 'result', 'state': 'needs_attention', 'message': str(error)})
        finally:
            await publisher.close()


async def self_test():
    """Local packaging check: no accounts, profiles, or network publishing."""
    from playwright.async_api import async_playwright
    if sys.platform == 'darwin':
        import os
        session_store.configure_key(base64.b64encode(os.urandom(32)).decode('ascii'))
    payload = b'packaging-check'
    assert session_store.crypt(session_store.crypt(payload), decrypt=True) == payload
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome', headless=True)
        try:
            page = await browser.new_page()
            await page.set_content('<title>Fanzy packaging check</title>')
            assert await page.title() == 'Fanzy packaging check'
            await page.evaluate('(source) => { new Function(source); }', ADAPTER_PATH.read_text(encoding='utf-8'))
        finally:
            await browser.close()
    emit({'type': 'self-test', 'ok': True, 'frozen': bool(getattr(sys, 'frozen', False))})


if __name__ == '__main__':
    asyncio.run(self_test() if '--self-test' in sys.argv else main())
