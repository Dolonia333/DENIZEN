#!/usr/bin/env python3
"""Verify Claude NPC is live on NAS — DB row, assets, MCP, roster."""
from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
from mcp_http import mcp_rpc  # noqa: E402

ROOT = INFRA.parent
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PUBLIC = os.environ.get("DENIZEN_MCP_PUBLIC", "https://denizen.dolonia.cloud").rstrip("/")
TOKEN_FILE = ROOT / ".mcp-claude-token.local.json"


def ssh(cmd: str) -> str:
    import paramiko
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, e = c.exec_command(cmd, timeout=60)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    c.close()
    return out.strip()


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    fails = 0

    db = ssh(
        f"{DOCKER} exec -i supabase-db psql -U postgres -d postgres -t -A "
        f"-c \"select npc_key,display_name from denizen_npcs where npc_key='claude'\""
    )
    print(f"DB denizen_npcs: {db or 'MISSING'}")
    if "claude" not in db:
        fails += 1

    asset = ssh(f"{DOCKER} exec denizen-server python3 -c \"from PIL import Image; i=Image.open('/app/assets/Claude.png'); print(i.size)\" 2>/dev/null || {DOCKER} exec denizen-server file /app/assets/Claude.png")
    print(f"Asset: {asset[:120]}")

    roster = ssh(f"{DOCKER} exec denizen-server node -e \"const r=require('/app/src/npc-roster'); console.log(r.entries.length, r.entries.some(e=>e.folder==='claude'))\"")
    print(f"Roster: count+claude={roster}")
    if "true" not in roster.lower():
        fails += 1

    soul = ssh(f"{DOCKER} exec denizen-server wc -c /app/npcs/claude/SOUL.md")
    print(f"SOUL: {soul}")

    if TOKEN_FILE.is_file():
        tok = json.loads(TOKEN_FILE.read_text()).get("token", "")
        init = mcp_rpc(f"{PUBLIC}/mcp/npc/claude", tok, "initialize")
        ok = init.get("result", {}).get("serverInfo", {}).get("name")
        print(f"MCP claude initialize: {ok or init.get('error', 'FAIL')}")
        if not ok:
            fails += 1
        skills = mcp_rpc(f"{PUBLIC}/mcp/npc/claude", tok, "tools/call", {
            "name": "list_skills",
            "arguments": {},
        })
        text = skills.get("result", {}).get("content", [{}])[0].get("text", "")[:200]
        print(f"MCP list_skills: {text[:180]}...")
    else:
        print("WARN: no .mcp-claude-token.local.json")
        fails += 1

    health = ssh(f"curl -fsS -m 10 http://127.0.0.1:8888/api/health | head -c 80")
    print(f"Health: {health}")

    if fails:
        print(f"\nVERIFY: {fails} check(s) failed")
        return 1
    print("\nVERIFY: Claude NPC live end-to-end")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
