#!/usr/bin/env python3
"""Fetch n8n workflow JSON by name or ID."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
N8N_API_URL = os.environ.get("N8N_API_URL", "http://127.0.0.1:5679/api/v1").rstrip("/")
API_KEY = os.environ.get("N8N_API_KEY", "")
TARGET = sys.argv[1] if len(sys.argv) > 1 else "Dolonia Web Analyzer"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else INFRA / "_fetched-workflow.json"


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    cmd = f"curl -fsS -m 30 -H 'X-N8N-API-KEY: {API_KEY}' '{N8N_API_URL}/workflows?limit=100'"
    _, o, e = client.exec_command(cmd, timeout=60)
    out = (o.read() + e.read()).decode("utf-8")
    data = json.loads(out).get("data", [])

    wf = None
    for item in data:
        if item.get("id") == TARGET or item.get("name") == TARGET:
            wf_id = item["id"]
            cmd2 = f"curl -fsS -m 30 -H 'X-N8N-API-KEY: {API_KEY}' '{N8N_API_URL}/workflows/{wf_id}'"
            _, o2, e2 = client.exec_command(cmd2, timeout=60)
            wf = json.loads((o2.read() + e2.read()).decode("utf-8"))
            break

    client.close()
    if not wf:
        print("Workflow not found", file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(wf, indent=2), encoding="utf-8")
    print(f"saved {OUT} id={wf.get('id')} nodes={len(wf.get('nodes', []))}")
    for n in wf.get("nodes", []):
        print(f"  - {n.get('name')} ({n.get('type')})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
