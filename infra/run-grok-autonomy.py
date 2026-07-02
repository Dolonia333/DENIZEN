#!/usr/bin/env python3
"""Run Grok ↔ Denizen autonomy loop (xAI Responses API + MCP)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
SCRIPT = REPO / "denizen" / "scripts" / "grok-denizen-autonomy.js"

sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401


def main() -> int:
    if not SCRIPT.is_file():
        print(f"missing {SCRIPT}")
        return 1
    cmd = ["node", str(SCRIPT), *sys.argv[1:]]
    return subprocess.call(cmd, cwd=str(REPO / "denizen"))


if __name__ == "__main__":
    raise SystemExit(main())
