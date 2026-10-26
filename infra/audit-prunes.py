#!/usr/bin/env python3
"""
Prune audit — detect silent failures in the telemetry-feedback loop.

Compares:
  - telemetry://fleet/latest/{npc} generatedAt + latency/bloat facts
  - [kv_prune_log] / [GROK-TELEMETRY-PRUNE] entries in NPC MEMORY.md (container or local)

Exit 0 = healthy, 1 = prune silent failure detected, 2 = setup/warn.
"""

from __future__ import annotations

from hostcfg import get_host
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
from mcp_http import mcp_rpc  # noqa: E402

ROOT = INFRA.parent
DENIZEN = ROOT / "denizen"
TOKEN_FILE = ROOT / ".mcp-team-token.local.json"
BASE = os.environ.get("DENIZEN_MCP_PUBLIC", "https://denizen.dolonia.cloud").rstrip("/")
HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

PRUNE_MARKERS = ("[kv_prune_log]", "[GROK-TELEMETRY-PRUNE]")
STALE_MINUTES = int(os.environ.get("PRUNE_AUDIT_STALE_MIN", "15"))
TARGETS = [a.strip() for a in os.environ.get("PRUNE_AUDIT_NPCS", "bouncer,bob").split(",") if a.strip()]


def load_token() -> str:
    tok = os.environ.get("DENIZEN_TEAM_MCP_TOKEN", "").strip()
    if tok:
        return tok
    if TOKEN_FILE.is_file():
        return str(json.loads(TOKEN_FILE.read_text(encoding="utf-8")).get("token") or "")
    return ""


def parse_ts(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def telemetry_for(token: str, npc_key: str) -> dict:
    url = f"{BASE}/mcp/team"
    res = mcp_rpc(url, token, "resources/read", {"uri": f"telemetry://fleet/latest/{npc_key}"})
    if res.get("error"):
        return {"error": res["error"]}
    text = res.get("result", {}).get("contents", [{}])[0].get("text", "{}")
    return json.loads(text)


def latency_facts(facts: list[str]) -> list[str]:
    return [f for f in facts if re.search(r"latency|bloat|bottleneck|stuck", f, re.I)]


def count_prunes_local(npc_key: str) -> int:
    mem = DENIZEN / "npcs" / npc_key / "MEMORY.md"
    if not mem.is_file():
        return 0
    text = mem.read_text(encoding="utf-8", errors="replace")
    return sum(text.count(m) for m in PRUNE_MARKERS)


def count_prunes_nas(npc_key: str) -> int | None:
    if not PASSWORD:
        return None
    try:
        import paramiko
    except ImportError:
        return None
    path = f"/app/npcs/{npc_key}/MEMORY.md"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, e = client.exec_command(
        f"{DOCKER} exec denizen-server sh -c \"grep -cE 'kv_prune_log|GROK-TELEMETRY-PRUNE' {path} 2>/dev/null || echo 0\"",
        timeout=30,
    )
    out = (o.read() + e.read()).decode("utf-8", errors="replace").strip().splitlines()
    client.close()
    try:
        return int(out[-1]) if out else 0
    except ValueError:
        return 0


def audit_npc(token: str, npc_key: str) -> dict:
    tel = telemetry_for(token, npc_key)
    if tel.get("error"):
        return {"npc": npc_key, "status": "error", "detail": tel["error"]}

    facts = tel.get("facts") or []
    bad = latency_facts(facts)
    gen = parse_ts(tel.get("generatedAt"))
    age_min = None
    if gen:
        age_min = (datetime.now(timezone.utc) - gen.astimezone(timezone.utc)).total_seconds() / 60

    prune_nas = count_prunes_nas(npc_key)
    prune_local = count_prunes_local(npc_key)
    prune_count = prune_nas if prune_nas is not None else prune_local
    source = "nas" if prune_nas is not None else "local"

    silent = bool(
        bad
        and age_min is not None
        and age_min >= STALE_MINUTES
        and prune_count == 0
    )

    return {
        "npc": npc_key,
        "status": "silent_failure" if silent else "ok",
        "generatedAt": tel.get("generatedAt"),
        "age_minutes": round(age_min, 1) if age_min is not None else None,
        "latency_facts": len(bad),
        "prune_count": prune_count,
        "prune_source": source,
        "stats": tel.get("npcs", {}).get(npc_key.capitalize()) or tel.get("npcs", {}).get(npc_key),
    }


def main() -> int:
    token = load_token()
    if not token:
        print("No team token — py infra/mint-mcp-team-token-nas.py", file=sys.stderr)
        return 2

    print(f"Prune audit (stale threshold: {STALE_MINUTES}m)")
    failures = 0
    for npc in TARGETS:
        row = audit_npc(token, npc)
        flag = "FAIL" if row.get("status") == "silent_failure" else row.get("status", "?").upper()
        print(
            f"  [{flag}] {npc}: prunes={row.get('prune_count')} ({row.get('prune_source')}) "
            f"latency_facts={row.get('latency_facts')} age={row.get('age_minutes')}m "
            f"generatedAt={row.get('generatedAt')}"
        )
        if row.get("status") == "silent_failure":
            failures += 1
            print(
                f"       ^ Prune silent failure: telemetry reports latency/bloat for "
                f">{STALE_MINUTES}m but no prune markers in MEMORY.md"
            )

    if failures:
        print(f"\nAUDIT: {failures} silent failure(s) — check think() throttle + _applyGrokTelemetryPrune")
        return 1
    print("\nAUDIT: PASS — prune loop healthy or telemetry not yet stale")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
