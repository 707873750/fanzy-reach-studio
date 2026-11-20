"""Offline Bluesky fixtures; never sends a real post."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, AsyncMock
from bluesky_confirmation import BlueskyConfirmation
from adapters import validate
import test_playwright

PAGE = '''<div data-testid="composePostView">
<div contenteditable="true" style="min-height:30px"></div>
<button data-testid="openMediaBtn" onclick="document.querySelector('input').click()">Add media</button>
<input type="file" multiple hidden onchange="for(const f of this.files){const b=document.createElement('button');b.dataset.testid='removePhotoButton';b.textContent='Remove image';document.querySelector('#photos').append(b)}">
<div id="photos" data-testid="selectedPhotosView"></div>
<button data-testid="composerPublishBtn" onclick="window.clicks=(window.clicks||0)+1;fetch('/xrpc/com.atproto.repo.createRecord',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo:'did:plc:fixture',collection:'app.bsky.feed.post',record:{$type:'app.bsky.feed.post',text:document.querySelector('[contenteditable]').innerText,embed:{$type:'app.bsky.embed.images',images:Array.from(document.querySelectorAll('#photos button'),()=>({alt:'',image:{}}))}}})})">Post</button>
</div>'''


class BrowserTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_playwright.PlaywrightPublishingTests.asyncSetUp
    asyncTearDown = test_playwright.PlaywrightPublishingTests.asyncTearDown
    checkpoint = test_playwright.PlaywrightPublishingTests.checkpoint

    async def test_response_confirms_without_toast(self):
        async def setup(context, job):
            self.context = context
            async def route(r):
                if r.request.is_navigation_request():
                    await r.fulfill(content_type='text/html', body=PAGE)
                elif r.request.url.endswith('/xrpc/com.atproto.repo.createRecord'):
                    await r.fulfill(content_type='application/json', body=json.dumps({'uri':'at://did:plc:fixture/app.bsky.feed.post/abc123','cid':'fixture-cid'}))
                else:
                    await r.abort()
            await context.route('**/*', route)
        self.runner.context_setup = setup
        async def checkpoint():
            await self.checkpoint()
            self.assertEqual(await self.context.pages[0].locator('#photos button').count(), 4)
            return True
        result = await self.runner.publish({**self.job, 'platform':'bluesky','files':self.job['files']*4}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)
        self.assertEqual(result['url'], 'https://bsky.app/profile/did:plc:fixture/post/abc123')
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events), 1)

    async def test_overlong_copy_never_submits(self):
        self.fixture['bluesky'] = PAGE
        result = await self.runner.publish({**self.job,'platform':'bluesky','caption':'a'*301}, self.checkpoint)
        self.assertEqual(result['state'], 'needs_attention', result)
        self.assertIn('300', result['message'])
        self.assertFalse(any(e['step']=='submit.click' for e in self.events))

    async def test_unconfirmed_request_is_not_retried(self):
        self.fixture['bluesky'] = PAGE
        async def checkpoint():
            await self.checkpoint()
            await self.context.pages[0].evaluate('const now=Date.now.bind(Date), start=now(); Date.now=()=>start+(now()-start)*1000;')
            return True
        result = await self.runner.publish({**self.job,'platform':'bluesky'}, checkpoint)
        self.assertEqual(result['state'], 'uncertain', result)
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events), 1)

    async def test_image_limit(self):
        with self.assertRaises(ValueError):
            validate({**self.job,'platform':'bluesky','files':self.job['files']*5})


class ConfirmationTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_and_response_matching(self):
        page = Mock(evaluate=AsyncMock())
        page.main_frame.url = 'https://bsky.app/intent/compose'
        record = {'$type':'app.bsky.feed.post','text':'expected','embed':{'$type':'app.bsky.embed.images','images':[{}]}}
        body = {'repo':'did:plc:fixture','collection':'app.bsky.feed.post','record':record}
        request = Mock(url='https://custom-pds.example/xrpc/com.atproto.repo.createRecord',method='POST',frame=page.main_frame,post_data_json=body)
        capture = BlueskyConfirmation(page, {'caption':'expected','files':['one']})
        capture.on_request(request)
        self.assertFalse(capture.requests)
        capture.armed = True
        record['text'] = 'unrelated'
        capture.on_request(request)
        self.assertFalse(capture.requests)
        record['text'] = 'expected'
        for status, response in [(500,{}),(200,{'uri':'at://did:plc:other/app.bsky.feed.post/key','cid':'cid'}),(200,{'uri':'at://did:plc:fixture/app.bsky.feed.post/key'})]:
            capture.on_request(request)
            await capture.read(SimpleNamespace(request=request,status=status,json=AsyncMock(return_value=response)))
            self.assertIsNone(capture.url)
        request.url = 'https://custom-pds.example/xrpc/com.atproto.repo.applyWrites'
        request.post_data_json = {'repo':'did:plc:fixture','writes':[{'$type':'com.atproto.repo.applyWrites#create','collection':'app.bsky.feed.post','value':record}]}
        capture.on_request(request)
        await capture.read(SimpleNamespace(request=request,status=200,json=AsyncMock(return_value={'results':[{'uri':'at://did:plc:fixture/app.bsky.feed.post/key','cid':'cid'}]})))
        self.assertEqual(capture.url,'https://bsky.app/profile/did:plc:fixture/post/key')
        await capture.close()


if __name__ == '__main__':
    unittest.main()
