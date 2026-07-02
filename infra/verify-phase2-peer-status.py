#!/usr/bin/env python3
"""Phase 2: peer work-status returns live task state (not scripted replay)."""
from __future__ import annotations

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

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def main() -> int:
    print("==> Phase 2: peer work-status (live directive in reply)\n")

    script = DENIZEN / "scripts" / "phase2-peer-status.js"
    proc = subprocess.run(
        ["node", str(script), HOST, PORT],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=45,
    )
    data = {}
    for line in reversed((proc.stdout or "").splitlines()):
        if line.strip().startswith("{"):
            try:
                data = json.loads(line.strip())
                break
            except json.JSONDecodeError:
                continue

    reply = data.get("reply") or {}
    text = (reply.get("text") or "").lower()
    scripted = reply.get("scripted")

    print(f"reply:     {(reply.get('text') or '')[:500]}")
    print(f"scripted:  {scripted}")

    has_directive = "direct order" in text or "phase 2 probe" in text or "readme" in text
    has_live = "task" in text or "coding" in text or "in-progress" in text or "action" in text
    scripted_bad = scripted is True and not has_directive

    print("\n--- Phase 2 verdict ---")
    print(f"scripted replay:  {'YES (bad)' if scripted_bad else 'NO'}")
    print(f"live state hint:  {'YES' if has_directive or has_live else 'NO'}")

    if reply.get("text") and (has_directive or has_live) and not scripted_bad:
        print("\nPASS: work-status path surfaced live state")
        return 0
    if reply.get("text") and scripted is False:
        print("\nPASS: work-status (scripted=false)")
        return 0
    print("\nFAIL or PARTIAL")
    if proc.stderr:
        print(proc.stderr[:400], file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
