import asyncio
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi.responses import Response

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app import IMAGE_SIZES, create_app, day, milliseconds, sha
from database import SQLiteDatabase
from provider import ProviderError, VolcProvider, sign_visual_request

SCHEMA = (Path(__file__).resolve().parents[1] / "schema.sql").read_text(encoding="utf-8")


class YieldingDatabase(SQLiteDatabase):
    """Yield around reads/writes to exercise stale reads like remote D1."""
    async def first(self, sql, *values):
        result = await super().first(sql, *values)
        await asyncio.sleep(0)
        return result

    async def batch(self, statements):
        await asyncio.sleep(0)
        await super().batch(statements)


class FakeProvider:
    def __init__(self):
        self.calls = 0
        self.failure = None
        self.result = {"status": "in_queue"}

    async def submit(self, env, data):
        self.calls += 1
        await asyncio.sleep(0)
        if self.failure:
            raise self.failure
        return "provider-task"

    async def query(self, env, task_id):
        await asyncio.sleep(0)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeTransport:
    async def image(self, url):
        return Response(b"test-image", media_type="image/png")


def task():
    return {"id": str(uuid4()), "prompt": "清晨森林中的玻璃小屋", "size": "1328x1328"}


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = YieldingDatabase(":memory:", SCHEMA)
        self.env = SimpleNamespace(DEMO_PASSWORD="test-password", VOLC_AK="test-ak", VOLC_SK="test-sk")
        self.provider = FakeProvider()
        self.app = create_app(self.env, self.db, self.provider, FakeTransport())
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app, raise_app_exceptions=False), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.db.close()

    async def login(self):
        response = await self.client.post("/api/login", json={"username": "demo", "password": "test-password"})
        self.assertEqual(response.status_code, 200, response.text)
        token = response.json()["token"]
        self.client.headers["Authorization"] = f"Bearer {token}"
        return token

    async def balance(self):
        response = await self.client.get("/api/me")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["user"]["balance"]

    async def funded(self):
        await self.login()
        await self.client.post("/api/checkin", json={})

    async def register(self, username="New_User", password="password-123"):
        response = await self.client.post("/api/register", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        self.client.headers["Authorization"] = "Bearer " + response.json()["token"]
        return response.json()

    async def test_registration_login_password_hash_and_independent_wallets(self):
        # Registration/login must work even when the legacy demo account is disabled.
        self.env.DEMO_PASSWORD = ""
        result = await self.register()
        self.assertNotEqual(result["account"]["user"]["id"], "demo")
        self.assertEqual(await self.balance(), 0)
        self.assertFalse(result["account"]["checkedIn"])
        stored = await self.db.first("SELECT * FROM user_credentials")
        self.assertEqual(stored["username"], "new_user")
        self.assertTrue(stored["password_hash"].startswith("pbkdf2_sha256$100000$"))
        self.assertNotIn("password-123", json.dumps(stored))
        await self.client.post("/api/checkin")
        self.assertEqual(await self.balance(), 30)
        old_id = result["account"]["user"]["id"]
        await self.client.post("/api/logout")
        invalid = await self.client.post("/api/login", json={"username": "NEW_USER", "password": "wrong-password"})
        self.assertEqual(invalid.status_code, 401)
        login = await self.client.post("/api/login", json={"username": "NEW_USER", "password": "password-123"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["account"]["user"]["id"], old_id)
        self.assertEqual(login.json()["account"]["user"]["balance"], 30)
        other = await self.register("Other_User")
        self.assertEqual(await self.balance(), 0)
        await self.client.post("/api/checkin")
        self.assertEqual(await self.balance(), 30)
        second = await self.db.first("SELECT password_hash FROM user_credentials WHERE username='other_user'")
        self.assertNotEqual(stored["password_hash"], second["password_hash"])
        self.assertNotEqual(other["account"]["user"]["id"], old_id)

    async def test_registration_duplicates_validation_and_atomicity(self):
        for username, password in [("ab", "password-123"), ("has space", "password-123"), ("a" * 33, "password-123"), ("valid", "short"), ("valid", " " * 10), ("valid", "x" * 129)]:
            response = await self.client.post("/api/register", json={"username": username, "password": password})
            self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual((await self.client.post("/api/register", json={"username": "DEMO", "password": "password-123"})).status_code, 409)
        results = await asyncio.gather(*[self.client.post("/api/register", json={"username": name, "password": "password-123"}) for name in ["Concurrent", "concurrent", "CONCURRENT"]])
        self.assertEqual(sorted(r.status_code for r in results), [200, 409, 409])
        self.assertEqual(len(await self.db.all("SELECT * FROM users")), 2)
        self.assertEqual(len(await self.db.all("SELECT * FROM user_credentials")), 1)
        self.assertEqual(len(await self.db.all("SELECT * FROM sessions")), 1)

    async def test_registration_accounts_cannot_access_each_others_tasks(self):
        await self.register("first_user")
        await self.client.post("/api/checkin")
        submitted = task()
        self.assertEqual((await self.client.post("/api/tasks", json=submitted)).status_code, 200)
        await self.register("second_user")
        self.assertEqual(await self.balance(), 0)
        for suffix in ["", "/image"]:
            self.assertEqual((await self.client.get(f'/api/tasks/{submitted["id"]}{suffix}')).status_code, 404)

    async def test_login_and_registration_rate_limits(self):
        await self.register()
        for _ in range(10):
            result = await self.client.post("/api/login", json={"username": "new_user", "password": "wrong-password"})
            self.assertEqual(result.status_code, 401)
        self.assertEqual((await self.client.post("/api/login", json={"username": "new_user", "password": "wrong-password"})).status_code, 429)
        await self.db.run("UPDATE auth_attempts SET expires=0")
        self.assertEqual((await self.client.post("/api/login", json={"username": "new_user", "password": "password-123"})).status_code, 200)
        for _ in range(10):
            self.assertEqual((await self.client.post("/api/register", json={"username": "demo", "password": "password-123"})).status_code, 409)
        self.assertEqual((await self.client.post("/api/register", json={"username": "demo", "password": "password-123"})).status_code, 429)

    async def test_auth_expiry_logout_and_hash_storage(self):
        for path in ["/api/checkin", "/api/tasks"]:
            self.assertEqual((await self.client.post(path, json=task())).status_code, 401)
        bad = await self.client.post("/api/login", json={"username": "demo", "password": "wrong"})
        self.assertEqual(bad.status_code, 401)
        token = await self.login()
        stored = await self.db.first("SELECT * FROM sessions")
        self.assertEqual(stored["token_hash"], sha(token))
        self.assertEqual(await self.balance(), 0)
        self.assertEqual((await self.client.post("/api/logout")).status_code, 200)
        self.assertEqual((await self.client.get("/api/me")).status_code, 401)
        token = await self.login()
        await self.db.run("UPDATE sessions SET expires=? WHERE token_hash=?", milliseconds() - 1, sha(token))
        self.assertEqual((await self.client.get("/api/me")).status_code, 401)

    async def test_concurrent_checkin_and_day_rollover(self):
        await self.login()
        with patch("app.day", return_value="2026-11-23"):
            results = await asyncio.gather(*[self.client.post("/api/checkin", json={"reward": 99999}) for _ in range(8)])
        self.assertTrue(all(r.status_code == 200 for r in results))
        self.assertEqual(await self.balance(), 30)
        self.assertEqual(len(await self.db.all("SELECT * FROM ledger")), 1)
        self.env.CHECKIN_REWARD = "7"
        with patch("app.day", return_value="2026-11-24"):
            result = await self.client.post("/api/checkin")
        self.assertTrue(result.json()["checkedIn"])
        self.assertEqual(await self.balance(), 37)

    async def test_atomic_balance_and_server_rules(self):
        await self.login()
        self.assertEqual((await self.client.post("/api/tasks", json=task())).status_code, 402)
        self.assertEqual(await self.db.all("SELECT * FROM tasks"), [])
        self.assertEqual(await self.db.all("SELECT * FROM ledger"), [])
        await self.client.post("/api/checkin")
        self.env.GENERATION_ENABLED = "false"
        self.assertEqual((await self.client.post("/api/tasks", json=task())).status_code, 403)
        self.env.GENERATION_ENABLED = "true"
        self.env.VOLC_AK = ""
        self.assertEqual((await self.client.post("/api/tasks", json=task())).status_code, 503)
        self.assertEqual(self.provider.calls, 0)

    async def test_concurrent_same_task_charges_and_submits_once(self):
        await self.funded()
        data = {**task(), "cost": 0}
        results = await asyncio.gather(*[self.client.post("/api/tasks", json=data) for _ in range(8)])
        self.assertTrue(all(r.status_code == 200 for r in results), [r.text for r in results])
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(await self.balance(), 20)
        self.assertEqual((await self.client.post("/api/tasks", json={**data, "prompt": "different"})).status_code, 409)
        self.assertEqual((await self.client.post("/api/tasks", json=task())).status_code, 409)

    async def test_concurrent_distinct_tasks_allow_only_one(self):
        await self.funded()
        results = await asyncio.gather(*[self.client.post("/api/tasks", json=task()) for _ in range(5)])
        self.assertEqual(sum(r.status_code == 200 for r in results), 1)
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(await self.balance(), 20)

    async def test_rejection_refunds_once_and_uncertain_stays_charged(self):
        await self.funded()
        self.provider.failure = ProviderError("rejected", True)
        data = task()
        result = await self.client.post("/api/tasks", json=data)
        self.assertEqual(result.json()["status"], "failed")
        await self.client.post("/api/tasks", json=data)
        self.assertEqual(await self.balance(), 30)
        self.assertEqual(len(await self.db.all("SELECT * FROM ledger")), 3)
        self.provider.failure = ProviderError("timeout")
        data = task()
        result = await self.client.post("/api/tasks", json=data)
        self.assertEqual(result.json()["status"], "uncertain")
        await self.client.post("/api/tasks", json=data)
        self.assertEqual(self.provider.calls, 2)
        self.assertEqual(await self.balance(), 20)
        self.assertEqual((await self.client.post("/api/tasks", json=task())).status_code, 409)

    async def test_success_image_and_failure_refund(self):
        await self.funded()
        data = task()
        await self.client.post("/api/tasks", json=data)
        path = f'/api/tasks/{data["id"]}'
        self.assertEqual((await self.client.get(path + "/image")).status_code, 409)
        self.provider.result = {"status": "done", "image_urls": ["https://images.example.test/image.png"]}
        self.assertEqual((await self.client.get(path)).json()["status"], "succeeded")
        image = await self.client.get(path + "/image")
        self.assertEqual(image.content, b"test-image")
        self.assertEqual(image.headers["content-type"], "image/png")
        self.assertEqual(image.headers["cache-control"], "no-store")
        second = task()
        await self.client.post("/api/tasks", json=second)
        self.provider.result = {"status": "expired"}
        results = await asyncio.gather(*[self.client.get(f'/api/tasks/{second["id"]}') for _ in range(6)])
        self.assertTrue(all(r.json()["status"] == "failed" for r in results))
        self.assertEqual(await self.balance(), 20)

    async def test_unknown_query_does_not_refund_or_lose_task(self):
        await self.funded()
        data = task()
        await self.client.post("/api/tasks", json=data)
        for result in [RuntimeError("network"), {"status": "unknown"}, {"status": "done", "image_urls": []}]:
            self.provider.result = result
            response = await self.client.get(f'/api/tasks/{data["id"]}')
            self.assertEqual(response.status_code, 502)
        self.assertEqual(await self.balance(), 20)
        self.assertEqual((await self.client.get("/api/me")).json()["activeTaskId"], data["id"])

    async def test_task_ownership(self):
        await self.funded()
        data = task()
        await self.client.post("/api/tasks", json=data)
        await self.db.run("INSERT INTO users(id,name) VALUES('other','Other')")
        token = "a" * 64
        await self.db.run("INSERT INTO sessions VALUES(?,?,?)", sha(token), "other", milliseconds() + 60000)
        self.client.headers["Authorization"] = f"Bearer {token}"
        path = f'/api/tasks/{data["id"]}'
        for url in [path, path + "/image"]:
            self.assertEqual((await self.client.get(url)).status_code, 404)
        self.assertEqual((await self.client.post("/api/tasks", json=data)).status_code, 409)

    async def test_malformed_and_oversized_requests(self):
        await self.login()
        for body in ["{", "[]", "null", '{"prompt":"\\ud800"}']:
            response = await self.client.post("/api/tasks", content=body)
            self.assertEqual(response.status_code, 400)
            self.assertIn("error", response.json())
        response = await self.client.post("/api/tasks", content=b"x" * 8193)
        self.assertEqual(response.status_code, 413)
        for data in [{**task(), "size": []}, {**task(), "prompt": "x" * 801}, {**task(), "id": "-" * 36}]:
            self.assertEqual((await self.client.post("/api/tasks", json=data)).status_code, 400)
        self.assertEqual(self.provider.calls, 0)


class CompatibilityTests(unittest.IsolatedAsyncioTestCase):
    def test_signing_matches_existing_typescript_fixture(self):
        url, headers = sign_visual_request("CVSync2AsyncSubmitTask", "{}", "test-ak", "test-sk",
                                           datetime(2026, 11, 23, 1, 2, 3, tzinfo=timezone.utc))
        self.assertEqual(url, "https://visual.volcengineapi.com/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31")
        self.assertEqual(headers["X-Date"], "20261123T010203Z")
        self.assertEqual(headers["Authorization"], "HMAC-SHA256 Credential=test-ak/20261123/cn-north-1/cv/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=ae914ffbe07a056782a6270bd9d88922eef8de2259ae96ca3e52cb587d28e252")

    async def test_existing_database_and_session_survive_reopen(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "demo.sqlite"
            db = SQLiteDatabase(path, SCHEMA)
            token = "b" * 64
            await db.run("INSERT INTO sessions VALUES(?,?,?)", sha(token), "demo", milliseconds() + 60000)
            await db.run("INSERT INTO ledger(user_id,delta,reason,reference) VALUES('demo',30,'每日签到','old-checkin')")
            db.close()
            db = SQLiteDatabase(path, SCHEMA)
            try:
                app = create_app(SimpleNamespace(), db)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    response = await client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
                    self.assertEqual(response.json()["user"]["balance"], 30)
            finally:
                db.close()

    def test_beijing_day(self):
        with patch("app.datetime") as clock:
            clock.now.return_value = datetime(2026, 11, 24, 0, 1, tzinfo=timezone.utc)
            self.assertEqual(day(), "2026-11-24")
            self.assertEqual(clock.now.call_args.args[0].utcoffset(None).total_seconds(), 8 * 3600)

    def test_sizes_match_desktop(self):
        source = (Path(__file__).resolve().parents[2] / "src/shared/image-generation.ts").read_text()
        import re
        self.assertEqual(IMAGE_SIZES, re.findall(r'"(\d+x\d+)"', source))

    async def test_provider_response_classification_and_request(self):
        class Transport:
            status = 200
            payload = {"code": 10000, "data": {"task_id": "upstream-id"}}

            async def post(self, url, headers, body):
                self.body = json.loads(body)
                return self.status, json.dumps(self.payload).encode()

        transport = Transport()
        provider = VolcProvider(transport)
        env = SimpleNamespace(VOLC_AK="test-ak", VOLC_SK="test-sk")
        self.assertEqual(await provider.submit(env, task()), "upstream-id")
        self.assertEqual(transport.body["width"], 1328)
        for status, payload, rejected in [(400, {"code": 123}, True), (500, {"code": 123}, False), (200, {"code": 10000, "data": {}}, False),
                                          (401, {"ResponseMetadata": {"Error": {"Code": "InvalidAccessKey", "Message": "private-key"}}}, True),
                                          (403, {"ResponseMetadata": {"Error": {"Code": "SignatureDoesNotMatch", "Message": "private-key"}}}, True),
                                          (500, {"ResponseMetadata": {"Error": {"Code": "InternalError", "Message": "private-key"}}}, False)]:
            transport.status, transport.payload = status, payload
            with self.assertRaises(ProviderError) as error:
                await provider.submit(env, task())
            self.assertEqual(error.exception.rejected, rejected)
            self.assertNotIn("private-key", str(error.exception))


if __name__ == "__main__":
    unittest.main()
