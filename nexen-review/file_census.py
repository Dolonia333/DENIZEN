"""Resumable metadata census. Reads names/stat only; never opens source content.

--once finishes the initial inventory; --batch N processes N directories then exits.
Interrupted directories are retried; primary keys prevent duplicate file counts.
--pause/--resume set or remove a marker. Sources are never written or executed.
"""
from __future__ import annotations
import argparse
import json
import os
import sqlite3
import stat
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_STATE = Path(__file__).resolve().parent / "data" / "census"
GROUPS = {
    "videos": ".mp4 .mov .mkv .avi .webm .m4v .wmv .mpeg .mpg .mts .m2ts",
    "audio": ".wav .mp3 .flac .aiff .aif .m4a .ogg .opus .aac .wma .mid .midi",
    "models": ".gguf .safetensors .onnx .pt .pth .ckpt .ggml .tflite .h5",
    "code": ".py .pyw .js .jsx .ts .tsx .mjs .cjs .ps1 .psm1 .bat .cmd .sh .bash .c .cpp .h .hpp .cs .rs .go .java .swift .kt .rb .php .lua .sql .r .ipynb .vue .svelte .css .scss",
    "archives": ".zip .7z .rar .tar .gz .bz2 .xz .zst .tgz .iso .cab",
    "documents": ".txt .md .markdown .pdf .doc .docx .odt .rtf .csv .tsv .xls .xlsx .ods .ppt .pptx .odp .json .jsonl .yaml .yml .toml .xml .html .htm .log .ini .epub",
    "assets": ".png .jpg .jpeg .gif .webp .avif .bmp .tif .tiff .svg .ico .psd .ai .exr .hdr .fbx .obj .gltf .glb .blend .stl .mtl .unity .unitypackage .uasset .uproject .ttf .otf .flp .als .rpp",
}
EXTENSIONS = {ext: group for group, words in GROUPS.items() for ext in words.split()}


def utc():
    return datetime.now(timezone.utc).isoformat()


def is_reparse(st):
    return stat.S_ISLNK(st.st_mode) or bool(getattr(st, "st_file_attributes", 0) & 0x400)


def category(path):
    suffix = Path(path).suffix.lower()
    if suffix in EXTENSIONS:
        return EXTENSIONS[suffix]
    parts = [p.lower() for p in Path(path).parts]
    if "blobs" in parts and Path(path).name.lower().startswith("sha256-"):
        return "models"
    return "other"


class SingleWriter:
    def __init__(self, directory):
        self.path = directory / "worker.lock"
        self.file = None

    def __enter__(self):
        self.file = self.path.open("a+b")
        self.file.seek(0, os.SEEK_END)
        if not self.file.tell():
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.file.close()
            raise RuntimeError("A census worker already holds this state directory") from exc
        return self

    def __exit__(self, *_):
        self.file.close()


class Census:
    def __init__(self, root, state_dir, commit_every=250):
        self.root = Path(os.path.abspath(root))
        self.state_dir = Path(state_dir).resolve()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.pause_path = self.state_dir / "PAUSE"
        self.status_path = self.state_dir / "status.json"
        self.current = ""
        self.last_publish = 0.0
        self.dirty = 0
        self.commit_every = max(1, int(commit_every))
        self.connection = sqlite3.connect(self.state_dir / "census.sqlite3", timeout=10)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS directories(
                path TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending',
                discovered_at TEXT NOT NULL,completed_at TEXT,error TEXT);
            CREATE INDEX IF NOT EXISTS dir_queue ON directories(state,discovered_at);
            CREATE TABLE IF NOT EXISTS files(
                path TEXT PRIMARY KEY,size INTEGER NOT NULL,modified_ns INTEGER,
                created_ns INTEGER,extension TEXT,category TEXT NOT NULL,seen_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS file_category ON files(category);
            CREATE TABLE IF NOT EXISTS issues(
                path TEXT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,
                seen_at TEXT NOT NULL,PRIMARY KEY(path,kind));
            CREATE TABLE IF NOT EXISTS counters(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
        """)
        prior = self.connection.execute("SELECT value FROM meta WHERE key='root'").fetchone()
        if prior and os.path.normcase(prior[0]) != os.path.normcase(str(self.root)):
            raise ValueError("State belongs to another root; choose a different --state-dir")
        root_stat = self.root.stat(follow_symlinks=False)
        if not stat.S_ISDIR(root_stat.st_mode) or is_reparse(root_stat):
            raise ValueError("Root must be a real directory, not a link or reparse point")
        with self.connection:
            self.connection.execute("INSERT OR IGNORE INTO meta VALUES('root',?)", (str(self.root),))
            self.connection.execute("INSERT OR IGNORE INTO meta VALUES('started_at',?)", (utc(),))
            self.connection.execute("UPDATE directories SET state='pending' WHERE state='working'")
            self.add_directory(str(self.root))
            self.recount()

    def close(self):
        self.connection.close()

    def bump(self, key, amount=1):
        self.connection.execute("INSERT INTO counters VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=value+excluded.value", (key, amount))

    def recount(self):
        c = self.connection
        c.execute("DELETE FROM counters")
        for row in c.execute("SELECT category,count(*) n,coalesce(sum(size),0) bytes FROM files GROUP BY category").fetchall():
            self.bump("category:" + row["category"], row["n"])
            self.bump("files", row["n"])
            self.bump("bytes_inventoried", row["bytes"])
        for row in c.execute("SELECT state,count(*) n FROM directories GROUP BY state").fetchall():
            self.bump("directories:" + row["state"], row["n"])
        for row in c.execute("SELECT kind,count(*) n FROM issues GROUP BY kind").fetchall():
            self.bump("issues:" + row["kind"], row["n"])

    def add_directory(self, path):
        try:
            path.encode('utf-8')
        except UnicodeEncodeError:
            self.issue(path, 'skipped', 'Directory name contains an unpaired UTF-16 code unit; escaped path retained, source untouched, directory not traversed.')
            return
        cur = self.connection.execute("INSERT OR IGNORE INTO directories(path,discovered_at) VALUES(?,?)", (path, utc()))
        if cur.rowcount:
            self.bump("directories:pending")

    def set_directory(self, path, state, error=None):
        old = self.connection.execute("SELECT state FROM directories WHERE path=?", (path,)).fetchone()[0]
        if old != state:
            self.bump("directories:" + old, -1)
            self.bump("directories:" + state)
        self.connection.execute("UPDATE directories SET state=?,completed_at=?,error=? WHERE path=?", (state, utc() if state in ("done", "error", "skipped") else None, error, path))

    def issue(self, path, kind, message):
        path = str(path)
        try:
            path.encode('utf-8')
        except UnicodeEncodeError:
            path = 'escaped-utf16:' + path.encode('utf-8', 'backslashreplace').decode('utf-8')
        message = message.encode('utf-8', 'backslashreplace').decode('utf-8')
        cur = self.connection.execute("INSERT OR IGNORE INTO issues VALUES(?,?,?,?)", (path, kind, message[:1000], utc()))
        if cur.rowcount:
            self.bump("issues:" + kind)

    def add_file(self, path, st):
        try:
            path.encode('utf-8')
        except UnicodeEncodeError:
            self.issue(path, 'skipped', 'File name contains an unpaired UTF-16 code unit; escaped path retained and source untouched.')
            return
        kind = category(path)
        old = self.connection.execute("SELECT size,category FROM files WHERE path=?", (path,)).fetchone()
        self.connection.execute("""INSERT INTO files VALUES(?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
            size=excluded.size,modified_ns=excluded.modified_ns,created_ns=excluded.created_ns,
            extension=excluded.extension,category=excluded.category,seen_at=excluded.seen_at""",
            (path, st.st_size, st.st_mtime_ns, getattr(st, "st_birthtime_ns", st.st_ctime_ns), Path(path).suffix.lower(), kind, utc()))
        if old:
            self.bump("bytes_inventoried", st.st_size - old["size"])
            if old["category"] != kind:
                self.bump("category:" + old["category"], -1)
                self.bump("category:" + kind)
        else:
            self.bump("files")
            self.bump("category:" + kind)
            self.bump("bytes_inventoried", st.st_size)

    def publish(self, state, force=False):
        if not force and time.monotonic() - self.last_publish < 2:
            return
        self.connection.commit()
        self.dirty = 0
        counts = dict(self.connection.execute("SELECT key,value FROM counters").fetchall())
        directory_states = {key: counts.get("directories:" + key, 0) for key in ("pending", "working", "done", "error", "skipped")}
        relative = os.path.relpath(self.current or str(self.root), self.root)
        payload = {
            "schema_version": 1, "status": state, "pid": os.getpid(), "root": str(self.root),
            "started_at": self.connection.execute("SELECT value FROM meta WHERE key='started_at'").fetchone()[0],
            "heartbeat_at": utc(), "current_directory": self.current,
            "current_top_level": relative.split(os.sep)[0] if relative != "." else "(root)",
            "metadata_only": True, "content_files_read": 0,
            "coverage": "File names, size and timestamps only. No content ingestion, source execution or source hashes.",
            "progress_percent": 100 if state == "complete" else None,
            "files_count": counts.get("files", 0), "bytes_inventoried": counts.get("bytes_inventoried", 0),
            "categories": {key: counts.get("category:" + key, 0) for key in (*GROUPS.keys(), "other")},
            "directories": {"discovered": sum(directory_states.values()), **directory_states},
            "skips_count": counts.get("issues:skipped", 0), "errors_count": counts.get("issues:error", 0),
            "recent_issues": [dict(row) for row in self.connection.execute("SELECT path,kind,message,seen_at FROM issues ORDER BY seen_at DESC LIMIT 8")],
            "database": str(self.state_dir / "census.sqlite3"), "pause_marker": str(self.pause_path),
            "limits": "Changed or deleted files in completed directories need a future refresh pass; initial traversal is resumable, not a filesystem snapshot.",
        }
        temp = self.status_path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        # Windows readers/antivirus can briefly hold the old JSON without
        # FILE_SHARE_DELETE. Retry that short sharing conflict, not the scan.
        for attempt in range(6):
            try:
                os.replace(temp, self.status_path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(.05)
        self.last_publish = time.monotonic()

    def wait_if_paused(self):
        while self.pause_path.exists():
            self.publish("paused", force=True)
            time.sleep(2)

    def step(self, path):
        self.current = path
        self.set_directory(path, "working")
        self.publish("running", force=True)
        try:
            if not Path(path).is_relative_to(self.root):
                self.issue(path, "skipped", "Queued path is outside the configured root")
                self.set_directory(path, "skipped")
                return
            st = os.stat(path, follow_symlinks=False)
            if is_reparse(st):
                self.issue(path, "skipped", "Directory is a symlink or Windows reparse point")
                self.set_directory(path, "skipped")
                return
            parent = Path(path).parent
            while parent != self.root and parent.is_relative_to(self.root):
                if is_reparse(os.stat(parent, follow_symlinks=False)):
                    self.issue(path, "skipped", "Queued directory has a reparse-point ancestor")
                    self.set_directory(path, "skipped")
                    return
                parent = parent.parent
            with os.scandir(path) as entries:
                for entry in entries:
                    self.wait_if_paused()
                    try:
                        st = entry.stat(follow_symlinks=False)
                        if is_reparse(st):
                            self.issue(entry.path, "skipped", "Symlink or Windows reparse point; not followed")
                        elif stat.S_ISDIR(st.st_mode):
                            if os.path.normcase(os.path.abspath(entry.path)) == os.path.normcase(str(self.state_dir)):
                                self.issue(entry.path, "skipped", "Census state directory excluded from source scan")
                            else:
                                self.add_directory(entry.path)
                        elif stat.S_ISREG(st.st_mode):
                            self.add_file(entry.path, st)
                        else:
                            self.issue(entry.path, "skipped", "Not a regular file or directory")
                    except OSError as exc:
                        self.issue(entry.path, "error", f"{type(exc).__name__}: {exc}")
                    self.dirty += 1
                    if self.dirty >= self.commit_every:
                        self.connection.commit()
                        self.dirty = 0
                    self.publish("running")
            self.set_directory(path, "done")
        except OSError as exc:
            self.issue(path, "error", f"{type(exc).__name__}: {exc}")
            self.set_directory(path, "error", str(exc)[:1000])
        self.connection.commit()

    def run(self, batch=0):
        processed = 0
        self.publish("running", force=True)
        try:
            while True:
                self.wait_if_paused()
                row = self.connection.execute("SELECT path FROM directories WHERE state='pending' ORDER BY discovered_at,path LIMIT 1").fetchone()
                if not row:
                    self.current = ""
                    self.publish("complete", force=True)
                    return "complete"
                if batch and processed >= batch:
                    self.publish("batch_complete", force=True)
                    return "batch_complete"
                self.step(row[0])
                processed += 1
        except KeyboardInterrupt:
            self.publish("interrupted", force=True)
            return "interrupted"
        except Exception:
            self.publish("error", force=True)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default="F:\\")
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--once", action="store_true", help="Finish the initial inventory then exit (default)")
    parser.add_argument("--batch", type=int, default=0, help="Maximum directories this invocation; zero means all")
    parser.add_argument("--pause", action="store_true", help="Create pause marker; worker remains alive")
    parser.add_argument("--resume", action="store_true", help="Remove pause marker; start worker separately if it exited")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    if args.pause:
        (args.state_dir / "PAUSE").write_text(utc(), encoding="utf-8")
        print("Pause requested")
        return
    if args.resume:
        (args.state_dir / "PAUSE").unlink(missing_ok=True)
        print("Pause marker removed")
        return
    if args.status:
        path = args.state_dir / "status.json"
        print(path.read_text(encoding="utf-8") if path.exists() else '{"status":"not_started"}')
        return
    if args.batch < 0:
        parser.error("--batch cannot be negative")
    with SingleWriter(args.state_dir):
        worker = Census(args.root, args.state_dir)
        try:
            print(worker.run(args.batch))
        finally:
            worker.close()


if __name__ == "__main__":
    main()
