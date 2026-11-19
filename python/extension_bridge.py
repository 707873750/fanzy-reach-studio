"""Authenticated loopback bridge; only desktop stdin may create publishing jobs."""
import base64
import json
import re
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Queue, Empty
from adapters import validate


class Bridge:
    def __init__(self, logger=lambda entry: None):
        self.token = secrets.token_urlsafe(32)
        self.client = None
        self.last_seen = 0
        self.job = None
        self.lock = threading.RLock()
        self.events = Queue()
        self.logger = logger
        self.last_auth_warning = 0

    def log(self, step, message, level='info', job=None, source='python', detail=None):
        entry = {'source': source, 'step': step, 'message': str(message)[:2000], 'level': level}
        if detail:
            entry['detail'] = str(detail)[:6000]
        if job:
            entry.update(jobId=job['id'], draftId=job['request'].get('id'), platform=job['request']['platform'])
        self.logger(entry)

    def connection(self, port):
        with self.lock:
            return {'pairing': json.dumps({'url': f'http://127.0.0.1:{port}', 'token': self.token}),
                    'connected': self.client is not None and time.monotonic() - self.last_seen < 50}

    def authorize(self, token, origin, client, pair=False):
        with self.lock:
            if not secrets.compare_digest(token, 'Bearer ' + self.token):
                return False
            if not re.fullmatch(r'chrome-extension://[a-p]{32}', origin or '') or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', client or ''):
                return False
            identity = (origin, client)
            if self.client is None and pair:
                self.client = identity
            if self.client != identity:
                return False
            self.last_seen = time.monotonic()
            return True

    def create_job(self, request):
        if request.get('action') not in ('login', 'publish') or request.get('platform') not in ('x', 'instagram', 'pinterest'):
            raise ValueError('Invalid publishing request')
        if request['action'] == 'publish':
            validate(request)
            sizes = [Path(file).stat().st_size for file in request['files']]
            if max(sizes) > 12 * 1024 * 1024 or sum(sizes) > 24 * 1024 * 1024:
                raise ValueError('Images exceed extension transfer limits (12 MB each, 24 MB total)')
        with self.lock:
            if self.client is None or time.monotonic() - self.last_seen >= 50:
                raise ValueError('Extension is disconnected. Pair it in Settings and keep the browser open.')
            self.job = {'id': secrets.token_urlsafe(24), 'request': request, 'leased': False,
                        'checkpoint': False, 'permit': False, 'ack': threading.Event(), 'done': False, 'log_count': 0}
            self.log('job.queued', '任务已进入扩展队列，等待浏览器领取', job=self.job)
            return self.job

    def lease(self, native_schedule=False):
        with self.lock:
            job = self.job
            if not job or job['leased'] or job['done']:
                return None
            if job['request'].get('xScheduledAt') and native_schedule is not True:
                job['done'] = True
                message = '当前扩展不支持 X 定时发布，请重新加载 0.3.2 或更高版本扩展后重试'
                self.log('schedule.unsupported', message, 'warn', job=job)
                self.events.put(('result', job, {'state': 'needs_attention', 'message': message}))
                return None
            job['leased'] = True  # Never re-lease after a worker crash.
            self.log('job.leased', '浏览器扩展已领取任务', job=job)
            request = job['request']
            return {'id': job['id'], 'action': request['action'], 'platform': request['platform'],
                    **{key: request.get(key, default) for key, default in
                       (('caption', ''), ('title', ''), ('hashtags', []), ('altText', ''), ('boardName', ''), ('xScheduledAt', None))},
                    'fileCount': len(request.get('files', []))}

    def current(self, job_id):
        job = self.job
        if not job or job['id'] != job_id or not job['leased'] or job['done']:
            raise ValueError('Job is no longer active')
        return job


def handler_for(bridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # stdout is reserved for Electron; never log credentials.

        def reply(self, status, value):
            raw = json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
                return self.reply(403, {'error': 'Invalid host'})
            if not bridge.authorize(self.headers.get('Authorization', ''), self.headers.get('Origin', ''),
                                    self.headers.get('X-Fanzy-Client', ''), self.path == '/pair'):
                if time.monotonic() - bridge.last_auth_warning > 60:
                    bridge.last_auth_warning = time.monotonic()
                    bridge.log('connection.rejected', '拒绝未经配对或配对已失效的扩展请求', 'warn')
                return self.reply(403, {'error': 'Pair this browser using the current desktop pairing code'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 16384:
                    return self.reply(413, {'error': 'Invalid request size'})
                self.connection.settimeout(25)
                data = json.loads(self.rfile.read(size))
                if self.path == '/pair':
                    bridge.log('connection.paired', '浏览器扩展配对成功')
                    return self.reply(200, {'ok': True})
                if self.path == '/poll':
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline:
                        with bridge.lock:
                            if not bridge.authorize(self.headers.get('Authorization', ''), self.headers.get('Origin', ''), self.headers.get('X-Fanzy-Client', '')):
                                return self.reply(403, {'error': 'Pairing was reset'})
                            job = bridge.lease(data.get('xNativeSchedule') is True)
                        if job:
                            return self.reply(200, {'job': job})
                        time.sleep(0.2)
                    return self.reply(200, {'job': None})
                with bridge.lock:
                    job = bridge.current(data.get('id'))
                    if self.path == '/log':
                        if job['log_count'] < 300:
                            job['log_count'] += 1
                            bridge.log(str(data.get('step', 'extension.event'))[:100], str(data.get('message', ''))[:2000],
                                       data.get('level') if data.get('level') in ('warn', 'error') else 'info', job=job,
                                       source='page' if data.get('source') == 'page' else 'extension', detail=data.get('detail'))
                        return self.reply(200, {'ok': True})
                    if self.path == '/asset':
                        index = data.get('index')
                        files = job['request'].get('files', [])
                        if type(index) is not int or not 0 <= index < len(files):
                            raise ValueError('Invalid image index')
                        file = Path(files[index])
                        bridge.log('asset.transfer', f'传输图片 {index + 1}/{len(files)}，{file.stat().st_size} 字节', job=job)
                        return self.reply(200, {'name': file.name, 'data': base64.b64encode(file.read_bytes()).decode(), 'type': 'image/jpeg'})
                    if self.path == '/checkpoint':
                        if job['checkpoint'] or job['request']['action'] != 'publish':
                            raise ValueError('Submission permission already used or unavailable')
                        job['checkpoint'] = True
                        bridge.log('submit.checkpoint_requested', '扩展请求提交许可，等待桌面端保存检查点', job=job)
                        bridge.events.put(('checkpoint', job, None))
                    elif self.path == '/result':
                        state = data.get('state')
                        if state not in ('opened', 'succeeded', 'needs_attention', 'uncertain'):
                            raise ValueError('Invalid result')
                        if state == 'succeeded' and not job['permit']:
                            raise ValueError('No submission checkpoint')
                        if state == 'opened' and job['request']['action'] != 'login':
                            raise ValueError('Invalid publication result')
                        if job['checkpoint'] and state not in ('succeeded', 'uncertain'):
                            state = 'uncertain'
                        result = {'state': state, 'message': str(data.get('message', ''))[:800]}
                        url = str(data.get('url', ''))
                        patterns = {'x': r'https://x\.com/[^/]+/status/\d+/?', 'instagram': r'https://www\.instagram\.com/(p|reel)/[\w-]+/?', 'pinterest': r'https://www\.pinterest\.com/pin/\d+/?'}
                        if re.fullmatch(patterns[job['request']['platform']], url):
                            result['url'] = url
                        job['done'] = True
                        bridge.log('job.result', f'任务结果：{state}；{result["message"]}', 'info' if state in ('opened', 'succeeded') else 'warn', job=job)
                        bridge.events.put(('result', job, result))
                        return self.reply(200, {'ok': True})
                    else:
                        return self.reply(404, {'error': 'Unknown operation'})
                if not job['ack'].wait(20) or not job['permit'] or job['done']:
                    return self.reply(409, {'error': 'Submission was not authorized'})
                return self.reply(200, {'permit': True})
            except (ValueError, KeyError, TypeError, OSError) as error:
                bridge.log('bridge.request_error', str(error), 'error', job=bridge.job)
                return self.reply(409, {'error': str(error)[:300]})
    return Handler


OUTPUT_LOCK = threading.Lock()


def emit(value):
    with OUTPUT_LOCK:
        print(json.dumps(value), flush=True)


def main():
    bridge = Bridge(lambda entry: emit({'type': 'log', **entry}))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(bridge))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bridge.log('bridge.ready', 'Python 本地桥接服务已启动')
    incoming = Queue()
    disconnected = threading.Event()

    def read_input():
        for line in sys.stdin:
            incoming.put(json.loads(line))
        disconnected.set()
        incoming.put(None)
    threading.Thread(target=read_input, daemon=True).start()
    try:
        while not disconnected.is_set() or not incoming.empty():
            request = incoming.get()
            if request is None:
                break
            if request.get('action') in ('connection', 'reset_connection'):
                if request['action'] == 'reset_connection':
                    with bridge.lock:
                        bridge.token = secrets.token_urlsafe(32)
                        bridge.client = None
                    bridge.log('connection.reset', '已撤销旧配对并生成新的配对信息')
                emit({'type': 'result', 'state': 'opened', **bridge.connection(server.server_port)})
                continue
            job = None
            try:
                job = bridge.create_job(request)
                deadline = time.monotonic() + 180
                while True:
                    if time.monotonic() >= deadline:
                        raise ValueError('Extension timed out. Inspect the platform before retrying.')
                    try:
                        event, event_job, result = bridge.events.get(timeout=0.5)
                    except Empty:
                        if disconnected.is_set():
                            raise ValueError('Desktop connection interrupted')
                        continue
                    if event_job is not job:
                        continue
                    if event == 'checkpoint':
                        emit({'type': 'submitting'})
                        ack = incoming.get(timeout=20)
                        with bridge.lock:
                            job['permit'] = ack == {'ack': 'persisted'}
                            job['ack'].set()
                        bridge.log('submit.checkpoint_saved' if job['permit'] else 'submit.checkpoint_denied', '提交检查点已保存，允许扩展提交' if job['permit'] else '未获得持久化确认，禁止提交', 'info' if job['permit'] else 'error', job=job)
                        if not job['permit']:
                            raise ValueError('Submission checkpoint could not be saved')
                    else:
                        emit({'type': 'result', **result})
                        break
            except (ValueError, Empty) as error:
                bridge.log('job.failed', str(error) or 'Desktop checkpoint timed out', 'error', job=job)
                emit({'type': 'result', 'state': 'uncertain' if job and job['checkpoint'] else 'needs_attention', 'message': str(error) or 'Desktop checkpoint timed out'})
            finally:
                with bridge.lock:
                    if job:
                        job['done'] = True
                        job['ack'].set()
                    bridge.job = None
                if disconnected.is_set():
                    break
    finally:
        bridge.log('bridge.stop', 'Python 本地桥接服务停止')
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
