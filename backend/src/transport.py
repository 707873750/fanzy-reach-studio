"""HTTP transports: HTTPX locally, native Fetch in Python Workers."""

from fastapi.responses import StreamingResponse

JSON_LIMIT = 1024 * 1024
IMAGE_LIMIT = 20 * 1024 * 1024


class LocalTransport:
    async def post(self, url, headers, body, timeout=45):
        import httpx

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            async with client.stream("POST", url, headers=headers, content=body.encode()) as response:
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > JSON_LIMIT:
                        raise ValueError("Response too large")
                return response.status_code, bytes(data)

    async def image(self, url):
        import httpx

        client = httpx.AsyncClient(timeout=45, follow_redirects=False)
        try:
            response = await client.send(client.build_request("GET", url), stream=True)
            content_type = response.headers.get("content-type", "")
            if not response.is_success or not content_type.startswith("image/"):
                raise ValueError("Invalid image response")
        except BaseException:
            await client.aclose()
            raise

        async def chunks():
            size = 0
            try:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > IMAGE_LIMIT:
                        raise ValueError("Image too large")
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        return StreamingResponse(chunks(), media_type=content_type, headers={"Cache-Control": "no-store"})


class WorkerTransport:
    async def fetch(self, url, timeout=45, **options):
        from js import AbortSignal, Object, fetch
        from pyodide.ffi import to_js

        # workerd only supports follow/manual. Never forward signed credentials
        # to a redirect destination; inspect the response instead.
        options.update(redirect="manual", signal=AbortSignal.timeout(timeout * 1000))
        response = await fetch(url, to_js(options, dict_converter=Object.fromEntries))
        if 300 <= response.status < 400:
            if response.body:
                await response.body.cancel()
            raise ValueError("Upstream redirects are not allowed")
        return response

    async def chunks(self, response, limit):
        reader = response.body.getReader()
        size = 0
        try:
            while True:
                part = await reader.read()
                if part.done:
                    break
                chunk = bytes(part.value.to_py())
                size += len(chunk)
                if size > limit:
                    raise ValueError("Response too large")
                yield chunk
        finally:
            await reader.cancel()

    async def post(self, url, headers, body, timeout=45):
        response = await self.fetch(url, timeout=timeout, method="POST", headers=headers, body=body)
        data = bytearray()
        async for chunk in self.chunks(response, JSON_LIMIT):
            data.extend(chunk)
        return response.status, bytes(data)

    async def image(self, url):
        response = await self.fetch(url)
        content_type = response.headers.get("content-type") or ""
        if not response.ok or not content_type.startswith("image/"):
            if response.body:
                await response.body.cancel()
            raise ValueError("Invalid image response")
        return StreamingResponse(self.chunks(response, IMAGE_LIMIT), media_type=content_type,
                                 headers={"Cache-Control": "no-store"})
