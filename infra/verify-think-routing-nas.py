#!/usr/bin/env python3
"""Verify think() routes to lmstudio-fast in the live NAS container."""
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
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

NODE_TEST = (
    "const NpcBrainManager=require('/app/src/npc-brains.js');"
    "const m=new NpcBrainManager();"
    "const main={...m.providers.lmstudio,providerKey:'lmstudio'};"
    "const pinned=m._pinThinkToFastSlot(main,{kind:'think'});"
    "const chat=m._pinThinkToFastSlot(main,{kind:'chat'});"
    "console.log(JSON.stringify({think:{providerKey:pinned.providerKey,model:pinned.model},"
    "chat:{providerKey:chat.providerKey,model:chat.model}}));"
)


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, o, e = client.exec_command(
        f"{DOCKER} exec denizen-server node -e {json.dumps(NODE_TEST)}",
        timeout=60,
    )
    out = o.read().decode().strip()
    err = e.read().decode().strip()
    if err:
        print(err, file=sys.stderr)
    if not out:
        print("no output from container test", file=sys.stderr)
        return 1

    data = json.loads(out.splitlines()[-1])
    think = data["think"]
    chat = data["chat"]
    ok = (
        think["providerKey"] == "lmstudio-fast"
        and "gemma" in (think["model"] or "").lower()
        and chat["providerKey"] == "lmstudio"
        and "ministral" in (chat["model"] or "").lower()
    )
    print(json.dumps(data, indent=2))
    if not ok:
        print("FAILED: think/chat routing mismatch", file=sys.stderr)
        return 1
    print("ok unit routing: think->fast, chat->main")

    _, o, _ = client.exec_command(
        f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/telemetry/llm?kind=think&limit=15",
        timeout=20,
    )
    tel_raw = o.read().decode()
    try:
        tel = json.loads(tel_raw)
        calls = tel.get("calls") or []
        if calls:
            print("\nrecent think telemetry:")
            for c in calls[:8]:
                print(f"  {c.get('npc','?'):8} {c.get('provider','?'):14} {c.get('model','?')[:40]}")
            bad = [
                c for c in calls
                if c.get("kind") == "think"
                and "ministral" in (c.get("model") or "").lower()
                and (c.get("at") or 0) > 0  # noqa: placeholder
            ]
            # Only flag post-deploy thinks if we can tell — show either way
            ministral_thinks = [c for c in calls if "ministral" in (c.get("model") or "").lower()]
            if ministral_thinks:
                print(f"\nwarn: {len(ministral_thinks)} recent think rows still show ministral (may be pre-deploy)")
            else:
                print("\nok no ministral in last 15 think rows")
        else:
            print("\n(no think telemetry yet — office idle)")
    except json.JSONDecodeError:
        print("telemetry fetch failed", tel_raw[:200])

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
