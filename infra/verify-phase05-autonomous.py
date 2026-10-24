#!/usr/bin/env python3
"""Phase 0.5: Bob autonomous think -> run_skill (no CEO chat)."""
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
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def curl_json(client, path: str) -> dict:
    _, o, _ = client.exec_command(
        f"curl -fsS -m 25 http://127.0.0.1:{PORT}{path}",
        timeout=35,
    )
    raw = o.read().decode("utf-8", errors="replace").strip()
    try:
        return json.loads(raw.splitlines()[-1] if raw else "{}")
    except json.JSONDecodeError:
        return {"_raw": raw[:400]}


def think_run_skill_rows(calls: list) -> list:
    out = []
    for c in calls:
        if (c.get("kind") or "") != "think":
            continue
        if (c.get("npc") or "") != "Bob":
            continue
        preview = c.get("responsePreview") or ""
        if '"action"' in preview and "run_skill" in preview:
            out.append(c)
    return out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    before = curl_json(client, "/api/telemetry/llm?kind=think&limit=40&npc=Bob")
    before_ids = {c.get("id") for c in (before.get("calls") or []) if c.get("id")}

    print("==> Phase 0.5: Bob autonomous think (no player_chat)")
    print(f"    Sending npc_think cycles to {HOST}:{PORT}...\n")

    script = DENIZEN / "scripts" / "phase05-bob-autonomous.js"
    proc = subprocess.run(
        ["node", str(script), HOST, PORT, "8", "2500"],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=120,
    )
    run_data = {}
    for line in reversed((proc.stdout or "").splitlines()):
        if line.strip().startswith("{"):
            try:
                run_data = json.loads(line.strip())
                break
            except json.JSONDecodeError:
                continue

    time.sleep(4)
    after = curl_json(client, "/api/telemetry/llm?kind=think&limit=40&npc=Bob")
    pc = curl_json(client, "/api/pc-activity?limit=20")

    client.close()

    decisions = run_data.get("decisions") or []
    run_skill_dec = run_data.get("runSkillDecisions") or [
        d for d in decisions if d.get("action") == "run_skill"
    ]

    new_think_skills = []
    for c in after.get("calls") or []:
        if c.get("id") in before_ids:
            continue
        if think_run_skill_rows([c]):
            new_think_skills.append(c)

    bob_pc = [
        e for e in (pc.get("events") or [])
        if (e.get("npc") or "") == "Bob"
        and (e.get("kind") or "") == "research"
        and e.get("status") == "done"
    ]

    print("--- npc_decision (from think WS) ---")
    for d in decisions[-8:]:
        print(f"  action={d.get('action')} skill={d.get('skill')} director={d.get('_director')} throttled={d.get('_throttled')}")
        if d.get("thought"):
            print(f"    thought: {d.get('thought')}")

    print("\n--- telemetry: new think rows with run_skill ---")
    if new_think_skills:
        for c in new_think_skills[:3]:
            print(f"  {c.get('at')} preview={str(c.get('responsePreview',''))[:120]}")
    else:
        print("  (none in new think telemetry)")

    print("\n--- Phase 0.5 verdict ---")
    autonomous = bool(run_skill_dec) or bool(new_think_skills)
    print(f"think -> run_skill decision: {'YES' if autonomous else 'NO'}")
    print(f"Bob research PC row (post-test): {'YES' if bob_pc else 'NO'}")

    if autonomous:
        print("\nPASS: autonomous path fired run_skill from think")
        return 0

    print("\nFAIL: no think-originated run_skill in ~8 cycles")
    print("  Next: tighten think prompt, DENIZEN_REAL_WORK_CYCLES=2, or HYBRID_DIRECTOR=false for test session")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
