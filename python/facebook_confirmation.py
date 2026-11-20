"""Conservative passive acknowledgement of the current composer submission."""
import asyncio
import json
import re
from urllib.parse import parse_qs, urlsplit
from pinterest_confirmation import PinterestConfirmation


class FacebookConfirmation(PinterestConfirmation):
    def __init__(self, page, job, diagnose=None):
        super().__init__(page)
        self.confirmed = False
        self.expected = '\n\n'.join(part for part in [job.get('title', ''), job.get('caption', ''), ' '.join(job.get('hashtags', []))] if part)
        self.count = len(job['files'])
        self.kind = 'video' if job.get('mediaType') == 'video' else 'photo'
        self.diagnose = diagnose or (lambda detail: None)
        self.actors = {}

    def on_request(self, request):
        try:
            url = urlsplit(request.url)
            if not (self.armed and request.method == 'POST' and url.scheme == 'https'
                    and url.hostname == 'www.facebook.com' and url.path.rstrip('/') == '/api/graphql'
                    and request.frame == self.page.main_frame):
                return
            form = parse_qs(request.post_data or '')
            if form.get('fb_api_req_friendly_name') != ['ComposerStoryCreateMutation']:
                return
            payload = json.loads(form['variables'][0])['input']
            self.diagnose(json.dumps({'mutation':'ComposerStoryCreateMutation','inputKeys':list(payload)[:40],
                                      'attachmentKeys':[list(item)[:10] for item in payload.get('attachments', [])[:10] if isinstance(item, dict)]}))
            if payload.get('message', {}).get('text', '') != self.expected or self.unpublished(payload):
                return
            attachments = payload.get('attachments', [])
            if len(attachments) != self.count or not all(isinstance(item, dict) and isinstance(item.get(self.kind), dict) and item[self.kind].get('id') for item in attachments):
                return
            self.requests.add(request)
            actor = str(payload.get('actor_id', ''))
            if re.fullmatch(r'\d{5,30}', actor):
                self.actors[request] = actor
        except (ValueError, KeyError, TypeError, AttributeError):
            pass

    @staticmethod
    def unpublished(node):
        return (node.get('is_draft') is True or bool(node.get('scheduled_publish_time'))
                or bool(node.get('unpublished_content_type'))
                or bool(re.search(r'draft|schedule', str(node.get('publishing_flow', '')), re.I)))

    @staticmethod
    def identifier(value):
        return isinstance(value, str) and value != '0' and bool(re.fullmatch(r'[A-Za-z0-9_:/+=-]{1,256}', value))

    async def read(self, response):
        actor = self.actors.pop(getattr(response, 'request', None), None)
        try:
            if not 200 <= response.status < 300:
                return
            text = await asyncio.wait_for(response.text(), 5)
            if len(text) > 5_000_000:
                return
            text = text.removeprefix('for (;;);').strip()
            # Facebook can stream newline-delimited GraphQL payloads.
            bodies = [json.loads(line) for line in text.splitlines() if line.strip()]
            self.diagnose(json.dumps({'http':response.status, 'payloads':[{'keys':list(body)[:20],
                              'dataKeys':list(body.get('data') or {})[:20], 'hasErrors':bool(body.get('errors')),
                              'creationKeys':list((body.get('data') or {}).get('story_create') or {})[:30]} for body in bodies[:10]]}))
            if any(body.get('errors') for body in bodies):
                return
            for body in bodies:
                creation = (body.get('data') or {}).get('story_create')
                if not isinstance(creation, dict) or self.unpublished(creation):
                    continue
                story = creation.get('story')
                story = story if isinstance(story, dict) else {}
                if self.unpublished(story):
                    continue
                # The live ComposerStoryCreateMutation schema returns story_id
                # and post_id directly. Reel creation can omit the full story.
                # Never substitute upload IDs, user IDs, or a bare HTTP 200.
                if not any(self.identifier(value) for value in (creation.get('story_id'), creation.get('post_id'), story.get('id'))):
                    continue
                self.confirmed = True
                candidate = story.get('url', '')
                parsed = urlsplit(candidate)
                if parsed.scheme == 'https' and parsed.hostname in ('www.facebook.com', 'facebook.com'):
                    self.url = candidate
                if not self.url and actor:
                    post_id = creation.get('post_id') or story.get('post_id')
                    if isinstance(post_id, str) and re.fullmatch(r'(?:\d{5,30}|pfbid[A-Za-z0-9]+)', post_id):
                        self.url = 'https://www.facebook.com/permalink.php?story_fbid=' + post_id + '&id=' + actor
                await self.page.evaluate('()=>globalThis.fanzyPublisher("confirm_facebook",{platform:"facebook"})')
                return
        except Exception:
            # A navigation may destroy the adapter after receipt; keep evidence.
            pass

    async def close(self):
        await super().close()
        self.actors.clear()
