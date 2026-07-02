#!/usr/bin/env python3
"""Inspect office layout files on NAS."""
import json
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    paths = [
        "/app/layouts/offices/ceo-operator/office-layout.json",
        "/app/layouts/office-layout.json",
    ]
    for p in paths:
        cmd = f"{DOCKER} exec denizen-server cat {p}"
        _, o, e = client.exec_command(cmd, timeout=60)
        raw = o.read().decode("utf-8", errors="replace")
        err = e.read().decode("utf-8", errors="replace")
        if err.strip() and not raw.strip():
            print(p, "MISSING:", err.strip()[:200])
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as ex:
            print(p, "INVALID JSON:", ex)
            continue
        keys = list(data.keys())[:12]
        n_pl = len(data.get("placements") or [])
        n_items = len(data.get("items") or [])
        print(f"{p}: keys={keys} placements={n_pl} items={n_items}")
        if n_pl:
            sample = data["placements"][:3]
            print("  sample placements:", json.dumps(sample, indent=2)[:500])

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
