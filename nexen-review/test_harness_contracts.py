import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from harness_bridge import HarnessBridge, local_request
from test_support import fixture_root
from storage_policy import require_output_path


class Response:
    status = 200
    def __init__(self, payload, content_type='application/json'):
        self.raw = json.dumps(payload).encode() if content_type == 'application/json' else payload.encode()
        self.headers = {'Content-Type': content_type}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return self.raw[:limit]


class HarnessContracts(unittest.TestCase):
    def setUp(self):
        # This adapter currently requires an F: root. Create its repository-owned
        # fixture parent lazily instead of requiring a private preexisting folder.
        parent = require_output_path(Path(__file__).resolve().parent/'work'/'harness-contract-fixtures')
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(self.temp.name)
        self.bridge = HarnessBridge(None, self.root, self.root/'state')

    def tearDown(self): self.temp.cleanup()

    def test_json_endpoints_require_objects_but_dashboard_html_remains_valid(self):
        for payload, content_type in (([], 'application/json'), ('scalar', 'application/json'),
                                      (None, 'application/json'), ('<html>Dashboard</html>', 'text/html')):
            with self.subTest(payload=payload), patch('harness_bridge.build_opener') as opener:
                opener.return_value.open.return_value = Response(payload, content_type)
                with self.assertRaises(ValueError):
                    local_request('http://127.0.0.1:11434/api/tags', require_object=True)
        with patch('harness_bridge.build_opener') as opener:
            opener.return_value.open.return_value = Response('<html>Dashboard</html>', 'text/html')
            self.assertEqual(local_request('http://127.0.0.1:20128')['status'], 200)

    def test_invalid_tags_never_generate_and_status_remains_available(self):
        for payload in ([], 'scalar', None, {'models':None}, {'models':'invalid'}):
            with self.subTest(payload=payload), patch('harness_bridge.build_opener') as opener:
                opener.return_value.open.return_value = Response(payload)
                result = self.bridge.smoke_local('test')
                self.assertEqual(result['status'], 'not_started')
                self.assertEqual(result['attempts'], 0)
                self.assertEqual(opener.return_value.open.call_count, 1)
                status = self.bridge.status()
                ollama = next(p for p in status['providers'] if p['id']=='ollama')
                self.assertEqual(ollama['readiness'], 'unavailable')

    def test_mixed_model_records_preserve_only_valid_names(self):
        with patch('harness_bridge.build_opener') as opener:
            opener.return_value.open.return_value = Response({'models':[None, 'bad', {'name':12}, {'name':'test','size':20}]})
            status = self.bridge.status()
        self.assertEqual(next(p for p in status['providers'] if p['id']=='ollama')['models'], [{'name':'test','size':20}])

    def test_malformed_generated_response_is_failed_without_retry(self):
        for payload in ([], None, 'scalar'):
            with self.subTest(payload=payload), patch('harness_bridge.build_opener') as opener:
                opener.return_value.open.side_effect = [Response({'models':[{'name':'test'}]}), Response(payload)]
                result = self.bridge.smoke_local('test')
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(result['reason'], 'invalid_local_response')
                self.assertEqual(result['attempts'], 1)
                self.assertFalse(result['automatic_retry'])
                self.assertEqual(opener.return_value.open.call_count, 2)

    def test_catalog_requires_object_and_record_shapes(self):
        folder = self.root/'harnesses'
        folder.mkdir()
        for payload in ([], None, 'bad', {'harnesses':None}, {'harnesses':'bad'}):
            with self.subTest(payload=payload):
                (folder/'status.json').write_text(json.dumps(payload), encoding='utf-8')
                self.assertEqual(self.bridge._catalog(), {})
        (folder/'status.json').write_text(json.dumps({'harnesses':[None,'bad',{'id':'ollama','name':'Local'}]}), encoding='utf-8')
        self.assertEqual(self.bridge._catalog(), {'ollama':{'id':'ollama','name':'Local'}})


if __name__ == '__main__': unittest.main()
