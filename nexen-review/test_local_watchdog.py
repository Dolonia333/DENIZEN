import logging
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
import local_watchdog as module

TEST_ROOT = module.BASE / "work" / "watchdog-tests"


def setUpModule():
    global TEST_ROOT, _test_root
    _test_root = tempfile.TemporaryDirectory(prefix='watchdog-tests-')
    TEST_ROOT = Path(_test_root.name)


def tearDownModule():
    _test_root.cleanup()


class Process:
    stdout = None
    def __init__(self, pid):
        self.pid, self.returncode = pid, None
    def poll(self):
        return self.returncode


class Kernel:
    def __init__(self):
        self.refs, self.error = 0, 0
    def CreateMutexW(self, *_):
        self.error = 183 if self.refs else 0
        self.refs += 1
        return 99
    def GetLastError(self):
        return self.error
    def CloseHandle(self, handle):
        self.refs -= 1


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="case-", dir=TEST_ROOT)
        self.path = Path(self.temp.name).resolve()
        assert self.path.is_relative_to(TEST_ROOT.resolve())
        self.data_patch = patch.object(module, "DATA", self.path)
        self.data_patch.start()
        self.time = 10000
        self.spawned, self.requests = [], []
        self.healthy, self.port, self.lock = True, False, True

    def tearDown(self):
        self.data_patch.stop()
        for logger in logging.Logger.manager.loggerDict.values():
            if not isinstance(logger, logging.Logger):
                continue
            for handler in list(logger.handlers):
                if getattr(handler, "baseFilename", "").startswith(str(self.path)):
                    handler.close()
                    logger.removeHandler(handler)
        self.temp.cleanup()

    def request(self, path, method="GET"):
        self.requests.append((path, method))
        if not self.healthy:
            raise urllib.error.URLError("test offline")
        return {"status": {}, "messages": []}

    def spawn(self, command, **options):
        self.assertEqual(command[0], str(module.PYTHONW))
        self.assertIn(command[1], [str(module.BASE / "nexen.py"), str(module.BASE / "file_census.py")])
        self.assertNotIn("shell", options)
        process = Process(100 + len(self.spawned))
        self.spawned.append(process)
        return process

    def watchdog(self):
        return module.Watchdog(self.path / "watchdog", request=self.request,
            listening=lambda: self.port, spawn=self.spawn, locked=lambda: self.lock,
            now=lambda: self.time)

    def test_healthy_attach_is_idempotent_and_digest_interval(self):
        watchdog = self.watchdog()
        state = watchdog.tick()
        self.assertEqual(state["hub"], "healthy_attached")
        self.assertEqual(len(self.spawned), 0)
        self.assertEqual(state["census"], "attached_worker_locked")
        self.time += 15
        watchdog.tick()
        self.assertEqual(self.requests.count(("/api/hub/digest", "POST")), 1)

    def test_mocked_crash_restart_ceiling_and_cooldown(self):
        self.healthy = False
        watchdog = self.watchdog()
        watchdog.tick()
        self.assertEqual(len(self.spawned), 0)  # grace period avoids startup races
        self.time += 15
        watchdog.tick()
        self.assertEqual(len(self.spawned), 1)
        for _ in range(2):
            self.spawned[-1].returncode = 1
            self.time += 15
            watchdog.tick()
        self.assertEqual(len(self.spawned), 3)
        self.spawned[-1].returncode = 1
        self.time += 15
        state = watchdog.tick()
        self.assertEqual(len(self.spawned), 3)
        self.assertEqual(state["hub"], "restart_cooldown")
        self.assertGreater(state["cooldown_until_unix"]["hub"], self.time)

    def test_unknown_unresponsive_listener_is_never_killed_or_duplicated(self):
        self.healthy, self.port = False, True
        watchdog = self.watchdog()
        self.assertEqual(watchdog.tick()["hub"], "unresponsive_unknown_owner_no_kill")
        self.time += 100
        watchdog.tick()
        self.assertEqual(len(self.spawned), 0)

    def test_pause_preserves_ui_and_manual_census_pause(self):
        watchdog = self.watchdog()
        state = watchdog.tick(paused=True)
        self.assertEqual(state["hub"], "healthy_attached")
        self.assertEqual(state["digest"], "paused")
        self.assertEqual(state["census"], "paused")
        self.assertEqual(len(self.requests), 1)
        marker = self.path / "census" / "PAUSE"
        self.assertEqual(marker.read_text(), "watchdog:global-pause")
        watchdog.tick(paused=False)
        self.assertFalse(marker.exists())
        marker.write_text("manual user pause")
        watchdog.tick(paused=True)
        watchdog.tick(paused=False)
        self.assertEqual(marker.read_text(), "manual user pause")

    def test_windows_mutex_rejects_double_start(self):
        kernel = Kernel()
        with module.WindowsMutex(kernel):
            self.assertEqual(kernel.refs, 1)
            with self.assertRaises(RuntimeError):
                with module.WindowsMutex(kernel):
                    pass
            self.assertEqual(kernel.refs, 1)
        self.assertEqual(kernel.refs, 0)


if __name__ == "__main__":
    unittest.main()
