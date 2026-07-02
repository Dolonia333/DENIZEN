#!/usr/bin/env python3
"""Seed acme demo org with generic-office souls (no 1921 context)."""
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
PACK = "generic-office"
ORG = "acme"


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

    code, out2 = run(
        client,
        f"{DOCKER} exec denizen-server node scripts/seed-org-business-model.js {ORG} {PACK}",
    )
    client.close()

    if code != 0:
        return 1
    combined = out + out2
    if '"ok":true' not in combined.replace(" ", ""):
        print("WARN: seed output missing ok:true")
        return 1
    if "upserted" in combined and '"upserted":17' not in combined.replace(" ", ""):
        print("WARN: expected 17 souls upserted for acme")
    print("\nPASS: acme generic-office souls + business model seeded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
