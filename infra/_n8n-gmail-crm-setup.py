#!/usr/bin/env python3
"""Inspect n8n Gmail credentials/workflows and import Angela→CRM inbound workflow."""
from __future__ import annotations
from hostcfg import get_host
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa
import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
N8N_KEY = os.environ.get("N8N_API_KEY", "")
# n8n inside docker / host network — use container or host port
N8N_BASE = os.environ.get("N8N_API_URL", "http://127.0.0.1:5679/api/v1").rstrip("/")

ROOT = Path(__file__).resolve().parent.parent
WF_PATH = ROOT / "denizen" / "data" / "email-workflows" / "angela-gmail-to-crm.n8n.json"


def run(c, cmd, timeout=120):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


def main() -> int:
    if not PWD:
        print("no password")
        return 1
    if not N8N_KEY:
        print("N8N_API_KEY missing in infra/.env")
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)

    # Find n8n listening port
    print("=== n8n ports ===")
    print(run(c, f"{DOCKER} port denizen-n8n 2>/dev/null; {DOCKER} inspect denizen-n8n --format '{{{{json .NetworkSettings.Ports}}}}' 2>/dev/null | head -c 500"))

    # Call n8n API from NAS host (API key)
    def n8n(path, method="GET", data=None):
        # Prefer host localhost:5679 as N8N_API_URL suggests
        url = f"{N8N_BASE}{path}"
        if method == "GET":
            cmd = (
                f"curl -fsS -m 20 -H 'X-N8N-API-KEY: {N8N_KEY}' "
                f"-H 'Accept: application/json' '{url}'"
            )
        else:
            body = json.dumps(data or {})
            # escape for single-quoted shell: use base64
            import base64
            b64 = base64.b64encode(body.encode()).decode()
            cmd = (
                f"echo {b64} | base64 -d > /tmp/n8n-body.json && "
                f"curl -fsS -m 30 -X {method} -H 'X-N8N-API-KEY: {N8N_KEY}' "
                f"-H 'Content-Type: application/json' "
                f"-H 'Accept: application/json' "
                f"--data-binary @/tmp/n8n-body.json '{url}'"
            )
        out = run(c, cmd)
        return out

    print("=== n8n credentials ===")
    creds_raw = n8n("/credentials")
    print(creds_raw[:2000])
    try:
        creds = json.loads(creds_raw)
        items = creds if isinstance(creds, list) else creds.get("data") or []
        gmail_creds = []
        for it in items:
            name = str(it.get("name") or "")
            typ = str(it.get("type") or "")
            if "gmail" in name.lower() or "gmail" in typ.lower():
                gmail_creds.append({"id": it.get("id"), "name": name, "type": typ})
        print("GMAIL_CREDS", json.dumps(gmail_creds, indent=2))
    except Exception as e:
        print("creds parse err", e)
        gmail_creds = []

    print("=== n8n workflows (names) ===")
    wfs_raw = n8n("/workflows?limit=50")
    print(wfs_raw[:1500])
    try:
        wfs = json.loads(wfs_raw)
        data = wfs.get("data") if isinstance(wfs, dict) else wfs
        for w in (data or [])[:30]:
            print("-", w.get("id"), w.get("name"), "active=", w.get("active"))
    except Exception as e:
        print("wf parse", e)

    if not WF_PATH.is_file():
        print("workflow file missing", WF_PATH)
        c.close()
        return 1

    wf = json.loads(WF_PATH.read_text(encoding="utf-8"))
    # Inject gmail credential if found
    if gmail_creds:
        g = gmail_creds[0]
        for node in wf.get("nodes") or []:
            if "gmail" in str(node.get("type", "")).lower() or "Gmail" in str(node.get("name", "")):
                node["credentials"] = {
                    "gmailOAuth2": {
                        "id": str(g["id"]),
                        "name": g["name"],
                    }
                }
                print("bound gmail cred", g)

    # Fix Denizen host for NAS
    denizen_url = os.environ.get("DENIZEN_NAS_URL", "http://127.0.0.1:8888")
    secret = os.environ.get("DENIZEN_EMAIL_SECRET") or os.environ.get("EMAIL_INBOUND_SECRET") or ""
    for node in wf.get("nodes") or []:
        if node.get("type") == "n8n-nodes-base.httpRequest":
            params = node.setdefault("parameters", {})
            params["url"] = f"{denizen_url.rstrip('/')}/api/crm/email-inbound"
            headers = params.get("headerParameters", {}).get("parameters") or []
            for h in headers:
                if h.get("name") == "X-Denizen-Secret" and secret:
                    h["value"] = secret
            print("http node url", params.get("url"))

    # n8n create workflow API
    payload = {
        "name": wf.get("name") or "Angela Gmail → CRM",
        "nodes": wf.get("nodes"),
        "connections": wf.get("connections"),
        "settings": wf.get("settings") or {},
    }
    print("=== create workflow ===")
    created = n8n("/workflows", method="POST", data=payload)
    print(created[:2000])

    try:
        created_j = json.loads(created)
        wid = created_j.get("id") or (created_j.get("data") or {}).get("id")
        if wid:
            print("activating", wid)
            act = n8n(f"/workflows/{wid}/activate", method="POST", data={})
            print(act[:800])
    except Exception as e:
        print("activate err", e)

    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
