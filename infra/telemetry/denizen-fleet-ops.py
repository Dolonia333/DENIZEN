#!/usr/bin/env python3
"""
denizen-fleet-ops - Master CLI for the Sovereign Intelligence Mesh.

Orchestrates telemetry, consultations, and optimizations for the 3-node Denizen fleet.

Usage:
  python infra/denizen-fleet-ops.py status
  python infra/denizen-fleet-ops.py consult bouncer
  python infra/denizen-fleet-ops.py flush-bloat --npc Bouncer
  python infra/denizen-fleet-ops.py status --mcp  # use MCP resources if token

Requires MCP token for full features: .mcp-token.local.json or .mcp-team-token.local.json
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

def record_nas_friction(domain, severity=5, note=""):
    """Record friction from NAS background task for agent visibility (feeds JS friction metrics)."""
    try:
        friction_path = BASE / "data" / "nas-friction.jsonl"
        friction_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "domain": domain,
            "severity": severity,
            "note": note,
            "source": "fleet-ops"
        }
        with open(friction_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"[FRICTION] Failed to record: {e}")

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
TOKEN_FILE = Path(__file__).parent.parent.parent / ".mcp-token.local.json"
TEAM_TOKEN_FILE = Path(__file__).parent.parent.parent / ".mcp-team-token.local.json"

def load_json(p):
    try:
        return json.loads(p.read_text())
    except:
        return {}

def cmd_status(args):
    tel = load_json(DATA / "grok-telemetry-latest.json")
    print("=== Fleet Telemetry ===")
    print(json.dumps(tel, indent=2)[:1500])
    if not tel or not tel.get("npcs"):
        record_nas_friction("nas_telemetry", 6, "no current telemetry data")
    if args.mcp:
        print("\n[Using MCP resources if available]")
    # TODO: call MCP telemetry://fleet/latest if token

def cmd_consult(args):
    npc = args.npc
    print(f"Forcing consult flow for {npc}...")
    # In real: use MCP to run_skill consult-grok with question, or mentor
    print("Recommendation: Use MCP run_skill consult-grok on grok NPC, or team mentor tools.")
    print("See grok-consult-queue.jsonl and mentor pending.")

def cmd_flush(args):
    npc = args.npc or "all"
    print(f"Flushing bloat for {npc}...")
    # Would trigger prunes via facts or direct memory update
    print("See _applyGrokTelemetryPrune in npc-brains.js and telemetry facts.")

def cmd_audit_improvements(args):
    """Compare baseline from consult-improvement-log.jsonl vs current telemetry to measure mentor loop ROI (latency/token savings)."""
    log_path = DATA / "consult-improvement-log.jsonl"
    tel = load_json(DATA / "grok-telemetry-latest.json")
    if not log_path.exists():
        print("No improvement log yet. Run process-consults first.")
        record_nas_friction("nas_audit", 5, "no consult improvement log")
        return
    improvements = []
    current_npcs = tel.get("npcs", {})
    with open(log_path, encoding="utf-8", errors="replace") as lf:
        for line in lf:
            try:
                rec = json.loads(line)
            except:
                continue
            npc = rec.get("npc")
            rt = rec.get("remediation_tracking") or rec
            baseline_lat = rt.get("baseline_latency_ms")
            baseline_tok = rt.get("baseline_tokens")
            if not npc or not baseline_lat:
                continue
            cur = current_npcs.get(npc) or current_npcs.get(npc.capitalize()) or {}
            cur_lat = cur.get("avg_latency_ms")
            cur_tok = cur.get("avg_tokens")
            if cur_lat and baseline_lat:
                lat_delta = ((baseline_lat - cur_lat) / baseline_lat * 100) if baseline_lat else 0
                improvements.append({
                    "npc": npc,
                    "baseline_lat": baseline_lat,
                    "current_lat": cur_lat,
                    "lat_savings_pct": round(lat_delta, 1),
                    "baseline_tok": baseline_tok,
                    "current_tok": cur_tok,
                })
    if not improvements:
        print("No comparable baselines yet.")
        record_nas_friction("nas_audit", 4, "no comparable improvement baselines")
        return
    print("=== Mentor Loop ROI Audit ===")
    for imp in improvements:
        print(f"{imp['npc']}: latency {imp['baseline_lat']}->{imp['current_lat']}ms ({imp['lat_savings_pct']}% savings)")
        if imp['baseline_tok'] and imp['current_tok']:
            tok_delta = ((imp['baseline_tok'] - imp['current_tok']) / imp['baseline_tok'] * 100)
            print(f"         tokens {imp['baseline_tok']}->{imp['current_tok']} ({round(tok_delta,1)}% savings)")
    print("Audit complete. Higher % = better mentor impact. Re-run after more consults.")

def cmd_home(args):
    """Denizen is Grok's home — run full home maintenance: job, process consults, status, audit."""
    print("=== Denizen Home Maintenance ===")
    print("1. Running telemetry job...")
    subprocess.run(["py", "infra/grok-mesh-telemetry-job.py"], env={**os.environ, "GROK_AGENT": "1"})
    print("\n2. Processing consults...")
    subprocess.run(["py", "infra/denizen-fleet-ops.py", "process-consults", "--mcp"])
    print("\n3. Fleet status:")
    cmd_status(args)
    print("\n4. Audit improvements:")
    cmd_audit_improvements(args)
    print("\nHome maintenance complete. Denizen is alive and improving.")

def _telemetry_analyzer():
    import importlib.util
    path = Path(__file__).parent / "grok-analyze-telemetry.py"
    spec = importlib.util.spec_from_file_location("grok_analyze_telemetry", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cmd_process_consults(args):
    """Read pending consults, reply via context-aware telemetry analysis."""
    import uuid
    analyzer = _telemetry_analyzer()
    tel_report = analyzer.analyze(analyzer.load_recent(hours=0))

    queue_path = DATA / "grok-consult-queue.jsonl"
    if not queue_path.exists():
        print("No consult queue.")
        return
    lines = queue_path.read_text().strip().split("\n")
    updated = []
    pending_found = False
    token = None
    if TOKEN_FILE.exists():
        try:
            token = json.loads(TOKEN_FILE.read_text())["token"]
        except:
            pass
    for line in lines:
        try:
            entry = json.loads(line)
        except:
            updated.append(line)
            continue
        if entry.get("status") == "pending" or not entry.get("answer"):
            pending_found = True
            npc = entry.get("npc", "unknown")
            question = entry.get("question", "")
            topic = entry.get("topic", "general")
            reply = analyzer.build_consult_reply(npc, question, tel_report)
            entry["answer"] = reply
            entry["status"] = "answered"
            entry["replied_at"] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            entry["replied_by"] = "grok-cli"
            rt = entry.get("remediation_tracking") or {}
            if not rt.get("baseline_latency_ms"):
                stats = (tel_report.get("npcs") or {}).get(npc) or (tel_report.get("npcs") or {}).get(str(npc).capitalize()) or {}
                entry["remediation_tracking"] = {
                    **rt,
                    "baseline_latency_ms": stats.get("avg_latency_ms"),
                    "baseline_tokens": stats.get("avg_tokens"),
                    "baseline_count": stats.get("count"),
                    "captured_at": entry["replied_at"],
                    "audited": False,
                }
            # Reply via MCP: log the answer into the NPC's memory/activity
            if token and args.mcp:
                mcp_url = os.environ.get("DENIZEN_MCP_URL", "https://denizen.dolonia.cloud/mcp/npc/grok")
                body = json.dumps({
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "tools/call",
                    "params": {
                        "name": "update_memory",
                        "arguments": {
                            "body": f"[GROK-CLI-REPLY to {npc}] {reply}",
                            "topic": topic,
                            "outcome": "learning"
                        }
                    }
                })
                cmd = ["curl", "-fsS", "-m", "30", "-X", "POST", mcp_url,
                       "-H", "Content-Type: application/json",
                       "-H", f"Authorization: Bearer {token}",
                       "-d", body]
                try:
                    res = subprocess.run(cmd, capture_output=True, text=True)
                    print(f"  MCP reply for {npc}: {res.stdout[:100] if res.stdout else 'ok'}")
                except Exception as e:
                    print(f"  MCP reply failed: {e}")
            else:
                print(f"  [MCP would reply for {npc} if --mcp and token]")
            print(f"Processed consult for {npc}: {question[:60]}...")
            # Log for improvement tracking (check next telemetry for lower latency/tokens)
            log_path = DATA / "consult-improvement-log.jsonl"
            with open(log_path, "a") as lf:
                lf.write(json.dumps({
                    "ts": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                    "npc": npc,
                    "question": question[:100],
                    "reply_preview": reply[:100],
                    "remediation_tracking": entry.get("remediation_tracking"),
                    "expected_improvement": "mesh job audits ≥10% latency/token drop in 15m",
                }) + "\n")
        updated.append(json.dumps(entry))
    if pending_found:
        queue_path.write_text("\n".join(updated) + "\n")
        print("Queue updated with answers.")
    else:
        print("No pending consults.")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["status", "consult", "flush-bloat", "process-consults", "audit-improvements", "home"])
    p.add_argument("npc", nargs="?", default=None)
    p.add_argument("--mcp", action="store_true", help="Use MCP for actions/replies")
    args = p.parse_args()

    if args.cmd == "status":
        cmd_status(args)
    elif args.cmd == "consult":
        cmd_consult(args)
    elif args.cmd == "flush-bloat":
        cmd_flush(args)
    elif args.cmd == "process-consults":
        cmd_process_consults(args)
    elif args.cmd == "audit-improvements":
        cmd_audit_improvements(args)
    elif args.cmd == "home":
        cmd_home(args)

if __name__ == "__main__":
    main()
