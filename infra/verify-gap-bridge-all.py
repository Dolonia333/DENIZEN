#!/usr/bin/env python3
"""Master gap-bridge gate — runs all phase verify scripts."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent

SCRIPTS = [
    "verify-phase3-marcus-business-crm.py",
    "verify-phase4-agent-souls.py",
    "verify-phase5-world-isolation.py",
    "verify-phase6-mcp-delegation.py",
    "verify-org-isolation.py",
    "verify-mcp-preflight.py",
]


def main() -> int:
    print("==> Gap bridge — full verification gate\n")
    failed = []
    for script in SCRIPTS:
        path = INFRA / script
        if not path.is_file():
            print(f"SKIP {script}")
            continue
        print(f"--- {script} ---")
        proc = subprocess.run([sys.executable, str(path)], cwd=str(INFRA.parent))
        if proc.returncode != 0:
            failed.append(script)
        print()

    if failed:
        print(f"FAIL: {', '.join(failed)}")
        return 1
    print("PASS: gap bridge — all gates green")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
