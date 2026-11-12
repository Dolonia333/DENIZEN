#!/usr/bin/env python3
"""Patch NAS docker-compose JWT_JWKS lines and restart storage + realtime."""

from __future__ import annotations

from hostcfg import get_host
import os
import sys

import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"
COMPOSE = "/volume1/docker/supabase-project/docker-compose.yml"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 1800) -> int:
    print("$", cmd, flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code


def main() -> int:
    if not PASSWORD:
        print("Set SYNO_SSH_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username=USER,
        password=PASSWORD,
        look_for_keys=False,
        allow_agent=False,
    )

    run(
        client,
        (
            f"sed -i "
            f"-e 's|API_JWT_JWKS: \\${{JWT_JWKS:-{{\"keys\":\\[]}}}}|API_JWT_JWKS: \\${{JWT_JWKS}}|g' "
            f"-e 's|JWT_JWKS: \\${{JWT_JWKS:-{{\"keys\":\\[]}}}}|JWT_JWKS: \\${{JWT_JWKS}}|g' "
            f"{COMPOSE}"
        ),
    )
    run(client, f"grep -n 'JWT_JWKS' {COMPOSE}")
    run(client, f"cd /volume1/docker/supabase-project && {DOCKER} compose up -d storage realtime --force-recreate")
    code = run(client, f"cd /volume1/docker/supabase-project && {DOCKER} compose up -d --wait storage realtime")
    run(client, f"{DOCKER} compose -f {COMPOSE} ps -a storage realtime")
    run(client, f"{DOCKER} inspect supabase-storage --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | grep JWT_JWKS")
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
