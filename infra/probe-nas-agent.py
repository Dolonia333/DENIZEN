#!/usr/bin/env python3
"""Probe NAS SSH + Denizen fleet metrics for the NAS agent."""

from __future__ import annotations

from hostcfg import get_host
import json
import os
import sys
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
REMOTE_DIR = os.environ.get("SYNO_AGENT_DIR", "/volume1/docker/denizen-agent")
DENIZEN_URL = os.environ.get("DENIZEN_URL", "http://127.0.0.1:8081").rstrip("/")
ROOT = Path(__file__).resolve().parent.parent


def log(msg: str) -> None:
    print(msg, flush=True)


def read_bundle_env() -> dict[str, str]:
    path = ROOT / "infra" / "nas-agent-bundle" / ".env"
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def main() -> int:
    ok = True

    if PASSWORD:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        log(f"==> SSH {USER}@{HOST}")
        client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)
        for cmd in [
            f"ps aux | grep '[n]as-metrics-agent.js' || echo NO_AGENT",
            f"test -f '{REMOTE_DIR}/agent.log' && tail -n 5 '{REMOTE_DIR}/agent.log' || echo NO_LOG",
        ]:
            log(f"$ {cmd}")
            _stdin, stdout, stderr = client.exec_command(cmd)
            print((stdout.read() + stderr.read()).decode("utf-8", errors="replace").rstrip())
        client.close()
    else:
        log("SKIP SSH (SYNO_SSH_PASSWORD not set)")

    bundle = read_bundle_env()
    machine_id = bundle.get("DENIZEN_MACHINE_ID", f"nas-{HOST}")
    try:
        with urllib.request.urlopen(f"{DENIZEN_URL}/api/health", timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        fleet = (data.get("hardware") or {}).get("fleet") or []
        nas = next((m for m in fleet if m.get("machine_id") == machine_id or m.get("role") == "nas"), None)
        if nas and nas.get("cpu_percent") is not None:
            log(f"PASS fleet metrics for {machine_id}: CPU {nas.get('cpu_percent')}% RAM {nas.get('ram', {}).get('used_percent')}%")
        elif nas and nas.get("reachable"):
            log(f"WARN NAS reachable but no live CPU/RAM yet ({machine_id})")
            ok = False
        else:
            log(f"FAIL NAS machine not in fleet ({machine_id})")
            ok = False
    except Exception as exc:
        log(f"FAIL health check: {exc}")
        ok = False

    print("NAS_AGENT_READY true" if ok else "NAS_AGENT_READY false")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
