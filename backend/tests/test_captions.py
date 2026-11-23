import base64
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from app import create_app, milliseconds, sha
from captions import PLATFORMS
from database import SQLiteDatabase

SCHEMA = (Path(__file__).resolve().parents[1] / "schema.sql").read_text(encoding="utf-8")
IMAGE = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0test\xff\xd9").decode()


class CaptionTransport:
    def __init__(self):
        self.calls = []
        self.status = 200
        self.raw = json.dumps({"choices": [{"message": {"content": json.dumps({"caption": "Visible scene", "title": "Title", "hashtags": ["#photo"], "alt_text": "A scene"})}}]})
        self.failure = None

    async def post(self, url, headers, body, timeout=45):
        self.calls.append((url, headers, json.loads(body), timeout))
        if self.failure:
            raise self.failure
        return self.status, self.raw


class CaptionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = SQLiteDatabase(":memory:", SCHEMA)
        self.env = SimpleNamespace(DEEPSEEK_API_KEY="server-only-secret", DEEPSEEK_MODEL="server-model")
        self.transport = CaptionTransport()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(
            app=create_app(self.env, self.db, transport=self.transport), raise_app_exceptions=False), base_url="http://test")
        self.token = "a" * 64
        await self.db.run("INSERT INTO sessions VALUES(?,?,?)", sha(self.token), "demo", milliseconds() + 60000)
        self.client.headers["Authorization"] = "Bearer " + self.token
        self.data = {"images": [IMAGE], "platforms": ["instagram"], "shared": False, "hasVideo": False}

    async def asyncTearDown(self):
        await self.client.aclose()
        self.db.close()

    async def test_authenticated_server_owned_request_no_billing_or_image_storage(self):
        result = await self.client.post("/api/captions", json={**self.data, "model": "untrusted", "apiKey": "client-key", "prompt": "untrusted prompt"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["caption"], "Visible scene")
        url, headers, body, timeout = self.transport.calls[0]
        self.assertEqual(url, "https://api.deepseek.com/chat/completions")
        self.assertEqual(headers["Authorization"], "Bearer server-only-secret")
        self.assertEqual(body["model"], "server-model")
        self.assertEqual(body["response_format"], {"type": "json_object"})
        content = body["messages"][0]["content"]
        self.assertIn("Instagram", content[0]["text"])
        self.assertNotIn("untrusted", content[0]["text"])
        self.assertEqual(content[1]["image_url"]["url"], IMAGE)
        self.assertEqual(timeout, 120)
        self.assertEqual(await self.db.all("SELECT * FROM ledger"), [])
        self.assertEqual(await self.db.all("SELECT * FROM tasks"), [])
        self.assertNotIn("server-only-secret", result.text)
        self.assertEqual(result.headers["cache-control"], "no-store")

    async def test_auth_configuration_and_expiry(self):
        self.client.headers.pop("Authorization")
        self.assertEqual((await self.client.post("/api/captions", json=self.data)).status_code, 401)
        self.client.headers["Authorization"] = "Bearer " + self.token
        self.env.DEEPSEEK_API_KEY = ""
        self.assertEqual((await self.client.post("/api/captions", json=self.data)).status_code, 503)
        self.env.DEEPSEEK_API_KEY = "server-only-secret"
        await self.db.run("UPDATE sessions SET expires=0")
        self.assertEqual((await self.client.post("/api/captions", json=self.data)).status_code, 401)
        self.assertEqual(self.transport.calls, [])

    async def test_input_limits_and_no_remote_image_urls(self):
        for invalid in [
            {"images": []}, {"images": [IMAGE] * 36}, {"images": ["https://private.test/image.jpg"]},
            {"images": ["data:image/jpeg;base64,!!!!"]}, {"images": ["data:image/jpeg;base64,YQ=="]},
            {"images": ["data:image/jpeg;base64," + "A" * 1024 * 1024]},
            {"platforms": []}, {"platforms": ["unknown"]}, {"platforms": [{}]},
            {"platforms": ["x", "instagram"]}, {"shared": "yes"}, {"hasVideo": 1},
        ]:
            with self.subTest(invalid=str(invalid)[:80]):
                result = await self.client.post("/api/captions", json={**self.data, **invalid})
                self.assertEqual(result.status_code, 400, result.text)
        with patch("app.BODY_LIMIT", 100):
            self.assertEqual((await self.client.post("/api/captions", content=b"x" * 101)).status_code, 413)
        self.assertEqual((await self.client.post("/api/captions", content="{")).status_code, 400)
        self.assertEqual(self.transport.calls, [])

    async def test_shared_video_and_all_platform_prompts(self):
        for platform in PLATFORMS:
            result = await self.client.post("/api/captions", json={**self.data, "platforms": [platform]})
            self.assertEqual(result.status_code, 200, result.text)
        result = await self.client.post("/api/captions", json={**self.data, "platforms": ["x", "tiktok"], "shared": True, "hasVideo": True, "images": [IMAGE] * 35})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["alt_text"], "")
        content = self.transport.calls[-1][2]["messages"][0]["content"]
        self.assertEqual(len(content), 36)
        self.assertIn("x, tiktok", content[0]["text"])
        self.assertIn("240 characters", content[0]["text"])
        self.assertIn("video cover frames only", content[0]["text"])

    async def test_upstream_failures_and_invalid_output_are_sanitized(self):
        self.transport.failure = RuntimeError("server-only-secret and image data")
        result = await self.client.post("/api/captions", json=self.data)
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("server-only-secret", result.text)
        self.transport.failure = None
        for status, raw in [(401, "server-only-secret"), (500, "server-only-secret"), (200, "not-json"), (200, '{}'), (200, '{"choices":null}')]:
            self.transport.status, self.transport.raw = status, raw
            result = await self.client.post("/api/captions", json=self.data)
            self.assertEqual(result.status_code, 502, result.text)
            self.assertNotIn("server-only-secret", result.text)
        self.transport.status = 200
        for parsed in [[], {"caption": ""}, {"caption": "copy", "hashtags": [1]}, {"caption": "copy", "title": None}]:
            self.transport.raw = json.dumps({"choices": [{"message": {"content": json.dumps(parsed)}}]})
            self.assertEqual((await self.client.post("/api/captions", json=self.data)).status_code, 502)

    async def test_rate_limit_stops_upstream_calls(self):
        for _ in range(30):
            self.assertEqual((await self.client.post("/api/captions", json=self.data)).status_code, 200)
        self.assertEqual((await self.client.post("/api/captions", json=self.data)).status_code, 429)
        self.assertEqual(len(self.transport.calls), 30)
