#!/usr/bin/env python3
from hostcfg import get_host
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
for cmd in [
    f"{DOCKER} ps --filter name=denizen-server --format '{{{{.Status}}}}'",
    "ps aux | grep 'docker build' | grep -v grep | head -3",
    f"{DOCKER} images denizen-server:latest",
]:
    print("$", cmd[:100])
    _, o, e = c.exec_command(cmd, timeout=30)
    print((o.read() + e.read()).decode("ascii", "replace"))
    print("---")
c.close()
