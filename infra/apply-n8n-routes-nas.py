#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def upload(client, local: Path, remote: str):
    stdin, stdout, _ = client.exec_command(f"cat > '{remote}'", timeout=120)
    stdin.write(local.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()


def run(client, cmd, timeout=120):
    print("$", cmd[:140])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:800])
    return out


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    upload(client, ROOT / "denizen" / "src" / "n8n-client.js", "/tmp/n8n-client.js")
    upload(client, ROOT / "denizen" / "src" / "n8n-routes.js", "/tmp/n8n-routes.js")
    upload(client, INFRA / "_patch_server_n8n.js", "/tmp/_patch_server_n8n.js")

    run(client, f"{DOCKER} cp /tmp/n8n-client.js denizen-server:/app/src/n8n-client.js")
    run(client, f"{DOCKER} cp /tmp/n8n-routes.js denizen-server:/app/src/n8n-routes.js")
    run(client, f"{DOCKER} cp /tmp/_patch_server_n8n.js denizen-server:/tmp/_patch_server_n8n.js")
    run(client, f"{DOCKER} exec denizen-server node /tmp/_patch_server_n8n.js")
    run(client, f"{DOCKER} restart denizen-server")
    run(
        client,
        "sleep 16 && SECRET=$(grep '^EMAIL_INBOUND_SECRET=' /volume1/docker/denizen-server/.env | cut -d= -f2) && "
        "curl -fsS -m 20 -H \"X-Denizen-Secret: $SECRET\" http://127.0.0.1:8888/api/n8n/status",
    )
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
