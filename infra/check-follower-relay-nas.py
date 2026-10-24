#!/usr/bin/env python3
"""Check follower container logs for relay-only mode."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
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
    for cmd in [
        f"{DOCKER} logs --tail 25 denizen-follower 2>&1",
        f"{DOCKER} exec denizen-follower printenv DENIZEN_SERVER_ROLE DENIZEN_WORLD_PUBSUB 2>&1",
        f"{DOCKER} logs denizen-follower 2>&1 | grep -E 'Relay-only|CofounderAgent|skipped' || true",
    ]:
        print("$", cmd[:100])
        _, o, e = c.exec_command(cmd, timeout=60)
        out = (o.read() + e.read()).decode("utf-8", errors="replace")
        try:
            print(out.rstrip() or "(empty)")
        except UnicodeEncodeError:
            print(out.rstrip().encode("ascii", errors="replace").decode("ascii") or "(empty)")
        print()
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
