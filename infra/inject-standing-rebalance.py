#!/usr/bin/env python3
"""Inject Claude standing rebalance recommendations into Bouncer + Bob memory via Team MCP."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
from mcp_http import tool_call  # noqa: E402

ROOT = INFRA.parent
STANDING = ROOT / "denizen" / "data" / "telemetry-rebalance-standing.json"
TOKEN_FILE = ROOT / ".mcp-team-token.local.json"
BASE = __import__("os").environ.get("DENIZEN_MCP_PUBLIC", "https://denizen.dolonia.cloud").rstrip("/")


def inject_npc(token: str, npc_key: str, body: str) -> dict:
    return tool_call(
        f"{BASE}/mcp/team",
        token,
        "run_as_npc",
        {
            "npc_key": npc_key,
            "tool": "update_memory",
            "arguments": {
                "body": body[:2000],
                "topic": "telemetry-rebalance-standing",
                "outcome": "fleet-optimization",
            },
        },
    )


def directive_bouncer(token: str, body: str) -> dict:
    """Bouncer is protected from run_as_npc — assign standing rebalance via broadcast_task."""
    return tool_call(
        f"{BASE}/mcp/team",
        token,
        "broadcast_task",
        {
            "npc_keys": ["bouncer"],
            "task": body[:2000],
            "urgent": False,
        },
    )


def main() -> int:
    if not STANDING.is_file():
        print(f"Missing {STANDING}", file=sys.stderr)
        return 1
    data = json.loads(STANDING.read_text(encoding="utf-8"))
    token = json.loads(TOKEN_FILE.read_text()).get("token") if TOKEN_FILE.is_file() else ""
    if not token:
        print("No team token", file=sys.stderr)
        return 1

    for display, key in [("Bouncer", "bouncer"), ("Bob", "bob")]:
        block = data.get("npcs", {}).get(display, {})
        recs = block.get("recommendations", [])
        stats = block.get("stats", {})
        body = (
            f"Standing fleet rebalance ({data.get('source', 'telemetry')}):\n"
            f"Stats: {json.dumps(stats)}\n"
            + "\n".join(f"- {r}" for r in recs)
            + "\n\nApply on next think cycles. Re-verify after sync-telemetry-nas --run-job."
        )
        if key == "bouncer":
            res = directive_bouncer(token, body)
        else:
            res = inject_npc(token, key, body)
        print(display, json.dumps(res.get("parsed") or res, indent=2)[:600])

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
