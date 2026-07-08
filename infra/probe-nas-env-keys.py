#!/usr/bin/env python3
"""Probe NAS denizen-server .env for email/n8n keys (redacted output)."""
from __future__ import annotations
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
ENV_PATH = "/volume1/docker/denizen-server/.env"
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

KEYS = [
    "EMAIL_INBOUND_SECRET",
    "N8N_WEBHOOK_URL",
    "N8N_WEBHOOK_KEY",
    "N8N_API_URL",
    "N8N_API_KEY",
    "RESEND_API_KEY",
    "DENIZEN_EMAIL_FROM",
    "GMAIL_OAUTH_FILE",
    "EXTERNAL_SINK_KINDS",
]


def run(client, cmd: str, timeout: int = 30) -> str:
    _, o, e = client.exec_command(cmd, timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD not set")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
    print(f"=== NAS env probe ({HOST}) ===")
    for k in KEYS:
        line = run(client, f"grep '^{k}=' '{ENV_PATH}' 2>/dev/null | head -1")
        if not line:
            print(f"{k}: NOT SET")
            continue
        if "=" not in line:
            print(f"{k}: {line[:80]}")
            continue
        name, val = line.split("=", 1)
        if any(x in k for x in ("KEY", "SECRET", "TOKEN")):
            print(f"{k}: SET (len={len(val)}, starts={val[:6]}...)")
        else:
            print(f"{k}: {val[:120]}")

    secret = run(client, f"grep '^EMAIL_INBOUND_SECRET=' '{ENV_PATH}' | cut -d= -f2")
    n8n_status = run(
        client,
        f"curl -fsS -m 8 -H 'X-Denizen-Secret: {secret}' http://127.0.0.1:8888/api/n8n/status 2>/dev/null || echo FAIL",
    )
    print(f"\nN8N_STATUS: {n8n_status[:400]}")

    containers = run(client, f"{DOCKER} ps --format '{{{{.Names}}}}\t{{{{.Status}}}}' | grep -E 'n8n|denizen' || true")
    print(f"\nCONTAINERS:\n{containers}")

    wf = run(
        client,
        f"curl -fsS -m 8 -H 'X-Denizen-Secret: {secret}' http://127.0.0.1:8888/api/n8n/workflows?limit=20 2>/dev/null || echo FAIL",
    )
    print(f"\nN8N_WORKFLOWS: {wf[:800]}")

    gmail_oauth = run(client, "test -f /volume1/docker/denizen-server/data/gmail-oauth.json && echo YES || echo NO")
    print(f"\nGMAIL_OAUTH_FILE_ON_DISK: {gmail_oauth}")

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
