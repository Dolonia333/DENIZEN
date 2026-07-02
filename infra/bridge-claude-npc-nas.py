#!/usr/bin/env python3
"""Bridge Claude NPC gaps: migration → hotfix deploy → seed soul → mint MCP token."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INFRA = ROOT / "infra"


def run(cmd: list[str], label: str) -> int:
    print(f"\n==> {label}")
    r = subprocess.run(cmd, cwd=str(ROOT))
    if r.returncode != 0:
        print(f"FAIL: {label}", file=sys.stderr)
    return r.returncode


def main() -> int:
    steps = [
        ([sys.executable, str(INFRA / "apply-migrations-nas.py")], "Apply DB migration (claude npc)"),
        ([sys.executable, str(INFRA / "hotfix-claude-npc-nas.py")], "Deploy Claude sprite + roster + SOUL"),
        ([sys.executable, str(INFRA / "seed-agent-souls-nas.py")], "Seed agent souls"),
        ([sys.executable, str(INFRA / "mint-mcp-claude-token-nas.py"), "office-operator"], "Mint claude MCP token"),
    ]
    for cmd, label in steps:
        code = run(cmd, label)
        if code != 0:
            return code
    print("\nPASS: Claude NPC bridged end-to-end")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
