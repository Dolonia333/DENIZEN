"""CodeRabbit regressions at persistence and queue boundaries; no model calls."""
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import nexen


class ReviewRuntimeTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parent / 'work' / 'review-runtime-tests'
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.db = nexen.DB(self.base / 'test.sqlite3')

    def test_confidence_variants_preserve_items_and_valid_zero(self):
        values = ['high', None, 0, -5, 9, 'NaN', 'Infinity', {}, True, .7]
        analyzer = nexen.Analyzer(self.db, None)
        analyzer.persist(None, {'items': [
            {'kind': 'FACT', 'body': str(i), 'confidence': value}
            for i, value in enumerate(values)], 'workflows': []})
        self.assertEqual([r['confidence'] for r in self.db.rows(
            'SELECT confidence FROM knowledge_items ORDER BY id')],
            [.5, .5, 0, 0, 1, .5, .5, .5, .5, .7])

    def test_two_supervisors_claim_one_job_once(self):
        self.db.enqueue('analyze_file', {'file_id': 1})
        real_rows = self.db.rows
        selected = threading.Barrier(2)
        def same_snapshot(sql, params=()):
            rows = real_rows(sql, params)
            selected.wait(timeout=5)
            return rows
        calls = []
        def worker():
            sup = nexen.Supervisor.__new__(nexen.Supervisor)
            sup.db = self.db
            sup._stop_event = threading.Event()
            sup.analyzer = SimpleNamespace(analyze_file=lambda file_id: calls.append(file_id))
            sup.drain(1)
        with patch.object(nexen, 'BASE', self.base), patch.object(self.db, 'rows', side_effect=same_snapshot):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(worker) for _ in range(2)]
                for future in futures:
                    future.result(timeout=10)
        self.assertEqual(calls, [1])
        self.assertEqual(real_rows('SELECT status,attempts FROM jobs'), [{'status': 'done', 'attempts': 1}])


if __name__ == '__main__':
    unittest.main()
