#!/usr/bin/env python3
"""Patch the Normalize email node in the live NAS n8n workflow (keeps Gmail OAuth)."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
N8N_DB = "/volume1/docker/n8n/database.sqlite"
WORKFLOW_SRC = ROOT / "denizen" / "data" / "email-workflows" / "lucy-inbox.n8n.json"

PATCH_PY = r'''
import json
import sqlite3
from pathlib import Path

DB = Path("/volume1/docker/n8n/database.sqlite")
TEMPLATE = Path("/tmp/lucy-inbox.template.json")

raw = json.loads(TEMPLATE.read_text(encoding="utf-8"))
normalize = next(n for n in raw["nodes"] if n.get("name") == "Normalize email")
new_code = normalize["parameters"]["jsCode"]

conn = sqlite3.connect(DB)
cur = conn.cursor()
cur.execute("SELECT id, name, nodes, active FROM workflow_entity")
rows = cur.fetchall()
target = None
for wf_id, name, nodes_json, active in rows:
    if not name or "Gmail inbox to Lucy" not in name:
        continue
    nodes = json.loads(nodes_json)
    changed = False
    for node in nodes:
        if node.get("name") == "Normalize email" and node.get("type") == "n8n-nodes-base.code":
            old = node.get("parameters", {}).get("jsCode", "")
            if old.strip() == new_code.strip():
                print(f"SKIP already patched: {wf_id} {name}")
                target = (wf_id, name, active, False)
                break
            node.setdefault("parameters", {})["jsCode"] = new_code
            changed = True
            print(f"PATCH normalize node in {wf_id} {name}")
        if node.get("name") == "POST → Denizen /api/email-inbound":
            params = node.setdefault("parameters", {})
            if "denizen.dolonia.cloud" not in str(params.get("url", "")):
                params["url"] = "https://denizen.dolonia.cloud/api/email-inbound"
                changed = True
                print(f"PATCH inbound URL in {wf_id}")
    if changed:
        cur.execute(
            "UPDATE workflow_entity SET nodes = ?, updatedAt = datetime('now') WHERE id = ?",
            (json.dumps(nodes), wf_id),
        )
        conn.commit()
        target = (wf_id, name, active, True)
        break
    if target:
        break

if not target:
  print("ERROR: Lucy workflow not found")
  raise SystemExit(1)

wf_id, name, active, patched = target
print(f"WORKFLOW_ID={wf_id}")
print(f"WORKFLOW_NAME={name}")
print(f"ACTIVE={active}")
print(f"PATCHED={patched}")
'''


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str]:
    print("$", cmd[:200], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required in infra/.env", file=sys.stderr)
        return 1
    if not WORKFLOW_SRC.is_file():
        print("Missing workflow template", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    stdin, stdout, _ = client.exec_command("cat > /tmp/lucy-inbox.template.json", timeout=60)
    stdin.write(WORKFLOW_SRC.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()

    stdin, stdout, _ = client.exec_command("cat > /tmp/patch_n8n_lucy.py", timeout=60)
    stdin.write(PATCH_PY.encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()

    code, out = run_ssh(client, "python3 /tmp/patch_n8n_lucy.py")
    if code != 0 or "ERROR:" in out:
        client.close()
        return 1

    # Restart n8n so editor picks up DB changes cleanly
    run_ssh(client, f"{DOCKER} restart denizen-n8n", timeout=120)
    run_ssh(
        client,
        f"for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -fsS -m 5 http://127.0.0.1:5679/healthz && break; sleep 3; done",
        timeout=90,
    )

    client.close()
    print("\n==> NAS n8n Lucy normalize patch complete (Gmail OAuth preserved)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
