"""Exercise the real bootstrap without starting a service or writing a cache."""
import os
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import patch
from storage_policy import StoragePolicyError

ENTRY=Path(__file__).with_name('start_on_f.pyw')

class BootstrapStorageTests(unittest.TestCase):
    def run_entry(self):
        exec(compile(ENTRY.read_text(encoding='utf-8'),str(ENTRY),'exec'),{'__file__':str(ENTRY)})

    def test_redirected_cache_stops_before_any_write_or_worker(self):
        original=Path.lstat
        def inspect(path,*args,**kwargs):
            if path==Path('F:/NEXEN_CACHE'):
                return types.SimpleNamespace(st_mode=0o40777,st_file_attributes=0x400)
            return original(path,*args,**kwargs)
        with patch.dict(os.environ),patch.object(sys,'path',sys.path.copy()),patch.object(sys,'argv',sys.argv.copy()),patch.object(sys,'dont_write_bytecode',True),patch.object(Path,'lstat',inspect),patch.object(Path,'mkdir') as mkdir,patch.object(runpy,'run_path') as worker,patch.object(os,'chdir'):
            with self.assertRaises(StoragePolicyError):self.run_entry()
            mkdir.assert_not_called();worker.assert_not_called()

    def test_normal_bootstrap_passes_only_fixed_cache_paths_to_mkdir(self):
        with patch.dict(os.environ),patch.object(sys,'path',sys.path.copy()),patch.object(sys,'argv',sys.argv.copy()),patch.object(sys,'dont_write_bytecode',True),patch.object(Path,'mkdir',autospec=True) as mkdir,patch.object(runpy,'run_path') as worker,patch.object(os,'chdir'):
            self.run_entry()
            self.assertGreater(len(mkdir.call_args_list),5)
            self.assertTrue(all(call.args[0].is_relative_to(Path('F:/NEXEN_CACHE')) for call in mkdir.call_args_list))
            worker.assert_called_once_with(str(ENTRY.with_name('local_watchdog.py')),run_name='__main__')
            self.assertEqual(os.environ['PYTHONDONTWRITEBYTECODE'],'1')

if __name__=='__main__':unittest.main()
