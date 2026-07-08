#!/usr/bin/env python3
"""Add persistent ./layouts volume to NAS denizen-server (furniture + office saves)."""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parent.parent
COMPOSE_SRC = ROOT / "denizen" / "docker-compose.production.yml"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
LAYOUT_DIRS = [
    "data",
    "desktop",
    "layouts",
    "layouts/offices",
    "layouts/offices/ceo-operator",
]


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 180) -> tuple[int, str]:
    print(f"$ {cmd[:140]}")
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[-800:])
    return code, out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    if not COMPOSE_SRC.is_file():
        print(f"Missing {COMPOSE_SRC}", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    for sub in LAYOUT_DIRS:
        run_ssh(client, f"mkdir -p '{REMOTE_DIR}/{sub}'")

    # Seed empty layout file so GET /api/layout works after first boot.
    seed = '{"placements":[],"items":[]}'
    run_ssh(
        client,
        f"test -f '{REMOTE_DIR}/layouts/offices/ceo-operator/office-layout.json' "
        f"|| printf '%s' '{seed}' > '{REMOTE_DIR}/layouts/offices/ceo-operator/office-layout.json'",
    )

    compose_b64 = base64.b64encode(COMPOSE_SRC.read_bytes()).decode()
    run_ssh(
        client,
        f"printf '%s' '{compose_b64}' | base64 -d > '{REMOTE_DIR}/docker-compose.yml'",
    )

    _, mounts = run_ssh(
        client,
        f"{DOCKER} inspect denizen-server --format '{{{{json .Mounts}}}}' 2>/dev/null || echo '[]'",
    )
    needs_recreate = "./layouts" not in mounts and "/app/layouts" not in mounts

    if needs_recreate:
        print("==> Applying compose (layouts volume — container will recreate)")
        code, _ = run_ssh(
            client,
            f"cd '{REMOTE_DIR}' && {DOCKER} compose -f docker-compose.yml up -d",
            timeout=300,
        )
        if code != 0:
            client.close()
            return code
        run_ssh(client, "sleep 12")
    else:
        print("==> layouts volume already mounted — ensuring container is up")
        run_ssh(
            client,
            f"cd '{REMOTE_DIR}' && {DOCKER} compose -f docker-compose.yml up -d",
            timeout=180,
        )
        run_ssh(client, "sleep 8")

    code, health = run_ssh(
        client,
        f"curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 200",
    )
    if code != 0:
        print("WARN: health check failed after layouts patch — hotfix sync will follow")
    client.close()
    print("layouts volume patch ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
