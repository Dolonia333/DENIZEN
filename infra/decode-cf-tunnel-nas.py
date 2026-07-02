#!/usr/bin/env python3
"""Decode cloudflared tunnel token metadata from NAS (IDs only, no secrets)."""

from __future__ import annotations

import base64
import json
import load_infra_env  # noqa: F401

import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def decode_tunnel_token(token: str) -> dict:
    # Remotely-managed tunnel tokens are base64 JSON (not always dotted JWT).
    if "." in token and token.count(".") >= 2:
        part = token.split(".")[1]
        pad = "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part + pad))
    pad = "=" * (-len(token) % 4)
    return json.loads(base64.urlsafe_b64decode(token + pad))


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = c.exec_command(
        f"{DOCKER} inspect cloudflare-cloudflared --format '{{{{json .Config.Cmd}}}}'"
    )
    cmd = json.loads(o.read().decode() or "[]")
    try:
        idx = cmd.index("--token")
        token = cmd[idx + 1]
    except (ValueError, IndexError):
        print("No --token in cloudflared cmd")
        c.close()
        return 1
    payload = decode_tunnel_token(token)
    print("tunnel_id:", payload.get("t"))
    print("account_id:", payload.get("a"))
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
