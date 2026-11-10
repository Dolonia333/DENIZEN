"""Fixed desktop-launch storage regressions; every process is mocked."""
from pathlib import Path
from types import SimpleNamespace
import asyncio
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import httpx
from fastapi import FastAPI, HTTPException
import pc_control as pc


class DesktopStorageTests(unittest.TestCase):
    def setUp(self):
        root = Path('H:/NEXEN/work/tests')
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='pc-storage-', dir=root)
        self.root = Path(self.temp.name)
        self.executable = self.root / 'FL64.exe'
        self.executable.write_bytes(b'fixture; never executed')
        self.apps = {key: pc.DesktopApp(key, key, self.executable, 'Fixture')
                     for key in ('flstudio', 'claude', 'discord', 'everything', 'chrome')}
        self.db = SimpleNamespace(event=Mock())
        self.spawn = Mock(return_value=SimpleNamespace(pid=9876))
        self.native = SimpleNamespace(user_data_path=Mock(return_value=self.root),
                                      running=Mock(return_value=False), ready=Mock())
        self.time = 100.0
        self.launcher = pc.Launcher(self.db, spawn=self.spawn, clock=lambda: self.time)
        self.patches = [patch.object(pc, 'APP_BY_ID', self.apps),
                        patch.object(pc, 'MUSIC_ROOT', self.root / 'music', create=True),
                        patch.object(pc, 'fl_adapter', return_value=self.native, create=True)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_unverified_apps_never_spawn_even_when_executable_exists(self):
        for app_id in ('claude', 'discord', 'everything', 'chrome'):
            with self.subTest(app_id=app_id):
                status = pc.app_status(self.apps[app_id])
                self.assertFalse(status['available'])
                self.assertIn('H/F storage setup required', status['reason'])
                with self.assertRaises(HTTPException) as error:
                    self.launcher.launch(app_id)
                self.assertEqual(error.exception.status_code, 409)
        self.spawn.assert_not_called()
        self.db.event.assert_not_called()

    def test_fl_launch_uses_hf_environment_without_mp3_validator(self):
        result = self.launcher.launch('flstudio')
        self.assertEqual(result['pid'], 9876)
        self.assertEqual(self.spawn.call_args.args, ([str(self.executable)],))
        options = self.spawn.call_args.kwargs
        self.assertFalse(options['shell'])
        env = options['env']
        for name in ('TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
                     'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'PIP_CACHE_DIR',
                     'HF_HOME', 'TORCH_HOME', 'npm_config_cache'):
            self.assertTrue(Path(env[name]).is_relative_to(self.root / 'music'), name)
            self.assertTrue(Path(env[name]).is_dir(), name)
        self.assertEqual(env['HOMEDRIVE'], 'H:')
        self.native.ready.assert_not_called()
        self.assertGreaterEqual(self.native.user_data_path.call_count, 2)
        self.native.running.assert_called()
        self.assertEqual([call.args[0] for call in self.db.event.call_args_list],
                         ['pc_launch_requested', 'pc_launch_started'])

    def test_changed_user_data_is_rechecked_before_spawn(self):
        self.native.user_data_path.side_effect = [self.root, ValueError('changed to C:')]
        with self.assertRaises(HTTPException) as error:
            self.launcher.launch('flstudio')
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn('nothing was launched', error.exception.detail)
        self.spawn.assert_not_called()

    def test_unreadable_user_data_status_fails_closed(self):
        self.native.user_data_path.side_effect = OSError('fixture registry unavailable')
        status = pc.app_status(self.apps['flstudio'])
        self.assertTrue(status['installed'])
        self.assertFalse(status['available'])
        self.assertFalse(status['storage']['configured_paths_verified'])
        with self.assertRaises(HTTPException):
            self.launcher.launch('flstudio')
        self.spawn.assert_not_called()

    def test_running_fl_and_unavailable_process_probe_never_spawn(self):
        for state in (True, subprocess.TimeoutExpired('tasklist', 8)):
            with self.subTest(state=type(state).__name__):
                self.launcher = pc.Launcher(self.db, spawn=self.spawn)
                self.native.running.side_effect = state if isinstance(state, Exception) else None
                self.native.running.return_value = state
                with self.assertRaises(HTTPException) as error:
                    self.launcher.launch('flstudio')
                self.assertEqual(error.exception.status_code, 409)
        self.spawn.assert_not_called()

    def test_wrong_output_root_rejects_without_creating_c_profile(self):
        with patch.object(pc, 'MUSIC_ROOT', Path('C:/nexen-fixture-must-never-create')):
            with self.assertRaises(HTTPException) as error:
                self.launcher.launch('flstudio')
            self.assertEqual(error.exception.status_code, 409)
        self.spawn.assert_not_called()

    def test_log_failure_stops_dispatch_and_environment_creation(self):
        self.db.event.side_effect = RuntimeError('fixture audit database unavailable')
        with patch.object(pc, 'tool_environment') as environment:
            with self.assertRaises(HTTPException) as error:
                self.launcher.launch('flstudio')
        self.assertEqual(error.exception.status_code, 503)
        environment.assert_not_called()
        self.spawn.assert_not_called()

    def test_cooldown_and_fixed_target_contract_survive(self):
        self.launcher.launch('flstudio')
        with self.assertRaises(HTTPException) as error:
            self.launcher.launch('flstudio')
        self.assertEqual(error.exception.status_code, 429)
        self.assertIn('Retry-After', error.exception.headers)
        with self.assertRaises(HTTPException) as unknown:
            self.launcher.launch('arbitrary-command')
        self.assertEqual(unknown.exception.status_code, 404)
        self.assertEqual(self.spawn.call_count, 1)

    def test_spawn_failure_preserves_failed_action_event(self):
        self.spawn.side_effect = OSError('fixture process failure')
        with self.assertRaises(HTTPException) as error:
            self.launcher.launch('flstudio')
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(self.db.event.call_args.args[0], 'pc_launch_failed')

    def test_http_origin_peer_and_fixed_body_guards_preserved(self):
        app = FastAPI()
        controller = pc.register(app, self.db)
        controller.spawn = self.spawn

        async def scenario():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 9001)),
                                         base_url='http://127.0.0.1:8788') as client:
                for headers in ({}, {'Origin': 'https://untrusted.invalid', 'X-Nexen-Action': 'launch'},
                                [('Origin', 'http://127.0.0.1:8788'), ('Origin', 'http://127.0.0.1:8788'),
                                 ('X-Nexen-Action', 'launch')]):
                    response = await client.post('/api/pc/launch', json={'id': 'flstudio'}, headers=headers)
                    self.assertEqual(response.status_code, 403)
                headers = {'Origin': 'http://127.0.0.1:8788', 'X-Nexen-Action': 'launch'}
                response = await client.post('/api/pc/launch', json={'id': 'flstudio', 'args': ['/unsafe']}, headers=headers)
                self.assertEqual(response.status_code, 422)
                response = await client.post('/api/pc/launch', json={'id': 'chrome'}, headers=headers)
                self.assertEqual(response.status_code, 409)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('192.0.2.1', 9002)),
                                         base_url='http://127.0.0.1:8788') as client:
                response = await client.get('/api/pc/apps')
                self.assertEqual(response.status_code, 403)
        asyncio.run(scenario())
        self.spawn.assert_not_called()


if __name__ == '__main__':
    unittest.main()
