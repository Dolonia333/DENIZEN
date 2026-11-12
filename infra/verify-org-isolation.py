#!/usr/bin/env python3
"""Verify org soul isolation — zion 1921 vs acme generic."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
DENIZEN = REPO / "denizen"
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def run_local_tests() -> bool:
    proc = subprocess.run(
        ["node", "--test", str(DENIZEN / "tests" / "org-soul-isolation.test.js")],
        cwd=str(DENIZEN),
    )
    return proc.returncode == 0


def nas_soul_snippets(client) -> dict:
    cmd = f"{DOCKER} exec denizen-server node scripts/smoke-org-soul-isolation.js"
    _, o, e = client.exec_command(cmd, timeout=90)
    raw = (o.read() + e.read()).decode("utf-8", errors="replace")
    for line in reversed(raw.splitlines()):
        if line.strip().startswith("{"):
            try:
                return json.loads(line.strip())
            except json.JSONDecodeError:
                continue
    return {"_raw": raw[:500]}


def main() -> int:
    print("==> Org soul isolation gate\n")
    if not run_local_tests():
        print("FAIL: local org-soul-isolation tests")
        return 1
    print("local org-soul-isolation tests: PASS")

    if not PASSWORD:
        print("SKIP: NAS check (no SYNO_SSH_PASSWORD)")
        print("\nPASS: org soul isolation (local only)")
        return 0

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    nas = nas_soul_snippets(client)
    client.close()
    print(f"NAS soul check: {nas}")

    if nas.get("error"):
        print(f"FAIL: NAS soul check — {nas['error']}")
        return 1
    if not nas.get("zion_has_omes"):
        print("FAIL: zion Abby soul should reference 1921/OMES")
        return 1
    if not nas.get("acme_generic") or not nas.get("acme_no_omes"):
        print("FAIL: acme Abby should be generic-office without 1921 pursuits")
        print("  Run: py infra/seed-acme-generic-nas.py")
        return 1

    print("\nPASS: org soul isolation — zion 1921, acme generic")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
