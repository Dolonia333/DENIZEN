#!/usr/bin/env python3
"""Provision /app/desktop on NAS denizen-server (bind mount + download page)."""
from __future__ import annotations

from hostcfg import get_host
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DESKTOP = "/volume1/docker/denizen-server/desktop"
COMPOSE = ROOT / "denizen" / "docker-compose.production.yml"


def upload(client, local: Path, remote: str):
    stdin, stdout, _ = client.exec_command(f"cat > '{remote}'", timeout=120)
    stdin.write(local.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command(f"mkdir -p '{REMOTE_DESKTOP}/releases'", timeout=30)
    o.channel.recv_exit_status()

    upload(client, ROOT / "denizen" / "desktop" / "download.html", f"{REMOTE_DESKTOP}/download.html")

    # Push updated compose with desktop volume bind
    upload(client, COMPOSE, "/volume1/docker/denizen-server/docker-compose.yml")

    _, o, e = client.exec_command(
        f"cd /volume1/docker/denizen-server && {DOCKER} compose up -d --force-recreate",
        timeout=180,
    )
    print((o.read() + e.read()).decode("ascii", "replace")[:800])

    _, o, e = client.exec_command(
        "sleep 14 && curl -fsS -m 20 -o /dev/null -w '%{http_code}' http://127.0.0.1:8888/desktop/download.html",
        timeout=60,
    )
    print("download.html status:", (o.read() + e.read()).decode().strip())

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
