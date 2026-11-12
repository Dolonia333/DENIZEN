#!/usr/bin/env python3
"""Restore denizen-server container, add n8n modules without replacing full server.js."""
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
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")


def run(client, cmd, timeout=180):
    print("$", cmd[:150])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:2000])
    return o.channel.recv_exit_status()


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

    run(client, f"cd '{REMOTE_DIR}' && {DOCKER} compose up -d --force-recreate")
    run(client, "sleep 18 && curl -fsS -m 20 http://127.0.0.1:8888/api/health | head -c 160")

    upload(client, ROOT / "denizen" / "src" / "n8n-client.js", "/tmp/n8n-client.js")
    upload(client, ROOT / "denizen" / "src" / "n8n-routes.js", "/tmp/n8n-routes.js")
    upload(client, INFRA / "_patch_server_n8n.js", "/tmp/_patch_server_n8n.js")

    run(client, f"{DOCKER} cp /tmp/n8n-client.js denizen-server:/app/src/n8n-client.js")
    run(client, f"{DOCKER} cp /tmp/n8n-routes.js denizen-server:/app/src/n8n-routes.js")
    run(client, f"{DOCKER} cp /tmp/_patch_server_n8n.js denizen-server:/tmp/_patch_server_n8n.js")
    run(client, f"{DOCKER} exec denizen-server node /tmp/_patch_server_n8n.js")
    run(client, f"{DOCKER} restart denizen-server")
    run(client, "sleep 18 && curl -fsS -m 20 http://127.0.0.1:8888/api/health | head -c 160")

    client.close()
    print("==> denizen-server restored and n8n routes injected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
