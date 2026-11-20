"""User-bound encrypted snapshots: Windows DPAPI / macOS Electron-protected key."""
import base64
import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path
import sys

_session_key = None
MAC_HEADER = b'FANZY-MAC-1\x00'


def configure_key(encoded):
    global _session_key
    key = base64.b64decode(encoded, validate=True)
    if len(key) != 32:
        raise ValueError('Invalid session encryption key')
    _session_key = key


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def crypt(data, decrypt=False):
    if sys.platform == 'darwin':
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        if _session_key is None:
            raise RuntimeError('请通过桌面应用启动发布程序以访问 macOS 登录加密密钥')
        cipher = AESGCM(_session_key)
        if decrypt:
            if not data.startswith(MAC_HEADER) or len(data) < len(MAC_HEADER) + 28:
                raise ValueError('登录快照格式不正确，请在当前系统重新登录')
            offset = len(MAC_HEADER)
            return cipher.decrypt(data[offset:offset+12], data[offset+12:], MAC_HEADER)
        nonce = os.urandom(12)
        return MAC_HEADER + nonce + cipher.encrypt(nonce, data, MAC_HEADER)
    if os.name != 'nt':
        raise RuntimeError('登录状态加密保存仅支持 Windows 和 macOS')
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    api = ctypes.WinDLL('crypt32', use_last_error=True)
    function = api.CryptUnprotectData if decrypt else api.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        free = ctypes.WinDLL('kernel32').LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(target.data)


def save(profile, state):
    path = Path(profile)/'fanzy-session.bin'
    encrypted = crypt(json.dumps(state).encode('utf-8'))
    temporary = path.with_suffix('.tmp')
    temporary.write_bytes(encrypted)
    temporary.replace(path)


def load(profile):
    path = Path(profile)/'fanzy-session.bin'
    return json.loads(crypt(path.read_bytes(), decrypt=True)) if path.exists() else None
