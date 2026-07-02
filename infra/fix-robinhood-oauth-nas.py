#!/usr/bin/env python3
"""Reset corrupted robinhood-oauth.json on NAS."""

from __future__ import annotations

import json
import load_infra_env  # noqa: F401

import os
import time

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def run(client: paramiko.SSHClient, cmd: str) -> str:
    print("$", cmd[:100])
    _, o, e = client.exec_command(cmd, timeout=120)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    print(run(client, f"{DOCKER} exec denizen-server printenv DENIZEN_PUBLIC_URL"))
    print(run(client, f"{DOCKER} exec denizen-server printenv DENIZEN_URL"))

    import base64

    oauth = json.dumps({})
    b64 = base64.b64encode(oauth.encode()).decode()
    run(
        client,
        f"{DOCKER} exec denizen-server sh -c 'echo {b64} | base64 -d > /app/data/robinhood-oauth.json'",
    )

    print(run(client, f"{DOCKER} exec denizen-server cat /app/data/robinhood-oauth.json"))
    print(run(client, f"{DOCKER} exec denizen-server node -e \"console.log(require('/app/src/robinhood-mcp.js').getRedirectUri())\""))

    run(client, f"{DOCKER} restart denizen-server")
    time.sleep(8)
    print(run(client, f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/market/auth-status"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
