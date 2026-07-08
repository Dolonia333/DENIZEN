#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")


def main() -> int:
    if not PASSWORD:
        print(os.environ.get("DENIZEN_INTERNAL_API_TOKEN", ""))
        return 0
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command(
        "grep '^DENIZEN_INTERNAL_API_TOKEN=' /volume1/docker/denizen-server/.env | sed -n '1p'"
    )
    line = o.read().decode().strip()
    client.close()
    if "=" in line:
        print(line.split("=", 1)[1].strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
