#!/usr/bin/env python3
"""Stop denizen-server, ensure hotfix src on disk, start and probe."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import time
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def run(client, cmd, timeout=120):
    print(f"$ {cmd[:100]}", flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    run(client, f"{DOCKER} stop denizen-server", timeout=60)
    run(client, f"{DOCKER} start denizen-server", timeout=60)
    time.sleep(18)
    run(client, f"{DOCKER} ps -a --filter name=denizen-server")
    run(client, f"{DOCKER} logs denizen-server --tail 12 2>&1")
    run(client, f"curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health 2>&1 | head -c 400")
    run(client, f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/compute/inference/catalog 2>&1 | head -c 350")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
