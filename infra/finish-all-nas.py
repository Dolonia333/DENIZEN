#!/usr/bin/env python3
"""Finish Supabase on Synology: change pooler port, restart, verify."""

from __future__ import annotations

from hostcfg import get_host
import os
import sys
import time

import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"
DIR = "/volume1/docker/supabase-project"
NEW_PG_PORT = os.environ.get("SYNO_POSTGRES_PORT", "5433")
NEW_TX_PORT = os.environ.get("SYNO_POOLER_TX_PORT", "6544")


def log(msg: str) -> None:
    print(msg, flush=True)


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 1800) -> tuple[int, str]:
    log(f"$ {cmd}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def main() -> int:
    if not PASSWORD:
        log("ERROR: SYNO_SSH_PASSWORD not set")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"==> Connecting {USER}@{HOST}")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, look_for_keys=False, allow_agent=False)

    log(f"==> Setting POSTGRES_PORT={NEW_PG_PORT}, POOLER_PROXY_PORT_TRANSACTION={NEW_TX_PORT}")
    run(
        client,
        (
            f"cd {DIR} && "
            f"grep -q '^POSTGRES_PORT=' .env && sed -i 's/^POSTGRES_PORT=.*/POSTGRES_PORT={NEW_PG_PORT}/' .env "
            f"|| echo POSTGRES_PORT={NEW_PG_PORT} >> .env"
        ),
    )
    run(
        client,
        (
            f"cd {DIR} && "
            f"grep -q '^POOLER_PROXY_PORT_TRANSACTION=' .env && "
            f"sed -i 's/^POOLER_PROXY_PORT_TRANSACTION=.*/POOLER_PROXY_PORT_TRANSACTION={NEW_TX_PORT}/' .env "
            f"|| echo POOLER_PROXY_PORT_TRANSACTION={NEW_TX_PORT} >> .env"
        ),
    )
    run(client, f"grep -E '^(POSTGRES_PORT|POOLER_PROXY_PORT_TRANSACTION)=' {DIR}/.env")

    run(client, f"mkdir -p {DIR}/volumes/db/data {DIR}/volumes/storage {DIR}/volumes/snippets")
    run(client, f"chmod +x {DIR}/volumes/api/kong-entrypoint.sh")

    log("==> Recreating stack")
    code, _ = run(client, f"cd {DIR} && {DOCKER} compose down", timeout=300)
    code, _ = run(client, f"cd {DIR} && {DOCKER} compose up -d --wait", timeout=1800)
    if code != 0:
        log("WARN: compose up returned non-zero; checking status anyway")

    time.sleep(10)
    run(client, f"{DOCKER} compose -f {DIR}/docker-compose.yml ps -a")
    run(client, "curl -s -o /dev/null -w 'kong8000:%{http_code}' http://127.0.0.1:8000/; echo")
    run(client, f"curl -s -o /dev/null -w 'rest:%{{http_code}}' http://127.0.0.1:8000/rest/v1/; echo")
    run(client, f"netstat -tlnp 2>/dev/null | grep -E ':{NEW_PG_PORT} |:{NEW_TX_PORT} ' || ss -tlnp | grep -E ':{NEW_PG_PORT} |:{NEW_TX_PORT} '")

    # Cloudflare tunnel container
    run(client, f"{DOCKER} ps --filter name=cloudflared --format '{{{{.Names}}}}\t{{{{.Status}}}}'")

    # Emit values for local migration step (no secrets in keys list beyond what's needed)
    for key in ("POSTGRES_PASSWORD", "POOLER_TENANT_ID", "ANON_KEY", "SERVICE_ROLE_KEY"):
        run(client, f"grep '^{key}=' {DIR}/.env | head -1")

    client.close()
    log("==> NAS finish complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
