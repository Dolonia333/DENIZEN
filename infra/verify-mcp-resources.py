#!/usr/bin/env python3
"""Smoke test MCP resource templates — Cloudflare-safe."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
from mcp_http import mcp_rpc  # noqa: E402

ROOT = INFRA.parent
TOKEN_FILE = ROOT / ".mcp-token.local.json"
HOST = get_host("SYNO_HOST")
PUBLIC = os.environ.get("DENIZEN_MCP_PUBLIC", "https://denizen.dolonia.cloud").rstrip("/")
BASE = os.environ.get("DENIZEN_MCP_BASE", PUBLIC).rstrip("/")


def main() -> int:
    token = json.loads(TOKEN_FILE.read_text()).get("token") if TOKEN_FILE.is_file() else ""
    if not token:
        print("No .mcp-token.local.json", file=sys.stderr)
        return 1

    print(f"base: {BASE}")
    grok_url = f"{BASE}/mcp/npc/grok"
    templates = mcp_rpc(grok_url, token, "resources/templates/list")
    if templates.get("error"):
        print("FAIL:", templates["error"])
        return 1
    rts = templates.get("result", {}).get("resourceTemplates", [])
    print(f"grok templates: {len(rts)}")
    assert any("telemetry://grok/latest/{npcId}" in t.get("uriTemplate", "") for t in rts)

    filtered = mcp_rpc(grok_url, token, "resources/read", {"uri": "telemetry://grok/latest/bouncer"})
    text = filtered.get("result", {}).get("contents", [{}])[0].get("text", "")
    data = json.loads(text)
    print(f"bouncer filtered facts: {len(data.get('facts', []))} generatedAt={data.get('generatedAt')}")
    assert data.get("filtered") is True

    if len(data.get("facts", [])) == 0 and not data.get("generatedAt"):
        print("WARN: telemetry empty — py infra/sync-telemetry-nas.py")
        return 2

    print("PASS: MCP resource templates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
