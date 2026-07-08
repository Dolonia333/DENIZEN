#!/usr/bin/env python3
"""Smoke test Dolonia Web Analyzer scrape webhook (may take ~60s)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
PUBLIC_N8N = os.environ.get("N8N_URL", "https://n8n.dolonia.cloud").rstrip("/")

payload = json.dumps({
    "url": "https://example.com",
    "company": "Example Gov Integrator",
    "email": "info@example.com",
    "name": "Example Contact",
})


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    stdin, stdout, _ = client.exec_command("cat > /tmp/scrape-test.json", timeout=30)
    stdin.write(payload.encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()

    cmd = (
        "curl -fsS -m 120 -X POST -H 'Content-Type: application/json' "
        "-d @/tmp/scrape-test.json 'http://127.0.0.1:5679/webhook/scrape'"
    )
    _, o, e = client.exec_command(cmd, timeout=130)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    sys.stdout.buffer.write(out[:2000].encode("utf-8", errors="replace"))
    sys.stdout.buffer.write(b"\n")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
