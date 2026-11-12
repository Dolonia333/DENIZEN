#!/usr/bin/env python3
"""Print NAS /volume1/docker/compose.yaml cloudflared section."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = c.exec_command("cat /volume1/docker/compose.yaml")
    print(o.read().decode("utf-8", errors="replace"))
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
