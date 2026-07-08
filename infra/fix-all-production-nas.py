#!/usr/bin/env python3
"""
One-shot production repair for denizen.dolonia.cloud:

  1. Persistent layouts volume (furniture saves survive container recreate)
  2. Hotfix-sync all changed src (Office HQ, chat stability, grok-cli, doors, pathfinding)
  3. Grok CLI bridge env (secure token, restart only — no force-recreate)

Run from repo root:

  py infra/fix-all-production-nas.py

Requires SYNO_SSH_PASSWORD in infra/.env
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent

STEPS = [
    ("patch-nas-layouts-volume.py", "Persistent layouts + data volumes"),
    ("emergency-full-src-sync-nas.py", "Full src into container (recover stale image)"),
    ("hotfix-sync-denizen-nas.py", "Delta hotfix (Office HQ, data JSON, doors, chat)"),
    ("patch-grok-cli-bridge-nas.py", "Grok CLI bridge env"),
]


def main() -> int:
    print("=" * 60)
    print("Denizen production fix-all")
    print("=" * 60)
    for script, label in STEPS:
        path = INFRA / script
        if not path.is_file():
            print(f"ERROR: missing {path}", file=sys.stderr)
            return 1
        print(f"\n>>> {label} ({script})\n")
        result = subprocess.run([sys.executable, str(path)], cwd=str(ROOT))
        if result.returncode != 0:
            print(f"\nFAILED at {script} (exit {result.returncode})", file=sys.stderr)
            return result.returncode
    print("\n" + "=" * 60)
    print("All production fixes applied.")
    print("On your PC, restart the bridge with the token printed above:")
    print("  py infra/run-grok-cli-chat-bridge.py --port 9876 --token <token>")
    print("Hard-refresh the office tab (Ctrl+Shift+R).")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
