#!/usr/bin/env python3
"""Phase 4: agent_souls — DB-backed SOUL/MEMORY per org."""
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
        ["node", "--test", str(DENIZEN / "tests" / "agent-souls.test.js")],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0 and proc.stderr:
        print(proc.stderr[:500], file=sys.stderr)
    return proc.returncode == 0


def nas_check(client) -> tuple[bool, dict]:
    one_liner = (
        "const fs=require('fs');"
        "const p='/app/src/agent-souls.js';"
        "const m='/app/supabase/migrations/20260624000001_agent_souls.sql';"
        "console.log(JSON.stringify({"
        "module:fs.existsSync(p),"
        "migration:fs.existsSync(m),"
        "hydrate:typeof require('/app/src/npc-brains.js').prototype.hydrateAgentSoulsFromDb==='function'"
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
                ok = data.get("module") and data.get("migration")
                return bool(ok), data
            except json.JSONDecodeError:
                continue
    return False, {"_raw": raw[:200]}


def main() -> int:
    print("==> Phase 4: agent_souls foundation\n")
    local_ok = run_local_tests()
    print(f"local agent-souls tests: {'PASS' if local_ok else 'FAIL'}")
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
    print(f"NAS files present:      {'PASS' if nas_ok else 'FAIL'}")
    print(f"  detail: {nas}")
    print("\nNext: apply migration + run seed-agent-souls.js on NAS")
    print("  py infra/apply-migrations-nas.py")
    print("  node denizen/scripts/seed-agent-souls.js zion 1921-govcon")

    if nas_ok:
        print("\nPASS: Phase 4 foundation deployed (migrate + seed to complete)")
        return 0
    print("\nFAIL: deploy agent_souls files to NAS")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
