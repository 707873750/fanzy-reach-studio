"""Observe the browser's own create response; never issue or replay a request."""
import asyncio
import re
from urllib.parse import urlsplit


class PinterestConfirmation:
    def __init__(self, page):
        self.page = page
        self.armed = False
        self.url = None
        self.requests = set()
        self.tasks = set()
        page.on('request', self.on_request)
        page.on('response', self.on_response)

    def on_request(self, request):
        parsed = urlsplit(request.url)
        if (self.armed and request.method == 'POST' and parsed.scheme == 'https'
                and parsed.hostname in ('www.pinterest.com', 'pinterest.com')
                and parsed.path.rstrip('/') == '/resource/PinResource/create'):
            self.requests.add(request)

    def on_response(self, response):
        if response.request not in self.requests:
            return
        self.requests.discard(response.request)
        task = asyncio.create_task(self.read(response))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def read(self, response):
        try:
            if not 200 <= response.status < 300:
                return
            body = await asyncio.wait_for(response.json(), 5)
            resource = body.get('resource_response', {})
            data = resource.get('data', {})
            if resource.get('status') != 'success' or not isinstance(data, dict) or data.get('is_draft') is True:
                return
            pin_id = str(data.get('id', ''))
            if not re.fullmatch(r'\d{5,30}', pin_id):
                return
            self.url = 'https://www.pinterest.com/pin/' + pin_id + '/'
            # The adapter can finish promptly even if a promotional dialog hid its toast.
            await self.page.evaluate('(url)=>globalThis.fanzyPublisher("confirm_pinterest",{platform:"pinterest"},{url})', self.url)
        except Exception:
            # Navigation may destroy the adapter; the Python caller still has the evidence.
            pass

    async def close(self):
        self.page.remove_listener('request', self.on_request)
        self.page.remove_listener('response', self.on_response)
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.requests.clear()
