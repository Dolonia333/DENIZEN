#!/usr/bin/env python3
"""Apply MCP scopes + audit migration on NAS Supabase."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

SQL = (ROOT / "denizen" / "supabase" / "migrations" / "20260623000002_mcp_scopes_audit.sql").read_text(
    encoding="utf-8"
)


def run(client: paramiko.SSHClient, cmd: str) -> tuple[int, str]:
    print("$", cmd[:100])
    _, o, e = client.exec_command(cmd, timeout=120)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command("grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg_pass = o.read().decode().strip().split("=", 1)[-1]

    import base64

    b64 = base64.b64encode(SQL.strip().encode()).decode()
    code, out = run(
        client,
        (
            f"printf '%s' '{b64}' | base64 -d | "
            f"{DOCKER} exec -i -e PGPASSWORD='{pg_pass}' supabase-db "
            f"psql -v ON_ERROR_STOP=1 -U postgres -d postgres"
        ),
    )
    print(out.strip())
    client.close()
    return 0 if code == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
