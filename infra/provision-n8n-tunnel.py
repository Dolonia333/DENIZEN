#!/usr/bin/env python3
"""Expose NAS n8n at https://n8n.dolonia.cloud via Cloudflare tunnel + redeploy container."""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "b3b4fb60c5d98decb3eb90483152204d")
TUNNEL_ID = os.environ.get("CLOUDFLARE_TUNNEL_ID", "6d77a3dd-cef0-481d-9be0-181b249a8ef6")
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
CERT = Path(os.environ.get("CLOUDFLARE_CERT", Path.home() / ".cloudflared" / "cert.pem"))
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()

N8N_HOSTNAME = os.environ.get("N8N_PUBLIC_HOST", "n8n.dolonia.cloud")
N8N_ORIGIN = os.environ.get("N8N_ORIGIN", f"http://{HOST}:5679")
N8N_PUBLIC = f"https://{N8N_HOSTNAME}"


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
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {resolve_api_token()}",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
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
    ingress = (out.get("result") or {}).get("config", {}).get("ingress") or []
    if not ingress:
        raise RuntimeError("tunnel has no ingress rules")
    return ingress


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
    cmd = ["cloudflared", "tunnel", "route", "dns", "--overwrite-dns", TUNNEL_ID, hostname]
    print("$", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    print(out.strip())
    if proc.returncode != 0 and "already exists" not in out.lower():
        raise RuntimeError(f"cloudflared route dns failed ({proc.returncode})")


def upsert_n8n_route(ingress: list[dict]) -> list[dict]:
    catch_all = (
        ingress[-1]
        if ingress and not ingress[-1].get("hostname")
        else {"service": "http_status:404"}
    )
    rules = [
        rule
        for rule in ingress
        if rule.get("hostname") and rule.get("hostname") != N8N_HOSTNAME
    ]
    n8n_rule = {"hostname": N8N_HOSTNAME, "service": N8N_ORIGIN, "originRequest": {}}
    return rules + [n8n_rule] + [catch_all]


def wait_health(url: str, attempts: int = 20) -> bool:
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "DenizenN8nProbe/1.0"})
            with urllib.request.urlopen(req, timeout=12) as res:
                if res.status == 200:
                    print(f"OK {url}")
                    return True
        except Exception as exc:
            print(f"wait {i + 1}/{attempts}: {url} — {exc}")
        time.sleep(3)
    return False


def main() -> int:
    print("==> provision-n8n-tunnel")
    print(f"    tunnel: {TUNNEL_ID}")
    print(f"    route:  {N8N_HOSTNAME} -> {N8N_ORIGIN}")

    ingress = get_tunnel_config()
    new_ingress = upsert_n8n_route(ingress)
    if json.dumps(new_ingress, sort_keys=True) != json.dumps(ingress, sort_keys=True):
        print("Updated tunnel ingress:")
        put_tunnel_config(new_ingress)
    else:
        print("n8n route already present in tunnel")

    ensure_dns(N8N_HOSTNAME)

    print("Redeploying n8n container with HTTPS public URL env...")
    proc = subprocess.run(
        [sys.executable, str(INFRA / "setup-n8n-lucy-workflow-nas.py")],
        cwd=str(INFRA.parent),
        env={**os.environ, "N8N_URL": N8N_PUBLIC},
    )
    if proc.returncode != 0:
        return proc.returncode

    print("Waiting for public n8n health...")
    wait_health(f"{N8N_PUBLIC}/healthz")

    print("\n==> n8n HTTPS provisioned")
    print(f"  UI: {N8N_PUBLIC}")
    print("  Google OAuth redirect URI:")
    print(f"    {N8N_PUBLIC}/rest/oauth2-credential/callback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
