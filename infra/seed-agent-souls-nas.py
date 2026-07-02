#!/usr/bin/env python3
"""Seed agent_souls on NAS via docker exec."""
from __future__ import annotations

import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
ORG = sys.argv[1] if len(sys.argv) > 1 else "zion"
PACK = sys.argv[2] if len(sys.argv) > 2 else "1921-govcon"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 180) -> tuple[int, str]:
    print("$", cmd)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    code, out = run(
        client,
        f"{DOCKER} exec denizen-server node scripts/seed-agent-souls.js {ORG} {PACK}",
    )
    if code != 0:
        client.close()
        return 1

    run(client, f"{DOCKER} restart denizen-server")
    run(client, "sleep 12")
    _, logs = run(
        client,
        f"{DOCKER} logs denizen-server --tail 100 2>&1 | grep -i hydrated || true",
    )
    client.close()

    if "hydrated" in logs.lower():
        print("\nPASS: souls seeded and hydrated from DB")
        return 0
    print("\nWARN: seed ok but hydration log not found — check docker logs")
    return 0 if '"ok": true' in out or '"ok":true' in out else 1


if __name__ == "__main__":
    raise SystemExit(main())
