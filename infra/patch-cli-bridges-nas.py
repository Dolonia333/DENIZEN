#!/usr/bin/env python3
"""Patch NAS env for Grok/Claude CLI chat bridges (subscription, no API keys)."""
from __future__ import annotations

from hostcfg import get_host
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
# NOTE: docker-compose.yml for denizen-server declares env_file: .env.production,
# so THAT is the file the container actually reads. Patching plain .env wrote to a
# file nothing loads — these patches silently had no effect (this is why the CLI
# bridge env never reached the server). Also: docker restart does NOT reload env;
# use .
ENV_PATH = "/volume1/docker/denizen-server/.env.production"

# Defaults: this PC's Tailscale IP from setup session
PC_IP = get_host("DENIZEN_CLI_BRIDGE_HOST")
PATCH = {
    "GROK_CLI_BRIDGE_URL": os.environ.get("GROK_CLI_BRIDGE_URL", f"http://{PC_IP}:9876"),
    "GROK_CLI_BRIDGE_TOKEN": os.environ.get("GROK_CLI_BRIDGE_TOKEN", ""),
    "CLAUDE_CLI_BRIDGE_URL": os.environ.get("CLAUDE_CLI_BRIDGE_URL", f"http://{PC_IP}:9877"),
    "CLAUDE_CLI_BRIDGE_TOKEN": os.environ.get("CLAUDE_CLI_BRIDGE_TOKEN", ""),
}


def run(client, cmd, timeout=120):
    print("$", cmd[:120], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.encode("ascii", "replace").decode().rstrip(), flush=True)
    return o.channel.recv_exit_status(), out


def patch_env(text: str) -> str:
    lines = text.splitlines()
    keys = {k for k, v in PATCH.items() if v}
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in keys:
            key = m.group(1)
            out.append(f"{key}={PATCH[key]}")
            keys.remove(key)
        else:
            out.append(line)
    for key in sorted(keys):
        out.append(f"{key}={PATCH[key]}")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    if not PATCH["GROK_CLI_BRIDGE_TOKEN"] or not PATCH["CLAUDE_CLI_BRIDGE_TOKEN"]:
        print("Set GROK_CLI_BRIDGE_TOKEN and CLAUDE_CLI_BRIDGE_TOKEN in env before running")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command(f"cat {ENV_PATH} 2>/dev/null || echo ''")
    current = o.read().decode("utf-8", errors="replace")
    updated = patch_env(current)
    import base64
    b64 = base64.b64encode(updated.encode()).decode()
    run(client, f"printf '%s' '{b64}' | base64 -d > {ENV_PATH}")
    print(f"Patched {ENV_PATH}")
    # Restart only (do not recreate — preserves hotfixed /app files)
    run(client, f"{DOCKER} restart denizen-server", timeout=90)
    run(client, "sleep 14")
    for key in ("GROK_CLI_BRIDGE_URL", "CLAUDE_CLI_BRIDGE_URL", "DENIZEN_LIGHT_OFFICE"):
        run(client, f"{DOCKER} exec denizen-server printenv {key} 2>/dev/null || true")
    run(client, "curl -fsS -m 20 http://127.0.0.1:8888/api/health | head -c 200")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
