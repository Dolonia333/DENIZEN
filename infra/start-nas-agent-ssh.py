#!/usr/bin/env python3
from hostcfg import get_host
import load_infra_env  # noqa: F401 — loads infra/.env

import os
import sys
import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
REMOTE = "/volume1/docker/denizen-agent"
DENIZEN_LAN = os.environ.get("DENIZEN_LAN_URL", "http://192.168.1.1:8081")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

def run(cmd: str, timeout: int = 60) -> None:
    print("$", cmd)
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())

run(f"sed -i 's|^DENIZEN_URL=.*|DENIZEN_URL={DENIZEN_LAN}|' {REMOTE}/.env")
run("pkill -f nas-metrics-agent.js 2>/dev/null || true", timeout=15)
run(
    f"sh -c 'cd {REMOTE} && DENIZEN_AGENT_ROOT={REMOTE} "
    f"DENIZEN_HARDWARE_MONITOR_PATH={REMOTE}/src/denizen-hardware-monitor.js "
    f"nohup /usr/local/bin/node nas-metrics-agent.js >> agent.log 2>&1 </dev/null &'",
    timeout=15,
)
run("sleep 4", timeout=10)
run(f"ps aux | grep '[n]as-metrics-agent' || echo NOT_RUNNING")
run(f"tail -n 12 {REMOTE}/agent.log")
client.close()
print("done")
