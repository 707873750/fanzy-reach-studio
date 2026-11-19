import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from pinterest_confirmation import PinterestConfirmation


class ConfirmationTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_ambiguous_or_failed_response(self):
        for status,body in [(500,{}),(200,{'resource_response':{'status':'failure','data':{'id':'123456'}}}),
                            (200,{'resource_response':{'status':'success','data':{'id':'123456','is_draft':True}}}),
                            (200,{'resource_response':{'status':'success','data':{'id':'bad'}}}),
                            (200,{'resource_response':{'status':'success','data':{}}})]:
            page=Mock(evaluate=AsyncMock())
            capture=PinterestConfirmation(page)
            await capture.read(SimpleNamespace(status=status,json=AsyncMock(return_value=body)))
            self.assertIsNone(capture.url)
            await capture.close()

    async def test_only_tracks_new_create_requests(self):
        capture=PinterestConfirmation(Mock(evaluate=AsyncMock()))
        request=Mock(url='https://www.pinterest.com/resource/PinResource/create/',method='POST')
        capture.on_request(request)
        self.assertEqual(len(capture.requests),0)
        capture.armed=True
        for url,method in [('https://example.com/resource/PinResource/create/','POST'),
                           ('https://www.pinterest.com/resource/PinDraftResource/update/','POST'),
                           (request.url,'GET')]:
            capture.on_request(Mock(url=url,method=method))
        self.assertEqual(len(capture.requests),0)
        capture.on_request(request)
        self.assertIn(request,capture.requests)
        await capture.close()


if __name__ == '__main__':
    unittest.main()
