import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from file_census import Census, SingleWriter, is_reparse

BASE = Path(__file__).resolve().parent
TEST_ROOT = BASE / "work" / "census-tests"
TEST_ROOT.mkdir(parents=True, exist_ok=True)


class CensusTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="case-", dir=TEST_ROOT)
        self.base = Path(self.temporary.name).resolve()
        assert self.base.is_relative_to(TEST_ROOT.resolve())
        self.root = self.base / "source"
        self.root.mkdir()
        self.state = self.base / "state"

    def tearDown(self):
        # The resolved recursive cleanup target was checked against the test workspace.
        self.temporary.cleanup()

    def test_resume_unique_metadata_and_source_unchanged(self):
        (self.root / "nested").mkdir()
        samples = {"plan.md": b"original plan", "nested/clip.mp4": b"fake media",
                   "nested/model.gguf": b"fake model", "nested/payload.py": b"raise RuntimeError('never execute')",
                   "nested/archive.zip": b"not an actual zip", "nested/avatar.glb": b"fake asset"}
        for name, content in samples.items():
            (self.root / name).write_bytes(content)
        before = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in samples}
        census = Census(self.root, self.state, commit_every=1)
        self.assertEqual(census.run(batch=1), "batch_complete")
        self.assertEqual(census.connection.execute("SELECT count(*) FROM files").fetchone()[0], 1)
        # Simulate a crash partway through a directory that already has committed rows.
        child = str(self.root / "nested")
        census.set_directory(child, "working")
        census.add_file(str(self.root / "nested/clip.mp4"), (self.root / "nested/clip.mp4").stat())
        census.connection.commit()
        census.close()
        census = Census(self.root, self.state, commit_every=1)
        self.assertEqual(census.run(), "complete")
        result = json.loads((self.state / "status.json").read_text())
        self.assertEqual(result["files_count"], len(samples))
        self.assertEqual(result["content_files_read"], 0)
        self.assertEqual(result["categories"]["videos"], 1)
        self.assertEqual(result["categories"]["models"], 1)
        self.assertEqual(result["categories"]["code"], 1)
        self.assertEqual(result["categories"]["archives"], 1)
        self.assertEqual(result["categories"]["assets"], 1)
        self.assertEqual(result["directories"]["pending"], 0)
        self.assertEqual(census.run(), "complete")
        self.assertEqual(census.connection.execute("SELECT count(*) FROM files").fetchone()[0], len(samples))
        census.close()
        self.assertEqual(before, {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in samples})

    def test_unpaired_windows_filename_is_recorded_without_crashing(self):
        good = self.root / 'normal.mp3'
        good.write_bytes(b'fixture')
        (self.root / '\u97f3\u697d\U0001f3a7.wav').write_bytes(b'unicode fixture')
        census = Census(self.root, self.state)
        census.add_file(str(self.root / 'bad') + '\ud835.mp3', good.stat())
        census.add_directory(str(self.root / 'bad-directory') + '\ud835')
        self.assertEqual(census.run(), 'complete')
        self.assertEqual(census.connection.execute('SELECT count(*) FROM files').fetchone()[0], 2)
        issues = census.connection.execute("SELECT path,message FROM issues WHERE kind='skipped'").fetchall()
        self.assertEqual(len(issues), 2)
        self.assertTrue(all(row['path'].startswith('escaped-utf16:') for row in issues))
        self.assertTrue(all('\\ud835' in row['path'] for row in issues))
        self.assertEqual(census.connection.execute('PRAGMA quick_check').fetchone()[0], 'ok')
        census.close()

    def test_reparse_detection_and_outside_queue(self):
        self.assertTrue(is_reparse(SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400)))
        self.assertTrue(is_reparse(SimpleNamespace(st_mode=stat.S_IFLNK)))
        self.assertFalse(is_reparse(SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0)))
        outside = self.base / "outside"
        outside.mkdir()
        (outside / "secret.txt").write_text("not in scan")
        census = Census(self.root, self.state)
        census.add_directory(str(outside))
        census.connection.commit()
        census.run()
        self.assertEqual(census.connection.execute("SELECT count(*) FROM files").fetchone()[0], 0)
        self.assertEqual(census.connection.execute("SELECT state FROM directories WHERE path=?", (str(outside),)).fetchone()[0], "skipped")
        census.close()

    def test_pause_resume_and_single_writer(self):
        (self.root / "plan.txt").write_text("fixture")
        self.state.mkdir()
        (self.state / "PAUSE").write_text("test")
        command = [sys.executable, str(BASE / "file_census.py"), "--root", str(self.root), "--state-dir", str(self.state), "--once"]
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)
        try:
            deadline = time.monotonic() + 10
            path = self.state / "status.json"
            paused = False
            observed_status = None
            while time.monotonic() < deadline:
                try:
                    observed_status = json.loads(path.read_text())
                except (OSError, ValueError):
                    # Windows may briefly deny reads while the worker replaces its status file.
                    observed_status = None
                if isinstance(observed_status, dict) and observed_status.get("status") == "paused":
                    paused = True
                    break
                time.sleep(.1)
            if process.poll() is not None:
                _, error = process.communicate(timeout=10)
                self.fail('Paused worker exited: ' + error.decode('utf-8', 'replace'))
            self.assertTrue(paused, 'Census did not report paused within the 10-second deadline')
            self.assertEqual(observed_status["status"], "paused")
            self.assertEqual(observed_status["files_count"], 0)
            with self.assertRaises(RuntimeError):
                with SingleWriter(self.state):
                    pass
            (self.state / "PAUSE").unlink()
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, stderr.decode())
            self.assertEqual(json.loads(path.read_text())["status"], "complete")
        finally:
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=10)


if __name__ == "__main__":
    unittest.main()
