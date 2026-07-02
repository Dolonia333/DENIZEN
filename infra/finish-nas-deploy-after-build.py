#!/usr/bin/env python3
"""Wait for NAS docker build, restart container, verify Playwright."""
from __future__ import annotations

import load_infra_env  # noqa: F401
import os
import sys
import time

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def run(c, cmd, timeout=600):
    print("$", cmd[:120], flush=True)
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:3000].encode("ascii", errors="replace").decode())
    return code, out


def build_running(c) -> bool:
    _, out = run(c, "ps aux | grep 'docker build' | grep -v grep | wc -l", 30)
    try:
        return int(out.strip()) > 0
    except ValueError:
        return False


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    print("==> Waiting for docker build on NAS (up to 45 min)...")
    deadline = time.time() + 45 * 60
    while time.time() < deadline:
        if not build_running(c):
            break
        print("... still building", flush=True)
        time.sleep(45)
    else:
        print("ERROR: build still running after timeout", file=sys.stderr)
        return 1

    print("==> Build finished — restarting denizen-server with new image")
    run(c, f"{DOCKER} rm -f denizen-server 2>/dev/null || true")
    rc, _ = run(
        c,
        f"cd '{REMOTE_DIR}' && {DOCKER} compose -f docker-compose.yml up -d",
        300,
    )
    if rc != 0:
        return rc

    time.sleep(12)
    run(c, f"curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 800")
    run(
        c,
        f"{DOCKER} exec denizen-server node -e "
        "\"const {{chromium}}=require('playwright');const p=chromium.executablePath();"
        "const fs=require('fs');console.log('exe',p,'exists',fs.existsSync(p))\"",
        60,
    )
    run(
        c,
        f"{DOCKER} exec denizen-server sh -c "
        "'node jelly/vendor/skills/web-search/web-search.mjs --query deploy-probe --headless true 2>&1' | tail -3",
        120,
    )
    c.close()
    print("==> Done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
