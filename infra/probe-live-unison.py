#!/usr/bin/env python3
"""Probe live Denizen fleet + credit economy (no secrets printed)."""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "denizen" / ".env"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    if not ENV.exists():
        return out
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def get(url: str, headers: dict[str, str] | None = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def score_hardware(cpu_cores: int, ram_mb: int, vram_mb: int, gpu: str | None) -> int:
    def vram_pts(v: int) -> int:
        tiers = [(24576, 34), (16384, 28), (12288, 22), (8192, 16), (6144, 12), (4096, 8), (2048, 4)]
        for limit, pts in tiers:
            if v >= limit:
                return pts
        return 0

    def ram_pts(r: int) -> int:
        tiers = [(65536, 28), (32768, 22), (16384, 15), (8192, 9), (4096, 4)]
        for limit, pts in tiers:
            if r >= limit:
                return pts
        return 0

    def cpu_pts(c: int) -> int:
        tiers = [(24, 26), (16, 22), (12, 17), (8, 12), (6, 8), (4, 5), (2, 2)]
        for limit, pts in tiers:
            if c >= limit:
                return pts
        return 0

    discrete = 0
    if gpu:
        g = gpu.lower()
        if not any(x in g for x in ("integrated", "intel uhd", "intel iris", "apple m1", "apple m2", "apple m3")):
            discrete = 12
    return min(100, vram_pts(vram_mb) + ram_pts(ram_mb) + cpu_pts(cpu_cores) + discrete)


def main() -> int:
    env = load_env()
    base = "http://127.0.0.1:8081"
    sid = env.get("DENIZEN_FLEET_SESSION_ID", "")
    token = env.get("DENIZEN_FLEET_SESSION_TOKEN", "")
    headers = {
        "X-Session-Token": token,
        "X-Ceo-Principal": "1",
        "X-Denizen-Local-Client": "1",
    }

    live = get(f"{base}/api/compute/hardware/live?session_id={sid}", headers)
    economy = get(f"{base}/api/compute/credits/economy?session_id={sid}", headers)
    health = get(f"{base}/api/health")

    print("UNISON_PROBE true")
    print(f"fleet_machines={len(live.get('fleet', []))}")
    for m in live.get("fleet", []):
        gpu = (m.get("gpu") or {})
        score = score_hardware(
            int(m.get("cpu_cores") or 0),
            int((m.get("ram") or {}).get("total_mb") or 0),
            int(gpu.get("vram_total_mb") or 0),
            gpu.get("model"),
        )
        print(
            f"machine {m.get('machine_id')} role={m.get('role')} "
            f"cpu={m.get('cpu_percent')}% ram={(m.get('ram') or {}).get('used_percent')}% "
            f"gpu={gpu.get('utilization_percent')}% score={score}"
        )

    daily = (economy.get("daily_totals") or economy.get("credits_economy", {}).get("daily_totals") or {})
    est = economy.get("estimated_job_credits") or (economy.get("breakdown") or {}).get("amount")
    print(f"credits_today={daily.get('total', 0)} est_job={est}")
    print(f"health_fleet={len((health.get('hardware') or {}).get('fleet', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
