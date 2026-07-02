#!/usr/bin/env python3
"""Multi-user gate — runs all org-isolation verify scripts in order."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent

SCRIPTS = [
    ("Phase 3 business context", "verify-phase3-marcus-business-crm.py"),
    ("Phase 4 agent souls", "verify-phase4-agent-souls.py"),
    ("Phase 5 world isolation", "verify-phase5-world-isolation.py"),
    ("Phase 6 MCP delegation", "verify-phase6-mcp-delegation.py"),
    ("MCP preflight", "verify-mcp-preflight.py"),
]


def main() -> int:
    print("==> Multi-user verification gate\n")
    failed = []
    for label, script in SCRIPTS:
        path = INFRA / script
        if not path.is_file():
            print(f"SKIP {label}: {script} not found")
            continue
        print(f"--- {label} ---")
        proc = subprocess.run([sys.executable, str(path)], cwd=str(INFRA.parent))
        if proc.returncode != 0:
            failed.append(label)
        print()

    if failed:
        print(f"FAIL: {', '.join(failed)}")
        return 1
    print("PASS: all multi-user gate scripts green")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
