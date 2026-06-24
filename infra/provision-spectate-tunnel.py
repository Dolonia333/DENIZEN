#!/usr/bin/env python3
"""Add spectate.dolonia.cloud to NAS-Web tunnel via Cloudflare API + update Denizen env."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import base64
from pathlib import Path

import load_infra_env  # noqa: F401

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "b3b4fb60c5d98decb3eb90483152204d")
TUNNEL_ID = os.environ.get("CLOUDFLARE_TUNNEL_ID", "6d77a3dd-cef0-481d-9be0-181b249a8ef6")
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")


def spectate_routes() -> list[tuple[str, str]]:
    raw = os.environ.get(
        "DENIZEN_SPECTATE_ROUTES",
        f"spectate.dolonia.cloud:8889,spectate2.dolonia.cloud:8890",
    )
    routes: list[tuple[str, str]] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            hostname, port = part.rsplit(":", 1)
            routes.append((hostname.strip(), f"http://{HOST}:{port.strip()}"))
    if not routes:
        routes.append((
            os.environ.get("DENIZEN_SPECTATE_HOST", "spectate.dolonia.cloud"),
            os.environ.get(
                "DENIZEN_SPECTATE_ORIGIN",
                f"http://{HOST}:{os.environ.get('SYNO_DENIZEN_FOLLOWER_PORT', '8889')}",
            ),
        ))
    return routes


SPECTATE_WS_URLS = os.environ.get(
    "DENIZEN_SPECTATE_WS_URLS",
    ",".join(f"wss://{h}/agent-ws" for h, _ in spectate_routes()),
)
CERT = Path(os.environ.get("CLOUDFLARE_CERT", Path.home() / ".cloudflared" / "cert.pem"))
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
ZONE = os.environ.get("CLOUDFLARE_ZONE", "dolonia.cloud")


def resolve_api_token() -> str:
    if API_TOKEN:
        return API_TOKEN
    if not CERT.is_file():
        raise RuntimeError(f"Set CLOUDFLARE_API_TOKEN or install {CERT}")
    text = CERT.read_text(encoding="utf-8")
    match = re.search(
        r"-----BEGIN ARGO TUNNEL TOKEN-----\n(.+)\n-----END ARGO TUNNEL TOKEN-----",
        text,
        re.S,
    )
    if not match:
        raise RuntimeError(f"Could not parse API token from {CERT}")
    payload = json.loads(base64.b64decode(match.group(1)))
    token = str(payload.get("apiToken") or "").strip()
    if not token:
        raise RuntimeError("cert.pem has no apiToken field")
    return token


def cf_request(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {resolve_api_token()}",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            out = json.loads(res.read().decode("utf-8", errors="replace"))
        if not out.get("success", True):
            raise RuntimeError(out.get("errors") or out)
        return out
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {raw[:800]}") from exc


def get_tunnel_config() -> list[dict]:
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
        f"/cfd_tunnel/{TUNNEL_ID}/configurations"
    )
    out = cf_request("GET", url)
    result = out.get("result") or {}
    config = result.get("config") or {}
    ingress = config.get("ingress") or []
    if not ingress:
        raise RuntimeError("tunnel has no ingress rules")
    return ingress


def upsert_spectate_routes(ingress: list[dict], routes: list[tuple[str, str]]) -> list[dict]:
    catch_all = (
        ingress[-1]
        if ingress and not ingress[-1].get("hostname")
        else {"service": "http_status:404"}
    )
    hostnames = {h for h, _ in routes}
    rules = [
        rule
        for rule in ingress
        if rule.get("hostname") and rule.get("hostname") not in hostnames
    ]
    spectate_rules = [
        {"hostname": hostname, "service": origin, "originRequest": {}}
        for hostname, origin in routes
    ]
    return rules + spectate_rules + [catch_all]


def put_tunnel_config(ingress: list[dict]) -> None:
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
        f"/cfd_tunnel/{TUNNEL_ID}/configurations"
    )
    cf_request("PUT", url, {"config": {"ingress": ingress}})
    for rule in ingress:
        if rule.get("hostname"):
            print(f"  ingress: {rule['hostname']} -> {rule.get('service')}")


def ensure_dns(hostname: str) -> None:
    cmd = [
        "cloudflared",
        "tunnel",
        "route",
        "dns",
        "--overwrite-dns",
        TUNNEL_ID,
        hostname,
    ]
    print("$", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    print(out.strip())
    if proc.returncode != 0 and "already exists" not in out.lower():
        raise RuntimeError(f"cloudflared route dns failed ({proc.returncode})")


def patch_denizen_env() -> None:
    env = os.environ.copy()
    urls = SPECTATE_WS_URLS.split(",")
    env["DENIZEN_SPECTATE_WS_URL"] = urls[0].strip()
    env["DENIZEN_SPECTATE_WS_URLS"] = SPECTATE_WS_URLS
    infra = Path(__file__).resolve().parent
    proc = subprocess.run(
        [sys.executable, str(infra / "enable-world-pubsub-nas.py")],
        cwd=str(infra.parent),
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError("enable-world-pubsub-nas.py failed")


def wait_health(url: str, attempts: int = 20) -> bool:
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "DenizenSpectateProbe/1.0"})
            with urllib.request.urlopen(req, timeout=10) as res:
                if res.status == 200:
                    print(f"OK {url}")
                    return True
        except Exception as exc:
            print(f"wait {i + 1}/{attempts}: {url} — {exc}")
        time.sleep(3)
    return False


def main() -> int:
    routes = spectate_routes()
    print("==> provision-spectate-tunnel")
    print(f"    tunnel: {TUNNEL_ID}")
    for hostname, origin in routes:
        print(f"    route: {hostname} -> {origin}")
    print(f"    spectate WS pool: {SPECTATE_WS_URLS}")

    ingress = get_tunnel_config()
    print(f"Current ingress rules: {len(ingress)}")
    for rule in ingress:
        if rule.get("hostname"):
            print(f"  - {rule.get('hostname')} -> {rule.get('service')}")

    new_ingress = upsert_spectate_routes(ingress, routes)
    if json.dumps(new_ingress, sort_keys=True) == json.dumps(ingress, sort_keys=True):
        print("Spectate routes already present")
    else:
        print("Updated tunnel ingress:")
        put_tunnel_config(new_ingress)

    for hostname, _origin in routes:
        ensure_dns(hostname)

    print("Waiting for DNS + tunnel propagation...")
    for hostname, _origin in routes:
        public_health = f"https://{hostname}/api/health"
        if not wait_health(public_health):
            print(f"WARN: {public_health} not up yet — DNS may still propagate")

    patch_denizen_env()

    public_cfg_url = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/") + "/api/public/runtime-config"
    try:
        req = urllib.request.Request(public_cfg_url, headers={"User-Agent": "DenizenSpectateProbe/1.0"})
        with urllib.request.urlopen(req, timeout=15) as res:
            cfg = json.loads(res.read().decode("utf-8", errors="replace"))
        print(f"runtime-config: spectateEnabled={cfg.get('spectateEnabled')} url={cfg.get('spectateWsUrl')}")
    except Exception as exc:
        print(f"WARN runtime-config: {exc}")

    print("==> provision-spectate-tunnel done")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
