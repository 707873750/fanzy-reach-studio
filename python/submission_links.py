"""Read permalinks from matched browser submissions; never issue requests."""
import asyncio
import json
import re
from urllib.parse import parse_qs, urlsplit
from pinterest_confirmation import PinterestConfirmation


class SubmissionLinks(PinterestConfirmation):
    def __init__(self, page, job):
        super().__init__(page)
        self.platform = job['platform']
        self.expected = '\n\n'.join(part for part in [job.get('title', ''), job.get('caption', ''), ' '.join(job.get('hashtags', []))] if part)
        self.count = len(job['files'])
        self.video = job.get('mediaType') == 'video'

    def on_request(self, request):
        try:
            url = urlsplit(request.url)
            if not self.armed or request.method != 'POST' or url.scheme != 'https' or request.frame != self.page.main_frame:
                return
            if self.platform == 'x':
                if url.hostname not in ('x.com', 'www.x.com') or not re.fullmatch(r'/i/api/graphql/[^/]+/CreateTweet', url.path):
                    return
                variables = request.post_data_json['variables']
                media = variables.get('media', {}).get('media_entities', [])
                if variables.get('tweet_text') != self.expected or variables.get('reply') or len(media) != self.count or not all(item.get('media_id') for item in media):
                    return
            elif self.platform == 'instagram':
                if url.hostname != 'www.instagram.com' or url.path.rstrip('/') not in ('/api/v1/media/configure', '/api/v1/media/configure_sidecar', '/api/v1/media/configure_to_clips'):
                    return
                form = {key:values[0] for key, values in parse_qs(request.post_data or '', keep_blank_values=True).items()}
                if 'signed_body' in form:
                    form = json.loads(form['signed_body'].split('.', 1)[1])
                if form.get('caption', '') != self.expected or form.get('scheduled_publish_time') or form.get('is_draft') in (True, 'true', '1'):
                    return
                if url.path.rstrip('/').endswith('configure_sidecar'):
                    children = form.get('children_metadata', [])
                    children = json.loads(children) if isinstance(children, str) else children
                    if len(children) != self.count or not all(item.get('upload_id') for item in children):
                        return
                elif self.count != 1 or not form.get('upload_id'):
                    return
            else:
                return
            self.requests.add(request)
        except (ValueError, KeyError, TypeError, AttributeError):
            pass

    async def read(self, response):
        try:
            if not 200 <= response.status < 300:
                return
            body = await asyncio.wait_for(response.json(), 5)
            if not isinstance(body, dict) or body.get('errors') or body.get('error'):
                return
            if self.platform == 'x':
                tweet = body.get('data', {}).get('create_tweet', {}).get('tweet_results', {}).get('result', {})
                if tweet.get('__typename') == 'TweetWithVisibilityResults':
                    tweet = tweet.get('tweet', {})
                post_id = tweet.get('rest_id')
                if not isinstance(post_id, str) or not re.fullmatch(r'\d{5,30}', post_id):
                    return
                self.url = 'https://x.com/i/status/' + post_id
            else:
                media = body.get('media', {})
                code = media.get('code')
                if body.get('status') != 'ok' or media.get('is_draft') is True or media.get('scheduled_publish_time') or not media.get('pk', media.get('id')) or not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', code):
                    return
                self.url = 'https://www.instagram.com/' + ('reel/' if self.video else 'p/') + code + '/'
            await self.page.evaluate('([platform,url])=>globalThis.fanzyPublisher("confirm_post_url",{platform},{url})', [self.platform, self.url])
        except Exception:
            # The confirmed link survives page navigation.
            pass
