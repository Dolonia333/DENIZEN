#!/usr/bin/env python3
"""Mint an MCP bearer token on NAS (bypasses UI — for preflight / Grok wiring)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
NPC_KEY = sys.argv[1] if len(sys.argv) > 1 else "grok"
LABEL = sys.argv[2] if len(sys.argv) > 2 else "preflight"


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    one_liner = (
        "const db=require('/app/src/denizen-db');"
        "const gw=require('/app/src/denizen-npc-mcp-gateway');"
        f"const npcKey='{NPC_KEY.replace(chr(39), '')}';"
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
            token_path = INFRA.parent / ".mcp-token.local.json"
            token_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            sys.stdout.write("MCP token minted (saved once to .mcp-token.local.json)\n")
            sys.stdout.write(f"mcp_url: {data.get('mcp_url')}\n")
            sys.stdout.write(f"token_id: {data.get('token_id')}\n")
            return 0

    sys.stdout.write(raw.encode("ascii", errors="replace").decode("ascii") + "\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
