#!/usr/bin/env python3
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env, paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    os.environ.get("SYNO_HOST", "192.168.1.237"),
    username=os.environ.get("SYNO_USER", "admin"),
    password=os.environ.get("SYNO_SSH_PASSWORD", ""),
    look_for_keys=False,
    allow_agent=False,
)
d = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

def run(cmd):
    _, o, e = c.exec_command(cmd, timeout=60)
    return (o.read() + e.read()).decode("utf-8", errors="replace")

print("=== denizen gmail files / googleapis ===")
print(run(f"{d} exec denizen-server sh -c \"ls -la /app/data/gmail* 2>&1; ls /app/node_modules/googleapis/package.json 2>&1; node -e 'try{{require(\\\"googleapis\\\");console.log(\\\"googleapis ok\\\")}}catch(e){{console.log(\\\"no googleapis\\\",e.message)}}'\""))

print("=== n8n container ===")
print(run(f"{d} ps --filter name=n8n --format '{{{{.Names}}}} {{{{.Status}}}}'"))
print(run(f"{d} exec denizen-n8n sh -c 'ls -la /home/node/.n8n 2>&1 | head -30'"))
print(run(f"{d} exec denizen-n8n sh -c 'ls /home/node/.n8n/credentials* 2>&1; ls /home/node/.n8n/*.sqlite 2>&1'"))

print("=== env gmail lines (names only) ===")
print(run(f"grep -E 'GMAIL|GOOGLE|RESEND' /volume1/docker/denizen-server/.env.production 2>/dev/null | sed 's/=.*/=***/' || true"))
c.close()
