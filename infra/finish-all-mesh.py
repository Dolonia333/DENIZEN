#!/usr/bin/env python3
"""Provision and deploy NAS + Kali mesh agents, apply migrations, run smoke tests."""

from __future__ import annotations

import load_infra_env  # noqa: F401 — loads infra/.env

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
DENIZEN_DIR = ROOT / "denizen"
DENIZEN_URL = os.environ.get("DENIZEN_URL", "http://127.0.0.1:8081").rstrip("/")

SMOKE_SCRIPTS = [
    "scripts/smoke-mesh-complete.js",
    "scripts/smoke-mesh-jobs-flow.js",
    "scripts/smoke-nas-fleet.js",
    "test-compute-integration.js",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def run_step(name: str, script: str, *, optional: bool = False) -> bool:
    path = INFRA / script
    log(f"\n{'=' * 60}\n==> {name}\n{'=' * 60}")
    proc = subprocess.run(
        [sys.executable, str(path)],
        cwd=str(ROOT),
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        if optional:
            log(f"WARN: {name} failed (exit {proc.returncode}), continuing")
            return False
        log(f"ERROR: {name} failed with exit {proc.returncode}")
        raise SystemExit(proc.returncode)
    return True


def run_node_smoke(relative_path: str) -> None:
    script = DENIZEN_DIR / relative_path
    if not script.is_file():
        log(f"ERROR: smoke script not found: {script}")
        raise SystemExit(1)
    log(f"\n{'=' * 60}\n==> Smoke: {relative_path}\n{'=' * 60}")
    proc = subprocess.run(
        ["node", str(script)],
        cwd=str(DENIZEN_DIR),
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        log(f"ERROR: {relative_path} failed with exit {proc.returncode}")
        raise SystemExit(proc.returncode)


def print_final_health() -> None:
    log(f"\n{'=' * 60}\n==> Final Denizen health\n{'=' * 60}")
    try:
        with urllib.request.urlopen(f"{DENIZEN_URL}/api/health", timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        print(json.dumps(data, indent=2))
        fleet = (data.get("hardware") or {}).get("fleet") or []
        if fleet:
            log("\nFleet summary:")
            for machine in fleet:
                mid = machine.get("machine_id", "?")
                label = machine.get("label") or machine.get("role") or "?"
                cpu = machine.get("cpu_percent")
                ram = (machine.get("ram") or {}).get("used_percent")
                reachable = machine.get("reachable")
                log(f"  - {mid} ({label}): reachable={reachable} cpu={cpu}% ram={ram}%")
    except Exception as exc:
        log(f"WARN: could not fetch health: {exc}")


def main() -> int:
    run_step("Provision NAS agent", "provision-nas-agent.py")
    run_step("Provision Kali agent", "provision-kali-agent.py")
    run_step("Apply NAS migrations", "apply-migrations-nas.py")
    run_step("Deploy NAS agent", "deploy-nas-agent.py")

    kali_password = os.environ.get("KALI_SSH_PASSWORD", "").strip()
    kali_key = os.environ.get("KALI_SSH_KEY", "").strip()
    kali_syno_fallback = os.environ.get("SYNO_SSH_PASSWORD", "").strip()
    if kali_password or kali_key or kali_syno_fallback:
        if not run_step("Deploy Kali agent", "deploy-kali-agent.py", optional=True):
            log(
                "\nKali SSH deploy failed — on Kali run:\n"
                "  export DENIZEN_FLEET_AGENT_TOKEN=<from denizen/.env>\n"
                "  export DENIZEN_PULL_URL=http://100.71.54.109:8081\n"
                "  bash infra/pull-install-kali-agent.sh"
            )
    else:
        log("\nSKIP Deploy Kali agent (no KALI_SSH_PASSWORD / KALI_SSH_KEY / SYNO_SSH_PASSWORD)")

    run_step("Probe NAS agent", "probe-nas-agent.py")

    for smoke in SMOKE_SCRIPTS:
        run_node_smoke(smoke)

    print_final_health()
    log("\n==> Mesh finish complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
