"""Ordinary Chrome login windows: no automation or remote debugging flags."""
import asyncio
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import subprocess


def chrome_executable():
    for root in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        path = Path(os.environ.get(root, '')) / 'Google/Chrome/Application/chrome.exe'
        if path.is_file():
            return str(path)
    raise RuntimeError('未找到 Google Chrome，请先安装 Chrome 后再登录')


def close_windows(pid):
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    def visit(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE, normal profile flush.
        return True
    user32.EnumWindows(callback_type(visit), 0)


class NativeChrome:
    def __init__(self, process):
        self.process = process

    @classmethod
    async def start(cls, profile, url):
        profile.mkdir(parents=True, exist_ok=True)
        process = subprocess.Popen([
            chrome_executable(), '--user-data-dir='+str(profile),
            '--no-first-run', '--no-default-browser-check',
            '--disable-background-mode', '--new-window', url,
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        await asyncio.sleep(1)
        if process.poll() is not None:
            raise RuntimeError('Chrome 未保持运行；请先关闭该平台已打开的专用窗口，再点击登录')
        return cls(process)

    async def close(self):
        if self.process.poll() is not None:
            return
        close_windows(self.process.pid)
        try:
            await asyncio.to_thread(self.process.wait, timeout=15)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError('Chrome 尚未关闭，请处理窗口中的关闭提示后再点击完成登录；未强制终止浏览器') from error
