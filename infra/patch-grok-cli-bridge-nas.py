#!/usr/bin/env python3
"""Set GROK_CLI_BRIDGE_* on NAS denizen-server .env and restart (no force-recreate)."""
from __future__ import annotations

import base64
import os
import re
import secrets
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
TOKEN_FILE = INFRA / "grok-bridge-token.txt"

BRIDGE_URL = os.environ.get("GROK_CLI_BRIDGE_URL", "http://100.71.54.109:9876").strip()
BRIDGE_TOKEN = os.environ.get("GROK_CLI_BRIDGE_TOKEN", "").strip()


def resolve_token(existing_env: str) -> str:
    if BRIDGE_TOKEN and BRIDGE_TOKEN != "test-bridge-token-12345":
        return BRIDGE_TOKEN
    m = re.search(r"^GROK_CLI_BRIDGE_TOKEN=(.+)$", existing_env, re.MULTILINE)
    current = (m.group(1).strip() if m else "")
    if current and current != "test-bridge-token-12345":
        return current
    token = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
    print(f"Generated new bridge token -> {TOKEN_FILE}")
    return token


def patch_env(text: str, token: str) -> str:
    patch = {
        "GROK_CLI_BRIDGE_URL": BRIDGE_URL,
        "GROK_CLI_BRIDGE_TOKEN": token,
    }
    lines = text.splitlines()
    keys = set(patch)
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in keys:
            k = m.group(1)
            out.append(f"{k}={patch[k]}")
            keys.remove(k)
        else:
            out.append(line)
    for k in sorted(keys):
        out.append(f"{k}={patch[k]}")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command(f"cat {ENV_PATH} 2>/dev/null || echo ''")
    existing = o.read().decode("utf-8", errors="replace")
    token = resolve_token(existing)
    updated = patch_env(existing, token)
    b64 = base64.b64encode(updated.encode()).decode()
    client.exec_command(f"printf '%s' '{b64}' | base64 -d > {ENV_PATH}")[1].channel.recv_exit_status()
    print(f"Patched {ENV_PATH}")
    print(f"  GROK_CLI_BRIDGE_URL={BRIDGE_URL}")
    print(f"  GROK_CLI_BRIDGE_TOKEN={token[:8]}…")
    _, o, e = client.exec_command(f"{DOCKER} restart denizen-server", timeout=120)
    print((o.read() + e.read()).decode("utf-8", errors="replace")[-400:])
    _, o, _ = client.exec_command(f"{DOCKER} exec denizen-server printenv GROK_CLI_BRIDGE_URL")
    print("Container URL:", o.read().decode().strip())
    client.close()
    print("\nPC bridge command:")
    print(f"  py infra/run-grok-cli-chat-bridge.py --port 9876 --token {token}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
