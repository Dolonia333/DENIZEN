#!/usr/bin/env python3
"""
HTTP bridge: production Denizen server → your PC's Claude Code CLI for in-game Claude chat.

Run on the PC where `claude` is installed and denizen-claude MCP is wired:

  py infra/run-claude-cli-chat-bridge.py
  py infra/run-claude-cli-chat-bridge.py --port 9877

On the NAS / server container, set:

  CLAUDE_CLI_BRIDGE_URL=http://<your-pc-tailscale-ip>:9877
  CLAUDE_CLI_BRIDGE_TOKEN=<same as --token below>

In Claude SOUL.md:

  ## Provider
  lmstudio

  ## Chat Provider
  claude-cli

Expose port 9877 to the NAS (Tailscale recommended). Do not expose publicly without a strong token.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

_default = Path.home() / ".local" / "bin" / ("claude.exe" if os.name == "nt" else "claude")
CLAUDE_BIN = Path(os.environ.get("CLAUDE_BIN", str(_default if _default.is_file() else "claude")))
DENIZEN_ROOT = REPO / "denizen"
DEFAULT_TOKEN = os.environ.get("CLAUDE_CLI_BRIDGE_TOKEN", "")


def resolve_claude_bin() -> str:
    if CLAUDE_BIN.is_file():
        return str(CLAUDE_BIN)
    found = shutil.which("claude")
    if found:
        return found
    return str(CLAUDE_BIN)


def format_messages(messages: list) -> str:
    lines = []
    for m in messages or []:
        role = str(m.get("role") or m.get("from") or "user").lower()
        label = "Claude" if role in ("assistant", "npc") else "CEO"
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
        "You are Claude in the Denizen pixel office. The CEO is chatting in-game. "
        "Use denizen-claude MCP for live office tools when needed. "
        "Answer simple questions directly (including that you are subscription Claude CLI for chat).\n\n"
        + (f"## Recent chat\n{history}\n\n" if history else "")
        + f"## Latest message from CEO\n{latest or '(empty)'}\n\n"
        "Reply in character — concise, helpful."
    )


def ask_claude(prompt: str, timeout_s: int) -> str:
    bin_path = resolve_claude_bin()
    proc = subprocess.run(
        [
            bin_path,
            "-p",
            prompt,
            "--append-system-prompt",
            "You have denizen-claude MCP wired on this machine.",
        ],
        cwd=str(DENIZEN_ROOT),
        capture_output=True,
        text=True,
        timeout=max(10, timeout_s),
        shell=(os.name == "nt"),
    )
    out = (proc.stdout or "").strip()
    if out:
        return out
    err = (proc.stderr or proc.stdout or f"exit {proc.returncode}").strip()
    raise RuntimeError(err[:400])


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "ClaudeCLIChatBridge/1.0"
    auth_token = ""

    def log_message(self, fmt: str, *args) -> None:
        print(f"[claude-bridge] {self.address_string()} {fmt % args}", flush=True)

    def _check_auth(self) -> bool:
        if not self.auth_token:
            return True
        auth = self.headers.get("Authorization", "")
        want = f"Bearer {self.auth_token}"
        return auth == want

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            bin_path = resolve_claude_bin()
            exists = Path(bin_path).is_file() or shutil.which(bin_path) is not None
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "claude_bin": bin_path,
                "claude_exists": exists,
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
        bin_path = resolve_claude_bin()
        if not (Path(bin_path).is_file() or shutil.which(bin_path)):
            self.send_error(503, explain="Claude CLI not found")
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
            text = ask_claude(build_prompt(body), timeout_ms // 1000)
        except subprocess.TimeoutExpired:
            self.send_response(504)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": "Claude CLI timed out"}).encode())
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
    ap.add_argument("--port", type=int, default=int(os.environ.get("CLAUDE_CLI_BRIDGE_PORT", "9877")))
    ap.add_argument("--token", default=DEFAULT_TOKEN or secrets.token_urlsafe(24))
    args = ap.parse_args()

    bin_path = resolve_claude_bin()
    if not (Path(bin_path).is_file() or shutil.which(bin_path)):
        print(f"ERROR: Claude CLI not found (tried {bin_path})")
        return 1

    BridgeHandler.auth_token = str(args.token).strip()
    httpd = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    print(f"==> Claude CLI chat bridge on http://{args.host}:{args.port}")
    print(f"    Health: GET /health")
    print(f"    Chat:   POST /chat")
    if BridgeHandler.auth_token:
        print(f"    Token:  {BridgeHandler.auth_token}")
        print("    Set on NAS: CLAUDE_CLI_BRIDGE_URL + CLAUDE_CLI_BRIDGE_TOKEN")
    print(f"    Claude: {bin_path}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
