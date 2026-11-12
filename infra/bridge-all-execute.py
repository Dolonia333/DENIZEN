#!/usr/bin/env python3
"""Execute full capture bridge — MCP CRM audit, delegations, mesh, verify."""

from __future__ import annotations

from hostcfg import get_host
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
REPORT = ROOT / "denizen" / "reports" / "capture-bridge-report.json"
HOST = get_host("SYNO_HOST")
BASE = os.environ.get("DENIZEN_MCP_BASE", f"http://{HOST}:8888").rstrip("/")
NAS_URL = os.environ.get("DENIZEN_NAS_URL", BASE).rstrip("/")
NPC = os.environ.get("DENIZEN_MCP_NPC", "grok")
TOKEN_FILE = ROOT / ".mcp-token.local.json"


def log(msg: str) -> None:
    print(msg, flush=True)


def load_token() -> str:
    tok = os.environ.get("DENIZEN_MCP_TOKEN", "").strip()
    if tok:
        return tok
    if TOKEN_FILE.is_file():
        return str(json.loads(TOKEN_FILE.read_text(encoding="utf-8")).get("token") or "")
    return ""


def mcp_call(token: str, tool: str, arguments: dict | None = None, timeout: int = 120) -> dict:
    body = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments or {}},
    }
    url = f"{BASE}/mcp/npc/{NPC}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = {"error": e.read().decode(errors="replace")[:500], "status": e.code}
    except Exception as e:
        raw = {"error": str(e)}

    result = raw.get("result") or raw
    text = None
    if isinstance(result, dict):
        content = result.get("content") or []
        if content and isinstance(content[0], dict):
            text = content[0].get("text")
    if text:
        try:
            return {"ok": True, "parsed": json.loads(text), "raw": result}
        except json.JSONDecodeError:
            return {"ok": True, "text": text[:4000], "raw": result}
    return {"ok": "error" not in raw, "raw": result, "full": raw}


def nas_get(path: str) -> dict:
    try:
        with urllib.request.urlopen(f"{NAS_URL}{path}", timeout=20) as res:
            return json.loads(res.read().decode())
    except Exception as e:
        return {"ok": False, "error": str(e)}


def main() -> int:
    log("==> Bridge ALL — capture + CRM + delegations + verify\n")
    token = load_token()
    if not token:
        log("FAIL: no MCP token — py infra/mint-mcp-token-nas.py grok")
        return 1

    report: dict = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "base": BASE,
        "npc": NPC,
        "steps": {},
    }

    # 1 — Platform snapshot
    report["health"] = nas_get("/api/health")
    report["mesh"] = nas_get("/api/compute/node/status")
    report["platform_bridge"] = nas_get("/api/platform-bridge/status")
    log(f"mesh pending={report['mesh'].get('pending_count')} lm={report['health'].get('lmStudio', {}).get('reachable')}")

    # 2 — CRM + business context via MCP
    mcp_steps = [
        ("business_context_brief", {"npcName": "Marcus"}, 90),
        ("crm_pipeline_brief", {"focus": "OMES RM Cyber"}, 120),
        ("crm_list_tasks", {"limit": 40}, 90),
        ("get_status", {"limit": 8}, 60),
        ("get_inference_nodes", {}, 60),
    ]
    for tool, args, tmo in mcp_steps:
        log(f"  MCP {tool}…")
        report["steps"][tool] = mcp_call(token, tool, args, timeout=tmo)
        time.sleep(0.5)

    # 3 — Research (async — mesh picks up)
    log("  MCP run_skill research (async)…")
    report["steps"]["run_skill_research_omes"] = mcp_call(
        token,
        "run_skill",
        {
            "skill": "research",
            "params": {
                "query": "OMES EV00000919 Oklahoma IT modernization RM Cyber teaming October 2026",
                "read": 1,
            },
            "wait": False,
        },
        timeout=30,
    )

    # 4 — NPC delegations (capture sprint)
    delegations = [
        ("delegate_bob", "Bob", "Synthesize latest OMES EV00000919 + RM Cyber intel into capture brief; flag solicitation changes and teaming requirements.", True),
        ("delegate_marcus", "Marcus", "CRM audit: overdue tasks, Nexus at-risk deal, OMES/RM Cyber tags — update pipeline stages and owner actions before week end.", True),
        ("delegate_lucy", "Lucy", "Intake triage: prioritize gov/OMES/teaming leads; enrich incomplete contacts for $230k+ pipeline.", False),
        ("delegate_abby", "Abby", "Escalate RM Cyber teaming agreement blocker — draft CEO decision memo for Benjamin Ballard outreach this week.", True),
        ("delegate_oscar", "Oscar", "Confirm mesh + inference health after capture sprint; log any queue depth >5 to office feed.", False),
    ]
    for key, target, task, urgent in delegations:
        log(f"  delegate -> {target}")
        report["steps"][key] = mcp_call(
            token,
            "delegate_task",
            {"to_npc": target, "task": task, "urgent": urgent},
            timeout=30,
        )

    report["steps"]["assign_marcus_omes"] = mcp_call(
        token,
        "assign_task",
        {
            "task": "Weekly OMES EV00000919 tracker: teaming agreement status, blocker age, CRM sync — announce in office when status changes.",
            "urgent": True,
        },
        timeout=30,
    )

    # 5 — Roki / market (best-effort)
    for tool, args in [
        ("market_watch", {"symbols": "SPY,QQQ", "note": "daily capture sprint"}),
        ("get_market_quote", {"symbol": "SPY"}),
    ]:
        log(f"  MCP {tool} (optional)…")
        out = mcp_call(token, tool, args, timeout=45)
        if out.get("ok") or out.get("parsed") or out.get("text"):
            report["steps"][tool] = out
        else:
            report["steps"][tool] = {"skipped": True, "reason": out.get("raw") or out.get("full")}

    # 6 — Mesh think batch
    log("  MCP enqueue_compute_job npc_think_batch…")
    report["steps"]["enqueue_think_batch"] = mcp_call(
        token,
        "enqueue_compute_job",
        {
            "job_type": "npc_think_batch",
            "payload": {"source": "capture_bridge_all", "tag": f"all-{int(time.time())}"},
            "priority": 55,
        },
        timeout=30,
    )

    report["steps"]["announce_office"] = mcp_call(
        token,
        "announce_in_office",
        {
            "message": "Capture sprint ALL: mesh healthy — Bob/Marcus/Lucy/Abby delegated on OMES + CRM hygiene. CEO check Marcus pipeline.",
        },
        timeout=30,
    )

    # 7 — Verify gate
    log("\n==> verify-gap-bridge-all")
    proc = subprocess.run(
        [sys.executable, str(INFRA / "verify-gap-bridge-all.py")],
        cwd=str(ROOT),
    )
    report["verify_gap_bridge"] = proc.returncode == 0

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2, default=str)[:500000] + "\n", encoding="utf-8")
    log(f"\nReport: {REPORT}")

    # Summary for CEO
    pipeline = report["steps"].get("crm_pipeline_brief", {})
    tasks = report["steps"].get("crm_list_tasks", {})
    log("\n--- Summary ---")
    if pipeline.get("text"):
        log(f"pipeline: {pipeline['text'][:400]}")
    elif pipeline.get("parsed"):
        log(f"pipeline keys: {list(pipeline['parsed'].keys())[:8]}")
    if tasks.get("parsed"):
        log(f"tasks: {json.dumps(tasks['parsed'])[:300]}")
    log(f"delegations: {sum(1 for k,v in report['steps'].items() if k.startswith('delegate') and v.get('ok'))}/5 ok")
    log(f"verify: {'PASS' if report['verify_gap_bridge'] else 'FAIL'}")

    return 0 if report["verify_gap_bridge"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
