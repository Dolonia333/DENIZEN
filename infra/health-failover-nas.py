#!/usr/bin/env python3
"""Probe primary, followers, spectate hostnames, and print failover drill."""

from __future__ import annotations

from hostcfg import get_host
import json
import os
import sys
import urllib.error
import urllib.request

import load_infra_env  # noqa: F401

PRIMARY = os.environ.get("DENIZEN_PRIMARY_URL", "https://denizen.dolonia.cloud").rstrip("/")
STANDBY = (os.environ.get("DENIZEN_STANDBY_URL") or "http://" + get_host("SYNO_HOST") + ":8888").rstrip("/")
HOST = get_host("SYNO_HOST")
FOLLOWER_PORTS = [
    p.strip()
    for p in os.environ.get("DENIZEN_FOLLOWER_PORTS", "8889,8890").split(",")
    if p.strip()
]
SPECTATE_HOSTS = [
    h.strip()
    for h in os.environ.get(
        "DENIZEN_SPECTATE_HOSTS",
        "spectate.dolonia.cloud,spectate2.dolonia.cloud",
    ).split(",")
    if h.strip()
]
TIMEOUT = int(os.environ.get("DENIZEN_HEALTH_TIMEOUT", "12"))


def probe(url: str) -> dict:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DenizenFailoverProbe/1.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return {"ok": True, "status": resp.status, "body": body}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "status": exc.code, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "status": None, "error": str(exc)}


def summarize(label: str, result: dict) -> None:
    status = "OK" if result["ok"] else "FAIL"
    print(f"{label}: {status}")
    if result.get("body"):
        b = result["body"]
        role = b.get("server", {}).get("role") or b.get("server_role") or b.get("role")
        ws = b.get("ws") or b.get("wsClients") or {}
        pub = b.get("worldPubsub") or {}
        print(f"  role={role} ws={ws.get('agent')}/{ws.get('max')} pubsub={pub.get('connected')}")
    elif result.get("error"):
        print(f"  error: {result['error']}")


def main() -> int:
    primary = probe(f"{PRIMARY}/api/health")
    standby = probe(f"{STANDBY}/api/health")

    print("== Denizen failover probe ==")
    summarize(f"Primary {PRIMARY}", primary)

    for port in FOLLOWER_PORTS:
        summarize(f"Follower :{port}", probe(f"http://{HOST}:{port}/api/health"))

    for host in SPECTATE_HOSTS:
        summarize(f"Spectate {host}", probe(f"https://{host}/api/health"))

    summarize(f"Standby {STANDBY}", standby)

    if primary["ok"]:
        print("\nNo action — primary is healthy.")
        print("Failover drill (dry run):")
        print("  1. Stop denizen-server on NAS — followers keep relaying last Redis frames only")
        print("  2. Repoint denizen.dolonia.cloud tunnel to standby origin if needed")
        print("  3. Clients auto-reconnect via spectate-ui banner (30s backoff)")
        print("  4. Target RTO: <5 min manual tunnel flip; viewers see reconnect banner immediately")
        return 0

    if not standby["ok"]:
        print("\nBoth primary and standby failed — check mesh manually.")
        return 2

    print("\n== Suggested failover (manual) ==")
    print("1. Cloudflare Zero Trust → Tunnels → NAS-Web → Public Hostname")
    print(f"   Point denizen.dolonia.cloud to standby origin: {STANDBY.replace('http://', '')}")
    print("2. Or run: py infra/repoint-mesh-to-nas.py")
    print("3. Re-run: py infra/probe-spectate-nas.py")
    print("4. Spectate followers are read-only — game state pauses until primary returns")
    return 1


if __name__ == "__main__":
    sys.exit(main())
