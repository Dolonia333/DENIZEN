#!/usr/bin/env python3
"""Upload local data/robinhood-oauth.json to NAS denizen-server container."""

from __future__ import annotations

import json
import load_infra_env  # noqa: F401

import base64
import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
OAUTH_FILE = ROOT / "denizen" / "data" / "robinhood-oauth.json"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def run(client: paramiko.SSHClient, cmd: str) -> str:
    print("$", cmd[:110])
    _, o, e = client.exec_command(cmd, timeout=120)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


def main() -> int:
    if not OAUTH_FILE.is_file():
        print(f"Missing {OAUTH_FILE} — run node denizen/scripts/robinhood-local-oauth.js first")
        return 1
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required in infra/.env")
        return 1

    data = json.loads(OAUTH_FILE.read_text(encoding="utf-8"))
    if not data.get("access_token"):
        print("No access_token in robinhood-oauth.json — complete local OAuth first")
        return 1

    safe = {k: ("***" if k in ("access_token", "refresh_token", "pkce_verifier") else v) for k, v in data.items()}
    print("Uploading token:", json.dumps(safe, indent=2))

    b64 = base64.b64encode(json.dumps(data).encode()).decode()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    run(
        client,
        f"{DOCKER} exec denizen-server sh -c 'echo {b64} | base64 -d > /app/data/robinhood-oauth.json'",
    )
    run(client, f"{DOCKER} restart denizen-server")
    time.sleep(8)
    status = run(client, f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/market/auth-status")
    client.close()

    print(status)
    if '"authenticated":true' in status.replace(" ", ""):
        print("==> NAS Robinhood connected")
        return 0
    print("WARN: uploaded but auth-status still false — check container logs")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
