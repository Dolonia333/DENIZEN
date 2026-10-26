#!/usr/bin/env python3
"""Phase 0: CEO chat -> run_skill -> Jelly result (research = injected output, not reports/)."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import subprocess
import sys
import time
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

BOB_MSG = (
    'Bob, run_skill research on "LLM prompt compression for long-term memory" '
    "and save a report."
)

# Per-skill acceptance: research -> skill bridge + PC activity + injected chat output (no file).
MIN_INJECTED_CHARS = 80


def run(client, cmd, timeout=180):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def curl_json(client, path: str) -> dict:
    _, out = run(client, f"curl -fsS -m 20 http://127.0.0.1:{PORT}{path}", timeout=30)
    try:
        return json.loads(out.strip().splitlines()[-1] if out.strip() else "{}")
    except json.JSONDecodeError:
        return {"_raw": out[:500]}


def run_phase0_chat() -> dict:
    script = DENIZEN / "scripts" / "phase0-bob-ws.js"
    proc = subprocess.run(
        ["node", str(script), HOST, PORT, BOB_MSG],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=140,
    )
    for line in reversed((proc.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return {"error": proc.stderr or proc.stdout or "no json output", "replies": []}


def analyze_replies(replies: list) -> dict:
    bob = [r for r in replies if r.get("npcName") == "Bob" or not r.get("npcName")]
    skill_bridge = any(
        (r.get("text") or "").strip().lower().startswith("running research")
        or any(a.get("action") == "run_skill" or a.get("skill") == "research" for a in (r.get("actions") or []))
        for r in bob
    )
    injected = [
        r for r in bob
        if (r.get("text") or "").strip()
        and not (r.get("text") or "").strip().lower().startswith("running research")
        and len((r.get("text") or "").strip()) >= MIN_INJECTED_CHARS
    ]
    # Third+ bubble: substantive findings after skill bridge
    findings = injected[-1]["text"][:400] if injected else None
    return {
        "skill_bridge": skill_bridge,
        "injected_output": bool(injected),
        "findings_preview": findings,
        "reply_count": len(bob),
    }


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    print("==> Phase 0: Bob run_skill research (acceptance: bridge + inject, NOT reports/)")
    print(f"    Message: {BOB_MSG[:80]}...\n")

    chat_data = run_phase0_chat()
    replies = chat_data.get("replies") or []
    analysis = analyze_replies(replies)

    print("--- Bob chat replies ---")
    if not replies:
        print("(no player_chat_response from Bob)")
        if chat_data.get("error"):
            print(f"error: {chat_data['error']}")
    else:
        for i, r in enumerate(replies, 1):
            name = r.get("npcName") or "Bob"
            print(f"[{i}] {name}: {(r.get('text') or '')[:1200]}")
            if r.get("actions"):
                print(f"     actions: {json.dumps(r.get('actions'))[:400]}")

    time.sleep(2)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    pc = curl_json(client, "/api/pc-activity?limit=15")
    events = pc.get("events") or []
    bob_research = [
        e for e in events
        if (e.get("npc") or "").lower() == "bob"
        and (e.get("kind") or "") == "research"
        and e.get("status") == "done"
    ]
    client.close()

    print("\n--- execution signals ---")
    print(f"skill bridge fired:  {'YES' if analysis['skill_bridge'] else 'NO'}")
    print(f"injected output:     {'YES' if analysis['injected_output'] else 'NO'}")
    if analysis["findings_preview"]:
        print(f"findings preview:    {analysis['findings_preview'][:300]}...")
    print(f"Bob research (PC):   {'YES' if bob_research else 'NO'}")
    if bob_research:
        print(f"  detail: {bob_research[0].get('detail')}")

    ok = analysis["skill_bridge"] and (analysis["injected_output"] or bob_research)
    print("\n--- Phase 0 verdict ---")
    if ok:
        print("PASS (research: skill ran + result returned in chat or PC activity; no reports/ file required)")
        return 0
    print("FAIL")
    if not analysis["skill_bridge"]:
        print("  - missing skill bridge (Running research / run_skill action)")
    if not analysis["injected_output"] and not bob_research:
        print("  - missing injected findings bubble and no PC research row")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
