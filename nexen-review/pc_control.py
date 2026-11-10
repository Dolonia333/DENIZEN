"""Deliberate local desktop launches from NEXEN; no arbitrary PC commands.

The executable registry is code-owned. Source files, model output, and browser
requests cannot add launch targets or command arguments.
"""
from dataclasses import dataclass
import ipaddress
from pathlib import Path
import subprocess
import threading
import time
from typing import Callable

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from storage_policy import tool_environment


@dataclass(frozen=True)
class DesktopApp:
    id: str
    name: str
    executable: Path | None
    description: str
    unavailable_reason: str = "The verified desktop executable is not available."


# Verified against the existing registry and on-disk desktop executables.
# Discord and Claude pin a versioned directory intentionally: an update must
# be verified before this code is changed, rather than following user input.
APPS = (
    DesktopApp("flstudio", "FL Studio", Path("F:/FL STUDIO 24/FL64.exe"),
               "Open your music workspace."),
    DesktopApp("claude", "Claude Desktop",
               Path("C:/Program Files/WindowsApps/Claude_1.46388.4.0_x64__pzs8sxrjxfjjc/app/claude.exe"),
               "Open Claude Desktop; no prompt is submitted."),
    DesktopApp("discord", "Discord",
               Path("C:/Users/LOCAL_USER/AppData/Local/Discord/app-1.0.9238/lib/net45/Discord.exe"),
               "Open Discord; no message is sent."),
    DesktopApp("hermes", "Hermes", None,
               "A command-line agent is installed; a desktop launcher is not verified.",
               "Only the Hermes command-line agent was found. Use the agent controls separately."),
    DesktopApp("everything", "Everything Search",
               Path("F:/WDR_LIFEOS/NEXEN_TOOLS/Everything/Everything.exe"),
               "Search filenames across your drives."),
    DesktopApp("chrome", "Google Chrome",
               Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
               "Open your browser."),
)
APP_BY_ID = {item.id: item for item in APPS}
HOSTS = frozenset(("localhost:8788", "127.0.0.1:8788", "[::1]:8788"))
APP_COOLDOWN_SECONDS = 30.0
GLOBAL_COOLDOWN_SECONDS = 2.0
MUSIC_ROOT = Path('H:/NEXEN/music')
STORAGE_SETUP_REASON = 'H/F storage setup required. This desktop app has no verified NEXEN storage adapter.'


class LaunchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_-]+$")


def validate_context(client_host: str | None, host: str, origin: str | None = None,
                     action: str | None = None, *, mutation: bool = False) -> None:
    """Reject network callers, DNS rebinding, and cross-origin launch requests."""
    try:
        local = bool(client_host and ipaddress.ip_address(client_host).is_loopback)
    except ValueError:
        local = False
    if not local or host.lower() not in HOSTS:
        raise HTTPException(403, "PC controls are available only on the local NEXEN page.")
    if mutation and (origin != "http://" + host or action != "launch"):
        raise HTTPException(403, "Launch requires the same-origin NEXEN action header.")


def validate_request(request: Request, *, mutation: bool = False) -> None:
    # Multiple security headers are ambiguous; fail closed before interpreting them.
    names = ("host", "origin", "x-nexen-action") if mutation else ("host",)
    if any(len(request.headers.getlist(name)) != 1 for name in names):
        raise HTTPException(403, "Missing or duplicate PC control headers.")
    validate_context(request.client.host if request.client else None,
                     request.headers.get("host", ""), request.headers.get("origin"),
                     request.headers.get("x-nexen-action"), mutation=mutation)


def fl_adapter():
    """Reuse FL's actual user-data probe without requiring MP3 validation."""
    from music_render import NativeFL
    return NativeFL(root=MUSIC_ROOT)


def storage_status(item: DesktopApp) -> dict:
    """Report configured launch storage, not full third-party confinement."""
    result = {'state': 'needs_setup', 'configured_paths_verified': False,
              'allowed_drives': ['H:', 'F:'], 'third_party_write_confinement': False,
              'reason': STORAGE_SETUP_REASON}
    if item.id != 'flstudio':
        return result
    try:
        path = fl_adapter().user_data_path()
    except (OSError, ValueError, ImportError):
        result['reason'] = 'H/F storage setup required. FL Studio user-data settings could not be verified.'
        return result
    result.update(state='configured', configured_paths_verified=True,
                  fl_user_data=str(path), profile_root=str(MUSIC_ROOT), reason=None,
                  scope='Configured FL user data and NEXEN child profile/cache paths only; plugin-specific writes remain unverified.')
    return result


def app_status(item: DesktopApp) -> dict:
    installed = bool(item.executable and item.executable.is_file())
    storage = storage_status(item)
    available = installed and storage['configured_paths_verified']
    return {"id": item.id, "name": item.name, "description": item.description,
            "available": available, "installed": installed, 'storage': storage,
            "executable": str(item.executable) if item.executable else None,
            "reason": None if available else storage['reason'] or item.unavailable_reason}


class Launcher:
    def __init__(self, db, *, spawn: Callable | None = None, clock: Callable | None = None):
        self.db = db
        self.spawn = spawn or subprocess.Popen
        self.clock = clock or time.monotonic
        self.lock = threading.Lock()
        self.last_app: dict[str, float] = {}
        self.last_any: float | None = None

    def launch(self, app_id: str) -> dict:
        item = APP_BY_ID.get(app_id)
        if item is None:
            raise HTTPException(404, "Unknown desktop application.")
        status = app_status(item)
        if not status["available"]:
            raise HTTPException(409, status['reason'])
        with self.lock:
            now = self.clock()
            app_wait = APP_COOLDOWN_SECONDS - (now - self.last_app[app_id]) if app_id in self.last_app else 0
            global_wait = GLOBAL_COOLDOWN_SECONDS - (now - self.last_any) if self.last_any is not None else 0
            wait = max(app_wait, global_wait)
            if wait > 0:
                raise HTTPException(429, "Please wait before opening another application.",
                                    headers={"Retry-After": str(int(wait) + 1)})
            # Write the intended action before dispatch. A database failure must
            # never silently launch an unrecorded PC action.
            try:
                self.db.event("pc_launch_requested", f"Open {item.name}",
                              data={"app_id": app_id, "executable": str(item.executable)})
            except Exception as exc:
                raise HTTPException(503, "The action log is unavailable; nothing was launched.") from exc
            self.last_app[app_id] = now
            self.last_any = now
            try:
                # Re-read the actual setting after any earlier status check.
                # Opening the DAW does not require the MP3 validator dependency.
                adapter = fl_adapter()
                environment = tool_environment(MUSIC_ROOT)
                adapter.user_data_path()
                if adapter.running():
                    raise HTTPException(409, 'FL Studio is already running. Save and close that session before using the verified NEXEN launcher.')
            except (OSError, ValueError, ImportError, subprocess.SubprocessError) as exc:
                try:
                    self.db.event('pc_launch_blocked', 'Desktop storage or process verification failed',
                                  level='ERROR', data={'app_id': app_id, 'error_type': type(exc).__name__})
                except Exception:
                    pass
                raise HTTPException(409, 'H/F storage setup required. FL storage or process state could not be verified; nothing was launched.') from None
            try:
                process = self.spawn([str(item.executable)], shell=False,
                                     cwd=str(item.executable.parent), env=environment,
                                     stdin=subprocess.DEVNULL)
            except OSError as exc:
                self.db.event("pc_launch_failed", f"Could not open {item.name}", level="ERROR",
                              data={"app_id": app_id, "error_type": type(exc).__name__})
                raise HTTPException(502, "Windows could not start this application.") from exc
            result = {"status": "launch_requested", "id": app_id, "name": item.name,
                      "pid": process.pid, "cooldown_seconds": int(APP_COOLDOWN_SECONDS),
                      "storage": {'configured_paths_verified': True, 'allowed_drives': ['H:', 'F:'],
                                  'third_party_write_confinement': False},
                      "message": "Windows accepted the FL Studio launch with verified user-data storage and an H/F profile environment. Plugin-specific writes remain unverified."}
            try:
                self.db.event("pc_launch_started", f"Started {item.name}",
                              data={"app_id": app_id, "pid": process.pid})
            except Exception:
                result["audit_warning"] = "Launch was requested and recorded; completion logging failed."
            return result


def register(app, db):
    launcher = Launcher(db)

    @app.get("/api/pc/apps")
    def list_apps(request: Request):
        validate_request(request)
        return {"apps": [app_status(item) for item in APPS],
                "mode": "deliberate_desktop_launch",
                "description": "Open a desktop app only after its H/F storage adapter is verified. Other entries remain visible with setup blockers.",
                "cooldown_seconds": int(APP_COOLDOWN_SECONDS)}

    @app.post("/api/pc/launch")
    def launch_app(body: LaunchBody, request: Request):
        validate_request(request, mutation=True)
        return launcher.launch(body.id)

    return launcher
