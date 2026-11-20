"""Native video upload fixtures. Platform traffic is intercepted; no real posts."""
import asyncio
import json
import html
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
import test_playwright
from adapters import validate

UPLOAD = '''<input type="file" accept="video/mp4" data-testid="fileInput" onchange="
window.uploadedName=this.files[0].name;window.uploadedBytes=this.files[0].size;
const v=document.createElement('video');v.controls=true;v.width=240;v.src=globalThis.URL.createObjectURL(this.files[0]);this.parentElement.append(v)">'''


def fixture(platform, reject=False):
    labels = {'x': 'Post', 'instagram': 'Share', 'pinterest': 'Publish', 'tiktok': 'Post', 'facebook': 'Post', 'bluesky': 'Post'}
    success = {'x': 'Your post was sent', 'instagram': 'Your post has been shared.', 'pinterest': 'Your Pin has been published.', 'tiktok': 'Post published', 'facebook': 'Your post has been shared.', 'bluesky': ''}
    editor = '<div contenteditable="true" role="textbox" data-testid="tweetTextarea_0" aria-label="Write a caption" style="min-height:30px;white-space:pre-wrap"></div>'
    body = UPLOAD + editor
    if platform == 'tiktok':
        body += '<textarea aria-label="Description"></textarea><select aria-label="Who can watch"><option value="private">Only you</option><option>Everyone</option></select>'
    if platform == 'pinterest':
        body += '<input aria-label="Title"><textarea aria-label="Description"></textarea><button onclick="document.querySelector(\'#board\').hidden=false">Choose a board</button><button id="board" hidden onclick="this.hidden=true">Art</button>'
    if platform == 'instagram':
        body += '<button onclick="window.steps=(window.steps||0)+1;if(window.steps===2)this.hidden=true">Next</button>'
    if platform == 'x':
        body += '<div role="progressbar" aria-label="Video playback" aria-valuenow="0"></div><div role="progressbar" aria-valuenow="1"></div>'
    publish = "window.clicks=(window.clicks||0)+1;document.querySelector('#result').textContent=" + json.dumps(success[platform])
    if platform == 'bluesky':
        body += '<button data-testid="openVideoBtn" onclick="document.querySelector(\'input[type=file]\').click()">Add video</button>'
        publish = "window.clicks=(window.clicks||0)+1;fetch('/xrpc/com.atproto.repo.createRecord',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo:'did:plc:fixture',collection:'app.bsky.feed.post',record:{$type:'app.bsky.feed.post',text:document.querySelector('[contenteditable]').innerText,embed:{$type:'app.bsky.embed.video',video:{ref:{$link:'fixture'}}}}})})"
    body += f"<button data-testid=\"{'composerPublishBtn' if platform == 'bluesky' else 'tweetButton'}\" onclick=\"{html.escape(publish, quote=True)}\">{labels[platform]}</button>"
    if platform in ('facebook', 'instagram', 'x'):
        body = '<div role="dialog">' + body + '</div>'
    if platform == 'instagram':
        body += '''<div role="dialog" id="reels-notice" hidden><h2>视频帖现在会以 Reels 的形式分享</h2><button onclick="this.parentElement.hidden=true;document.querySelector('[role=dialog]').removeAttribute('aria-hidden')">确定</button></div>
        <script>document.querySelector('input[type=file]').addEventListener('change',()=>{document.querySelector('[role=dialog]').setAttribute('aria-hidden','true');document.querySelector('#reels-notice').hidden=false})</script>'''
    if platform == 'bluesky':
        body = '<div data-testid="composePostView">' + body + '</div>'
    if reject:
        body += '<script>document.querySelector("input[type=file]").addEventListener("change",()=>{const e=document.createElement("div");e.role="alert";e.textContent="Upload failed: unsupported video";document.querySelector("input[type=file]").parentElement.append(e)})</script>'
    return '<!doctype html><meta charset="utf-8"><body>' + body + '<div role="status" data-testid="toast" id="result"></div></body>'


class VideoTests(unittest.IsolatedAsyncioTestCase):
    asyncTearDown = test_playwright.PlaywrightPublishingTests.asyncTearDown
    checkpoint = test_playwright.PlaywrightPublishingTests.checkpoint

    async def asyncSetUp(self):
        await test_playwright.PlaywrightPublishingTests.asyncSetUp(self)
        self.video = Path(self.temp.name) / 'video.mp4'
        root = Path(__file__).resolve().parent.parent
        ffmpeg = subprocess.check_output(['node', '-p', 'require("ffmpeg-static")'], cwd=root, text=True).strip()
        subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(self.video)], check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.job.update(files=[str(self.video)], mediaType='video')
        async def setup(context, job):
            self.context = context
            async def route(r):
                if r.request.is_navigation_request():
                    await r.fulfill(content_type='text/html; charset=utf-8', body=self.fixture[job['platform']])
                elif r.request.url.endswith('/xrpc/com.atproto.repo.createRecord'):
                    await r.fulfill(json={'uri': 'at://did:plc:fixture/app.bsky.feed.post/video1', 'cid': 'video-cid'})
                else:
                    await r.abort()
            await context.route('**/*', route)
        self.runner.context_setup = setup

    async def test_native_upload_all_six_platforms(self):
        for platform in os.environ.get('FANZY_TEST_PLATFORMS', 'x,instagram,pinterest,tiktok,facebook,bluesky').split(','):
            with self.subTest(platform=platform):
                self.fixture[platform] = fixture(platform)
                checked = False
                async def checkpoint():
                    nonlocal checked
                    checked = True
                    await self.checkpoint()
                    page = self.context.pages[0]
                    self.assertEqual(await page.evaluate('window.uploadedName'), 'video.mp4')
                    self.assertEqual(await page.evaluate('window.uploadedBytes'), self.video.stat().st_size)
                    self.assertGreater(await page.locator('video').evaluate('(v)=>v.videoWidth'), 0)
                    if platform == 'tiktok':
                        self.assertEqual(await page.locator('textarea').input_value(), 'Video title\n\nPRIVATE fixture caption')
                    return True
                try:
                    result = await asyncio.wait_for(self.runner.publish({**self.job, 'platform': platform, 'title': 'Video title', 'tiktokPrivacy': 'self_only'}, checkpoint), 30)
                except TimeoutError:
                    print(json.dumps([e for e in self.events if e.get('step') != 'performance.sample'][-12:], ensure_ascii=True), flush=True)
                    raise
                self.assertTrue(checked, result)
                self.assertEqual(result['state'], 'succeeded', result)

    async def test_upload_error_never_submits(self):
        self.fixture['x'] = fixture('x', reject=True)
        checkpoint = AsyncMock(return_value=True)
        result = await asyncio.wait_for(self.runner.publish(self.job, checkpoint), 15)
        checkpoint.assert_not_awaited()
        self.assertEqual(result['state'], 'needs_attention')
        self.assertIn('平台拒绝视频', result['message'])

    async def test_instagram_chinese_reel_confirmation(self):
        self.fixture['instagram']=fixture('instagram').replace('Your post has been shared.', '你的 Reels 已分享。')
        result=await asyncio.wait_for(self.runner.publish({**self.job,'platform':'instagram'},self.checkpoint),15)
        self.assertEqual(result['state'],'succeeded',result)

    async def test_instagram_transient_reel_confirmation(self):
        self.fixture['instagram']=fixture('instagram')+'''<script>
          document.querySelector('[data-testid=tweetButton]').onclick=()=>{
            window.clicks=(window.clicks||0)+1;
            document.querySelector('#result').innerHTML='<h3>你的 <span>Reels</span> 已分享。</h3>';
            setTimeout(()=>document.querySelector('#result').remove(),50);
          };</script>'''
        result=await asyncio.wait_for(self.runner.publish({**self.job,'platform':'instagram'},self.checkpoint),15)
        self.assertEqual(result['state'],'succeeded',result)

    async def test_instagram_stale_reel_confirmation_blocks_submission(self):
        self.fixture['instagram']=fixture('instagram').replace('id="result"></div>', 'id="result">你的 Reels 已分享。</div>')
        checkpoint=AsyncMock(return_value=True)
        result=await asyncio.wait_for(self.runner.publish({**self.job,'platform':'instagram'},checkpoint),15)
        checkpoint.assert_not_awaited()
        self.assertEqual(result['state'],'needs_attention',result)

    async def test_instagram_reel_heading_and_feed_text_are_not_confirmation(self):
        self.fixture['instagram']=fixture('instagram').replace('Your post has been shared.', '分享了 Reels')+'<article><span>你的 Reels 已分享。</span></article>'
        async def checkpoint():
            await self.context.pages[0].evaluate('const now=Date.now.bind(Date), start=now(); Date.now=()=>start+(now()-start)*1000')
            return True
        result=await asyncio.wait_for(self.runner.publish({**self.job,'platform':'instagram'},checkpoint),15)
        self.assertEqual(result['state'],'uncertain',result)

    async def test_replaced_disabled_publish_button_is_reacquired(self):
        self.fixture['x'] = fixture('x') + '''<script>
        const button=document.querySelector('[data-testid=tweetButton]');button.disabled=true;
        document.querySelector('input[type=file]').addEventListener('change',()=>setTimeout(()=>{
          const next=button.cloneNode(true);next.disabled=false;button.replaceWith(next);
        },1600));</script>'''
        result = await asyncio.wait_for(self.runner.publish(self.job, self.checkpoint), 15)
        self.assertEqual(result['state'], 'succeeded', result)

    async def test_tiktok_cover_only_and_optional_onboarding(self):
        self.fixture['tiktok'] = fixture('tiktok') + '''<div id="notice" hidden>
          <span>开启自动内容检查？</span><button onclick="window.declined=true;this.parentElement.hidden=true">取消</button>
          <button onclick="window.enabled=true">开启</button></div>
        <script>document.querySelector('input[type=file]').addEventListener('change',()=>{
          document.querySelector('video').remove();
          document.body.insertAdjacentHTML('beforeend','<span>video.mp4</span><span>已上传（5.09MB）</span>');
          document.querySelector('#notice').hidden=false;
        });</script>'''
        async def checkpoint():
            page=self.context.pages[0]
            self.assertTrue(await page.evaluate('window.declined'))
            self.assertIsNone(await page.evaluate('window.enabled'))
            self.assertEqual(await page.locator('textarea').input_value(), 'PRIVATE fixture caption')
            return True
        result=await asyncio.wait_for(self.runner.publish({**self.job,'platform':'tiktok'},checkpoint),15)
        self.assertEqual(result['state'],'succeeded',result)

    async def test_video_count_and_type_validation(self):
        validate(self.job)
        for change in ({'files': self.job['files'] * 2}, {'mediaType': 'image'}, {'files': []}):
            with self.assertRaises(ValueError):
                validate({**self.job, **change})


if __name__ == '__main__':
    unittest.main()
