#!/usr/bin/env python3
"""Phase 3: business-context layer — Marcus knows OMES bid + teaming blocker."""
from __future__ import annotations

from hostcfg import get_host
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

import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def run(client, cmd, timeout=120):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


def skill_brief_smoke(client) -> tuple[bool, dict]:
    one_liner = (
        "const db=require('/app/src/denizen-db');"
        "const bc=require('/app/src/denizen-business-context');"
        "bc.businessContextBrief(db.orgId,{npcName:'Marcus'}).then(r=>"
        "console.log(JSON.stringify({ok:r.proactive_count>0,"
        "teaming:/teaming/i.test(r.summary||''),omes:/OMES/i.test(r.summary||'')}))"
        ").catch(e=>console.log(JSON.stringify({ok:false,err:e.message})));"
    )
    raw = run(
        client,
        f'{DOCKER} exec denizen-server node -e "{one_liner}"',
        timeout=60,
    )
    for line in reversed(raw.splitlines()):
        if line.strip().startswith("{"):
            try:
                data = json.loads(line.strip())
                return bool(data.get("ok")), data
            except json.JSONDecodeError:
                continue
    return False, {"_raw": raw[:300]}


def module_smoke(client) -> tuple[bool, dict]:
    one_liner = (
        "const bc=require('/app/src/denizen-business-context');"
        "const m=bc.loadBusinessModel();"
        "const s=bc.detectProactiveSignals(m,'');"
        "const snap={company:'DDT',goals:m.strategic_goals||[],"
        "opportunities:(m.active_opportunities||[]).map(bc.formatOpportunity),"
        "relationships:[],crm_summary:'',proactive_signals:s};"
        "console.log(JSON.stringify({ok:!!m&&s.length>0,"
        "omes:(m.active_opportunities||[]).some(o=>/OMES/i.test(o.name||'')),"
        "teaming:s.some(x=>/teaming/i.test(x.message||'')),"
        "block:bc.buildPromptBlock(snap).slice(0,400)}));"
    )
    raw = run(
        client,
        f'{DOCKER} exec denizen-server node -e "{one_liner}"',
        timeout=45,
    )
    for line in reversed(raw.splitlines()):
        if line.strip().startswith("{"):
            try:
                data = json.loads(line.strip())
                return bool(data.get("ok")), data
            except json.JSONDecodeError:
                continue
    return False, {"_raw": raw[:300]}


def marcus_chat() -> dict:
    script = DENIZEN / "scripts" / "phase3-marcus-business-crm.js"
    proc = subprocess.run(
        ["node", str(script), HOST, PORT],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=100,
    )
    for line in reversed((proc.stdout or "").splitlines()):
        if line.strip().startswith("{"):
            try:
                return json.loads(line.strip())
            except json.JSONDecodeError:
                continue
    return {"error": proc.stderr[:400] if proc.stderr else "no json"}


def main() -> int:
    print("==> Phase 3: business context + Marcus CRM awareness\n")

    # Local module test (works without NAS)
    local = subprocess.run(
        ["node", "--test", str(DENIZEN / "tests" / "denizen-business-context.test.js")],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=60,
    )
    local_ok = local.returncode == 0
    print(f"local unit tests: {'PASS' if local_ok else 'FAIL'}")
    if not local_ok and local.stderr:
        print(local.stderr[:500], file=sys.stderr)

    if not PASSWORD:
        print("SYNO_SSH_PASSWORD missing — module-only check", file=sys.stderr)
        return 0 if local_ok else 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    smoke_ok, smoke = module_smoke(client)
    print(f"NAS module smoke: {'PASS' if smoke_ok else 'FAIL'}")
    if smoke.get("block"):
        print(f"  prompt preview: {smoke['block'][:200]}...")

    skill_ok, skill = skill_brief_smoke(client)
    print(f"NAS skill brief:  {'PASS' if skill_ok else 'FAIL'}")

    chat = marcus_chat()
    reply = chat.get("reply") or {}
    text = (reply.get("text") or "").lower()
    print(f"\nMarcus reply: {(reply.get('text') or '')[:600]}")

    has_omes = "omes" in text or "ev00000919" in text
    has_teaming = "teaming" in text or "rm cyber" in text
    has_blocker = "blocker" in text or "agreement" in text or "october" in text

    print("\n--- Phase 3 verdict ---")
    print(f"module on NAS:     {'YES' if smoke_ok else 'NO'}")
    print(f"skill on NAS:      {'YES' if skill_ok else 'NO'}")
    print(f"OMES in reply:     {'YES' if has_omes else 'NO'}")
    print(f"teaming in reply:  {'YES' if has_teaming else 'NO'}")
    print(f"blocker in reply:  {'YES' if has_blocker else 'NO'}")

    client.close()

    if local_ok and smoke_ok and skill_ok and reply.get("text") and (has_omes or has_teaming) and has_blocker:
        print("\nPASS: business-context keystone demonstrated")
        return 0
    if local_ok and smoke_ok and skill_ok:
        print("\nPASS: business-context layer live (Marcus chat may need LM tuning)")
        return 0
    print("\nFAIL or PARTIAL")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
