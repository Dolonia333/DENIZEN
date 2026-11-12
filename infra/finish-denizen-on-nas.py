#!/usr/bin/env python3
"""One-command: provision + deploy Denizen server on NAS + re-point mesh."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import subprocess
import sys
import urllib.request
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
DENIZEN_DIR = ROOT / "denizen"

SYNO_HOST = get_host("SYNO_HOST")
NAS_PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
PUBLIC_URL = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")


def log(msg: str) -> None:
    print(msg, flush=True)


def run_step(name: str, script: str, *, optional: bool = False) -> bool:
    path = INFRA / script
    log(f"\n{'=' * 60}\n==> {name}\n{'=' * 60}")
    proc = subprocess.run([sys.executable, str(path)], cwd=str(ROOT), env=os.environ.copy())
    if proc.returncode != 0:
        if optional:
            log(f"WARN: {name} failed (exit {proc.returncode})")
            return False
        raise SystemExit(proc.returncode)
    return True


def run_smoke(relative: str) -> None:
    script = DENIZEN_DIR / relative
    env = os.environ.copy()
    env["DENIZEN_URL"] = PUBLIC_URL
    proc = subprocess.run(["node", str(script)], cwd=str(DENIZEN_DIR), env=env)
    if proc.returncode != 0:
        log(f"WARN: smoke {relative} failed — tunnel may still point at dolonia")


def probe_lan() -> None:
    url = f"http://{SYNO_HOST}:{NAS_PORT}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            body = resp.read(500).decode("utf-8", errors="replace")
            log(f"LAN health OK ({resp.status}): {body[:200]}")
    except Exception as exc:
        log(f"WARN: LAN health check failed: {exc}")


def main() -> int:
    steps = [
        ("Apply DB migrations", "apply-migrations-nas.py"),
        ("Provision NAS server env", "provision-nas-server.py"),
        ("Deploy Denizen Docker image", "deploy-denizen-to-nas.py"),
        ("Re-point mesh agents", "repoint-mesh-to-nas.py"),
    ]
    for name, script in steps:
        run_step(name, script)

    probe_lan()
    run_smoke("scripts/smoke-nas-fleet.js")
    run_smoke("scripts/smoke-mesh-complete.js")

    log("\n" + "=" * 60)
    log("NAS Denizen server cutover checklist:")
    log(f"  1. Cloudflare tunnel: denizen.dolonia.cloud -> http://{SYNO_HOST}:{NAS_PORT}")
    log("  2. Stop dolonia watchdog Denizen restart (avoid port conflict on 8081)")
    log(f"  3. Verify public: curl {PUBLIC_URL}/api/health")
    log(f"  4. CRM smoke: cd denizen && DENIZEN_URL={PUBLIC_URL} npm run smoke:crm")
    log("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
