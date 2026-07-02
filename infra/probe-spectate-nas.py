#!/usr/bin/env python3
"""Probe primary + follower spectate stack on NAS."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import load_infra_env  # noqa: F401

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PRIMARY_PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
FOLLOWER_PORT = os.environ.get("SYNO_DENIZEN_FOLLOWER_PORT", "8889")
FOLLOWER_PORTS = [
    p.strip()
    for p in os.environ.get("DENIZEN_FOLLOWER_PORTS", "8889,8890").split(",")
    if p.strip()
]
PUBLIC = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
SPECTATE_PUBLIC = os.environ.get(
    "DENIZEN_SPECTATE_PUBLIC_URL",
    os.environ.get("DENIZEN_SPECTATE_HOST", "spectate.dolonia.cloud"),
)
if not SPECTATE_PUBLIC.startswith("http"):
    SPECTATE_PUBLIC = f"https://{SPECTATE_PUBLIC}"


def resolve_via_public_dns(hostname: str) -> str | None:
    try:
        out = subprocess.check_output(
            ["nslookup", hostname, "1.1.1.1"],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10,
        )
    except Exception:
        return None
    ips: list[str] = []
    for line in out.splitlines():
        m = re.search(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b", line)
        if m and "1.1.1.1" not in line:
            ips.append(m.group(1))
    return ips[0] if ips else None


def fetch(url: str, *, host_header: str | None = None) -> dict:
    headers = {"User-Agent": "DenizenSpectateProbe/1.0", "Accept": "application/json"}
    if host_header:
        headers["Host"] = host_header
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8", errors="replace"))


def fetch_https_hostname(url: str) -> dict:
    try:
        return fetch(url)
    except (OSError, urllib.error.URLError) as exc:
        if "getaddrinfo failed" not in str(exc):
            raise
        parsed = urlparse(url)
        ip = resolve_via_public_dns(parsed.hostname or "")
        if not ip:
            raise
        host = parsed.hostname or ""
        print(f"  (local DNS lag — probing via curl --resolve {host}:443:{ip})")
        out = subprocess.check_output(
            [
                "curl",
                "-sS",
                "--max-time",
                "15",
                "-H",
                "User-Agent: DenizenSpectateProbe/1.0",
                "--resolve",
                f"{host}:443:{ip}",
                url,
            ],
            text=True,
        )
        return json.loads(out)


def main() -> int:
    ok = True
    for label, base in [
        ("primary-lan", f"http://{HOST}:{PRIMARY_PORT}"),
        *[(f"follower-lan-{port}", f"http://{HOST}:{port}") for port in FOLLOWER_PORTS],
        ("primary-public", PUBLIC),
    ]:
        try:
            health = fetch(f"{base}/api/health")
            pub = health.get("worldPubsub") or {}
            print(f"OK {label}: role={health.get('server', {}).get('role')} pubsub={pub}")
            if label.startswith("follower") and health.get("server", {}).get("role") != "follower":
                print(f"  WARN: expected follower role")
                ok = False
            if pub.get("driver") == "redis" and not pub.get("connected"):
                print("  WARN: redis not connected")
                ok = False
        except Exception as exc:
            print(f"FAIL {label}: {exc}")
            ok = False

    try:
        cfg = fetch(f"{PUBLIC}/api/public/runtime-config")
        print(f"OK runtime-config: spectateEnabled={cfg.get('spectateEnabled')} url={cfg.get('spectateWsUrl')}")
        if not cfg.get("spectateEnabled"):
            print("  WARN: spectateEnabled=false on public runtime-config")
            ok = False
    except Exception as exc:
        print(f"WARN runtime-config: {exc}")

    try:
        spectate_health = fetch_https_hostname(f"{SPECTATE_PUBLIC.rstrip('/')}/api/health")
        role = spectate_health.get("server", {}).get("role")
        pub = spectate_health.get("worldPubsub") or {}
        print(f"OK spectate-public: role={role} pubsub={pub}")
        if role != "follower":
            print("  WARN: expected follower role on spectate hostname")
            ok = False
    except Exception as exc:
        print(f"WARN spectate-public: {exc}")

    try:
        snap = fetch(f"http://{HOST}:{FOLLOWER_PORTS[0]}/api/world-state")
        print(f"OK follower world-state proxy: npcs={len(snap.get('npcs') or {})}")
    except Exception as exc:
        print(f"FAIL follower world-state proxy: {exc}")
        ok = False

    try:
        import subprocess as sp
        redis_info = sp.check_output(
            ["py", str(Path(__file__).resolve().parent / "check-redis-persistence-nas.py")],
            text=True,
            timeout=30,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        if "aof_enabled:1" in redis_info.lower() or "appendonly:yes" in redis_info.lower():
            print("OK redis persistence: AOF enabled")
        else:
            print("WARN redis persistence: AOF not confirmed")
    except Exception as exc:
        print(f"WARN redis persistence check: {exc}")

    print("==> spectate probe", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
