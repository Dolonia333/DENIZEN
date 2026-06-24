#!/usr/bin/env python3
"""Copy hotfixed server.js onto denizen-follower and restart."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
SRC = "/volume1/docker/denizen-server/inference-hotfix-src/server.js"


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    for cmd in [
        f"{DOCKER} cp '{SRC}' denizen-follower:/app/server.js",
        f"{DOCKER} restart denizen-follower",
        f"sleep 8 && {DOCKER} logs --tail 12 denizen-follower 2>&1",
    ]:
        print("$", cmd[:90])
        _, o, e = c.exec_command(cmd, timeout=120)
        out = (o.read() + e.read()).decode("utf-8", errors="replace")
        try:
            print(out.rstrip())
        except UnicodeEncodeError:
            print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
