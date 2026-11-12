#!/usr/bin/env python3
"""Check Redis AOF persistence on NAS."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REDIS_NAME = os.environ.get("DENIZEN_REDIS_CONTAINER", "denizen-redis")


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, e = c.exec_command(
        f"{DOCKER} exec {REDIS_NAME} redis-cli INFO persistence 2>/dev/null | grep -E 'aof_enabled|appendonly'",
        timeout=30,
    )
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    c.close()
    print(out.strip() or "no redis persistence info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
