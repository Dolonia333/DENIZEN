#!/usr/bin/env python3
"""Probe Lucy Playwright on NAS container."""
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

cmds = [
    f"{DOCKER} exec denizen-server printenv PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD NODE_ENV",
    f"{DOCKER} exec denizen-server node -e \"try{{const p=require('playwright');console.log('playwright ok')}}catch(e){{console.log('playwright missing:',e.message)}}\"",
    f"{DOCKER} exec denizen-server sh -c 'node jelly/vendor/skills/web-search/web-search.mjs --query probe --headless true 2>&1'",
    f"{DOCKER} exec denizen-server ls -la /app/data/jelly/canvas 2>/dev/null | head -10",
    f"curl -fsS -m 10 http://127.0.0.1:8888/api/lucy-browser/mirror",
]
for cmd in cmds:
    print("$", cmd[:120])
    _, o, e = c.exec_command(cmd, timeout=120)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(out.rstrip()[:2000].encode("ascii", errors="replace").decode())
    print("---")
c.close()
