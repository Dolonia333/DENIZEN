#!/usr/bin/env python3
"""Inject a sample Angela email into CRM inbound + check n8n workflow active."""
from __future__ import annotations
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env, paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ.get("SYNO_HOST","192.168.1.237"), username=os.environ.get("SYNO_USER","admin"),
          password=os.environ.get("SYNO_SSH_PASSWORD",""), look_for_keys=False, allow_agent=False)
d = os.environ.get("SYNO_DOCKER","/usr/local/bin/docker")
port = os.environ.get("SYNO_DENIZEN_PORT","8888")
key = os.environ.get("N8N_API_KEY","")

def run(cmd, timeout=90):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    return (o.read()+e.read()).decode("utf-8","replace")

body = {
    "from": "ANGELA VAN ZANDT <vzion253@gmail.com>",
    "fromEmail": "vzion253@gmail.com",
    "to": "zionvanzandt@gmail.com",
    "subject": "Capture note — test inbound for OMES",
    "body": "Testing Gmail→CRM inbound. Please file this under my contact for govcon capture.",
    "gmailId": f"test_inject_{int(__import__('time').time())}",
    "source": "setup_test",
    "org_slug": "zion",
}
b64 = __import__("base64").b64encode(json.dumps(body).encode()).decode()
print("=== inject ===")
print(run(
    f"echo {b64} | base64 -d > /tmp/crm-in.json && "
    f"curl -fsS -m 20 -X POST http://127.0.0.1:{port}/api/crm/email-inbound "
    f"-H 'Content-Type: application/json' --data-binary @/tmp/crm-in.json"
))

print("=== status ===")
print(run(f"curl -fsS -m 10 http://127.0.0.1:{port}/api/crm/email-inbound/status"))

print("=== n8n workflow ===")
print(run(
    f"curl -fsS -m 15 -H 'X-N8N-API-KEY: {key}' "
    f"'http://127.0.0.1:5679/api/v1/workflows/ySx0NJadS3afNUWJ' | head -c 600"
))
c.close()
