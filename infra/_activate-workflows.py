#!/usr/bin/env python3
from __future__ import annotations
import os, sys
from pathlib import Path
INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env
import paramiko
HOST=os.environ.get('SYNO_HOST','192.168.1.237'); PWD=os.environ['SYNO_SSH_PASSWORD']
API_KEY=os.environ['N8N_API_KEY']; N8N_API_URL=os.environ.get('N8N_API_URL','http://127.0.0.1:5679/api/v1')
for wf_id in ['1B9yO3KPBgdlqNWV','TKuKzeNBq0dIrTdx']:
    client=paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username='admin', password=PWD, look_for_keys=False, allow_agent=False)
    cmd=f"curl -sS -m 30 -X POST -H 'X-N8N-API-KEY: {API_KEY}' '{N8N_API_URL}/workflows/{wf_id}/activate' -w '\\nHTTP_%{{http_code}}'"
    _,o,e=client.exec_command(cmd, timeout=60)
    out=(o.read()+e.read()).decode('ascii','replace')
    print(wf_id, out[-120:])
    client.close()
