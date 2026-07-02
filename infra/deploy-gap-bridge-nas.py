#!/usr/bin/env python3
"""Deploy Roki/MCP/market gap-bridge files to NAS without touching oauth."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
DENIZEN = ROOT / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
CHUNK = 1024 * 512

SYNC_PATHS = [
    "server.js",
    "index.html",
    "src/spectate-routing.js",
    "npcs/roki/SOUL.md",
    "src/robinhood-mcp.js",
    "src/denizen-mcp-actions.js",
    "src/denizen-mcp-market-tools.js",
    "src/denizen-mcp-team-tools.js",
    "src/denizen-mcp-crm-tools.js",
    "src/denizen-mcp-scopes.js",
    "src/denizen-lazy-scripts.js",
    "src/denizen-mcp-team-gateway.js",
    "src/denizen-npc-mcp-gateway.js",
    "src/visitor-mcp-connect-ui.js",
    "src/denizen-mcp-market-tools.js",
    "src/denizen-market-scheduler.js",
    "src/denizen-phone-ui.js",
    "src/denizen-mcp-actions.js",
    "src/npc-brains.js",
    "src/visitor-market-panel.js",
    "jelly/skills/trade-suggest/index.js",
]


def run(client: paramiko.SSHClient, cmd: str) -> str:
    print("$", cmd[:110])
    _, o, e = client.exec_command(cmd, timeout=120)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


def stream_to_remote(client: paramiko.SSHClient, local_path: Path, remote_path: str) -> int:
    run(client, f"mkdir -p '{remote_path.rsplit('/', 1)[0]}'")
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'", timeout=600)
    with open(local_path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            stdin.write(chunk)
    stdin.flush()
    stdin.channel.shutdown_write()
    code = stdout.channel.recv_exit_status()
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    for rel in SYNC_PATHS:
        local = DENIZEN / rel
        if not local.is_file():
            print(f"WARN skip missing {rel}")
            continue
        remote = f"{REMOTE_DIR}/gap-bridge/{rel}"
        if stream_to_remote(client, local, remote) != 0:
            return 1
        run(client, f"{DOCKER} exec denizen-server mkdir -p /app/{rel.rsplit('/', 1)[0]}")
        run(client, f"{DOCKER} cp '{remote}' denizen-server:/app/{rel}")

    run(client, f"{DOCKER} restart denizen-server")
    time.sleep(10)
    print(run(client, f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/market/auth-status"))
    print(run(client, f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/intelligence/mirofish-status"))
    client.close()
    print("==> Gap-bridge deploy complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
