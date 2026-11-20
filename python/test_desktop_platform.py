import base64
import os
import signal
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # import before platform mocking
import native_login
import session_store


class SessionTests(unittest.TestCase):
    def tearDown(self):
        session_store._session_key = None

    def test_mac_authenticated_encryption_and_wrong_key(self):
        with patch.object(sys, 'platform', 'darwin'):
            session_store.configure_key(base64.b64encode(os.urandom(32)).decode())
            data = b'{"cookies": ["secret"]}'
            encrypted = session_store.crypt(data)
            self.assertNotIn(b'secret', encrypted)
            self.assertNotEqual(encrypted, session_store.crypt(data))
            self.assertEqual(session_store.crypt(encrypted, True), data)
            with self.assertRaises(InvalidTag):
                session_store.crypt(encrypted[:-1] + bytes([encrypted[-1] ^ 1]), True)
            session_store.configure_key(base64.b64encode(os.urandom(32)).decode())
            with self.assertRaises(InvalidTag):
                session_store.crypt(encrypted, True)

    def test_mac_never_falls_back_to_plaintext(self):
        with patch.object(sys, 'platform', 'darwin'):
            with self.assertRaises(RuntimeError):
                session_store.crypt(b'secret')
            with self.assertRaises(ValueError):
                session_store.configure_key(base64.b64encode(b'short').decode())

    @unittest.skipUnless(os.name == 'nt', 'Windows DPAPI')
    def test_existing_windows_format_roundtrip(self):
        data = b'windows-session'
        self.assertEqual(session_store.crypt(session_store.crypt(data), True), data)

    def test_mac_chrome_locations_and_missing_browser(self):
        with patch.object(sys, 'platform', 'darwin'), patch.object(Path, 'is_file', return_value=True):
            self.assertEqual(Path(native_login.chrome_executable()).as_posix(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        with patch.object(sys, 'platform', 'darwin'), patch.object(Path, 'is_file', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Chrome'):
                native_login.chrome_executable()


class CloseTests(unittest.IsolatedAsyncioTestCase):
    async def test_mac_signals_only_owned_process(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(sys, 'platform', 'darwin'), patch.object(native_login, 'close_windows') as windows:
            await native_login.NativeChrome(process).close()
        windows.assert_not_called()
        process.send_signal.assert_called_once_with(signal.SIGTERM)
        process.wait.assert_called_once_with(timeout=15)

    async def test_mac_timeout_does_not_force_kill(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = subprocess.TimeoutExpired('chrome', 15)
        with patch.object(sys, 'platform', 'darwin'):
            with self.assertRaises(RuntimeError):
                await native_login.NativeChrome(process).close()
        process.kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()
