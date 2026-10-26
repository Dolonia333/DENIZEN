#!/usr/bin/env python3
"""Inspect cloudflared tunnel config on NAS (tokens redacted)."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import re
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    cmds = [
        f"{DOCKER} ps --filter name=cloudflared --format '{{{{.Names}}}}\t{{{{.Status}}}}'",
        f"{DOCKER} inspect cloudflare-cloudflared --format '{{{{json .Config.Cmd}}}}' 2>/dev/null || true",
        "ls -la /volume1/docker/cloudflared 2>/dev/null | head -25",
        "cat /volume1/docker/cloudflared/config.yml 2>/dev/null || echo '(no config.yml)'",
        "grep -r spectate /volume1/docker/cloudflared 2>/dev/null || true",
    ]
    for cmd in cmds:
        print("===", cmd[:100])
        _, o, e = c.exec_command(cmd)
        text = (o.read() + e.read()).decode("utf-8", errors="replace")
        text = re.sub(r"token:\s*\S+", "token: [REDACTED]", text)
        print(text[:4000])
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
