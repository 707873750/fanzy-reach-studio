"""Ordinary Chrome -> Playwright transfer on a local HTTP fixture only."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from playwright.async_api import async_playwright
from native_login import NativeChrome


class NativeLoginTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_profile_survives_headless_handoff(self):
        ready = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Set-Cookie', 'native_session=fixture; Max-Age=3600; Path=/; HttpOnly')
                self.end_headers()
                if self.path == '/ready':
                    ready.set()
                else:
                    self.wfile.write(b"<script>localStorage.setItem('native-login','saved');fetch('/ready')</script>Local login fixture")
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        window = None
        try:
            with tempfile.TemporaryDirectory() as folder:
                url = f'http://127.0.0.1:{server.server_port}/'
                window = await NativeChrome.start(Path(folder), url)
                self.assertTrue(await asyncio.to_thread(ready.wait, 10))
                args = window.process.args
                self.assertFalse(any('remote-debugging' in arg or 'enable-automation' in arg for arg in args))
                await window.close()
                async with async_playwright() as p:
                    context = await p.chromium.launch_persistent_context(folder, channel='chrome', headless=True)
                    try:
                        self.assertTrue(any(c['name']=='native_session' for c in await context.cookies(url)))
                        page = context.pages[0]
                        # Intercept so reloading cannot recreate the original state.
                        await context.route('**/*', lambda route: route.fulfill(body='<html>Read only</html>', content_type='text/html'))
                        await page.goto(url)
                        self.assertEqual(await page.evaluate("localStorage.getItem('native-login')"), 'saved')
                    finally:
                        await context.close()
        finally:
            if window:
                await window.close()
            server.shutdown()
            server.server_close()
