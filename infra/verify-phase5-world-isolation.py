#!/usr/bin/env python3
"""Phase 5: per-org world-state buckets + WS org_id filtering."""
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
        ["node", "--test", str(DENIZEN / "tests" / "world-state-org.test.js")],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        print(proc.stdout[-800:] if proc.stdout else "")
        print(proc.stderr[-800:] if proc.stderr else "", file=sys.stderr)
    return proc.returncode == 0


def nas_check(client) -> tuple[bool, dict]:
    one_liner = (
        "const fs=require('fs');"
        "const ws='/app/src/world-state.js';"
        "const vo='/app/src/visitor-office-registry.js';"
        "const o=require('/app/src/visitor-office-registry.js');"
        "console.log(JSON.stringify({"
        "worldState:fs.existsSync(ws),"
        "visitorOffice:fs.existsSync(vo),"
        "forOrg:typeof require('/app/src/world-state.js').forOrg==='function',"
        "orgScoped:!!o.ORG_SCOPED_WS_TYPES"
        "}));"
    )
    _, o, _ = client.exec_command(
        f'{DOCKER} exec denizen-server node -e "{one_liner}"',
        timeout=30,
    )
    raw = o.read().decode("utf-8", errors="replace")
    for line in reversed(raw.splitlines()):
        if line.strip().startswith("{"):
            try:
                data = json.loads(line.strip())
                ok = data.get("worldState") and data.get("forOrg") and data.get("orgScoped")
                return bool(ok), data
            except json.JSONDecodeError:
                continue
    return False, {"_raw": raw[:200]}


def main() -> int:
    print("==> Phase 5: world state org isolation\n")
    local_ok = run_local_tests()
    print(f"local world-state-org tests: {'PASS' if local_ok else 'FAIL'}")
    if not local_ok:
        return 1

    if not PASSWORD:
        print("SYNO_SSH_PASSWORD missing — local-only PASS")
        return 0

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    nas_ok, nas = nas_check(client)
    client.close()
    print(f"NAS world isolation:    {'PASS' if nas_ok else 'FAIL'}")
    print(f"  detail: {nas}")

    if nas_ok:
        print("\nPASS: Phase 5 world isolation foundation")
        return 0
    print("\nFAIL: deploy world-state + visitor-office-registry to NAS")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
