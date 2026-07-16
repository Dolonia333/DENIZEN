#!/usr/bin/env python3
"""
Grok Telemetry Analyzer for DENIZEN

Scans data/llm-telemetry.jsonl for patterns in local LLM performance.
Outputs fresh dense [FACT:*] lines for NPC self-improvement + mentor consults.

CRITICAL: all datetime comparisons must be timezone-aware. A naive cutoff
against aware telemetry timestamps silently drops every row (bare except),
which is why the mesh job fell back to July-2 canned facts for weeks.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
TELEMETRY_FILE = DATA_DIR / "llm-telemetry.jsonl"
# Cap read size so a 50MB+ live log doesn't thrash OneDrive/sync.
MAX_BYTES = int(os.environ.get("GROK_TELEMETRY_MAX_BYTES", str(20 * 1024 * 1024)))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(raw) -> datetime | None:
    if not raw:
        return None
    try:
        s = str(raw).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def record_nas_friction(domain, severity=5, note=""):
    try:
        friction_path = DATA_DIR / "nas-friction.jsonl"
        friction_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": utcnow().isoformat().replace("+00:00", "Z"),
            "domain": domain,
            "severity": severity,
            "note": str(note)[:240],
            "source": "analyze-telemetry",
        }
        with open(friction_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"[NAS FRICTION] {e}", file=sys.stderr)


def load_friction_summary():
    """Per-NPC friction hotspots from data/friction-metrics.json."""
    friction_path = DATA_DIR / "friction-metrics.json"
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
                {
                    "domain": d,
                    "score": (v or {}).get("score", 0),
                    "count": (v or {}).get("count", 0),
                    "lastAt": (v or {}).get("lastAt"),
                }
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


def _read_telemetry_tail(path: Path, max_bytes: int) -> list[str]:
    """Read the last max_bytes of the JSONL without locking forever on huge files."""
    size = path.stat().st_size
    with open(path, "rb") as f:
        if size > max_bytes:
            f.seek(-max_bytes, os.SEEK_END)
            # discard partial first line
            f.readline()
        data = f.read()
    text = data.decode("utf-8", errors="replace")
    return text.splitlines()


def load_recent(hours: float = 24) -> list[dict]:
    """Load recent telemetry rows with correct UTC-aware filtering."""
    if not TELEMETRY_FILE.exists():
        return []

    if hours <= 0 or os.environ.get("GROK_AGENT") == "1":
        # Agent/mesh mode: last 48h of the log tail by default.
        hours = float(os.environ.get("GROK_TELEMETRY_HOURS", "48"))

    cutoff = utcnow() - timedelta(hours=hours)
    entries: list[dict] = []
    try:
        lines = _read_telemetry_tail(TELEMETRY_FILE, MAX_BYTES)
    except Exception as e:
        record_nas_friction("nas_telemetry", 8, f"read fail: {e}")
        return []

    all_parsed: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        at = parse_ts(e.get("at") or e.get("ts") or e.get("timestamp"))
        if at is None:
            continue
        e = {**e, "_parsed_at": at}
        all_parsed.append(e)
        if at >= cutoff:
            entries.append(e)

    # Sparse window (idle office / NAS lag): still analyze last 250 real events
    # so facts stay live-derived instead of empty/canned.
    if len(entries) < 30 and all_parsed:
        tail = all_parsed[-250:]
        # Prefer most recent by timestamp
        tail.sort(key=lambda e: e["_parsed_at"])
        entries = tail[-250:]
    for e in entries:
        e.pop("_parsed_at", None)
    return entries


def analyze(entries: list[dict]) -> dict:
    by_npc: dict[str, list] = defaultdict(list)
    errors = []
    high_latency = []
    high_tokens = []
    models = Counter()
    kinds = Counter()

    for e in entries:
        npc = e.get("npc") or e.get("npcName") or "unknown"
        if not npc or npc == "None":
            npc = "unknown"
        by_npc[str(npc)].append(e)
        model = e.get("model") or e.get("modelId") or "?"
        models[str(model)] += 1
        kinds[str(e.get("kind") or "other")] += 1
        if e.get("error"):
            errors.append(e)
        lat = e.get("latencyMs") or e.get("latency_ms") or 0
        try:
            lat = float(lat)
        except Exception:
            lat = 0
        tin = int(e.get("tokensIn") or e.get("tokens_in") or 0)
        tout = int(e.get("tokensOut") or e.get("tokens_out") or 0)
        if lat > 8000:
            high_latency.append(e)
        if tin + tout > 2500:
            high_tokens.append(e)

    report = {
        "total_events": len(entries),
        "npcs": {},
        "issues": {
            "errors": len(errors),
            "high_latency": len(high_latency),
            "high_tokens": len(high_tokens),
        },
        "models": dict(models.most_common(12)),
        "kinds": dict(kinds.most_common(12)),
        "facts": [],
        "generatedAt": utcnow().isoformat().replace("+00:00", "Z"),
        "source": "live-telemetry",
    }

    for npc, evs in sorted(by_npc.items(), key=lambda kv: -len(kv[1])):
        if npc == "unknown" and len(evs) < 3:
            continue
        lats = []
        for e in evs:
            try:
                lats.append(float(e.get("latencyMs") or e.get("latency_ms") or 0))
            except Exception:
                pass
        avg_lat = sum(lats) / len(lats) if lats else 0
        tok_vals = []
        for e in evs:
            tin = int(e.get("tokensIn") or e.get("tokens_in") or 0)
            tout = int(e.get("tokensOut") or e.get("tokens_out") or 0)
            tok_vals.append(tin + tout)
        avg_tok = sum(tok_vals) / len(tok_vals) if tok_vals else 0
        avg_tin = sum(int(e.get("tokensIn") or e.get("tokens_in") or 0) for e in evs) / len(evs)
        avg_tout = sum(int(e.get("tokensOut") or e.get("tokens_out") or 0) for e in evs) / len(evs)
        npc_models = list({str(e.get("model") or e.get("modelId") or "?") for e in evs})
        report["npcs"][npc] = {
            "count": len(evs),
            "avg_latency_ms": round(avg_lat, 1),
            "avg_tokens": round(avg_tok),
            "avg_tokens_in": round(avg_tin),
            "avg_tokens_out": round(avg_tout),
            "models": npc_models[:6],
        }
        key = npc.lower().replace(" ", "_")
        report["facts"].append(
            f"[FACT:high_activity_{key}] {npc}: {len(evs)} ev, {round(avg_lat)}ms avg, "
            f"~{round(avg_tin)}t in / {round(avg_tout)}t out"
        )
        if avg_lat >= 4000:
            report["facts"].append(
                f"[FACT:latency_bottleneck_{key}] {npc}: avg {round(avg_lat)}ms — "
                f"compress recentMemory, debounce thinks, prune SOUL-adjacent context"
            )
        if avg_tin >= 1200 or avg_tok >= 1500:
            report["facts"].append(
                f"[FACT:context_bloat_{key}] {npc}: ~{round(avg_tin)} tokens in — "
                f"auto-compress memory + office map before next think"
            )
        if avg_tout and avg_tin and avg_tin / max(avg_tout, 1) > 15:
            report["facts"].append(
                f"[FACT:prompt_output_skew_{key}] {npc}: prompt:output ≈ "
                f"{round(avg_tin / max(avg_tout, 1))}:1 — cut filler context"
            )

    stuck = [n for n, d in report["npcs"].items() if d.get("avg_latency_ms", 0) >= 5000]
    if stuck:
        report["facts"].append(
            f"[FACT:stuck_npcs] Investigate: {', '.join(stuck)}. "
            f"Context compression + consult-grok recommended."
        )

    top_models = models.most_common(3)
    if top_models:
        report["facts"].append(
            "[FACT:model_mix] Recent models: "
            + ", ".join(f"{m}×{c}" for m, c in top_models)
        )
        small = [m for m, _ in top_models if any(x in m.lower() for x in ("e2b", "gemma-4", "mini", "3b", "1b"))]
        heavy_idle = any(
            any(x in m.lower() for x in ("14b", "27b", "32b", "70b")) for m in models
        )
        if small and not heavy_idle:
            report["facts"].append(
                "[FACT:model_routing] Ambient thinks on small models are fine; "
                "route cofounder/directive/synthesis to 14B+ when loaded"
            )

    # Friction hotspots
    fric = load_friction_summary()
    for npc, info in list(fric.items())[:8]:
        if info.get("overall", 0) >= 8:
            domains = ",".join(info.get("hot_domains") or [])[:80]
            report["facts"].append(
                f"[FACT:friction_{npc.lower()}] {npc} friction score {info['overall']} "
                f"domains=[{domains}] — build/fix or consult-mentors"
            )

    report["friction_summary"] = fric
    # Cap facts so consumers stay dense
    report["facts"] = report["facts"][:40]
    return report


def build_consult_reply(npc: str, question: str, report: dict | None = None) -> str:
    """Context-aware mentor reply from live telemetry (no canned July-2 template)."""
    report = report or {}
    npcs = report.get("npcs") or {}
    stats = (
        npcs.get(npc)
        or npcs.get(npc.capitalize())
        or npcs.get(npc.title())
        or next((v for k, v in npcs.items() if k.lower() == str(npc).lower()), {})
    )
    facts = [f for f in (report.get("facts") or []) if str(npc).lower() in f.lower()]
    lat = stats.get("avg_latency_ms", "?")
    tok_in = stats.get("avg_tokens_in", stats.get("avg_tokens", "?"))
    tok_out = stats.get("avg_tokens_out", "?")
    cnt = stats.get("count", "?")
    fact_line = "; ".join(facts[:3]) if facts else "no dense facts yet for you"
    gen = report.get("generatedAt") or "live"

    lines = [
        f"Hey {npc} — on your question:",
        question.strip()[:400],
        "",
        f"Fleet snapshot ({gen}): {cnt} events, {lat}ms avg latency, "
        f"~{tok_in}t in / {tok_out}t out.",
        f"Relevant facts: {fact_line}",
        "",
        "Do this next cycle:",
    ]
    if isinstance(lat, (int, float)) and lat >= 3500:
        lines.append(
            "1) Latency: one think every 60–90s max, prune MEMORY.md to dense [FACT:*] lines, "
            "drop full office map if not navigating."
        )
    else:
        lines.append("1) Keep think cadence; log one concrete outcome each cycle (not 'continuing work').")
    if isinstance(tok_in, (int, float)) and tok_in >= 1000:
        lines.append(
            "2) Tokens: cap recentMemory ~200–300 chars, keep last 2 chats only, "
            "skip FULL OFFICE MAP unless moving."
        )
    else:
        lines.append("2) Tokens look OK — still prefer short saves and no platitudes.")
    lines.append(
        "3) If still stuck after one more cycle, run_skill consult-mentors with live numbers "
        "(latency, tokens, last action)."
    )
    lines.append("Track next-cycle metrics; ≥10% drop in latency or tokens = remediation worked.")
    return "\n".join(lines)


def main() -> int:
    entries = load_recent()
    report = analyze(entries)
    is_agent = os.environ.get("GROK_AGENT") == "1"

    structured = {
        "facts": report.get("facts", []),
        "npcs": report.get("npcs", {}),
        "issues": report.get("issues", {}),
        "models": report.get("models", {}),
        "kinds": report.get("kinds", {}),
        "friction_summary": report.get("friction_summary") or load_friction_summary(),
        "agent_mode": is_agent,
        "generatedAt": report.get("generatedAt"),
        "source": report.get("source") or "live-telemetry",
        "entries_analyzed": len(entries),
        "recommendations": [
            f"Inject [FACT:*] via MCP/memory for {len(report.get('facts', []))} live findings.",
            "Prefer context compression on high tokens_in NPCs.",
            "Route heavy synthesis off the smallest ambient model when 14B+ is loaded.",
        ],
    }

    if not entries:
        structured["warning"] = "no_recent_telemetry_in_window"
        # Do NOT invent July-2 Bouncer/Bob canned stats — empty facts + warning.
        structured["facts"] = structured.get("facts") or [
            "[FACT:telemetry_gap] No recent llm-telemetry rows in window — "
            "check server write path and GROK_TELEMETRY_HOURS"
        ]

    if is_agent or "--json" in sys.argv:
        print(json.dumps(structured, indent=2))
    else:
        print(json.dumps(report, indent=2))
        print("\n--- DENSE FACTS ---")
        for fact in report.get("facts", []):
            print(fact)
        print(f"\nEntries analyzed: {len(entries)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
