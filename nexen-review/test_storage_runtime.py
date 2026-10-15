"""Migration status has a stable schema even without a valid journal."""
import json
from pathlib import Path
import tempfile
import unittest
from storage_runtime import read_migration


class StorageTests(unittest.TestCase):
    def test_missing_and_bad_journals_keep_the_success_key_set(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'migration.json'
            missing=read_migration(path)
            path.write_text('[]',encoding='utf-8')
            invalid=read_migration(path)
            path.write_text(json.dumps({'status':'copying','total_bytes':100,'copied_bytes':1}),encoding='utf-8')
            valid=read_migration(path)
        self.assertEqual(set(missing),set(valid))
        self.assertEqual(set(invalid),set(valid))
        self.assertFalse(missing['available'])
        self.assertIsNone(missing['total_bytes'])
        self.assertIsNone(missing['copy_percent'])
