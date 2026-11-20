import asyncio
import json
import unittest
from urllib.parse import urlencode
from unittest.mock import Mock, AsyncMock
from submission_links import SubmissionLinks
import test_video


class LinkTests(unittest.IsolatedAsyncioTestCase):
    async def test_matching_request_and_response(self):
        for platform in ('x', 'instagram'):
            page=Mock(evaluate=AsyncMock())
            capture=SubmissionLinks(page,{'platform':platform,'files':['video.mp4'],'caption':'expected','mediaType':'video'})
            if platform=='x':
                request=Mock(url='https://x.com/i/api/graphql/query/CreateTweet',method='POST',frame=page.main_frame,post_data_json={'variables':{'tweet_text':'expected','media':{'media_entities':[{'media_id':'123'}]}}})
                body={'data':{'create_tweet':{'tweet_results':{'result':{'rest_id':'123456789'}}}}}
                expected='https://x.com/i/status/123456789'
            else:
                request=Mock(url='https://www.instagram.com/api/v1/media/configure_to_clips/',method='POST',frame=page.main_frame,post_data=urlencode({'caption':'expected','upload_id':'123'}))
                body={'status':'ok','media':{'pk':'123456','code':'ReelCode_1'}}
                expected='https://www.instagram.com/reel/ReelCode_1/'
            capture.on_request(request)
            self.assertFalse(capture.requests)
            capture.armed=True
            capture.expected='different'
            capture.on_request(request)
            self.assertFalse(capture.requests)
            capture.expected='expected'
            capture.on_request(request)
            self.assertIn(request,capture.requests)
            capture.on_response(Mock(request=request,status=200,json=AsyncMock(return_value=body)))
            await asyncio.gather(*capture.tasks)
            self.assertEqual(capture.url,expected)
            await capture.close()

    async def test_failed_or_incomplete_responses_do_not_supply_link(self):
        for platform in ('x','instagram'):
            for body in ({}, {'status':'fail','media':{'pk':'123','code':'test'}}, {'errors':[{}]}, {'status':'ok','media':{'pk':'123'}}):
                capture=SubmissionLinks(Mock(evaluate=AsyncMock()),{'platform':platform,'files':['one']})
                await capture.read(Mock(status=200,json=AsyncMock(return_value=body)))
                self.assertIsNone(capture.url)
                await capture.close()


class BrowserLinkTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=test_video.VideoTests.asyncSetUp
    asyncTearDown=test_video.VideoTests.asyncTearDown
    checkpoint=test_video.VideoTests.checkpoint

    async def test_success_notification_link_is_preserved(self):
        self.fixture['x']=test_video.fixture('x')+'''<script>document.querySelector('[data-testid=tweetButton]').onclick=()=>{
          window.clicks=(window.clicks||0)+1;
          document.querySelector('#result').innerHTML='<span>Your post was sent</span><a href="https://x.com/owner/status/123456789">View</a>';
        };</script>'''
        result=await asyncio.wait_for(self.runner.publish(self.job,self.checkpoint),15)
        self.assertEqual(result.get('url'),'https://x.com/owner/status/123456789',result)

    async def test_success_without_permalink_never_returns_composer(self):
        self.fixture['instagram']=test_video.fixture('instagram')
        result=await asyncio.wait_for(self.runner.publish({**self.job,'platform':'instagram'},self.checkpoint),15)
        self.assertEqual(result['state'],'succeeded',result)
        self.assertIsNone(result.get('url'))

    async def test_x_and_instagram_return_real_post_links(self):
        for platform in ('x','instagram'):
            url='/i/api/graphql/query/CreateTweet' if platform=='x' else '/api/v1/media/configure_to_clips/'
            payload="JSON.stringify({variables:{tweet_text:document.querySelector('[contenteditable]').innerText,media:{media_entities:[{media_id:'123'}]}}})" if platform=='x' else "new URLSearchParams({caption:document.querySelector('[contenteditable]').innerText,upload_id:'123'})"
            self.fixture[platform]=test_video.fixture(platform)+f'''<script>document.querySelector('[data-testid=tweetButton]').onclick=()=>{{window.clicks=(window.clicks||0)+1;fetch('{url}',{{method:'POST',body:{payload},headers:{{'Content-Type':'{'application/json' if platform=='x' else 'application/x-www-form-urlencoded'}'}}}})}};</script>'''
            async def setup(context, job):
                self.context=context
                async def route(r):
                    if r.request.is_navigation_request():
                        await r.fulfill(content_type='text/html; charset=utf-8',body=self.fixture[platform])
                    elif r.request.url.endswith(url):
                        await r.fulfill(json={'data':{'create_tweet':{'tweet_results':{'result':{'rest_id':'123456789'}}}}} if platform=='x' else {'status':'ok','media':{'pk':'123456','code':'ReelCode_1'}})
                    else:
                        await r.abort()
                await context.route('**/*',route)
            self.runner.context_setup=setup
            result=await asyncio.wait_for(self.runner.publish({**self.job,'platform':platform},self.checkpoint),20)
            self.assertEqual(result['state'],'succeeded',result)
            self.assertEqual(result.get('url'),'https://x.com/i/status/123456789' if platform=='x' else 'https://www.instagram.com/reel/ReelCode_1/')
