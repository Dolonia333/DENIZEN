#!/usr/bin/env python3
"""Install Playwright Chromium inside denizen-server on NAS (one-time / after deploy)."""
from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

INSTALL = (
    f"{DOCKER} exec denizen-server sh -c "
    "'unset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD && npx playwright install chromium 2>&1'"
)
PROBE = (
    f"{DOCKER} exec denizen-server sh -c "
    "'node jelly/vendor/skills/web-search/web-search.mjs --query playwright-probe --headless true 2>&1'"
)


def run(client, cmd, timeout=600):
    print("$", cmd[:140], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(out.rstrip()[:4000].encode("ascii", errors="replace").decode())
    return o.channel.recv_exit_status()


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", flush=True)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
    print("==> Installing Playwright Chromium in denizen-server (may take a few minutes)...")
    rc = run(c, INSTALL, timeout=600)
    if rc != 0:
        print(f"install exit {rc}", flush=True)
    print("==> Probing web-search...")
    run(c, PROBE, timeout=120)
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
