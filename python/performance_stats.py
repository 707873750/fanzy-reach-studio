"""Windows aggregate counters; no process names, user data or network access."""
import ctypes
from ctypes import wintypes
import os


class MemoryStatus(ctypes.Structure):
    _fields_ = [('length', wintypes.DWORD), ('load', wintypes.DWORD)] + [
        (name, ctypes.c_ulonglong) for name in
        ('total', 'available', 'page_total', 'page_available', 'virtual_total', 'virtual_available', 'extended')]


def system_sample(previous=None):
    if os.name != 'nt':
        return {}, None
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    idle, system, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
    kernel.GetSystemTimes.argtypes = [ctypes.POINTER(wintypes.FILETIME)] * 3
    if not kernel.GetSystemTimes(ctypes.byref(idle), ctypes.byref(system), ctypes.byref(user)):
        return {}, None
    value = lambda t: (t.dwHighDateTime << 32) | t.dwLowDateTime
    current = (value(idle), value(system)+value(user))
    fields = {}
    if previous and current[1] > previous[1]:
        fields['systemCpuPercent'] = round(max(0, min(100, 100*(1-(current[0]-previous[0])/(current[1]-previous[1])))), 1)
    memory = MemoryStatus()
    memory.length = ctypes.sizeof(memory)
    kernel.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(MemoryStatus)]
    if kernel.GlobalMemoryStatusEx(ctypes.byref(memory)):
        fields.update(systemMemoryLoadPercent=memory.load, systemAvailableMemoryMB=round(memory.available/1048576))
    return fields, current
