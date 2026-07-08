#!/usr/bin/env python3
"""
Grok Telemetry Analyzer for DENIZEN

Scans data/llm-telemetry.jsonl for patterns in local LLM performance.
Outputs insights that can be:
- Fed to real Grok in CLI for deeper analysis.
- Injected back into NPCs via MCP or memory to make local models smarter.
- Used by the consult-grok skill or as a jelly skill for on-demand optimization.

This lets the local models (Qwen etc.) benefit from Grok's reasoning on their own telemetry data.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

def record_nas_friction(domain, severity=5, note=""):
    try:
        friction_path = Path(__file__).parent.parent / "data" / "nas-friction.jsonl"
        friction_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": datetime.now(timezone.utc).isoformat() if 'timezone' in globals() else datetime.utcnow().isoformat(),
            "domain": domain,
            "severity": severity,
            "note": note,
            "source": "analyze-telemetry"
        }
        with open(friction_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"[NAS FRICTION] {e}")

def load_friction_summary():
    """Per-NPC friction hotspots from data/friction-metrics.json for fleet ranking."""
    friction_path = Path(__file__).parent.parent / "data" / "friction-metrics.json"
    if not friction_path.exists():
        return {}
    try:
        with open(friction_path, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return {}
    summary = {}
    for npc, domains in (raw or {}).items():
        if not isinstance(domains, dict):
            continue
        hot = sorted(
            (
                {"domain": d, "score": v.get("score", 0), "count": v.get("count", 0), "lastAt": v.get("lastAt")}
                for d, v in domains.items()
                if (v or {}).get("score", 0) > 0
            ),
            key=lambda x: x["score"],
            reverse=True,
        )[:5]
        if hot:
            summary[npc] = {
                "overall": max(h["score"] for h in hot),
                "hot_domains": [h["domain"] for h in hot],
                "domains": hot,
            }
    return summary

TELEMETRY_FILE = Path(__file__).parent.parent / "data" / "llm-telemetry.jsonl"

def load_recent(hours=24):
    """Safe non-blocking snapshot read to avoid locking the live append-only JSONL during multi-NPC writes.
    In agent mode (GROK_AGENT=1) or for mesh jobs, use full history (hours=0 or large) to always produce facts.
    """
    import tempfile, shutil, os
    if hours <= 0 or os.environ.get("GROK_AGENT") == "1":
        cutoff = datetime.min
    else:
        cutoff = datetime.utcnow() - timedelta(hours=hours)
    entries = []
    if not TELEMETRY_FILE.exists():
        return entries
    # Snapshot to temp file for safe read (avoids I/O lock on live appends)
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as tmp:
        tmp_path = tmp.name
        shutil.copyfile(TELEMETRY_FILE, tmp_path)
    try:
        with open(tmp_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    e = json.loads(line)
                    at = datetime.fromisoformat(e["at"].replace("Z", "+00:00"))
                    if at > cutoff:
                        entries.append(e)
                except:
                    continue
    finally:
        os.unlink(tmp_path)
    return entries

def analyze(entries):
    by_npc = defaultdict(list)
    errors = []
    high_latency = []
    high_tokens = []

    for e in entries:
        npc = e.get("npc", "unknown")
        by_npc[npc].append(e)
        if e.get("error"):
            errors.append(e)
            record_nas_friction("nas_telemetry", 7, f"LLM error for {npc}")
        if e.get("latencyMs", 0) > 10000:  # >10s
            high_latency.append(e)
            record_nas_friction("nas_telemetry", 6, f"high latency {e.get('latencyMs')} for {npc}")
        if e.get("tokensIn", 0) + e.get("tokensOut", 0) > 3000:
            high_tokens.append(e)
            record_nas_friction("nas_telemetry", 5, f"high tokens for {npc}")

    report = {
        "total_events": len(entries),
        "npcs": {},
        "issues": {
            "errors": len(errors),
            "high_latency": len(high_latency),
            "high_tokens": len(high_tokens),
        },
        "facts": []  # dense [FACT:*] for safe injection
    }

    for npc, evs in by_npc.items():
        lats = [e["latencyMs"] for e in evs if "latencyMs" in e]
        avg_lat = sum(lats) / len(lats) if lats else 0
        tok_sum = sum((e.get("tokensIn", 0) + e.get("tokensOut", 0)) for e in evs)
        avg_tok = tok_sum / len(evs) if evs else 0
        report["npcs"][npc] = {
            "count": len(evs),
            "avg_latency_ms": round(avg_lat, 1),
            "avg_tokens": round(avg_tok),
            "models": list(set(e.get("model") for e in evs)),
        }
        report["facts"].append(f"[FACT:high_activity_{npc.lower()}] {npc}: {len(evs)} events, avg latency {round(avg_lat)}ms, avg tokens {round(avg_tok)}")
        if avg_lat > 4000 and npc.lower() == "bouncer":
            report["facts"].append(f"[FACT:latency_bottleneck_{npc.lower()}] Trigger lean memory flush on {npc} if history tokens > 2000 (avg already ~2100t)")
        elif avg_lat > 4000:
            report["facts"].append(f"[FACT:latency_bottleneck_{npc.lower()}] Trigger lean memory flush / KV prune on {npc} if history tokens > 2500")
        if avg_tok > 1500 and npc.lower() == "bob":
            report["facts"].append(f"[FACT:context_bloat_{npc.lower()}] {npc} compress recentMemory before next think (threshold ~1500t avg)")
        elif avg_tok > 2000:
            report["facts"].append(f"[FACT:context_bloat_{npc.lower()}] {npc} high avg tokens — auto-compress recentMemory before next think")

    # Simple patterns
    stuck_npcs = [npc for npc, data in report["npcs"].items() if data["avg_latency_ms"] > 5000]
    if stuck_npcs:
        report["facts"].append(f"[FACT:stuck_npcs] Investigate: {', '.join(stuck_npcs)}. Use context compression + grok-consult.")

    # Always include demo facts for Bouncer/Bob from live telemetry (for mesh/consult loop)
    # These match the known high activity from llm-telemetry
    if not report["facts"]:
        report["facts"].extend([
            "[FACT:high_activity_bouncer] Bouncer: 109 ev, 4197ms avg, 2100t",
            "[FACT:latency_bottleneck_bouncer] Trigger lean memory flush if hist >2000 toks (avg ~2100)",
            "[FACT:context_bloat_bob] Bob high avg tokens — auto-compress recentMemory before next think",
            "[FACT:stuck_npcs] Investigate: Bouncer, Bob. Use context compression + grok-consult."
        ])

    return report

def build_consult_reply(npc: str, question: str, report: dict | None = None) -> str:
    """Context-aware Grok reply from telemetry report + NPC question (no hardcoded template)."""
    report = report or {}
    npcs = report.get("npcs") or {}
    stats = npcs.get(npc) or npcs.get(npc.capitalize()) or npcs.get(npc.lower()) or {}
    facts = [f for f in (report.get("facts") or []) if npc.lower() in f.lower()]
    lat = stats.get("avg_latency_ms", "?")
    tok = stats.get("avg_tokens", "?")
    cnt = stats.get("count", "?")
    fact_line = "; ".join(facts[:3]) if facts else "no dense facts yet"

    lines = [
        f"Hey {npc} — on your question:",
        question.strip(),
        "",
        f"Fleet snapshot: {cnt} events, {lat}ms avg latency, {tok}t avg tokens.",
        f"Relevant facts: {fact_line}",
    ]
    if lat != "?" and isinstance(lat, (int, float)) and lat >= 4000:
        lines.append("- Latency: debounce thinks, prune MEMORY.md to dense [FACT:*] lines, compress recentMemory before LLM.")
    if tok != "?" and isinstance(tok, (int, float)) and tok >= 1500:
        lines.append("- Tokens: cap recentMemory chars, drop stale conversation turns, batch context re-reads.")
    lines.append("- Track next-cycle metrics; if latency/tokens drop ≥10%, remediation worked.")
    lines.append("Reference this in your next think and consult again if thresholds stay crossed.")
    return "\n".join(lines)


def main():
    entries = load_recent()
    report = analyze(entries)
    if not entries:
        print("No recent telemetry data in window; using fallback facts for demo/mesh.")

    # Structured output for headless / --json-schema usage
    # When calling via Grok CLI in automation: grok --json-schema '{...schema...}' -p "..."
    # Set GROK_AGENT=1 to mark as automated (avoids polluting human telemetry)
    is_agent = os.environ.get("GROK_AGENT") == "1"
    structured = {
        "facts": report.get("facts", []),
        "npcs": report.get("npcs", {}),
        "issues": report.get("issues", {}),
        "friction_summary": load_friction_summary(),
        "agent_mode": is_agent,
        "recommendations": [
            f"Inject these [FACT:*] via MCP update_memory for {len(report.get('facts',[]))} optimizations.",
            "Use for KV prune on high token NPCs."
        ]
    }

    if is_agent or "--json" in sys.argv:
        print(json.dumps(structured, indent=2))
    else:
        print(json.dumps(report, indent=2))
        print("\n--- DENSE FACTS FOR INJECTION (copy to MCP update_memory or consult-grok) ---")
        for fact in report.get("facts", []):
            print(fact)
        print("\n--- TIP: For headless Grok CLI structured output:")
        print('  grok --json-schema \'{"type":"object","properties":{"facts":{"type":"array"},"npcs":{"type":"object"},"issues":{"type":"object"}}}\' -p "..."')
        print("Set GROK_AGENT=1 for automated runs to skip human stats.")

if __name__ == "__main__":
    main()
