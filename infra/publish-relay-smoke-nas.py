#!/usr/bin/env python3
"""Publish a test frame on NAS Redis for relay smoke tests."""

from __future__ import annotations

import json
import os
import time
import uuid

import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
CHANNEL = os.environ.get("DENIZEN_WORLD_PUBSUB_CHANNEL", "denizen:world:broadcast")


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    frame = {
        "type": "relay_smoke_test",
        "id": str(uuid.uuid4()),
        "ts": int(time.time() * 1000),
    }
    payload = json.dumps(frame).replace("'", "'\"'\"'")
    cmd = (
        f"{DOCKER} exec denizen-redis redis-cli PUBLISH {CHANNEL} '{payload}'"
    )
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, e = c.exec_command(cmd, timeout=30)
    out = (o.read() + e.read()).decode("utf-8", errors="replace").strip()
    c.close()
    print(f"published relay_smoke_test subscribers={out}")
    print(json.dumps(frame))
    return 0 if out.isdigit() else 1


if __name__ == "__main__":
    raise SystemExit(main())
