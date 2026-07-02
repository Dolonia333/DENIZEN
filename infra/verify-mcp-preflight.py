#!/usr/bin/env python3
"""Pre-flight MCP: initialize + tools/list against LAN or public URL."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

BASE = os.environ.get("DENIZEN_MCP_BASE", f"http://{os.environ.get('SYNO_HOST', '192.168.1.237')}:8888")
NPC_KEY = sys.argv[1] if len(sys.argv) > 1 else "grok"
TOKEN_FILE = REPO / ".mcp-token.local.json"


def load_token() -> str:
    if os.environ.get("DENIZEN_MCP_TOKEN"):
        return os.environ["DENIZEN_MCP_TOKEN"].strip()
    if TOKEN_FILE.is_file():
        data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        tok = data.get("token")
        if tok:
            return str(tok)
    print("No token — run: py infra/mint-mcp-token-nas.py grok")
    sys.exit(1)


def rpc(method: str, params: dict | None, token: str) -> dict:
    body = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
        "params": params or {},
    }
    url = f"{BASE.rstrip('/')}/mcp/npc/{NPC_KEY}"
    proc = subprocess.run(
        [
            "curl", "-fsS", "-m", "30",
            "-X", "POST", url,
            "-H", "Content-Type: application/json",
            "-H", f"Authorization: Bearer {token}",
            "-d", json.dumps(body),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr or proc.stdout)
        raise SystemExit(1)
    return json.loads(proc.stdout)


def main() -> int:
    token = load_token()
    print(f"==> MCP preflight {BASE}/mcp/npc/{NPC_KEY}\n")

    init = rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "preflight", "version": "1"}}, token)
    print("initialize:", json.dumps(init.get("result", init), indent=2)[:800])

    tools = rpc("tools/list", {}, token)
    names = [t.get("name") for t in (tools.get("result", {}).get("tools") or [])]
    print(f"\ntools/list: {len(names)} tools")
    for n in names[:12]:
        print(f"  - {n}")
    if len(names) > 12:
        print(f"  ... +{len(names) - 12} more")

    if not names:
        print("\nFAIL: no tools returned")
        return 1
    print("\nPASS: MCP preflight ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
