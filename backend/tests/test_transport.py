import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from transport import WorkerTransport


class WorkerFetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_manual_redirect_mode_supported_by_workerd(self):
        response = SimpleNamespace(status=200)
        fetch = AsyncMock(return_value=response)
        js = SimpleNamespace(fetch=fetch, Object=SimpleNamespace(fromEntries=object()),
                             AbortSignal=SimpleNamespace(timeout=Mock(return_value="timeout-signal")))
        ffi = SimpleNamespace(to_js=lambda value, **kwargs: value)
        with patch.dict(sys.modules, {"js": js, "pyodide.ffi": ffi}):
            result = await WorkerTransport().fetch("https://provider.test", method="POST", body="{}", headers={"Authorization": "test-signature"})
        self.assertIs(result, response)
        options = fetch.call_args.args[1]
        self.assertEqual(options["redirect"], "manual")
        self.assertEqual(options["signal"], "timeout-signal")
        self.assertEqual(options["method"], "POST")
        self.assertEqual(options["headers"], {"Authorization": "test-signature"})
        js.AbortSignal.timeout.assert_called_once_with(45_000)

    async def test_redirects_are_rejected_without_following_or_leaking_credentials(self):
        for status in [301, 302, 303, 307, 308]:
            with self.subTest(status=status):
                body = SimpleNamespace(cancel=AsyncMock())
                fetch = AsyncMock(return_value=SimpleNamespace(status=status, body=body))
                js = SimpleNamespace(fetch=fetch, Object=SimpleNamespace(fromEntries=object()),
                                     AbortSignal=SimpleNamespace(timeout=lambda _: None))
                ffi = SimpleNamespace(to_js=lambda value, **kwargs: value)
                with patch.dict(sys.modules, {"js": js, "pyodide.ffi": ffi}):
                    with self.assertRaisesRegex(ValueError, "redirects are not allowed"):
                        await WorkerTransport().fetch("https://provider.test", headers={"Authorization": "test-signature"})
                fetch.assert_awaited_once()
                body.cancel.assert_awaited_once()
