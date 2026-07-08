#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env
import paramiko

PWD = os.environ["SYNO_SSH_PASSWORD"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.1.237", username="admin", password=PWD, look_for_keys=False, allow_agent=False)
_, o, _ = c.exec_command("grep '^EMAIL_INBOUND_SECRET=' /volume1/docker/denizen-server/.env")
secret = o.read().decode().strip().split("=", 1)[-1]
_, o, _ = c.exec_command(
    f"curl -fsS -m 12 -H 'X-Denizen-Secret: {secret}' 'http://127.0.0.1:8888/api/n8n/workflows?limit=50'"
)
data = json.loads(o.read().decode())
for w in data.get("data", []):
    print(f"{w.get('name')}\tactive={w.get('active')}")
c.close()
