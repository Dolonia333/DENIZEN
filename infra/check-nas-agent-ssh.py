#!/usr/bin/env python3
from hostcfg import get_host
import load_infra_env  # noqa: F401 — loads infra/.env

import os
import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
REMOTE = "/volume1/docker/denizen-agent"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

cmds = [
    f"ls -la {REMOTE}",
    f"cat {REMOTE}/.env",
    f"tail -n 25 {REMOTE}/agent.log 2>&1 || echo NO_LOG",
    "ps aux | grep '[n]as-metrics-agent'",
]
for cmd in cmds:
    print("===", cmd)
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    print((stdout.read() + stderr.read()).decode("utf-8", errors="replace"))
client.close()
