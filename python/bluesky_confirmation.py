"""Confirm only the current browser submission, including custom PDS hosts."""
import asyncio
import re
from urllib.parse import urlsplit
from pinterest_confirmation import PinterestConfirmation


class BlueskyConfirmation(PinterestConfirmation):
    def __init__(self, page, job):
        super().__init__(page)
        self.expected = '\n\n'.join(x for x in [job.get('title', ''), job.get('caption', ''), ' '.join(job.get('hashtags', []))] if x)
        self.count = len(job['files'])
        self.repos = {}

    def on_request(self, request):
        try:
            parsed = urlsplit(request.url)
            if not self.armed or request.method != 'POST' or parsed.scheme != 'https':
                return
            if request.frame != self.page.main_frame or urlsplit(request.frame.url).hostname != 'bsky.app':
                return
            body = request.post_data_json
            repo = body.get('repo', '')
            if not re.fullmatch(r'did:[a-z]+:[A-Za-z0-9._:%-]+', repo):
                return
            if parsed.path == '/xrpc/com.atproto.repo.createRecord':
                records = [body] if body.get('collection') == 'app.bsky.feed.post' else []
                record = body.get('record', {})
            elif parsed.path == '/xrpc/com.atproto.repo.applyWrites':
                records = [w for w in body.get('writes', []) if w.get('collection') == 'app.bsky.feed.post']
                if len(records) != 1 or records[0].get('$type') != 'com.atproto.repo.applyWrites#create':
                    return
                record = records[0].get('value', {})
            else:
                return
            if len(records) != 1 or record.get('$type') != 'app.bsky.feed.post' or record.get('text') != self.expected or record.get('reply'):
                return
            embed = record.get('embed', {})
            if embed.get('$type') != 'app.bsky.embed.images' or len(embed.get('images', [])) != self.count:
                return
            self.repos[request] = repo
            self.requests.add(request)
        except Exception:
            pass

    async def read(self, response):
        repo = self.repos.pop(response.request, None)
        try:
            if not repo or not 200 <= response.status < 300:
                return
            body = await asyncio.wait_for(response.json(), 5)
            if body.get('error'):
                return
            results = body.get('results', [body])
            for item in results:
                uri = item.get('uri', '')
                prefix = 'at://' + repo + '/app.bsky.feed.post/'
                if uri.startswith(prefix) and re.fullmatch(r'[A-Za-z0-9_-]+', uri[len(prefix):]) and item.get('cid'):
                    self.url = 'https://bsky.app/profile/' + repo + '/post/' + uri[len(prefix):]
                    await self.page.evaluate('(url)=>globalThis.fanzyPublisher("confirm_bluesky",{platform:"bluesky"},{url})', self.url)
                    return
        except Exception:
            pass

    async def close(self):
        await super().close()
        self.repos.clear()
