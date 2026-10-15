"""The fixture override cannot silently redirect tests to C: or create at import."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_support


class FixtureStorageTests(unittest.TestCase):
    def test_import_does_not_create_any_directory(self):
        with patch.object(Path, 'mkdir', side_effect=AssertionError('No import writes')):
            importlib.reload(test_support)

    def test_guarded_override_creates_missing_parent_lazily(self):
        with tempfile.TemporaryDirectory(dir=test_support.fixture_root()) as directory:
            root=Path(directory)/'not-created-yet'
            self.assertFalse(root.exists())
            with patch.dict(os.environ, {'NEXEN_TEST_ROOT':str(root)}):
                self.assertEqual(test_support.fixture_root(),root.resolve())
            self.assertTrue(root.is_dir())

    def test_disallowed_override_is_rejected_before_mkdir(self):
        with patch.dict(os.environ, {'NEXEN_TEST_ROOT':'C:/forbidden-fixture'}), \
             patch.object(Path,'mkdir',side_effect=AssertionError('No disallowed writes')):
            with self.assertRaises(ValueError):test_support.fixture_root()


if __name__=='__main__':unittest.main()
