#!/usr/bin/env python3
"""Static NEXEN UI demo for the public review snapshot.

The filtered review tree is not a full runnable app (see REVIEW-SCOPE.md).
This server serves the included HTML/CSS/JS with stub APIs and placeholder
branding so reviewers can browse the Command Center, login, and game shells
without private config, databases, or excluded Python modules.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
BRANDING = ROOT / "demo" / "branding"
WORLD = ROOT / "world-assets"

# Pretty paths used by the real FastAPI hub → flat HTML files in this snapshot.
PAGE_MAP = {
    "/": "hub.html",
    "/login": "login.html",
    "/game": "game.html",
    "/money": "money.html",
    "/next": "next.html",
    "/voice": "voice.html",
    "/storage": "storage.html",
    "/connections": "connections.html",
    "/check-in": "check-in.html",
    "/photos": "photos.html",
    "/problems": "problems.html",
    "/problem-cases": "problem-cases.html",
    "/memory-pools": "memory-pools.html",
    "/automatic-mode": "automatic-mode.html",
    "/desktop": "desktop.html",
    "/lookbook": "lookbook.html",
    "/kilo": "kilo.html",
    "/agents": "agents-console.html",
    "/agentic-os": "agentic-os.html",
    "/code-review": "code-review.html",
    "/youtube-memory": "youtube-memory.html",
    "/continuity": "continuity.html",
    "/readiness": "v1-readiness.html",
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def stub_api(path: str, query: dict[str, list[str]]) -> tuple[int, dict | list]:
    """Return demo JSON for hub/page fetches. Not production behavior."""
    if path == "/api/auth/session":
        # Stay unlocked for page shells; login.html can still render the unlock form.
        return 200, {
            "authenticated": False,
            "configured": True,
            "can_setup": True,
            "supported_destinations": sorted(PAGE_MAP.keys()),
            "demo": True,
        }
    if path in ("/api/auth/login", "/api/auth/setup", "/api/auth/logout"):
        return 200, {"ok": True, "authenticated": True, "demo": True}
    if path == "/api/hub":
        return 200, {
            "skills": 42,
            "points": 12,
            "brief": "DEMO MODE — review snapshot only. No local workers, databases, or private folders are attached.",
            "status": {
                "files_indexed": 128,
                "queued_jobs": 0,
                "running_jobs": 0,
                "failed_jobs": 0,
                "compiled_workflows": 3,
                "awaiting_approval": 1,
            },
            "requests": [
                {
                    "id": 1,
                    "text": "Demo planned request: review NEXEN command center UI.",
                    "status": "planned",
                    "created_at": _now(),
                }
            ],
            "collections": [
                {"collection": "skills", "count": 24},
                {"collection": "agents", "count": 18},
            ],
            "demo": True,
        }
    if path == "/api/hub/control":
        return 200, {
            "memory": {"messages": 0, "message_count": 0},
            "memory_messages": 0,
            "census": {"files_count": 128},
            "autonomy": {"paused": True},
            "services": [
                {"name": "NEXEN demo UI", "status": "online", "detail": "Static review demo server"},
                {"name": "Workers / models", "status": "unavailable", "detail": "Excluded from review snapshot"},
            ],
            "demo": True,
        }
    if path in ("/api/hub/digest",):
        return 200, {
            "coverage": "Demo digest — no Discord archive in this snapshot.",
            "messages": [],
            "demo": True,
        }
    if path == "/api/hub/request":
        return 200, {
            "id": 2,
            "status": "planned",
            "message": "Saved in demo mode only. No execution adapter is attached.",
            "demo": True,
        }
    if path == "/api/hub/autonomy":
        return 200, {"paused": True, "detail": "Demo mode: autonomy is not connected.", "demo": True}
    if path == "/api/pc/apps":
        return 200, {"apps": [], "demo": True}
    if path == "/api/skills":
        q = (query.get("q") or [""])[0]
        rows = [
            {"id": "demo-video", "name": "Demo video skill", "collection": "skills", "description": "Placeholder skill for UI review."},
            {"id": "demo-design", "name": "Demo design skill", "collection": "skills", "description": "Placeholder skill for UI review."},
        ]
        if q:
            rows = [r for r in rows if q.lower() in (r["name"] + r["description"]).lower()]
        return 200, rows
    if path == "/api/memory":
        return 200, {"results": [], "status": "not_indexed", "coverage": "No conversation exports in review snapshot.", "demo": True}
    if path == "/api/music":
        return 200, {"tracks": [], "coverage": "No local music library in review snapshot.", "demo": True}
    if path == "/api/money/status":
        gates = [
            {
                "id": "supplier",
                "title": "Confirm fulfillment costs",
                "detail": "Demo gate — supplier evidence is not in this snapshot.",
                "href": "/connections",
                "action": "Open needs-you",
                "state": "unverified",
                "provider_verified": False,
            },
            {
                "id": "checkout",
                "title": "Finish payments and test checkout",
                "detail": "Demo gate — checkout is not connected here.",
                "href": "/connections",
                "action": "Open needs-you",
                "state": "incomplete",
                "provider_verified": False,
            },
        ]
        return 200, {
            "updated_at": _now(),
            "demo": True,
            "inputs": {
                "values": {
                    "price_cents": 3499,
                    "supplier_cost_cents": None,
                    "shipping_cents": None,
                    "packaging_cents": None,
                    "payment_fees_cents": None,
                    "refund_reserve_cents": None,
                }
            },
            "calculator": {
                "complete": False,
                "missing": [
                    "supplier_cost_cents",
                    "shipping_cents",
                    "packaging_cents",
                    "payment_fees_cents",
                    "refund_reserve_cents",
                ],
                "landed_cost_cents": None,
                "variable_cost_cents": None,
                "contribution_before_ads_cents": None,
                "break_even_cac_cents": None,
                "orders_to_cover_50": None,
                "scenario_only": True,
                "excludes": ["fixed overhead", "taxes"],
                "forecast": False,
                "reason": "Demo mode — enter costs on a full local NEXEN install.",
            },
            "opportunities": [
                {
                    "id": 1,
                    "title": "Demo store opportunity",
                    "category": "store",
                    "status": "research",
                    "evidence": "Placeholder for UI review.",
                    "next_step": "Explore the Money Engine layout.",
                    "created_at": _now(),
                    "updated_at": _now(),
                }
            ],
            "task_progress": {
                "available": False,
                "total": None,
                "completed": None,
                "percent": None,
                "scope": "No task database in the review snapshot.",
            },
            "gates": gates,
            "readiness": {
                "can_execute_ads": False,
                "checkout_verified": False,
                "revenue_connected": False,
                "blockers": len(gates),
            },
            "budget": {
                "daily_cap_cents": 5000,
                "total_cap_cents": 5000,
                "automatically_restarts": False,
                "actual_spend_cents": None,
                "provider_enforcement_verified": False,
                "execution_enabled": False,
            },
            "revenue": {"actual_cents": None, "status": "not_connected"},
            "sources": {
                "formula": "https://legacy.sba.gov/business-guide/plan-your-business/calculate-your-startup-costs/break-even-point"
            },
            "notice": "DEMO MODE — statuses are stubs for layout review only.",
        }
    if path == "/api/money/workspace":
        return 200, {
            "demo": True,
            "tracks": [],
            "tasks": [],
            "offset": 0,
            "limit": 500,
            "total": 0,
            "notice": "Demo mode — money workspace has no local task DB.",
        }
    if path.startswith("/api/money/"):
        return 200, {"demo": True, "status": "stub", "path": path}
    if path.startswith("/api/"):
        return 200, {"demo": True, "status": "stub", "path": path, "detail": "API stub for UI review."}
    return 404, {"detail": "Not found"}


class DemoHandler(BaseHTTPRequestHandler):
    server_version = "NEXENDemo/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def _send(self, code: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-NEXEN-Demo", "1")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict | list) -> None:
        data = json.dumps(payload, indent=2).encode("utf-8")
        self._send(code, data, "application/json; charset=utf-8")

    def _file(self, path: Path, content_type: str | None = None) -> None:
        if not path.is_file():
            self._json(404, {"detail": f"Missing file: {path.name}"})
            return
        data = path.read_bytes()
        ctype = content_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype = f"{ctype}; charset=utf-8" if "charset" not in ctype else ctype
        self._send(200, data, ctype)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"", "text/plain", {"Allow": "GET, HEAD, POST, OPTIONS"})

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET(body=False)

    def do_GET(self, body: bool = True) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        query = parse_qs(parsed.query)

        if path == "/demo" or path == "/demo/":
            landing = (ROOT / "demo" / "index.html")
            return self._file(landing, "text/html; charset=utf-8") if body else self._send(200, b"", "text/html; charset=utf-8")

        if path.startswith("/branding/"):
            name = path[len("/branding/") :].lstrip("/")
            return self._file(BRANDING / name) if body else self._send(200, b"", "image/png")

        if path.startswith("/world-assets/"):
            rel = path[len("/world-assets/") :].lstrip("/")
            target = (WORLD / rel).resolve()
            if not str(target).startswith(str(WORLD.resolve())):
                return self._json(403, {"detail": "Forbidden"})
            return self._file(target) if body else self._send(200, b"", "application/octet-stream")

        if path.startswith("/api/"):
            code, payload = stub_api(path, query)
            data = json.dumps(payload).encode("utf-8")
            if not body:
                return self._send(code, b"", "application/json; charset=utf-8")
            return self._send(code, data, "application/json; charset=utf-8")

        page = PAGE_MAP.get(path)
        if page:
            return self._file(ROOT / page, "text/html; charset=utf-8") if body else self._send(200, b"", "text/html; charset=utf-8")

        # Allow direct file names for convenience (/hub.html).
        if path.endswith(".html") and (ROOT / path.lstrip("/")).is_file():
            return self._file(ROOT / path.lstrip("/"), "text/html; charset=utf-8")

        self._json(404, {"detail": f"No demo page for {path}", "try": sorted(PAGE_MAP)})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(min(length, 1_000_000))
        parsed = urlparse(self.path)
        code, payload = stub_api(parsed.path, parse_qs(parsed.query))
        self._json(code, payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the NEXEN review UI demo")
    parser.add_argument("--host", default=os.environ.get("NEXEN_DEMO_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("NEXEN_DEMO_PORT", "8765")))
    args = parser.parse_args()
    if not BRANDING.is_dir():
        raise SystemExit(f"Missing demo branding at {BRANDING}")
    httpd = ThreadingHTTPServer((args.host, args.port), DemoHandler)
    print(f"NEXEN demo UI → http://{args.host}:{args.port}/")
    print(f"Landing       → http://{args.host}:{args.port}/demo")
    print("Review snapshot only — stub APIs, no private data.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
