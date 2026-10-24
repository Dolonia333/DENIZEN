#!/usr/bin/env python3
"""Verify batch-3 deploy on NAS Denizen."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import urllib.request

import load_infra_env  # noqa: F401

HOST = get_host("SYNO_HOST")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
BASE = f"http://{HOST}:{PORT}"


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as r:
        return json.loads(r.read().decode())


def main() -> int:
    health = get("/api/health")
    office = get("/api/office-config")
    bridge = get("/api/platform-bridge/status")
    competency = get("/api/competency-map")

    print("health.ok:", health.get("ok"))
    ws = health.get("wsClients") or {}
    print("wsClients:", ws)
    print("lmStudio.reachable:", (health.get("lmStudio") or {}).get("reachable"))

    pd = (office.get("publicDemo") or {})
    print("publicDemo:", {k: pd.get(k) for k in ("enabled", "cloudProvider", "model", "npcFolders")})

    print("platform-bridge:", {k: bridge.get(k) for k in ("enabled", "mode")})
    print("competency-map keys:", list((competency.get("team") or {}).keys())[:5], "gaps:", len(competency.get("gaps") or []))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
