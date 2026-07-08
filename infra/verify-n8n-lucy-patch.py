#!/usr/bin/env python3
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
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
WF_ID = "9RepVHNTE0898fgX"

VERIFY_PY = f"""
import json, sqlite3
conn=sqlite3.connect('/volume1/docker/n8n/database.sqlite')
cur=conn.cursor()
cur.execute("SELECT id,name,nodes,active FROM workflow_entity WHERE id='{WF_ID}'")
row=cur.fetchone()
if not row:
    print('ERROR workflow missing')
    raise SystemExit(1)
wf_id,name,nodes_json,active=row
nodes=json.loads(nodes_json)
for n in nodes:
    if n.get('name')=='Normalize email':
        code=n['parameters']['jsCode']
        print('normalize_has_From=', 'item.From' in code)
    if n.get('name')=='POST → Denizen /api/email-inbound':
        p=n['parameters']
        print('url=', p.get('url'))
        for hp in p.get('headerParameters',{{}}).get('parameters',[]):
            if hp.get('name')=='X-Denizen-Secret':
                v=hp.get('value','')
                print('secret_set=', bool(v and 'REPLACE' not in v))
    if n.get('name')=='Gmail Trigger (unread, last 24h)':
        cred=n.get('credentials',{{}})
        print('gmail_cred=', cred.get('gmailOAuth2',{{}}).get('id','MISSING'))
print('active_before=', active)
"""


def run(client, cmd, timeout=60):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    stdin, stdout, _ = client.exec_command("python3 -", timeout=60)
    stdin.write(VERIFY_PY.encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    print(stdout.read().decode())

    activate_py = f"""
import sqlite3
conn=sqlite3.connect('/volume1/docker/n8n/database.sqlite')
conn.execute("UPDATE workflow_entity SET active=1 WHERE id='{WF_ID}'")
conn.commit()
cur=conn.cursor()
cur.execute("SELECT active FROM workflow_entity WHERE id='{WF_ID}'")
print('active_after=', cur.fetchone()[0])
"""
    stdin, stdout, _ = client.exec_command("python3 -", timeout=60)
    stdin.write(activate_py.encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    print(stdout.read().decode("utf-8", errors="replace"))

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
