#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
N8N_URL = os.environ.get("N8N_URL", "https://n8n.dolonia.cloud").rstrip("/")

CHECK_DB = r"""
import sqlite3
conn = sqlite3.connect('/volume1/docker/n8n/database.sqlite')
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]
print('has_user_api_keys=', 'user_api_keys' in tables)
if 'user_api_keys' in tables:
    cur.execute('SELECT id, label, createdAt FROM user_api_keys')
    rows = cur.fetchall()
    print('api_key_count=', len(rows))
    for r in rows:
        print('api_key_label=', r[1])
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
    stdin, stdout, _ = client.exec_command("python3 -", timeout=30)
    stdin.write(CHECK_DB.encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    print(stdout.read().decode("utf-8", errors="replace"))
    client.close()

    # Probe from NAS loopback (bypasses Cloudflare)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
    _, o, e = client.exec_command(
        "curl -fsS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:5679/api/v1/workflows 2>/dev/null || echo fail",
        timeout=20,
    )
    print("api_loopback_without_key=", (o.read() + e.read()).decode().strip())
    client.close()

    req = urllib.request.Request(f"{N8N_URL}/api/v1/workflows", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print("api_without_key_status=", resp.status)
    except urllib.error.HTTPError as e:
        print("api_without_key_status=", e.code)
        body = e.read().decode("utf-8", errors="replace")[:200]
        print("api_without_key_body=", body)
    except Exception as e:
        print("api_probe_error=", e)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
