#!/usr/bin/env python3
from __future__ import annotations
from hostcfg import get_host
import os, sys
from pathlib import Path
INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env
import paramiko
HOST=get_host("SYNO_HOST"); PWD=os.environ['SYNO_SSH_PASSWORD']
client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username='admin', password=PWD, look_for_keys=False, allow_agent=False)
cmd = (
    "SECRET=$(grep '^EMAIL_INBOUND_SECRET=' /volume1/docker/denizen-server/.env | cut -d= -f2) && "
    "curl -fsS -m 20 -H \"X-Denizen-Secret: $SECRET\" "
    "'http://127.0.0.1:8888/api/n8n/workflows?limit=3'"
)
_,o,e=client.exec_command(cmd, timeout=60)
print((o.read()+e.read()).decode('ascii','replace')[:600])
client.close()
