#!/usr/bin/env python3
from __future__ import annotations
from hostcfg import get_host
import json, os, sys, urllib.request
from pathlib import Path
INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env
import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ['SYNO_SSH_PASSWORD']
WEBHOOK = os.environ.get('N8N_URL', 'https://n8n.dolonia.cloud').rstrip('/') + '/webhook/denizen-lead-intake'
payload = json.dumps({
    'company': 'Test Gov Contractor LLC',
    'url': 'https://example.gov/vendor',
    'contact_email': 'capture@test.example',
    'contact_name': 'Jane Capture',
    'summary': 'SLED cyber integrator — pipeline test from deploy script',
    'source': 'deploy_smoke_test',
    'org_slug': 'zion',
})

# Test from NAS (loopback to n8n)
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username='admin', password=PWD, look_for_keys=False, allow_agent=False)
cmd = (
    f"curl -fsS -m 45 -X POST -H 'Content-Type: application/json' "
    f"-d '{payload.replace(chr(39), chr(39)+'\"'+chr(39)+'\"'+chr(39))}' "
    f"'http://127.0.0.1:5679/webhook/denizen-lead-intake'"
)
# simpler: write payload to file
stdin, stdout, _ = client.exec_command('cat > /tmp/lead-test.json', timeout=30)
stdin.write(payload.encode())
stdin.flush()
stdin.channel.shutdown_write()
stdout.channel.recv_exit_status()
_, o, e = client.exec_command(
    "curl -fsS -m 45 -X POST -H 'Content-Type: application/json' "
    "-d @/tmp/lead-test.json 'http://127.0.0.1:5679/webhook/denizen-lead-intake'",
    timeout=60,
)
out = (o.read() + e.read()).decode('ascii', 'replace')
sys.stdout.buffer.write(b'webhook_response: ' + out[:800].encode('utf-8', errors='replace') + b'\n')
client.close()
