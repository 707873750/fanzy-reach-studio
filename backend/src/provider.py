"""Volcengine visual API signing and asynchronous generation protocol."""

import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timezone
from urllib.parse import quote

MODEL = "high_aes_general_v30l_zt2i"


class ProviderError(Exception):
    def __init__(self, message, rejected=False):
        super().__init__(message)
        self.rejected = rejected


def sign_visual_request(action, body, ak, sk, now=None):
    now = now or datetime.now(timezone.utc)
    date = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    host = "visual.volcengineapi.com"
    query = f"Action={quote(action, safe='')}&Version=2022-08-31"
    digest = hashlib.sha256(body.encode()).hexdigest()
    signed = "content-type;host;x-content-sha256;x-date"
    headers = f"content-type:application/json\nhost:{host}\nx-content-sha256:{digest}\nx-date:{date}\n"
    canonical = "\n".join(["POST", "/", query, headers, signed, digest])
    scope = f"{date[:8]}/cn-north-1/cv/request"
    key = sk.encode()
    for part in [date[:8], "cn-north-1", "cv", "request"]:
        key = hmac.digest(key, part.encode(), "sha256")
    message = "\n".join(["HMAC-SHA256", date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signature = hmac.new(key, message.encode(), "sha256").hexdigest()
    return f"https://{host}/?{query}", {
        "Content-Type": "application/json", "X-Date": date,
        "X-Content-Sha256": digest,
        "Authorization": f"HMAC-SHA256 Credential={ak}/{scope}, SignedHeaders={signed}, Signature={signature}",
    }


class VolcProvider:
    def __init__(self, transport):
        self.transport = transport

    async def request(self, env, action, data):
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        url, headers = sign_visual_request(action, body, env.VOLC_AK, env.VOLC_SK)
        try:
            status, raw = await self.transport.post(url, headers, body)
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("Invalid provider response")
        except Exception as error:
            # Log the failure stage/type without credentials, prompts or bodies.
            logging.getLogger(__name__).warning("provider_request_failed action=%s error_type=%s", action, type(error).__name__)
            raise ProviderError("火山响应未确认，请继续查询；不要重复提交。") from error
        if not 200 <= status < 300 or payload.get("code") != 10000:
            metadata = payload.get("ResponseMetadata")
            gateway_error = metadata.get("Error") if isinstance(metadata, dict) else None
            gateway_code = gateway_error.get("Code") if isinstance(gateway_error, dict) else None
            # Gateway auth/signature errors use ResponseMetadata, not the visual
            # API's numeric code. Never expose its Message: it can contain AKs.
            code = re.sub(r"[^\w-]", "", str(payload.get("code", gateway_code or status)))[:64]
            rejected = status < 500 and type(payload.get("code")) is int
            rejected = rejected or (400 <= status < 500 and isinstance(gateway_code, str) and bool(gateway_code))
            raise ProviderError(
                f"火山接口返回错误（{code}），请检查服务权限、额度或内容审核。",
                rejected,
            )
        data = payload.get("data")
        if not isinstance(data, dict):
            raise ProviderError("火山返回内容未确认，请继续查询。")
        return data

    async def submit(self, env, task):
        width, height = map(int, task["size"].split("x"))
        data = await self.request(env, "CVSync2AsyncSubmitTask", {
            "req_key": MODEL, "prompt": task["prompt"], "width": width, "height": height, "seed": -1,
        })
        task_id = data.get("task_id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[\w-]{1,128}", task_id, re.ASCII):
            raise ProviderError("火山未返回有效任务编号，需要核对上游调用记录。")
        return task_id

    async def query(self, env, task_id):
        return await self.request(env, "CVSync2AsyncGetResult", {
            "req_key": MODEL, "task_id": task_id, "req_json": '{"return_url":true}',
        })
