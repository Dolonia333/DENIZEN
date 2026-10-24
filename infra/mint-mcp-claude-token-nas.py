#!/usr/bin/env python3
"""Mint claude NPC MCP bearer token on NAS (separate from grok token file)."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
NPC_KEY = "claude"
LABEL = sys.argv[1] if len(sys.argv) > 1 else "office-operator"
TOKEN_PATH = INFRA.parent / ".mcp-claude-token.local.json"


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    one_liner = (
        "const db=require('/app/src/denizen-db');"
        "const gw=require('/app/src/denizen-npc-mcp-gateway');"
        f"const npcKey='{NPC_KEY}';"
        f"const label='{LABEL.replace(chr(39), '')}';"
        "db.init().then(async(i)=>{"
        "if(!i?.ok||!db.orgId)throw new Error('db init failed');"
        "const r=await gw.createMcpToken({orgId:db.orgId,npcKey,label});"
        "console.log(JSON.stringify({ok:true,npc_key:npcKey,mcp_url:r.mcp_url,token:r.token,token_id:r.token_id}));"
        "}).catch(e=>{console.error(e?.message||e);process.exit(1);});"
    )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    cmd = f'{DOCKER} exec denizen-server node -e "{one_liner}"'
    print("$", cmd[:100], "...")
    _, o, e = client.exec_command(cmd, timeout=60)
    raw = (o.read() + e.read()).decode("utf-8", errors="replace")
    client.close()

    for line in reversed(raw.splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if data.get("ok"):
            TOKEN_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(f"MCP token minted -> {TOKEN_PATH}")
            print(f"mcp_url: {data.get('mcp_url')}")
            print(f"token_id: {data.get('token_id')}")
            return 0

    print(raw)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
