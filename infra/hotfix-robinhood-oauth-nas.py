#!/usr/bin/env python3
"""Deploy Robinhood OAuth redirect fix to NAS and reset stale localhost registration."""

from __future__ import annotations

import json
import load_infra_env  # noqa: F401

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
LOCAL_FILE = ROOT / "denizen" / "src" / "robinhood-mcp.js"
PUBLIC_URL = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud")
CHUNK = 1024 * 512


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str]:
    print("$", cmd[:120], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def stream_to_remote(client: paramiko.SSHClient, local_path: Path, remote_path: str) -> int:
    parent = remote_path.rsplit("/", 1)[0]
    run(client, f"mkdir -p '{parent}'")
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'", timeout=600)
    with open(local_path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            stdin.write(chunk)
    stdin.flush()
    stdin.channel.shutdown_write()
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    if not LOCAL_FILE.is_file():
        print(f"Missing {LOCAL_FILE}")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    remote_src = f"{REMOTE_DIR}/robinhood-mcp.js"
    if stream_to_remote(client, LOCAL_FILE, remote_src) != 0:
        return 1

    run(client, f"{DOCKER} cp '{remote_src}' denizen-server:/app/src/robinhood-mcp.js")

    # Do not wipe oauth token on code-only deploys.

    run(client, f"{DOCKER} restart denizen-server", timeout=120)
    run(client, f"sleep 8 && curl -fsS -m 15 http://127.0.0.1:{PORT}/api/health | head -c 400")

    code, status = run(
        client,
        f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/market/auth-status",
    )
    client.close()

    connect_url = f"{PUBLIC_URL.rstrip('/')}/api/market/auth/connect"
    print()
    print("==> Robinhood OAuth hotfix deployed")
    print(f"    Open in your browser (desktop): {connect_url}")
    print("    Log in to Robinhood and approve access.")
    print(f"    Then verify: {PUBLIC_URL.rstrip('/')}/api/market/auth-status")
    return 0 if code == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
