#!/usr/bin/env python3
from __future__ import annotations
import os, re, sys
from pathlib import Path
INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env
import paramiko

HOST = os.environ.get('SYNO_HOST', '192.168.1.237')
PWD = os.environ['SYNO_SSH_PASSWORD']
DOCKER = os.environ.get('SYNO_DOCKER', '/usr/local/bin/docker')
ENV_PATH = '/volume1/docker/denizen-server/.env'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username='admin', password=PWD, look_for_keys=False, allow_agent=False)

_, o, _ = client.exec_command(f"grep '^EMAIL_INBOUND_SECRET=' '{ENV_PATH}' | head -1", timeout=20)
secret_line = o.read().decode().strip()
secret = secret_line.split('=', 1)[1] if '=' in secret_line else ''

cmd = (
    "for i in 1 2 3 4 5 6 7 8 9 10 11 12; do "
    "curl -fsS -m 8 -H 'X-Denizen-Secret: " + secret.replace("'", "'\\''") + "' "
    "http://127.0.0.1:8888/api/n8n/status && break; sleep 4; done; "
    f"{DOCKER} logs --tail 30 denizen-server 2>&1"
)
_, o, e = client.exec_command(cmd, timeout=120)
print((o.read() + e.read()).decode('utf-8', errors='replace')[:2000])
client.close()
