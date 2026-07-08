#!/usr/bin/env python3
"""
HTTP bridge: production Denizen server → your PC's Grok CLI for in-game Grok chat.

Run on the PC where `grok` is installed and denizen-grok MCP is wired:

  py infra/run-grok-cli-chat-bridge.py
  py infra/run-grok-cli-chat-bridge.py --port 9876

On the NAS / server container, set:

  GROK_CLI_BRIDGE_URL=http://<your-pc-tailscale-ip>:9876
  GROK_CLI_BRIDGE_TOKEN=<same as --token below>

In Grok SOUL.md:

  ## Chat Provider
  grok-cli

Expose port 9876 to the NAS (Tailscale recommended). Do not expose publicly without a strong token.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

GROK_BIN = Path(os.environ.get("GROK_BIN", Path.home() / ".grok" / "bin" / "grok"))
if os.name == "nt" and not GROK_BIN.suffix:
    GROK_BIN = GROK_BIN.with_suffix(".exe")
DENIZEN_ROOT = REPO / "denizen"
DEFAULT_TOKEN = os.environ.get("GROK_CLI_BRIDGE_TOKEN", "")


def format_messages(messages: list) -> str:
    lines = []
    for m in messages or []:
        role = str(m.get("role") or m.get("from") or "user").lower()
        label = "Grok" if role in ("assistant", "npc") else "CEO"
        text = str(m.get("content") or m.get("text") or "").strip()
        if text:
            lines.append(f"{label}: {text}")
    return "\n".join(lines)


def build_prompt(body: dict) -> str:
    system = str(body.get("system_prompt") or "").strip()
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    history = format_messages(messages)
    latest = ""
    for m in reversed(messages):
        if str(m.get("role") or "user").lower() in ("user", "ceo"):
            latest = str(m.get("content") or m.get("text") or "").strip()
            break
    return (
        f"{system}\n\n"
        "You are Grok in the Denizen pixel office. The CEO is chatting in-game. "
        "Use denizen-grok MCP for live office tools when needed.\n\n"
        + (f"## Recent chat\n{history}\n\n" if history else "")
        + f"## Latest message from CEO\n{latest or '(empty)'}\n\n"
        "Reply in character — concise, helpful."
    )


def ask_grok(prompt: str, timeout_s: int) -> str:
    proc = subprocess.run(
        [str(GROK_BIN), "-p", prompt,
         "--append-system-prompt", "You have denizen-grok MCP wired on this machine."],
        cwd=str(DENIZEN_ROOT),
        capture_output=True,
        text=True,
        timeout=max(10, timeout_s),
    )
    out = (proc.stdout or "").strip()
    if out:
        return out
    err = (proc.stderr or proc.stdout or f"exit {proc.returncode}").strip()
    raise RuntimeError(err[:400])


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "GrokCLIChatBridge/1.0"
    auth_token = ""

    def log_message(self, fmt: str, *args) -> None:
        print(f"[bridge] {self.address_string()} {fmt % args}", flush=True)

    def _check_auth(self) -> bool:
        if not self.auth_token:
            return True
        auth = self.headers.get("Authorization", "")
        want = f"Bearer {self.auth_token}"
        return auth == want

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "grok_bin": str(GROK_BIN),
                "grok_exists": GROK_BIN.is_file(),
            }).encode())
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/chat":
            self.send_error(404)
            return
        if not self._check_auth():
            self.send_error(401)
            return
        if not GROK_BIN.is_file():
            self.send_error(503, explain="Grok CLI not found")
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400)
            return
        timeout_ms = int(body.get("timeout_ms") or 180_000)
        try:
            text = ask_grok(build_prompt(body), timeout_ms // 1000)
        except subprocess.TimeoutExpired:
            self.send_response(504)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": "Grok CLI timed out"}).encode())
            return
        except Exception as exc:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": str(exc)}).encode())
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "text": text}).encode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=int(os.environ.get("GROK_CLI_BRIDGE_PORT", "9876")))
    ap.add_argument("--token", default=DEFAULT_TOKEN or secrets.token_urlsafe(24))
    args = ap.parse_args()

    if not GROK_BIN.is_file():
        print(f"ERROR: Grok CLI not found at {GROK_BIN}")
        return 1

    BridgeHandler.auth_token = str(args.token).strip()
    httpd = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    print(f"==> Grok CLI chat bridge on http://{args.host}:{args.port}")
    print(f"    Health: GET /health")
    print(f"    Chat:   POST /chat")
    if BridgeHandler.auth_token:
        print(f"    Token:  {BridgeHandler.auth_token}")
        print("    Set on NAS: GROK_CLI_BRIDGE_URL + GROK_CLI_BRIDGE_TOKEN")
    print(f"    Grok:   {GROK_BIN}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
