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

cmds = [
    f"{DOCKER} ps --filter name=denizen-server --format '{{{{.Names}}}}\t{{{{.Status}}}}\t{{{{.Image}}}}'",
    "ls -la /volume1/docker/denizen-server 2>/dev/null | head -15",
    f"{DOCKER} exec denizen-server test -f /app/src/outcome-scorer.js && echo HAS_OUTCOME_SCORER || echo NO_OUTCOME_SCORER",
    f"{DOCKER} exec denizen-server printenv DENIZEN_PUBLIC_DEMO 2>/dev/null || true",
]
for cmd in cmds:
    print("$", cmd)
    _, o, e = c.exec_command(cmd, timeout=30)
    print((o.read() + e.read()).decode("utf-8", errors="replace").rstrip())
    print("---")
c.close()
