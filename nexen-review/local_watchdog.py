"""Local fixed-target lifecycle: NEXEN UI, metadata census and local digest.

No model prompts, billing, arbitrary commands or process termination. Windows must
be awake and this user's session available; Startup launches this after login.
"""
from __future__ import annotations
import sys
sys.dont_write_bytecode = True
import argparse
import ctypes
import hashlib
import json
import logging
import logging.handlers
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from file_census import SingleWriter
from storage_policy import require_output_path, tool_environment

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
STATE = DATA / "watchdog"
SERVICE_ROOT = Path('H:/NEXEN/services')
# Use the interpreter that bootstrapped this watchdog. During the F: migration
# the verified D: venv supplies dependencies; all app code and state remain on F:.
PYTHONW = Path(sys.executable).with_name("pythonw.exe")
HUB = "http://127.0.0.1:8788"
LOG_LIMIT = 1024 * 1024


def stamp(ts=None):
    return datetime.fromtimestamp(time.time() if ts is None else ts, timezone.utc).isoformat()


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def atomic_json(path, data):
    path = require_output_path(path)
    temp = require_output_path(path.with_suffix(".json.tmp"), within=path.parent)
    temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(temp, path)


class WindowsMutex:
    """Kernel-held lock disappears on exit/crash; a second watchdog exits."""
    def __init__(self, kernel=None):
        self.kernel = kernel
        self.handle = None

    def __enter__(self):
        kernel = self.kernel
        if kernel is None:
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
            kernel.CreateMutexW.restype = ctypes.c_void_p
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel.GetLastError.restype = ctypes.c_ulong
            self.kernel = kernel
        name = "Local\\NEXEN_Local_Watchdog_" + hashlib.sha256(str(BASE).lower().encode()).hexdigest()[:20]
        self.handle = kernel.CreateMutexW(None, False, name)
        error = kernel.GetLastError()
        if not self.handle:
            raise OSError(error, "Cannot create watchdog mutex")
        if error == 183:
            kernel.CloseHandle(self.handle)
            self.handle = None
            raise RuntimeError("NEXEN local watchdog is already running")
        return self

    def __exit__(self, *_):
        if self.handle:
            self.kernel.CloseHandle(self.handle)


def hub_request(path, method="GET"):
    headers = {"Content-Type": "application/json", "Origin": HUB, "X-Nexen-Local": "1"}
    if path == '/api/hub/digest':
        service_key = DATA / 'auth' / 'service.key'
        try:
            key = service_key.read_text(encoding='utf-8').strip()
            if key and len(key) <= 512:
                headers['X-Nexen-Service'] = key
        except OSError:
            pass
    request = urllib.request.Request(HUB + path, method=method,
        data=b"{}" if method == "POST" else None,
        headers=headers)
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.loads(response.read(1024 * 1024))


def hub_listening():
    try:
        with socket.create_connection(("127.0.0.1", 8788), timeout=1):
            return True
    except OSError:
        return False


def census_locked():
    path = require_output_path(DATA / "census")
    path.mkdir(parents=True, exist_ok=True)
    try:
        with SingleWriter(path):
            return False
    except RuntimeError:
        return True


def logger_for(name, directory):
    directory = require_output_path(directory)
    logfile = require_output_path(directory / (name + '.log'), within=directory)
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.handlers.RotatingFileHandler(logfile, maxBytes=LOG_LIMIT, backupCount=2, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        logger.addHandler(handler)
    return logger


def capture_output(process, logger):
    def read():
        if process.stdout is None:
            return
        try:
            while True:
                chunk = process.stdout.read(4096)
                if not chunk:
                    break
                logger.info(chunk.decode("utf-8", "replace").rstrip())
        except (OSError, ValueError):
            pass
        finally:
            process.stdout.close()
    threading.Thread(target=read, daemon=True, name="nexen-child-log").start()


class Watchdog:
    def __init__(self, directory=STATE, request=hub_request, listening=hub_listening,
                 spawn=subprocess.Popen, locked=census_locked, now=time.time):
        self.directory = require_output_path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.status_path = self.directory / "status.json"
        self.request, self.listening, self.spawn, self.locked, self.now = request, listening, spawn, locked, now
        self.log = logger_for("watchdog-" + hashlib.sha256(str(directory).encode()).hexdigest()[:8], self.directory)
        old = read_json(self.status_path)
        self.launch_history = old.get("launch_history", {"hub": [], "census": []})
        self.last_digest = old.get("last_digest_at_unix", 0)
        self.cooldowns = old.get("cooldown_until_unix", {})
        self.app_process = self.census_process = None
        self.unavailable_since = None
        self.started = self.now()
        self.last_state = None
        self.state = {}

    def allowed(self, target):
        now = self.now()
        history = [t for t in self.launch_history.get(target, []) if now - t < 600]
        self.launch_history[target] = history
        until = self.cooldowns.get(target, 0)
        if until > now:
            return False
        if len(history) >= 3:
            self.cooldowns[target] = now + 900
            return False
        return True

    def launch(self, target):
        # Targets and arguments are code-owned; no UI/source text enters this command.
        commands = {
            "hub": [str(PYTHONW), str(BASE / "nexen.py"), "serve"],
            "census": [str(PYTHONW), str(BASE / "file_census.py"), "--root", "F:\\", "--once"],
        }
        if target not in commands:
            raise ValueError('Unknown fixed watchdog target.')
        if not self.allowed(target):
            return None
        self.launch_history.setdefault(target, []).append(self.now())
        # Persist attempted launches before spawn, so repeated crashes keep the ceiling.
        self.save()
        try:
            # Each local child gets owned H/F cache/profile paths, even if this
            # watchdog was invoked directly rather than through a wrapper.
            environment = tool_environment(SERVICE_ROOT / target)
            process = self.spawn(commands[target], cwd=str(require_output_path(BASE)), env=environment, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            capture_output(process, logger_for("child-" + target, self.directory))
            self.log.info("Started fixed target %s, launcher PID %s", target, process.pid)
            return process
        except (OSError, ValueError) as exc:
            self.log.error("Launch %s failed: %s", target, type(exc).__name__)
            self.state["last_error"] = f"{target}: {type(exc).__name__}"
            return None

    def save(self):
        self.state.update({
            "schema_version": 1, "pid": os.getpid(), "heartbeat_at": stamp(self.now()),
            "started_at": stamp(self.started), "launch_history": self.launch_history,
            "cooldown_until_unix": self.cooldowns, "last_digest_at_unix": self.last_digest,
            "limits": "Runs while Windows is awake. Starts after this user logs in. No cloud prompts or ad spending.",
        })
        atomic_json(self.status_path, self.state)

    def pause_census(self, paused):
        marker = require_output_path(DATA / "census" / "PAUSE")
        owned_text = "watchdog:global-pause"
        marker.parent.mkdir(parents=True, exist_ok=True)
        if paused and not marker.exists():
            marker.write_text(owned_text, encoding="utf-8")
        elif not paused and marker.exists():
            try:
                if marker.read_text(encoding="utf-8") == owned_text:
                    marker.unlink()
            except OSError:
                pass

    def tick(self, paused=None):
        now = self.now()
        if paused is None:
            paused = (DATA / "PAUSE_AUTONOMY").exists()
        self.state["paused"] = paused
        self.state["status"] = "paused" if paused else "running"
        self.pause_census(paused)
        if self.app_process is not None and self.app_process.poll() is not None:
            self.state["last_hub_exit_code"] = self.app_process.returncode
            self.app_process = None
        if self.census_process is not None and self.census_process.poll() is not None:
            self.state["last_census_exit_code"] = self.census_process.returncode
            self.census_process = None
        try:
            reply = self.request("/healthz")
            healthy = isinstance(reply, dict) and "status" in reply
        except (OSError, ValueError, urllib.error.URLError):
            healthy = False
        if healthy:
            self.unavailable_since = None
            self.state["hub"] = "healthy_owned" if self.app_process is not None else "healthy_attached"
            self.state["last_hub_ok_at"] = stamp(now)
        elif self.listening():
            self.unavailable_since = None
            self.state["hub"] = "unresponsive_owned_no_kill" if self.app_process is not None else "unresponsive_unknown_owner_no_kill"
        elif self.app_process is not None:
            self.state["hub"] = "starting_owned"
        else:
            if self.unavailable_since is None:
                self.unavailable_since = now
            self.state["hub"] = "waiting_to_restart"
            if now - self.unavailable_since >= 10 and not self.listening():
                self.app_process = self.launch("hub")
                self.state["hub"] = "starting_owned" if self.app_process is not None else "restart_cooldown"
                self.unavailable_since = now
        self.state["hub_owned_launcher_pid"] = self.app_process.pid if self.app_process else None
        if paused:
            self.state["digest"] = "paused"
        elif healthy and now - self.last_digest >= 900:
            try:
                digest = self.request("/api/hub/digest", "POST")
                self.state["digest"] = digest.get("status", "refreshed")
                self.state["digest_messages"] = len(digest.get("messages", []))
                self.last_digest = now
            except (OSError, ValueError, urllib.error.URLError) as exc:
                self.state["digest"] = "failed:" + type(exc).__name__
                # Retry after one minute, not every loop.
                self.last_digest = now - 840
        census = read_json(DATA / "census" / "status.json")
        if paused:
            self.state["census"] = "paused"
        elif census.get("status") == "complete":
            self.state["census"] = "complete"
        elif self.locked():
            self.state["census"] = "attached_worker_locked"
        elif self.census_process is not None:
            self.state["census"] = "starting_owned"
        elif (DATA / "census" / "PAUSE").exists():
            self.state["census"] = "independently_paused"
        else:
            self.census_process = self.launch("census")
            self.state["census"] = "starting_owned" if self.census_process is not None else "restart_cooldown"
        self.state["census_owned_launcher_pid"] = self.census_process.pid if self.census_process else None
        self.state["census_heartbeat_at"] = census.get("heartbeat_at")
        self.state["census_files_count"] = census.get("files_count", 0)
        state_key = (self.state.get("hub"), self.state.get("census"), self.state.get("paused"))
        if state_key != self.last_state:
            self.log.info("State hub=%s census=%s paused=%s", *state_key)
            self.last_state = state_key
        self.save()
        return dict(self.state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="One lifecycle check")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    if args.status:
        print(json.dumps(read_json(STATE / "status.json"), indent=2))
        return
    require_output_path(STATE)
    os.environ.update(tool_environment(SERVICE_ROOT / 'watchdog'))
    require_output_path(STATE).mkdir(parents=True, exist_ok=True)
    try:
        with WindowsMutex():
            watchdog = Watchdog()
            while True:
                try:
                    watchdog.tick()
                except Exception as exc:
                    watchdog.log.exception("Lifecycle check failed: %s", type(exc).__name__)
                    watchdog.state["status"] = "error"
                    watchdog.state["last_error"] = type(exc).__name__
                    watchdog.save()
                if args.once:
                    return
                time.sleep(15)
    except RuntimeError:
        # Expected idempotent double start; the existing watchdog keeps working.
        return


if __name__ == "__main__":
    main()
