#!/usr/bin/env python3
"""One-off: set GROK_CLI_BRIDGE_* on NAS denizen-server .env and recreate container."""
from __future__ import annotations

import base64
import os
import re
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
ENV_PATH = "/volume1/docker/denizen-server/.env"

PATCH = {
    "GROK_CLI_BRIDGE_URL": os.environ.get(
        "GROK_CLI_BRIDGE_URL", "http://100.71.54.109:9876"
    ).strip(),
    "GROK_CLI_BRIDGE_TOKEN": os.environ.get(
        "GROK_CLI_BRIDGE_TOKEN", "test-bridge-token-12345"
    ).strip(),
}


def patch_env(text: str) -> str:
    lines = text.splitlines()
    keys = set(PATCH)
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in keys:
            k = m.group(1)
            out.append(f"{k}={PATCH[k]}")
            keys.remove(k)
        else:
            out.append(line)
    for k in sorted(keys):
        out.append(f"{k}={PATCH[k]}")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command(f"cat {ENV_PATH} 2>/dev/null || echo ''")
    updated = patch_env(o.read().decode("utf-8", errors="replace"))
    b64 = base64.b64encode(updated.encode()).decode()
    client.exec_command(f"printf '%s' '{b64}' | base64 -d > {ENV_PATH}")[1].channel.recv_exit_status()
    print(f"Patched {ENV_PATH}")
    print(f"  GROK_CLI_BRIDGE_URL={PATCH['GROK_CLI_BRIDGE_URL']}")
    _, o, e = client.exec_command(
        f"cd /volume1/docker/denizen-server && {DOCKER} compose -f docker-compose.yml up -d --force-recreate",
        timeout=180,
    )
    print((o.read() + e.read()).decode("utf-8", errors="replace")[-600:])
    _, o, _ = client.exec_command(f"{DOCKER} exec denizen-server printenv GROK_CLI_BRIDGE_URL")
    print("Container:", o.read().decode().strip())
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
