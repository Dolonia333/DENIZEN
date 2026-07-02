#!/usr/bin/env python3
"""Smoke test Team MCP — works via Cloudflare public URL or NAS LAN."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
from mcp_http import mcp_rpc  # noqa: E402

ROOT = INFRA.parent
TOKEN_FILE = ROOT / ".mcp-team-token.local.json"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PUBLIC = os.environ.get("DENIZEN_MCP_PUBLIC", "https://denizen.dolonia.cloud").rstrip("/")
BASE = os.environ.get("DENIZEN_MCP_BASE", PUBLIC).rstrip("/")


def load_token() -> str:
    tok = os.environ.get("DENIZEN_TEAM_MCP_TOKEN", "").strip()
    if tok:
        return tok
    if TOKEN_FILE.is_file():
        return str(json.loads(TOKEN_FILE.read_text(encoding="utf-8")).get("token") or "")
    return ""


def main() -> int:
    token = load_token()
    if not token:
        print("No team token — py infra/mint-mcp-team-token-nas.py", file=sys.stderr)
        return 1

    url = f"{BASE}/mcp/team"
    print(f"base: {BASE}")

    init = mcp_rpc(url, token, "initialize")
    if init.get("error"):
        print("initialize FAIL:", json.dumps(init["error"], indent=2)[:800])
        return 1
    assert init.get("result", {}).get("serverInfo", {}).get("name") == "denizen-team"
    print("initialize: OK")

    templates = mcp_rpc(url, token, "resources/templates/list")
    rts = templates.get("result", {}).get("resourceTemplates", [])
    print(f"resource templates: {len(rts)}")
    assert any("telemetry://fleet/latest/{npcId}" in t.get("uriTemplate", "") for t in rts)

    status = mcp_rpc(url, token, "tools/call", {"name": "team_status", "arguments": {}})
    parsed = json.loads(status["result"]["content"][0]["text"])
    print(
        f"team_status: teammates={parsed.get('teammate_count')} "
        f"inference={parsed.get('inference', {}).get('any_reachable')}"
    )

    filtered = mcp_rpc(url, token, "resources/read", {"uri": "telemetry://fleet/latest/bouncer"})
    data = json.loads(filtered["result"]["contents"][0]["text"])
    fact_n = len(data.get("facts", []))
    gen = data.get("generatedAt")
    print(f"bouncer telemetry: facts={fact_n} filtered={data.get('filtered')} generatedAt={gen}")

    if fact_n == 0 and not gen:
        print("WARN: telemetry empty on server — run: py infra/sync-telemetry-nas.py")
        return 2

    print("PASS: Team MCP")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
