#!/usr/bin/env python3
"""
Automated mesh job for Grok Telemetry Optimizer.

Wraps grok-analyze-telemetry.py, writes data/grok-telemetry-latest.json from
LIVE analysis (never canned July-2 stats), auto-enqueues consults, and can
answer pending consults with telemetry-grounded replies when Grok CLI is down.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
ANALYZER = SCRIPT_DIR / "grok-analyze-telemetry.py"
DATA_DIR = ROOT / "data"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def record_nas_friction(domain, severity=5, note=""):
    try:
        friction_path = DATA_DIR / "nas-friction.jsonl"
        friction_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": utcnow_iso(),
            "domain": domain,
            "severity": severity,
            "note": str(note)[:240],
            "source": "mesh-telemetry-job",
        }
        with open(friction_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"[FRICTION] record failed: {e}")


def run_analyzer() -> dict | None:
    env = os.environ.copy()
    env["GROK_AGENT"] = "1"
    result = subprocess.run(
        [sys.executable, str(ANALYZER), "--json"],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        print("Analyzer failed:", result.stderr[:500], file=sys.stderr)
        record_nas_friction("nas_telemetry", 8, f"analyzer failed: {result.stderr[:200]}")
        return None
    try:
        return json.loads(result.stdout)
    except Exception as e:
        record_nas_friction("nas_telemetry", 7, f"analyzer parse fail: {e}")
        print("Analyzer parse fail:", result.stdout[:300], file=sys.stderr)
        return None


def inject_via_mcp(structured: dict) -> None:
    """Optional MCP inject of dense facts for Grok NPC."""
    import uuid

    token_file = ROOT.parent / ".mcp-token.local.json"
    if not token_file.exists():
        print("No MCP token, skipping injection. Facts:", len(structured.get("facts") or []))
        return
    try:
        with open(token_file, encoding="utf-8") as f:
            tok = json.load(f)["token"]
        facts_str = "\n".join((structured.get("facts") or [])[:12])
        mcp_url = os.environ.get("DENIZEN_MCP_URL", "https://denizen.dolonia.cloud/mcp/npc/grok")
        body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "tools/call",
                "params": {
                    "name": "log_activity",
                    "arguments": {
                        "note": f"Grok telemetry facts: {facts_str}",
                        "phase": "telemetry-optimization",
                    },
                },
            }
        )
        cmd = [
            "curl",
            "-fsS",
            "-m",
            "30",
            "-X",
            "POST",
            mcp_url,
            "-H",
            "Content-Type: application/json",
            "-H",
            f"Authorization: Bearer {tok}",
            "-d",
            body,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print("[MESH JOB] Injected telemetry facts via MCP")
        else:
            print("MCP inject failed:", (result.stderr or result.stdout or "")[:200])
            record_nas_friction("nas_mcp", 6, "MCP inject failed")
    except Exception as e:
        print("MCP inject skipped:", e)
        record_nas_friction("nas_mcp", 5, str(e)[:100])


def audit_remediation(data: dict, queue_path: Path) -> tuple[dict, list]:
    if not queue_path.exists():
        return data, []
    now = datetime.now(timezone.utc)
    lines = queue_path.read_text(encoding="utf-8", errors="replace").strip().split("\n")
    updated = []
    success_facts = []
    npcs = data.get("npcs") or {}

    for line in lines:
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except Exception:
            updated.append(line)
            continue
        rt = entry.get("remediation_tracking") or {}
        if entry.get("status") != "answered" or rt.get("audited"):
            updated.append(json.dumps(entry))
            continue
        replied = entry.get("replied_at") or entry.get("answered_at") or entry.get("ts")
        try:
            replied_dt = datetime.fromisoformat(str(replied).replace("Z", "+00:00"))
            if replied_dt.tzinfo is None:
                replied_dt = replied_dt.replace(tzinfo=timezone.utc)
        except Exception:
            updated.append(json.dumps(entry))
            continue
        age_min = (now - replied_dt).total_seconds() / 60
        if age_min < 15:
            updated.append(json.dumps(entry))
            continue

        npc = entry.get("npc", "")
        stats = npcs.get(npc) or next(
            (v for k, v in npcs.items() if k.lower() == str(npc).lower()), {}
        )
        base_lat = rt.get("baseline_latency_ms")
        base_tok = rt.get("baseline_tokens")
        cur_lat = stats.get("avg_latency_ms")
        cur_tok = stats.get("avg_tokens") or stats.get("avg_tokens_in")
        improved = False
        if base_lat and cur_lat and cur_lat <= base_lat * 0.9:
            improved = True
        if base_tok and cur_tok and cur_tok <= base_tok * 0.9:
            improved = True
        rt["audited"] = True
        rt["audited_at"] = utcnow_iso()
        rt["current_latency_ms"] = cur_lat
        rt["current_tokens"] = cur_tok
        entry["remediation_tracking"] = rt
        updated.append(json.dumps(entry))
        if improved:
            fact = (
                f"[SUCCESS:remediation_applied_{str(npc).lower()}] {npc}: "
                f"latency {base_lat}→{cur_lat}ms, tokens {base_tok}→{cur_tok} after consult"
            )
            success_facts.append(fact)
            data.setdefault("facts", []).append(fact)

    if updated:
        queue_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
    return data, success_facts


def _npc_from_fact(fact: str) -> str | None:
    """Extract display-ish npc key from [FACT:…_bob] style tags."""
    import re

    m = re.search(r"\[FACT:[^\]]*_(bouncer|bob|lucy|abby|dan|edward|sarah|marcus|jenny|molly|oscar|pier|rob|roki|grok|claude|alex|josh)\]", fact, re.I)
    if m:
        return m.group(1).capitalize() if m.group(1).lower() != "abby" else "Abby"
    # map known
    name_map = {
        "bouncer": "Bouncer",
        "bob": "Bob",
        "lucy": "Lucy",
        "abby": "Abby",
        "dan": "Dan",
        "edward": "Edward",
        "sarah": "Sarah",
        "marcus": "Marcus",
        "jenny": "Jenny",
        "molly": "Molly",
        "oscar": "Oscar",
        "pier": "Pier",
        "rob": "Rob",
        "roki": "Roki",
        "grok": "Grok",
        "claude": "Claude",
        "alex": "Alex",
        "josh": "Josh",
    }
    low = fact.lower()
    for k, v in name_map.items():
        if f"_{k}" in low or f" {k}:" in low or f" {k} " in low:
            return v
    return None


def enqueue_consults(data: dict, queue_path: Path) -> int:
    existing = []
    if queue_path.exists():
        for line in queue_path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                existing.append(json.loads(line))
            except Exception:
                pass
    pending_npcs = {
        str(e.get("npc", "")).lower()
        for e in existing[-80:]
        if e.get("status") == "pending"
    }
    # Skip NPCs that already got an answer in the last 3 hours (let lessons settle).
    recent_answered = set()
    now = datetime.now(timezone.utc)
    for e in existing[-120:]:
        if e.get("status") != "answered":
            continue
        ts = e.get("answered_at") or e.get("ts")
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if (now - dt).total_seconds() < 3 * 3600:
                recent_answered.add(str(e.get("npc", "")).lower())
        except Exception:
            pass
    added = 0
    for fact in data.get("facts") or []:
        fact_lower = fact.lower()
        if not any(k in fact_lower for k in ("latency", "bloat", "stuck", "skew", "compress")):
            continue
        # Skip pure friction/nas noise facts for auto-enqueue
        if "friction_" in fact_lower and "nas_" in fact_lower:
            continue
        npc = _npc_from_fact(fact)
        if not npc:
            continue
        if npc.lower() in pending_npcs or npc.lower() in recent_answered:
            continue
        stats = (data.get("npcs") or {}).get(npc) or {}
        consult = {
            "ts": utcnow_iso(),
            "npc": npc,
            "topic": "telemetry-driven self-improvement",
            "question": (
                f"Telemetry shows: {fact}. How should I improve my prompts, memory, "
                f"or skills to cut latency/tokens and produce concrete work?"
            ),
            "status": "pending",
            "source": "auto-telemetry-job",
            "remediation_tracking": {
                "baseline_latency_ms": stats.get("avg_latency_ms"),
                "baseline_tokens": stats.get("avg_tokens_in") or stats.get("avg_tokens"),
            },
        }
        with open(queue_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(consult) + "\n")
        pending_npcs.add(npc.lower())
        added += 1
        print(f"Auto-enqueued consult for {npc}: {fact[:70]}...")
        if added >= 6:
            break
    return added


def _inject_memory_md(npc: str, answer: str, prefix: str = "[CONSULT LESSON]") -> bool:
    """Write lesson into npcs/<folder>/MEMORY.md so the next think sees it."""
    name_map = {
        "abby": "abby", "alex": "alex", "bob": "bob", "jenny": "jenny", "dan": "dan",
        "lucy": "lucy", "bouncer": "bouncer", "marcus": "conference_man",
        "sarah": "conference_woman", "edward": "edward", "josh": "josh",
        "molly": "molly", "oscar": "oscar", "pier": "pier", "rob": "rob",
        "roki": "roki", "grok": "grok", "claude": "claude",
        "conference_man": "conference_man", "conference_woman": "conference_woman",
    }
    key = str(npc or "").strip().lower()
    folder = name_map.get(key)
    if not folder:
        return False
    mem = ROOT / "npcs" / folder / "MEMORY.md"
    try:
        mem.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
        line = f"- [{ts}] {prefix} {answer.replace(chr(10), ' ').strip()[:850]}\n"
        existing = mem.read_text(encoding="utf-8", errors="replace") if mem.exists() else ""
        lines = [l for l in existing.splitlines() if l.strip()]
        if len(lines) > 120:
            header = lines[:2]
            recent = lines[-40:]
            body = "\n".join(header + [f"- [{ts}] [ARCHIVE] compacted mentor lessons"] + recent) + "\n" + line
        else:
            body = (existing if existing.endswith("\n") or not existing else existing + "\n") + line
        mem.write_text(body, encoding="utf-8")
        return True
    except Exception as e:
        print(f"memory inject failed for {npc}: {e}")
        return False


def answer_pending_with_telemetry(data: dict, queue_path: Path, limit: int = 5) -> int:
    """Close the loop without Grok CLI — dense telemetry-grounded replies + MEMORY.md."""
    sys.path.insert(0, str(SCRIPT_DIR))
    try:
        from importlib.machinery import SourceFileLoader

        mod = SourceFileLoader("grok_analyze_telemetry", str(ANALYZER)).load_module()
        build_reply = mod.build_consult_reply
    except Exception as e:
        print("Cannot load build_consult_reply:", e)
        return 0

    if not queue_path.exists():
        return 0
    rows = []
    for line in queue_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            continue

    answered = 0
    for row in rows:
        if row.get("status") != "pending":
            continue
        if answered >= limit:
            break
        npc = str(row.get("npc") or "").strip()
        q = str(row.get("question") or "").strip()
        if not npc or not q:
            continue
        answer = build_reply(npc, q, data)
        row["status"] = "answered"
        row["answer"] = answer[:2000]
        row["answered_by"] = "telemetry-analyzer"
        row["answered_at"] = utcnow_iso()
        injected = _inject_memory_md(npc, answer)
        row["memory_injected"] = injected
        if injected:
            row["memory_injected_at"] = row["answered_at"]
        answered += 1
        print(f"Answered consult for {npc} via live telemetry (memory_injected={injected})")
        log_path = DATA_DIR / "consult-improvement-log.jsonl"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "ts": row["answered_at"],
                        "npc": npc,
                        "question": q[:150],
                        "answer_preview": answer[:150],
                        "source": "mesh-telemetry-job",
                        "injected": injected,
                    }
                )
                + "\n"
            )

    if answered:
        queue_path.write_text(
            "\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8"
        )
    return answered


def main() -> int:
    print("Grok Mesh Telemetry Job starting (live analyzer, no canned fallbacks)")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cooldown_file = DATA_DIR / ".grok-telemetry-cooldown"
    force = "--force" in sys.argv
    if not force and cooldown_file.exists():
        try:
            last = float(cooldown_file.read_text(encoding="utf-8").strip() or 0)
        except Exception:
            last = 0
        if time.time() - last < 180:  # 3 min (was 5)
            print("Cooldown active, skipping.")
            return 0

    data = run_analyzer()
    if not data:
        print("No analysis data — abort without writing canned facts.")
        return 1

    # Never replace live empty-ish facts with July-2 hardcoded Bouncer/Bob stats.
    facts = data.get("facts") or []
    print(
        f"Analysis complete. events={data.get('entries_analyzed')} "
        f"facts={len(facts)} source={data.get('source')}"
    )
    data["generatedAt"] = data.get("generatedAt") or utcnow_iso()
    data["jobRanAt"] = utcnow_iso()

    queue_path = DATA_DIR / "grok-consult-queue.jsonl"
    data, success_facts = audit_remediation(data, queue_path)
    if success_facts:
        print("Remediation successes:", success_facts)

    facts_blob = "\n".join(data.get("facts") or [])
    facts_hash = hashlib.sha1(facts_blob.encode("utf-8")).hexdigest()
    hash_file = DATA_DIR / ".grok-telemetry-facts-hash"
    prev_hash = hash_file.read_text(encoding="utf-8").strip() if hash_file.exists() else ""
    out = DATA_DIR / "grok-telemetry-latest.json"
    # Always refresh generatedAt file at least every run so consumers see freshness,
    # but only re-inject MCP when facts content changes.
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Wrote {out}")
    if facts_hash != prev_hash:
        if os.environ.get("GROK_AGENT") == "1" or "--inject" in sys.argv:
            inject_via_mcp(data)
        hash_file.write_text(facts_hash, encoding="utf-8")
        print("Facts changed — hash updated")
    else:
        print("Facts content unchanged (file still refreshed)")

    enq = enqueue_consults(data, queue_path)
    # Close consult loop even if Grok CLI is offline
    ans = answer_pending_with_telemetry(data, queue_path, limit=5)
    print(f"Consults enqueued={enq} answered_via_telemetry={ans}")

    cooldown_file.write_text(str(time.time()), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
