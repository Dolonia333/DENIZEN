#!/usr/bin/env python3
"""Deploy Redis on Synology NAS for Denizen world-state pub/sub."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REDIS_NAME = os.environ.get("DENIZEN_REDIS_CONTAINER", "denizen-redis")
REDIS_PORT = os.environ.get("DENIZEN_REDIS_PORT", "6379")
REDIS_IMAGE = os.environ.get("DENIZEN_REDIS_IMAGE", "redis:7-alpine")
REDIS_DATA = os.environ.get("DENIZEN_REDIS_DATA", "/volume1/docker/denizen-redis-data")


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 300) -> tuple[int, str]:
    print("$", cmd[:120], flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())
    return stdout.channel.recv_exit_status(), out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required in infra/.env")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    run(client, f"mkdir -p {REDIS_DATA}")
    run(client, f"{DOCKER} rm -f {REDIS_NAME} 2>/dev/null || true")
    code, _ = run(
        client,
        f"{DOCKER} run -d --name {REDIS_NAME} --restart unless-stopped "
        f"--network host -v {REDIS_DATA}:/data {REDIS_IMAGE} "
        f"redis-server --port {REDIS_PORT} --bind 127.0.0.1 "
        f"--maxmemory 128mb --maxmemory-policy allkeys-lru "
        f"--appendonly yes --appendfsync everysec",
    )
    if code != 0:
        client.close()
        return code

    code, out = run(
        client,
        f"sleep 2 && redis-cli -p {REDIS_PORT} ping 2>/dev/null || "
        f"{DOCKER} exec {REDIS_NAME} redis-cli ping",
    )
    if code != 0 or "PONG" not in out.upper():
        print("WARN: Redis ping failed — check container logs")
    else:
        print(f"==> Redis ready at redis://127.0.0.1:{REDIS_PORT}")

    run(client, f"{DOCKER} ps --filter name={REDIS_NAME} --format '{{{{.Names}}}}\t{{{{.Status}}}}'")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
