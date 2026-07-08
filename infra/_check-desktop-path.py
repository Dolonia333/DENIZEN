#!/usr/bin/env python3
from __future__ import annotations
import os, sys
from pathlib import Path
INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env
import paramiko
HOST=os.environ.get('SYNO_HOST','192.168.1.237'); PWD=os.environ['SYNO_SSH_PASSWORD']
DOCKER=os.environ.get('SYNO_DOCKER','/usr/local/bin/docker')
client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username='admin', password=PWD, look_for_keys=False, allow_agent=False)
for cmd in [
    f"{DOCKER} exec denizen-server ls -la /app | head -20",
    f"{DOCKER} exec denizen-server ls -la /app/desktop 2>&1 || true",
    "curl -fsS -m 15 -o /dev/null -w '%{http_code}' http://127.0.0.1:8888/desktop/download.html",
    "curl -fsS -m 15 -o /dev/null -w '%{http_code}' http://127.0.0.1:8888/desktop/",
]:
    _,o,e=client.exec_command(cmd, timeout=30)
    print(cmd, '->', (o.read()+e.read()).decode('ascii','replace')[:200])
client.close()
