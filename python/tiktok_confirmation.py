"""Passive confirmation of the browser's publish request; never sends requests."""
import asyncio
import re
import json
from urllib.parse import urlsplit
from pinterest_confirmation import PinterestConfirmation


class TikTokConfirmation(PinterestConfirmation):
    confirmed = False

    def __init__(self, page, diagnose=None):
        super().__init__(page)
        self.diagnose = diagnose or (lambda detail: None)

    @staticmethod
    def publish_path(path):
        parts = path.lower().strip('/').split('/')
        return (any(part in ('publish', 'post', 'create') for part in parts)
                and not any('draft' in part or 'upload' in part or part in ('edit','delete','update') for part in parts))

    def on_request(self, request):
        url = urlsplit(request.url)
        if (self.armed and request.method == 'POST' and url.scheme == 'https'
                and (url.hostname == 'tiktok.com' or (url.hostname or '').endswith('.tiktok.com'))):
            self.requests.add(request)

    async def read(self, response):
        try:
            url = urlsplit(response.url) if isinstance(getattr(response, 'url', None), str) else None
            recognized = url is None or self.publish_path(url.path)
            metadata = {'path': url.path if url else '', 'http': response.status, 'recognizedPublishPath': recognized}
            if not 200 <= response.status < 300:
                self.diagnose(json.dumps(metadata))
                return
            body = await asyncio.wait_for(response.json(), 5)
            if isinstance(body, dict):
                metadata['keys'] = list(body)[:40]
                metadata['nestedKeys'] = {key:list(body[key])[:30] for key in ('data','item','aweme') if isinstance(body.get(key),dict)}
                metadata['status_code'] = body.get('status_code') if type(body.get('status_code')) is int else None
                posts = body.get('single_post_resp_list')
                if isinstance(posts,list):
                    metadata['postResponses'] = [{'keys':list(post)[:30], 'status_code':post.get('status_code') if type(post.get('status_code')) is int else None} for post in posts[:5] if isinstance(post,dict)]
            self.diagnose(json.dumps(metadata))
            if not recognized:
                return
            if not isinstance(body, dict) or type(body.get('status_code')) is not int or body['status_code'] != 0:
                return
            candidates = [body]
            for key in ('data', 'item', 'aweme'):
                if isinstance(body.get(key), dict):
                    candidates.append(body[key])
            posts=body.get('single_post_resp_list')
            if isinstance(posts,list):
                candidates.extend(post for post in posts if isinstance(post,dict))
            if any(node.get('is_draft') is True or ('status_code' in node and (type(node['status_code']) is not int or node['status_code'] != 0)) for node in candidates):
                return
            # The observed web project endpoint acknowledges a publish job,
            # not necessarily an already public or moderation-approved post.
            project_id=body.get('project_id')
            project_accepted = (url is not None and url.path.rstrip('/') == '/tiktok/web/project/post/v1'
                                and type(project_id) in (str,int) and bool(str(project_id).strip()) and str(project_id) != '0'
                                and isinstance(posts,list) and len(posts)==1 and isinstance(posts[0],dict) and bool(posts[0]))
            ids = {str(node[key]) for node in candidates for key in ('item_id', 'aweme_id')
                   if key in node and re.fullmatch(r'\d{10,30}', str(node[key]))}
            if not project_accepted and len(ids) != 1:
                return
            self.confirmed = True
            # A project/job ID is not a public post ID. Only retain a permalink
            # with the confirmed item ID, or build one with its returned author.
            link_ids = ids or ({str(post.get('post_id')) for post in posts if isinstance(post, dict) and re.fullmatch(r'\d{10,30}', str(post.get('post_id', '')))} if project_accepted else set())
            if len(link_ids) == 1:
                item_id = next(iter(link_ids))
                for node in candidates:
                    share = node.get('share_url') or (node.get('share_info') or {}).get('share_url')
                    parsed = urlsplit(share) if isinstance(share, str) else None
                    if parsed and parsed.scheme == 'https' and parsed.hostname in ('www.tiktok.com', 'tiktok.com') and re.fullmatch(r'/@[A-Za-z0-9._-]+/(video|photo)/'+item_id+r'/?', parsed.path):
                        self.url = 'https://www.tiktok.com' + parsed.path
                        break
                    author = node.get('author') or {}
                    username = author.get('unique_id') if isinstance(author, dict) else None
                    if isinstance(username, str) and re.fullmatch(r'[A-Za-z0-9._-]+', username) and str(node.get('item_id', node.get('aweme_id', ''))) == item_id and node.get('video'):
                        self.url = 'https://www.tiktok.com/@' + username + '/video/' + item_id
                        break
            await self.page.evaluate('()=>globalThis.fanzyPublisher("confirm_tiktok",{platform:"tiktok"})')
        except Exception:
            # Confirmation survives a navigation that destroys the adapter.
            pass
