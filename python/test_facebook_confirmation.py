"""No network: never mistake uploads, old requests or failed mutations for posts."""
import asyncio
import json
import unittest
from urllib.parse import urlencode
from unittest.mock import Mock, AsyncMock
from facebook_confirmation import FacebookConfirmation


class ConfirmationTests(unittest.IsolatedAsyncioTestCase):
    def setup_capture(self):
        self.page = Mock(evaluate=AsyncMock())
        self.capture = FacebookConfirmation(self.page, {'files':['video.mp4'], 'mediaType':'video', 'caption':'expected'})
        self.payload = {'input':{'message':{'text':'expected'}, 'attachments':[{'video':{'id':'123'}}]}}

    def request(self, name='ComposerStoryCreateMutation'):
        return Mock(url='https://www.facebook.com/api/graphql/', method='POST', frame=self.page.main_frame,
                    post_data=urlencode({'fb_api_req_friendly_name':name, 'variables':json.dumps(self.payload)}))

    async def test_only_current_matching_creation(self):
        self.setup_capture()
        request = self.request()
        self.capture.on_request(request)
        self.assertFalse(self.capture.requests)
        self.capture.armed = True
        for name in ('ComposerStoryEditMutation', 'VideoUploadMutation', 'CommentCreateMutation'):
            self.capture.on_request(self.request(name))
        self.assertFalse(self.capture.requests)
        self.payload['input']['message']['text'] = 'other'
        self.capture.on_request(self.request())
        self.assertFalse(self.capture.requests)
        self.payload['input']['message']['text'] = 'expected'
        request = self.request()
        self.capture.on_request(request)
        self.assertIn(request, self.capture.requests)
        body = {'data':{'story_create':{'story':{'id':'opaque-story-id','url':'https://www.facebook.com/posts/123'}}}}
        self.capture.on_response(Mock(request=request, status=200, text=AsyncMock(return_value='for (;;);'+json.dumps(body))))
        await asyncio.gather(*self.capture.tasks)
        self.assertTrue(self.capture.confirmed)
        self.assertEqual(self.capture.url, 'https://www.facebook.com/posts/123')
        self.page.evaluate.assert_awaited_once()
        await self.capture.close()

    async def test_errors_unknown_drafts_and_uploads_do_not_confirm(self):
        for body in ({'data':{'video_upload':{'id':'123'}}}, {'data':{'story_create':{'story':None}}},
                     {'errors':[{'message':'failed'}],'data':{'story_create':{'story':{'id':'123'}}}},
                     {'data':{'story_create':{'story':{'id':'123','is_draft':True}}}}):
            self.setup_capture()
            await self.capture.read(Mock(status=200, text=AsyncMock(return_value=json.dumps(body))))
            self.assertFalse(self.capture.confirmed)
            await self.capture.close()

    async def test_navigation_does_not_erase_confirmation(self):
        self.setup_capture()
        self.page.evaluate.side_effect = RuntimeError('execution context destroyed')
        await self.capture.read(Mock(status=200, text=AsyncMock(return_value=json.dumps({'data':{'story_create':{'story':{'id':'123','url':'https://evil.example/'}}}}))))
        self.assertTrue(self.capture.confirmed)
        self.assertIsNone(self.capture.url)
        await self.capture.close()

    async def test_reel_creation_ids_without_story_object(self):
        for creation in ({'story_id':'UzpfSToxMjM0NTY=', 'story':None}, {'post_id':'123456789012345','story':None}, {'post_id':'pfbidFixture123','story':{}}):
            with self.subTest(creation=creation):
                self.setup_capture()
                self.capture.armed=True
                request=self.request()
                self.capture.on_request(request)
                self.capture.on_response(Mock(request=request,status=200,text=AsyncMock(return_value=json.dumps({'data':{'story_create':creation}}))))
                await asyncio.gather(*self.capture.tasks)
                self.assertTrue(self.capture.confirmed)
                self.assertIsNone(self.capture.url, 'Never invent a URL from an opaque story ID')
                await self.capture.close()

    async def test_post_id_and_matched_actor_supply_permalink(self):
        self.setup_capture()
        self.payload['input']['actor_id']='987654321'
        self.capture.armed=True
        request=self.request()
        self.capture.on_request(request)
        self.capture.on_response(Mock(request=request,status=200,text=AsyncMock(return_value=json.dumps({'data':{'story_create':{'post_id':'123456789','story':None}}}))))
        await asyncio.gather(*self.capture.tasks)
        self.assertEqual(self.capture.url,'https://www.facebook.com/permalink.php?story_fbid=123456789&id=987654321')
        await self.capture.close()

    async def test_unpublished_or_unrelated_ids_do_not_confirm(self):
        for creation in ({'post_id':True}, {'post_id':'0'}, {'story_id':''}, {'video_id':'123456'},
                         {'user':{'id':'123456'}}, {'post_id':'123456','is_draft':True},
                         {'post_id':'123456','publishing_flow':'SCHEDULED'},
                         {'post_id':'123456','story':{'scheduled_publish_time':123456}},
                         {'story_id':'123456','story':{'unpublished_content_type':'DRAFT'}}):
            with self.subTest(creation=creation):
                self.setup_capture()
                await self.capture.read(Mock(status=200,text=AsyncMock(return_value=json.dumps({'data':{'story_create':creation}}))))
                self.assertFalse(self.capture.confirmed)
                await self.capture.close()
