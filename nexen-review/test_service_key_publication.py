"""Service-key regressions with isolated keys; never reads the live credential."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from starlette.requests import Request

import app_auth


class ServiceKeyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def request(self, value='', path='/api/hub/digest'):
        return Request({'type': 'http', 'method': 'POST', 'path': path,
            'query_string': b'', 'headers': [(b'host', b'127.0.0.1:8788'),
                                            (b'x-nexen-service', value.encode('utf-8'))],
            'client': ('127.0.0.1', 55000), 'server': ('127.0.0.1', 8788), 'scheme': 'http'})

    def gate(self, store):
        with patch.object(app_auth, 'AuthStore', return_value=store):
            return app_auth.register(FastAPI())

    def test_invalid_existing_key_rejects_startup_without_replacing_file(self):
        for index, content in enumerate((b'', b' \n', b'partial', b'a' * 63,
                                         b'a' * 65, b'\xff' * 64, b'a' * 64 + b' ' * 65)):
            with self.subTest(index=index):
                root = self.root / str(index)
                root.mkdir()
                path = root / 'service.key'
                path.write_bytes(content)
                with self.assertRaisesRegex(RuntimeError, 'Invalid service key'):
                    app_auth.AuthStore(root)
                self.assertEqual(path.read_bytes(), content)

    def test_gate_rejects_empty_partial_and_nonascii_in_memory_key(self):
        store = app_auth.AuthStore(self.root)
        gate = self.gate(store)
        for value in ('', 'short', '\u00e9' * 64):
            store.service_key = value
            self.assertEqual(gate(self.request(value)).status_code, 401)

    def test_existing_valid_key_is_stable_and_service_scope_stays_narrow(self):
        store = app_auth.AuthStore(self.root)
        content = store.key_path.read_bytes()
        second = app_auth.AuthStore(self.root)
        self.assertEqual(second.key_path.read_bytes(), content)
        self.assertEqual(second.service_key, store.service_key)
        gate = self.gate(second)
        self.assertIsNone(gate(self.request(second.service_key)))
        self.assertEqual(gate(self.request(second.service_key, '/api/money/workspace')).status_code, 401)
        private = self.request(second.service_key)
        private.state.private_access = True
        self.assertEqual(gate(private).status_code, 401)

    def test_atomic_publication_and_concurrent_start_share_complete_winner(self):
        before_publish = threading.Event()
        release = threading.Event()
        original = app_auth.os.replace
        captured_modes = []
        original_open = app_auth.os.open

        def opened(path, flags, mode=0o777, **kwargs):
            if Path(path).name.startswith('.service-key-'):
                captured_modes.append(mode)
            return original_open(path, flags, mode, **kwargs)

        def delayed_publish(source, target):
            self.assertTrue(app_auth.valid_service_key(Path(source).read_text(encoding='ascii')))
            self.assertFalse(Path(target).exists())
            before_publish.set()
            if not release.wait(3):
                raise RuntimeError('Fixture did not release publication')
            return original(source, target)

        with patch.object(app_auth.os, 'replace', side_effect=delayed_publish), \
             patch.object(app_auth.os, 'open', side_effect=opened), ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(app_auth.AuthStore, self.root)
            try:
                self.assertTrue(before_publish.wait(3))
                second = executor.submit(app_auth.AuthStore, self.root)
                self.assertFalse((self.root / 'service.key').exists())
            finally:
                release.set()
            one, two = first.result(timeout=5), second.result(timeout=5)
        self.assertTrue(app_auth.valid_service_key(one.service_key))
        self.assertEqual(one.service_key, two.service_key)
        self.assertEqual(captured_modes, [0o600])
        self.assertEqual(list(self.root.glob('.service-key-*.tmp')), [])

    def test_failed_publication_leaves_no_credential_and_next_start_recovers(self):
        with patch.object(app_auth.os, 'replace', side_effect=OSError('fixture disk fault')):
            with self.assertRaises(OSError):
                app_auth.AuthStore(self.root)
        self.assertFalse((self.root / 'service.key').exists())
        self.assertEqual(list(self.root.glob('.service-key-*.tmp')), [])
        self.assertTrue(app_auth.valid_service_key(app_auth.AuthStore(self.root).service_key))


if __name__ == '__main__':
    unittest.main()
