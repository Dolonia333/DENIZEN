#!/usr/bin/env python3
"""Find cloudflared compose / how denizen.dolonia.cloud is routed."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import re
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
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
        f"{DOCKER} inspect cloudflare-cloudflared --format '{{{{json .HostConfig.NetworkMode}}}}'",
        f"{DOCKER} inspect cloudflare-cloudflared --format '{{{{json .Mounts}}}}'",
        "find /volume1/docker -maxdepth 3 -iname '*cloudflare*' -o -iname '*cloudflared*' 2>/dev/null | head -30",
        "grep -r 'cloudflare-cloudflared\\|cloudflared' /volume1/docker --include='*.yml' --include='*.yaml' 2>/dev/null | head -40",
        f"{DOCKER} logs --tail 30 cloudflare-cloudflared 2>&1",
    ]
    for cmd in cmds:
        print("===", cmd[:110])
        _, o, e = c.exec_command(cmd)
        text = (o.read() + e.read()).decode("utf-8", errors="replace")
        text = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[TOKEN_REDACTED]", text)
        try:
            print(text[:5000])
        except UnicodeEncodeError:
            print(text[:5000].encode("ascii", errors="replace").decode("ascii"))
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
