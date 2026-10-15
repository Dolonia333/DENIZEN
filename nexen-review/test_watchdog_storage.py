"""Mocked watchdog child dispatch and direct-entry storage checks."""
from pathlib import Path
from types import SimpleNamespace
import json
import logging
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

import local_watchdog as wd
from storage_policy import StoragePolicyError


class WatchdogStorageTests(unittest.TestCase):
    def setUp(self):
        root = Path('H:/NEXEN/work/tests')
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='watchdog-storage-', dir=root)
        self.root = Path(self.temp.name)
        self.spawn = Mock(return_value=SimpleNamespace(pid=54321, stdout=None))
        self.patches = [patch.object(wd, 'SERVICE_ROOT', self.root / 'services', create=True),
                        patch.object(wd, 'capture_output')]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        for logger in logging.Logger.manager.loggerDict.values():
            if isinstance(logger, logging.Logger):
                for handler in list(logger.handlers):
                    if str(getattr(handler, 'baseFilename', '')).startswith(str(self.root)):
                        handler.close()
                        logger.removeHandler(handler)
        self.temp.cleanup()

    def test_each_fixed_child_gets_h_profile_and_cache(self):
        service = wd.Watchdog(self.root / 'state', spawn=self.spawn)
        for target in ('hub', 'census'):
            service.launch(target)
            options = self.spawn.call_args.kwargs
            env = options['env']
            owned = self.root / 'services' / target
            for key in ('TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'XDG_CACHE_HOME'):
                self.assertTrue(Path(env[key]).is_relative_to(owned), key)
            self.assertNotIn('shell', options)
            command = self.spawn.call_args.args[0]
            self.assertEqual(command[0], str(wd.PYTHONW))
            self.assertIn(command[1], [str(wd.BASE / 'nexen.py'), str(wd.BASE / 'file_census.py')])

    def test_disallowed_state_rejected_before_mkdir(self):
        with patch.object(Path, 'mkdir', side_effect=AssertionError('No disallowed write')):
            with self.assertRaises(StoragePolicyError):
                wd.Watchdog(Path('C:/nexen-must-not-create'))

    def test_status_entry_stays_read_only(self):
        state = self.root / 'state'
        state.mkdir()
        (state / 'status.json').write_text(json.dumps({'status': 'fixture'}), encoding='utf-8')
        with patch.object(wd, 'STATE', state), patch.object(wd.sys, 'argv', ['watchdog', '--status']), \
             patch.object(wd, 'tool_environment', create=True) as environment, \
             patch.object(wd, 'Watchdog') as service, patch('builtins.print'):
            wd.main()
        environment.assert_not_called()
        service.assert_not_called()

    def test_direct_once_entry_bootstraps_before_worker_creation(self):
        created = []
        fake = SimpleNamespace(tick=Mock())

        def construct():
            created.append(os.environ['TEMP'])
            self.assertTrue(Path(os.environ['TEMP']).is_relative_to(self.root / 'services/watchdog'))
            self.assertEqual(os.environ['PYTHONDONTWRITEBYTECODE'], '1')
            return fake

        with patch.dict(os.environ, {'TEMP': str(self.root)}, clear=False), \
             patch.object(wd, 'STATE', self.root / 'state'), \
             patch.object(wd.sys, 'argv', ['watchdog', '--once']), \
             patch.object(wd, 'WindowsMutex') as mutex, \
             patch.object(wd, 'Watchdog', side_effect=construct):
            mutex.return_value.__enter__.return_value = None
            wd.main()
        self.assertEqual(len(created), 1)
        fake.tick.assert_called_once_with()
        self.spawn.assert_not_called()

    def test_child_storage_failure_records_error_without_spawn_or_fallback(self):
        service = wd.Watchdog(self.root / 'state', spawn=self.spawn)
        with patch.object(wd, 'SERVICE_ROOT', Path('C:/nexen-must-not-create')):
            self.assertIsNone(service.launch('hub'))
        self.spawn.assert_not_called()
        self.assertEqual(service.state['last_error'], 'hub: StoragePolicyError')
        saved = json.loads(service.status_path.read_text(encoding='utf-8'))
        self.assertEqual(len(saved['launch_history']['hub']), 1)

    def test_unknown_target_never_dispatches(self):
        service = wd.Watchdog(self.root / 'state', spawn=self.spawn)
        with self.assertRaises(ValueError):
            service.launch('arbitrary-command')
        self.spawn.assert_not_called()

    def test_disallowed_log_path_is_rejected_without_handler(self):
        with self.assertRaises(StoragePolicyError):
            wd.logger_for('fixture', Path('C:/nexen-must-not-create'))


if __name__ == '__main__':
    unittest.main()
