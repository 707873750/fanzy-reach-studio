import unittest
from types import SimpleNamespace
from unittest.mock import Mock, AsyncMock
from tiktok_confirmation import TikTokConfirmation


class TikTokConfirmationTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_permalink_matching_confirmed_item_is_retained(self):
        for share,expected in [('https://www.tiktok.com/@owner/video/123456789012345?lang=en','https://www.tiktok.com/@owner/video/123456789012345'),('https://www.tiktok.com/@owner/video/987654321012345',None),('https://www.tiktok.com/tiktokstudio/content',None)]:
            capture=TikTokConfirmation(Mock(evaluate=AsyncMock()))
            await capture.read(SimpleNamespace(status=200,json=AsyncMock(return_value={'status_code':0,'item_id':'123456789012345','share_url':share})))
            self.assertTrue(capture.confirmed)
            self.assertEqual(capture.url,expected)
            await capture.close()

    async def test_project_id_alone_is_not_a_permalink(self):
        capture=TikTokConfirmation(Mock(evaluate=AsyncMock()))
        await capture.read(SimpleNamespace(url='https://www.tiktok.com/tiktok/web/project/post/v1',status=200,json=AsyncMock(return_value={'status_code':0,'project_id':'123456789','single_post_resp_list':[{'post_id':'123456789012345'}]})))
        self.assertTrue(capture.confirmed)
        self.assertIsNone(capture.url)
        await capture.close()

    async def test_web_project_response(self):
        for url,body,expected in [
            ('/tiktok/web/project/post/v1/',{'status_code':0,'project_id':'123456789','single_post_resp_list':[{'post_id':'123456789012345'}]},True),
            ('/tiktok/web/project/post/v1/',{'status_code':0,'project_id':'123456789','single_post_resp_list':[{'status_code':123}]},False),
            ('/tiktok/web/project/post/v1/',{'status_code':0,'project_id':'123456789','single_post_resp_list':[]},False),
            ('/tiktok/post/edit/v1/',{'status_code':0,'item_id':'123456789012345'},False),
            ('/tiktok/web/project/post/v1/',{'status_code':0,'single_post_resp_list':[{'post_id':'123456789012345'}]},False)]:
            capture=TikTokConfirmation(Mock(evaluate=AsyncMock()))
            await capture.read(SimpleNamespace(url='https://www.tiktok.com'+url,status=200,json=AsyncMock(return_value=body)))
            self.assertEqual(capture.confirmed,expected)
            await capture.close()

    async def test_requires_explicit_success_and_single_post_id(self):
        for body in [{}, {'status_code':1,'item_id':'123456789012345'},
                     {'status_code':0}, {'status_code':False,'item_id':'123456789012345'},
                     {'status_code':0,'item_id':'123456789012345','is_draft':True},
                     {'status_code':0,'item_id':'123456789012345','data':{'aweme_id':'987654321012345'}}]:
            capture=TikTokConfirmation(Mock(evaluate=AsyncMock()))
            await capture.read(SimpleNamespace(status=200,json=AsyncMock(return_value=body)))
            self.assertFalse(capture.confirmed)
            await capture.close()

    async def test_only_tracks_post_submit_publish_requests(self):
        capture=TikTokConfirmation(Mock(evaluate=AsyncMock()))
        request=Mock(url='https://www.tiktok.com/api/v1/web/project/post/',method='POST')
        capture.on_request(request)
        self.assertFalse(capture.requests)
        capture.armed=True
        for url in ['https://example.com/post/']:
            capture.on_request(Mock(url=url,method='POST'))
        self.assertFalse(capture.requests)
        capture.on_request(request)
        self.assertIn(request,capture.requests)
        await capture.close()

    async def test_diagnostic_does_not_confirm_unrecognized_endpoint(self):
        diagnostic=Mock()
        capture=TikTokConfirmation(Mock(evaluate=AsyncMock()),diagnostic)
        await capture.read(SimpleNamespace(url='https://www.tiktok.com/draft/create/?token=secret',status=200,json=AsyncMock(return_value={'status_code':0,'item_id':'123456789012345','caption':'private text'})))
        self.assertFalse(capture.confirmed)
        detail=diagnostic.call_args[0][0]
        self.assertNotIn('secret',detail)
        self.assertNotIn('private text',detail)
        await capture.close()

    async def test_confirmation_survives_page_navigation(self):
        page=Mock(evaluate=AsyncMock(side_effect=RuntimeError('navigation')))
        capture=TikTokConfirmation(page)
        await capture.read(SimpleNamespace(status=200,json=AsyncMock(return_value={'status_code':0,'data':{'item_id':'123456789012345'}})))
        self.assertTrue(capture.confirmed)
        await capture.close()
