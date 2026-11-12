#!/usr/bin/env python3
"""Verify Denizen server on Synology (Docker + health endpoints)."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import json
import os
import sys
import urllib.error
import urllib.request

import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PUBLIC_URL = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    lan_url = f"http://{HOST}:{PORT}/api/health"
    ok = True

    log(f"==> LAN health: {lan_url}")
    try:
        health = fetch_json(lan_url)
        log(json.dumps(health, indent=2)[:1200])
        fleet = health.get("fleet") or health.get("compute")
        if fleet:
            log(f"Fleet nodes visible: {len(fleet) if isinstance(fleet, list) else 'yes'}")
    except Exception as exc:
        log(f"FAIL LAN: {exc}")
        ok = False

    log(f"\n==> Public health: {PUBLIC_URL}/api/health")
    try:
        pub = fetch_json(f"{PUBLIC_URL}/api/health")
        role = pub.get("server_role") or pub.get("role")
        log(f"Public OK (role={role})")
    except Exception as exc:
        log(f"WARN public (tunnel may still point at dolonia): {exc}")

    if PASSWORD:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)
        for cmd in [
            f"{DOCKER} ps --filter name=denizen-server --format '{{{{.Names}}}}\t{{{{.Status}}}}'",
            f"tail -n 15 {REMOTE_DIR}/../denizen-server/agent.log 2>/dev/null || "
            f"{DOCKER} logs --tail 15 denizen-server 2>&1",
        ]:
            log(f"\n$ {cmd[:80]}")
            _stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
            out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
            if out.strip():
                try:
                    print(out.rstrip())
                except UnicodeEncodeError:
                    print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
        client.close()

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
