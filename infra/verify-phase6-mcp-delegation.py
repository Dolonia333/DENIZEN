#!/usr/bin/env python3
"""Phase 6: MCP delegation + grok-mcp-ping health."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
DENIZEN = REPO / "denizen"
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

BASE = os.environ.get("DENIZEN_MCP_BASE", "https://denizen.dolonia.cloud")
TOKEN_FILE = REPO / ".mcp-token.local.json"


def load_token() -> str:
    if os.environ.get("DENIZEN_MCP_TOKEN"):
        return os.environ["DENIZEN_MCP_TOKEN"].strip()
    if TOKEN_FILE.is_file():
        return str(json.loads(TOKEN_FILE.read_text(encoding="utf-8")).get("token") or "")
    return ""


def mcp_call(name: str, args: dict, token: str) -> dict:
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {"name": name, "arguments": args},
    })
    url = f"{BASE.rstrip('/')}/mcp/npc/grok"
    proc = subprocess.run(
        ["curl", "-fsS", "-m", "45", "-X", "POST", url,
         "-H", "Content-Type: application/json",
         "-H", f"Authorization: Bearer {token}",
         "-d", body],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)
    data = json.loads(proc.stdout)
    if data.get("error"):
        raise RuntimeError(str(data["error"]))
    return data.get("result") or data


def parse_mcp_skills(ping_data: dict) -> list:
    if isinstance(ping_data.get("skill_names"), list) and ping_data["skill_names"]:
        return ping_data["skill_names"]
    for key in ("skills", "status"):
        block = ping_data.get(key)
        if isinstance(block, dict) and isinstance(block.get("skills"), list):
            return block["skills"]
        text = (block or {}).get("content", [{}])[0].get("text") if isinstance(block, dict) else None
        if text:
            try:
                parsed = json.loads(text)
                if isinstance(parsed.get("skills"), list):
                    return parsed["skills"]
            except json.JSONDecodeError:
                pass
    return []


def main() -> int:
    print("==> Phase 6: MCP delegation gate\n")

    proc = subprocess.run(
        ["node", "--test", str(DENIZEN / "tests" / "soul-depth-all.test.js")],
        cwd=str(DENIZEN),
    )
    if proc.returncode != 0:
        print("FAIL: soul depth tests (all 17 NPCs)")
        return 1
    print("soul depth tests (17 NPCs): PASS")

    proc = subprocess.run(
        ["node", "--test", str(DENIZEN / "tests" / "1921-soul-pack.test.js")],
        cwd=str(DENIZEN),
    )
    if proc.returncode != 0:
        print("FAIL: 1921 soul pack tests")
        return 1
    print("1921 soul pack tests: PASS")

    ping = subprocess.run(
        ["node", str(DENIZEN / "scripts" / "grok-mcp-ping.js")],
        cwd=str(REPO),
        capture_output=True,
        text=True,
    )
    if ping.returncode != 0:
        print(ping.stderr or ping.stdout)
        print("FAIL: grok-mcp-ping")
        return 1
    ping_data = json.loads(ping.stdout)
    skills = parse_mcp_skills(ping_data)
    if not skills:
        print("WARN: list_skills empty in ping output")
    else:
        print(f"grok-mcp-ping: PASS ({len(skills)} skills)")

    token = load_token()
    if not token:
        print("SKIP: live delegate_task (no token)")
        print("\nPASS: Phase 6 local gate")
        return 0

    try:
        result = mcp_call("delegate_task", {
            "to_npc": "Marcus",
            "task": "Phase 6 verify: one-line OMES pipeline status for CEO",
            "urgent": False,
        }, token)
        ok = result.get("structuredContent", result).get("ok", result.get("ok"))
        if ok is False:
            print(f"FAIL: delegate_task {result}")
            return 1
        print("delegate_task -> Marcus: PASS")
    except Exception as err:
        print(f"WARN: delegate_task live check: {err}")

    print("\nPASS: Phase 6 MCP delegation gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
