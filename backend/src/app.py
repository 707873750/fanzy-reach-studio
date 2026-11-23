"""FastAPI business API. Response shapes intentionally match the Electron client."""

import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from database import D1Database
from provider import ProviderError, VolcProvider
from transport import WorkerTransport
from passwords import hash_password, verify_password, derive
from captions import BODY_LIMIT, CaptionError, DeepSeekProvider, validate_request

IMAGE_SIZES = ["1328x1328", "1472x1104", "1104x1472", "1584x1056", "1056x1584", "1664x936", "936x1664", "2016x864"]
PROMPT_LIMIT = 800
TASK_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
USERNAME = re.compile(r"[a-zA-Z0-9_]{3,32}")


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def milliseconds():
    return int(time.time() * 1000)


def day():
    return datetime.now(timezone(timedelta(hours=8))).date().isoformat()


def setting(env, name, default=""):
    value = getattr(env, name, None)
    return default if value is None else value


def config(env):
    def positive(name, fallback):
        value = str(setting(env, name))
        return int(value) if re.fullmatch(r"[0-9]{1,5}", value) and 0 < int(value) <= 10000 else fallback

    return {
        "enabled": setting(env, "GENERATION_ENABLED") != "false",
        "cost": positive("IMAGE_COST", 10), "checkinReward": positive("CHECKIN_REWARD", 30),
        "providerReady": bool(setting(env, "VOLC_AK") and setting(env, "VOLC_SK")),
        "model": "通用 3.0 文生图", "sizes": IMAGE_SIZES,
    }


async def read_body(request, limit=8192):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > limit:
            raise ApiError(413, "请求内容过大。")
    try:
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError()
        # Reject escaped unpaired surrogates before hashing or charging a task.
        json.dumps(result, ensure_ascii=False).encode("utf-8")
        return result
    except (ValueError, UnicodeError):
        raise ApiError(400, "请求格式不正确。") from None


async def account(db, env, user_id):
    today = day()
    user = await db.first("SELECT id, name, balance FROM users WHERE id=?", user_id)
    signed = await db.first("SELECT day FROM checkins WHERE user_id=? AND day=?", user_id, today)
    history = await db.all("SELECT delta, reason, created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 8", user_id)
    active = await db.first("SELECT id FROM tasks WHERE user_id=? AND status IN ('submitting','pending','uncertain')", user_id)
    return {"user": user, "checkedIn": bool(signed), "day": today, "config": config(env),
            "ledger": history, "activeTaskId": active["id"] if active else None}


async def refund(db, task, message):
    await db.batch([
        ("UPDATE tasks SET status='failed', error=? WHERE id=? AND status IN ('submitting','pending','uncertain')", (message, task["id"])),
        ("INSERT OR IGNORE INTO ledger(user_id,delta,reason,reference) SELECT user_id,cost,'生图失败退回',id || ':refund' FROM tasks WHERE id=? AND status='failed'", (task["id"],)),
    ])


def public_task(task):
    result = {key: task[key] for key in ["id", "status", "cost", "error"]}
    if task["status"] == "uncertain":
        result["providerTaskId"] = task["provider_id"]
    return result


def create_app(env=None, database=None, upstream=None, transport=None):
    app = FastAPI(title="Fanzy image backend", docs_url=None, redoc_url=None, openapi_url=None)
    transport = transport or WorkerTransport()
    upstream = upstream or VolcProvider(transport)
    captions = DeepSeekProvider(transport)

    async def context(request: Request):
        bindings = env if env is not None else request.scope["env"]
        return bindings, database if database is not None else D1Database(bindings.DB)

    async def authenticated(request: Request, ctx=Depends(context)):
        bindings, db = ctx
        match = re.fullmatch(r"Bearer ([a-f0-9]{64})", request.headers.get("authorization", ""))
        session = await db.first("SELECT user_id FROM sessions WHERE token_hash=? AND expires>?", sha(match[1]), milliseconds()) if match else None
        if not session:
            raise ApiError(401, "请先登录，登录后才可使用 AI 功能。")
        return bindings, db, session["user_id"]

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ApiError)
    async def api_error(request, error):
        return JSONResponse({"error": error.message}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse({"error": "请求格式不正确。"}, status_code=400)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({"error": "接口不存在。" if error.status_code == 404 else "请求方法不正确。"}, status_code=error.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        return JSONResponse({"error": "后端处理失败，请稍后重试。"}, status_code=500, headers={"Cache-Control": "no-store"})

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "fanzy-image-demo"}

    async def auth_limit(db, bucket, maximum, duration):
        now = milliseconds()
        result = await db.first(
            "INSERT INTO auth_attempts(bucket,expires,attempts) VALUES(?,?,1) "
            "ON CONFLICT(bucket) DO UPDATE SET "
            "attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END, "
            "expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING attempts",
            bucket, now + duration, now, now)
        if result["attempts"] > maximum:
            raise ApiError(429, "操作过于频繁，请稍后再试。")

    async def session_statements(db, user_id):
        token = secrets.token_hex(32)
        now = milliseconds()
        return token, [
            ("DELETE FROM sessions WHERE expires<=?", (now,)),
            ("DELETE FROM auth_attempts WHERE expires<=?", (now,)),
            ("INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)", (sha(token), user_id, now + 7 * 86400_000)),
        ]

    @app.post("/api/register")
    async def register(request: Request, ctx=Depends(context)):
        bindings, db = ctx
        data = await read_body(request)
        username, password = data.get("username"), data.get("password")
        if not isinstance(username, str) or not USERNAME.fullmatch(username.strip()):
            raise ApiError(400, "用户名需为 3–32 位字母、数字或下划线。")
        if not isinstance(password, str) or not 8 <= len(password) <= 128 or not password.strip():
            raise ApiError(400, "密码需为 8–128 个字符，不能全为空格。")
        username = username.strip()
        normalized = username.lower()
        # Only trust the Cloudflare client header in the Workers request context.
        ip = request.headers.get("cf-connecting-ip", "unknown") if env is None else (request.client.host if request.client else "unknown")
        await auth_limit(db, "register:" + sha(ip), 10, 3600_000)
        if normalized == "demo" or await db.first("SELECT user_id FROM user_credentials WHERE username=?", normalized):
            raise ApiError(409, "该用户名已被使用，请更换用户名。")
        record = await hash_password(password)
        user_id = secrets.token_hex(16)
        token, statements = await session_statements(db, user_id)
        try:
            await db.batch([
                ("INSERT INTO users(id,name) VALUES(?,?)", (user_id, username)),
                ("INSERT INTO user_credentials(username,user_id,password_hash) VALUES(?,?,?)", (normalized, user_id, record)),
                *statements,
            ])
        except Exception:
            if await db.first("SELECT user_id FROM user_credentials WHERE username=?", normalized):
                raise ApiError(409, "该用户名已被使用，请更换用户名。") from None
            raise
        return {"token": token, "account": await account(db, bindings, user_id)}

    @app.post("/api/login")
    async def login(request: Request, ctx=Depends(context)):
        bindings, db = ctx
        data = await read_body(request)
        username, password = data.get("username"), data.get("password")
        if not isinstance(username, str) or not USERNAME.fullmatch(username.strip()) or not isinstance(password, str) or not 1 <= len(password) <= 128:
            raise ApiError(401, "账号或密码错误。")
        username = username.strip().lower()
        bucket = "login:" + sha(username)
        await auth_limit(db, bucket, 10, 15 * 60_000)
        credentials = await db.first("SELECT user_id,password_hash FROM user_credentials WHERE username=?", username)
        valid = False
        if credentials:
            valid = await verify_password(password, credentials["password_hash"])
        else:
            # Keep unknown-user timing comparable to password verification.
            await derive(password, b"\x00" * 16)
            demo_password = setting(bindings, "DEMO_PASSWORD")
            valid = username == "demo" and bool(demo_password) and hmac.compare_digest(sha(password), sha(demo_password))
        if not valid:
            raise ApiError(401, "账号或密码错误。")
        user_id = credentials["user_id"] if credentials else "demo"
        token, statements = await session_statements(db, user_id)
        await db.batch([*statements, ("DELETE FROM auth_attempts WHERE bucket=?", (bucket,))])
        return {"token": token, "account": await account(db, bindings, user_id)}

    @app.get("/api/me")
    async def me(ctx=Depends(authenticated)):
        bindings, db, user_id = ctx
        return await account(db, bindings, user_id)

    @app.post("/api/logout")
    async def logout(request: Request, ctx=Depends(authenticated)):
        await ctx[1].run("DELETE FROM sessions WHERE token_hash=?", sha(request.headers["authorization"][7:]))
        return {"ok": True}

    @app.post("/api/checkin")
    async def checkin(ctx=Depends(authenticated)):
        bindings, db, user_id = ctx
        today = day()
        await db.batch([
            ("INSERT OR IGNORE INTO checkins(user_id,day) VALUES(?,?)", (user_id, today)),
            ("INSERT OR IGNORE INTO ledger(user_id,delta,reason,reference) VALUES(?,?,?,?)",
             (user_id, config(bindings)["checkinReward"], "每日签到", f"{user_id}:{today}:checkin")),
        ])
        return await account(db, bindings, user_id)

    @app.post("/api/captions")
    async def generate_caption(request: Request, ctx=Depends(authenticated)):
        bindings, db, user_id = ctx
        if not setting(bindings, "DEEPSEEK_API_KEY"):
            raise ApiError(503, "后端尚未配置 图片理解，请联系管理员。")
        data = await read_body(request, BODY_LIMIT)
        try:
            validate_request(data)
        except ValueError as error:
            raise ApiError(400, str(error)) from None
        await auth_limit(db, "captions:" + user_id, 30, 60_000)
        try:
            return await captions.generate(bindings, data)
        except CaptionError as error:
            raise ApiError(502, str(error)) from None

    @app.post("/api/tasks")
    async def submit(request: Request, ctx=Depends(authenticated)):
        bindings, db, user_id = ctx
        data = await read_body(request)
        task_id, prompt, size = (data.get(key) for key in ["id", "prompt", "size"])
        if not isinstance(task_id, str) or not TASK_ID.fullmatch(task_id) or not isinstance(prompt, str) or not prompt.strip() or len(prompt.strip().encode("utf-16-le")) // 2 > PROMPT_LIMIT or size not in IMAGE_SIZES:
            raise ApiError(400, "请检查任务编号、描述或图片尺寸。")
        prompt = prompt.strip()
        data = {"id": task_id, "prompt": prompt, "size": size}
        old = await db.first("SELECT * FROM tasks WHERE id=?", task_id)
        if old:
            if old["user_id"] != user_id or old["prompt"] != prompt or old["size"] != size:
                raise ApiError(409, "任务编号已被其他请求使用。")
            return public_task(old)
        rules = config(bindings)
        if not rules["enabled"]:
            raise ApiError(403, "服务端已暂停生图功能。")
        if not rules["providerReady"]:
            raise ApiError(503, "后端尚未配置火山 AK/SK。")
        # The unique index is the authority. A separate active-task check races
        # with concurrent retries of this same ID and would wrongly reject them.
        try:
            await db.batch([
                ("INSERT INTO tasks(id,user_id,prompt,size,cost,status) VALUES(?,?,?,?,?,'submitting')", (task_id, user_id, prompt, size, rules["cost"])),
                ("INSERT INTO ledger(user_id,delta,reason,reference) VALUES(?,?,?,?)", (user_id, -rules["cost"], "生图扣分", f"{task_id}:charge")),
            ])
        except Exception:
            concurrent = await db.first("SELECT * FROM tasks WHERE id=?", task_id)
            if concurrent:
                if concurrent["user_id"] == user_id and concurrent["prompt"] == prompt and concurrent["size"] == size:
                    return public_task(concurrent)
                raise ApiError(409, "任务编号已被其他请求使用。") from None
            wallet = await db.first("SELECT balance FROM users WHERE id=?", user_id)
            if wallet and wallet["balance"] < rules["cost"]:
                raise ApiError(402, "积分不足，请先签到领取积分。") from None
            active = await db.first("SELECT id FROM tasks WHERE user_id=? AND status IN ('submitting','pending','uncertain')", user_id)
            if active:
                raise ApiError(409, "已有任务正在提交，请刷新后继续查询。") from None
            raise
        task = await db.first("SELECT * FROM tasks WHERE id=?", task_id)
        try:
            provider_id = await upstream.submit(bindings, data)
            await db.run("UPDATE tasks SET status='pending',provider_id=? WHERE id=?", provider_id, task_id)
        except Exception as error:
            if isinstance(error, ProviderError) and error.rejected:
                await refund(db, task, str(error))
            else:
                await db.run("UPDATE tasks SET status='uncertain',error=? WHERE id=?", "提交结果未确认，积分暂未退回。请管理员核对火山调用记录，勿重复生图。", task_id)
        return public_task(await db.first("SELECT * FROM tasks WHERE id=?", task_id))

    async def owned_task(db, task_id, user_id):
        task = await db.first("SELECT * FROM tasks WHERE id=? AND user_id=?", task_id, user_id)
        if not task:
            raise ApiError(404, "未找到任务。若刚提交，请稍后继续查询。")
        return task

    @app.get("/api/tasks/{task_id}")
    async def query(task_id: str, ctx=Depends(authenticated)):
        bindings, db, user_id = ctx
        task = await owned_task(db, task_id, user_id)
        if task["status"] == "pending":
            try:
                data = await upstream.query(bindings, task["provider_id"])
            except Exception:
                raise ApiError(502, "查询火山任务失败，任务已保留，请继续查询。") from None
            status = data.get("status") if isinstance(data, dict) else None
            if status == "done":
                urls = data.get("image_urls")
                url = urls[0] if isinstance(urls, list) and urls else None
                if not isinstance(url, str) or not url.startswith("https://"):
                    raise ApiError(502, "火山未返回有效图片链接，请继续查询。")
                await db.run("UPDATE tasks SET status='succeeded',image_url=? WHERE id=? AND status='pending'", url, task_id)
            elif status in ("not_found", "expired", "failed"):
                await refund(db, task, "任务失败或已过期，积分已退回。")
            elif status not in ("in_queue", "generating"):
                raise ApiError(502, "火山任务状态未确认，请稍后继续查询。")
            task = await owned_task(db, task_id, user_id)
        return public_task(task)

    @app.get("/api/tasks/{task_id}/image")
    async def image(task_id: str, ctx=Depends(authenticated)):
        task = await owned_task(ctx[1], task_id, ctx[2])
        if task["status"] != "succeeded" or not task["image_url"]:
            raise ApiError(409, "图片尚未生成。")
        try:
            return await transport.image(task["image_url"])
        except Exception:
            raise ApiError(502, "图片下载失败，链接可能已过期，请重试或核对任务。") from None

    return app
