"""Salted PBKDF2 records shared by CPython and the Workers Web Crypto runtime."""
import hashlib
import hmac
import secrets
import sys

# Workers Web Crypto supports at most 100,000 PBKDF2 iterations.
ITERATIONS = 100_000


async def derive(password, salt, iterations=ITERATIONS):
    if sys.platform == "emscripten":
        from js import Object, Uint8Array, crypto
        from pyodide.ffi import to_js

        options = lambda value: to_js(value, dict_converter=Object.fromEntries)
        raw = Uint8Array.new(to_js(list(password.encode("utf-8"))))
        key = await crypto.subtle.importKey("raw", raw, "PBKDF2", False, to_js(["deriveBits"]))
        result = await crypto.subtle.deriveBits(options({
            "name": "PBKDF2", "hash": "SHA-256", "iterations": iterations,
            "salt": Uint8Array.new(to_js(list(salt))),
        }), key, 256)
        return bytes(Uint8Array.new(result).to_py())
    import asyncio
    return await asyncio.to_thread(hashlib.pbkdf2_hmac, "sha256", password.encode("utf-8"), salt, iterations, 32)


async def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = await derive(password, salt)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


async def verify_password(password, record):
    try:
        algorithm, count, salt, digest = record.split("$")
        if algorithm != "pbkdf2_sha256" or int(count) != ITERATIONS or len(salt) != 32 or len(digest) != 64:
            return False
        actual = await derive(password, bytes.fromhex(salt), int(count))
        return hmac.compare_digest(actual, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False
