"""Output policy checks use H-only fixtures and never create disallowed paths."""
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
from storage_policy import require_output_path, tool_environment, StoragePolicyError


class OutputPolicyTests(unittest.TestCase):
    def test_invalid_destinations_fail_before_filesystem_access(self):
        invalid=['C:/NEXEN/output','D:/output','E:/output','relative/file','H:relative',
                 r'\\server\share\file',r'\\?\H:\file','H:/a/../b','H:/a/file:stream','F:/NUL.txt','H:/trailing.']
        with patch.object(Path,'lstat',side_effect=AssertionError('No filesystem access allowed')):
            for value in invalid:
                with self.subTest(path=value),self.assertRaises(StoragePolicyError):require_output_path(value)

    def test_owned_output_and_environment_remain_on_h(self):
        with tempfile.TemporaryDirectory(dir='H:/NEXEN/temp') as fixture:
            root=Path(fixture)
            output=require_output_path(root/'exports'/'mix.mp3',within=root)
            self.assertTrue(output.is_relative_to(root.resolve()))
            env=tool_environment(root,{'TEMP':'C:/wrong','PATH':'preserve read-only executable search'})
            for key in ('TEMP','TMP','TMPDIR','APPDATA','LOCALAPPDATA','USERPROFILE','HOME','XDG_CACHE_HOME','HF_HOME','PIP_CACHE_DIR'):
                self.assertTrue(Path(env[key]).is_dir())
                self.assertTrue(Path(env[key]).is_relative_to(root.resolve()))
            self.assertEqual(env['HOMEDRIVE'],'H:');self.assertEqual(env['PYTHONDONTWRITEBYTECODE'],'1')
            self.assertEqual(env['PATH'],'preserve read-only executable search')
            with self.assertRaises(StoragePolicyError):require_output_path(root.parent/'elsewhere',within=root)

    def test_reparse_and_dangling_symlink_attributes_are_rejected(self):
        with tempfile.TemporaryDirectory(dir='H:/NEXEN/temp') as fixture:
            root=Path(fixture); original=Path.lstat
            for mode,attributes in ((0o120777,0),(0o40777,0x400)):
                def attributes_for(path,*args,**kwargs):
                    if path==root/'redirect':return types.SimpleNamespace(st_mode=mode,st_file_attributes=attributes)
                    return original(path,*args,**kwargs)
                with patch.object(Path,'lstat',attributes_for),self.assertRaises(StoragePolicyError):
                    require_output_path(root/'redirect'/'file.mp3')

    def test_access_errors_do_not_fall_back_to_another_drive(self):
        with patch.object(Path,'lstat',side_effect=PermissionError('fixture denial')):
            with self.assertRaises(PermissionError):require_output_path('H:/NEXEN/output')


if __name__=='__main__':unittest.main()
