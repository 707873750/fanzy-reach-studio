"""Windows PDH GPU engine counters. No process names, command lines or content.

Engine instances are grouped across PIDs by physical adapter/engine; the busiest
engine is reported, NOT a sum across engines that could falsely exceed 100%.
"""
import ctypes
from ctypes import wintypes
import math
import os
import re
import threading


class CounterUnion(ctypes.Union):
    _fields_ = [('longValue', wintypes.LONG), ('doubleValue', ctypes.c_double),
                ('largeValue', ctypes.c_longlong), ('stringValue', ctypes.c_void_p)]


class CounterValue(ctypes.Structure):
    _anonymous_ = ('value',)
    _fields_ = [('status', wintypes.DWORD), ('value', CounterUnion)]


class CounterItem(ctypes.Structure):
    _fields_ = [('name', wintypes.LPWSTR), ('value', CounterValue)]


def aggregate_engines(rows):
    engines = {}
    for name, value in rows:
        if not math.isfinite(value) or value < 0:
            continue
        match = re.search(r'(luid_.+?_phys_\d+_eng_\d+_engtype_[^#]+)', name)
        if match:
            key = match.group(1)
            engines[key] = engines.get(key, 0) + value
    return {'gpuBusiestEnginePercent': round(min(100, max(engines.values())), 1),
            'gpuEngineCount': len(engines)} if engines else {}


class GpuSampler:
    def __init__(self):
        self.lock = threading.RLock()
        self.query = ctypes.c_void_p()
        self.counter = ctypes.c_void_p()
        self.status = 'unsupported'
        self.pdh = None
        if os.name != 'nt':
            return
        try:
            self.pdh = ctypes.WinDLL('pdh')
            self.pdh.PdhOpenQueryW.argtypes = [wintypes.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
            self.pdh.PdhAddEnglishCounterW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
            self.pdh.PdhCollectQueryData.argtypes = [ctypes.c_void_p]
            self.pdh.PdhCloseQuery.argtypes = [ctypes.c_void_p]
            self.pdh.PdhGetFormattedCounterArrayW.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
            for name in ['PdhOpenQueryW','PdhAddEnglishCounterW','PdhCollectQueryData','PdhCloseQuery','PdhGetFormattedCounterArrayW']:
                getattr(self.pdh, name).restype = wintypes.LONG
            code = self.pdh.PdhOpenQueryW(None, 0, ctypes.byref(self.query))
            if not code:
                code = self.pdh.PdhAddEnglishCounterW(self.query, r'\GPU Engine(*)\Utilization Percentage', 0, ctypes.byref(self.counter))
            if code:
                self.status = 'unavailable:' + hex(code & 0xffffffff)
                self.close()
            else:
                self.status = 'ready'
        except Exception as error:
            self.status = 'unavailable:' + type(error).__name__
            self.close()

    def sample(self):
        with self.lock:
            return self._sample()

    def _sample(self):
        if self.status != 'ready':
            return {'gpuCounterStatus': self.status}
        code = self.pdh.PdhCollectQueryData(self.query)
        if code:
            return {'gpuCounterStatus': 'collect:' + hex(code & 0xffffffff)}
        size, count = wintypes.DWORD(), wintypes.DWORD()
        self.pdh.PdhGetFormattedCounterArrayW(self.counter, 0x200, ctypes.byref(size), ctypes.byref(count), None)
        if not size.value:
            return {'gpuCounterStatus': 'warming_up_or_no_data'}
        if size.value > 16*1024*1024:
            return {'gpuCounterStatus': 'buffer_limit'}
        buffer = ctypes.create_string_buffer(size.value)
        code = self.pdh.PdhGetFormattedCounterArrayW(self.counter, 0x200, ctypes.byref(size), ctypes.byref(count), buffer)
        if code:
            if (code & 0xffffffff) == 0xc0000bba:
                return {'gpuCounterStatus': 'warming_up_or_no_data'}
            return {'gpuCounterStatus': 'read:' + hex(code & 0xffffffff)}
        items = ctypes.cast(buffer, ctypes.POINTER(CounterItem))
        rows = [(items[i].name, items[i].value.doubleValue) for i in range(count.value) if items[i].value.status in (0, 1)]
        result = aggregate_engines(rows)
        return {'gpuCounterStatus': 'ok' if result else 'warming_up_or_no_data', **result}

    def close(self):
        with self.lock:
            if self.pdh and self.query.value:
                self.pdh.PdhCloseQuery(self.query)
                self.query = ctypes.c_void_p()
            if self.status == 'ready':
                self.status = 'closed'
