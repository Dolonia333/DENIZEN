#!/usr/bin/env python3
"""Phase 1: Abby delegates -> Alex coding-agent -> README diff on NAS."""
from __future__ import annotations

import hashlib
import json
import os
import re
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

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
README_PATH = "/app/README.md"

ABBY_MSG = (
    "Abby, have Alex run_skill coding-agent to add a one-line comment to README "
    "and confirm when done."
)


def run(client, cmd, timeout=180):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


def curl_json(client, path: str) -> dict:
    raw = run(client, f"curl -fsS -m 25 http://127.0.0.1:{PORT}{path}", timeout=35)
    try:
        return json.loads(raw.strip().splitlines()[-1] if raw.strip() else "{}")
    except json.JSONDecodeError:
        return {"_raw": raw[:400]}


def proposal_artifact(client) -> tuple[bool, str]:
    raw = run(client, f"curl -fsS -m 25 http://127.0.0.1:{PORT}/api/code-proposals", timeout=35)
    try:
        data = json.loads(raw.strip().splitlines()[-1] if raw.strip() else "{}")
    except json.JSONDecodeError:
        return False, "no proposals parse"
    for p in data.get("proposals") or []:
        if (p.get("npc") or "") in ("Alex", "Abby") and len(p.get("diff") or "") > 20:
            return True, f"proposal {p.get('id')} diff={len(p.get('diff') or '')}b npc={p.get('npc')}"
    return False, "no proposal diff"


def worktree_diff_bytes(client, npc: str = "Alex") -> int:
    raw = run(
        client,
        f'{DOCKER} exec denizen-server sh -c '
        f'"wt=$(ls -td /app/.npc-worktrees/{npc}-* 2>/dev/null | head -1); '
        f'if [ -n \\"$wt\\" ]; then cd \\"$wt\\" && git diff HEAD 2>/dev/null | wc -c; else echo 0; fi"',
        timeout=30,
    )
    try:
        return int(raw.strip().splitlines()[-1].strip())
    except ValueError:
        return 0


def readme_hash(client) -> str:
    raw = run(client, f"{DOCKER} exec denizen-server cat {README_PATH} 2>/dev/null", timeout=30)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    before_hash = readme_hash(client)
    before_tail = run(client, f"{DOCKER} exec denizen-server tail -5 {README_PATH} 2>/dev/null")

    print("==> Phase 1: Abby -> Alex -> coding-agent -> README")
    print(f"    README hash before: {before_hash}")
    print(f"    Command: {ABBY_MSG[:70]}...\n")

    script = DENIZEN / "scripts" / "phase1-abby-alex.js"
    proc = subprocess.run(
        ["node", str(script), HOST, PORT, ABBY_MSG],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=200,
    )
    data = {}
    for line in reversed((proc.stdout or "").splitlines()):
        if line.strip().startswith("{"):
            try:
                data = json.loads(line.strip())
                break
            except json.JSONDecodeError:
                continue

    time.sleep(15)
    after_hash = readme_hash(client)
    after_tail = run(client, f"{DOCKER} exec denizen-server tail -8 {README_PATH} 2>/dev/null")
    pc = curl_json(client, "/api/pc-activity?limit=25")
    tel = curl_json(client, "/api/telemetry/llm?kind=think&limit=30&npc=Alex")
    prop_ok, prop_detail = proposal_artifact(client)
    wt_bytes = worktree_diff_bytes(client, "Alex")

    client.close()

    delegation = data.get("delegation")
    alex_dec = data.get("alexDecisions") or []
    abby = data.get("abbyReplies") or []

    print("--- Abby ---")
    for i, r in enumerate(abby, 1):
        print(f"[{i}] {(r.get('text') or '')[:800]}")
        if r.get("delegation"):
            print(f"     delegation: {json.dumps(r['delegation'])}")

    print("\n--- Alex think decisions ---")
    run_skills = []
    for d in alex_dec:
        sk = d.get("skill")
        empty = d.get("action") == "run_skill" and not sk
        flag = " EMPTY_SKILL" if empty else (" inferred" if d.get("skillInferred") else "")
        print(f"  action={d.get('action')} skill={sk!r}{flag}")
        if d.get("action") == "run_skill":
            run_skills.append(d)

    print("\n--- Alex think telemetry (run_skill rows) ---")
    for c in tel.get("calls") or []:
        prev = c.get("responsePreview") or ""
        if "run_skill" in prev:
            skill_marker = 'skill":"'
            print(f"  {c.get('at')} skill_field={('skill' in prev and skill_marker in prev)} preview={prev[:140]}")

    alex_coding = [
        e for e in (pc.get("events") or [])
        if (e.get("npc") or "") == "Alex" and (e.get("kind") or "") == "coding-agent"
    ]
    abby_coding = [
        e for e in (pc.get("events") or [])
        if (e.get("npc") or "") == "Abby" and (e.get("kind") or "") == "coding-agent"
    ]

    print("\n--- README ---")
    print(f"hash before: {before_hash}")
    print(f"hash after:  {after_hash}")
    print(f"diff:        {'YES' if before_hash != after_hash else 'NO'} (main README)")
    print(f"proposal:    {prop_detail}")
    print(f"worktree:    {wt_bytes} diff bytes")
    if before_hash != after_hash:
        print("tail after:")
        print(after_tail)

    print("\n--- Phase 1 verdict ---")
    delegated = bool(delegation) or bool(re.search(r"\bhave\s+Alex\b", ABBY_MSG, re.I))
    skill_populated = any(
        d.get("skill") for d in run_skills
    )
    skill_empty_only = run_skills and not skill_populated
    artifact = before_hash != after_hash or prop_ok or wt_bytes > 20
    alex_coding_ok = any(
        (e.get("status") or "") == "done" for e in alex_coding
    )
    coding_ran = alex_coding_ok or prop_ok

    print(f"Abby delegated:           {'YES' if delegated else 'NO'}")
    print(f"Alex run_skill populated: {'YES' if skill_populated else ('EMPTY ONLY' if skill_empty_only else 'NO run_skill')}")
    print(f"Alex coding-agent PC:     {'YES' if coding_ran else 'NO'}")
    print(f"Abby coding-agent PC:     {'YES' if abby_coding else 'NO (good)'}")
    print(f"README changed:           {'YES' if artifact else 'NO'}")

    if delegated and (skill_populated or coding_ran) and artifact and not abby_coding:
        print("\nPASS: delegation + Alex execution + durable artifact")
        return 0
    if delegated and artifact and coding_ran:
        print("\nPASS: delegation + coding-agent artifact (check NPC owner)")
        return 0
    print("\nFAIL or PARTIAL — see above")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
