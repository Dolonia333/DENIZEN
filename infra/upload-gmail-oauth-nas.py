#!/usr/bin/env python3
"""Upload denizen/data/gmail-oauth.json to NAS denizen-server + ensure googleapis + GMAIL env."""
from __future__ import annotations

from hostcfg import get_host
import base64
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parent.parent
OAUTH_FILE = ROOT / "denizen" / "data" / "gmail-oauth.json"
HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")


def run(client, cmd, timeout=300):
    print("$", cmd[:140], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:2000].encode("ascii", "replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not OAUTH_FILE.is_file():
        print(f"Missing {OAUTH_FILE} — run: node denizen/scripts/gmail-local-oauth.js")
        return 1
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    data = json.loads(OAUTH_FILE.read_text(encoding="utf-8"))
    if not data.get("access_token") and not data.get("refresh_token"):
        print("No tokens in gmail-oauth.json")
        return 1

    safe = {
        k: ("***" if k in ("access_token", "refresh_token", "client_secret") else v)
        for k, v in data.items()
    }
    print("Uploading:", json.dumps(safe, indent=2))

    # ensure scope note
    scope = str(data.get("scope") or "")
    if "gmail.readonly" not in scope and "mail.google.com" not in scope:
        print("WARN: token scope may lack gmail.readonly — re-auth if list fails")

    b64 = base64.b64encode(json.dumps(data).encode()).decode()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

    run(
        client,
        f"{DOCKER} exec denizen-server sh -c "
        f"'mkdir -p /app/data && echo {b64} | base64 -d > /app/data/gmail-oauth.json && chmod 600 /app/data/gmail-oauth.json && ls -la /app/data/gmail-oauth.json'",
    )

    # install googleapis if missing
    run(
        client,
        f"{DOCKER} exec denizen-server sh -c "
        "'cd /app && (node -e \"require(\\\"googleapis\\\")\" 2>/dev/null || npm install googleapis@^144 --omit=dev --no-audit --no-fund)'",
        timeout=600,
    )

    # env
    run(
        client,
        f"grep -q GMAIL_OAUTH_FILE '{REMOTE}/.env.production' 2>/dev/null || "
        f"echo 'GMAIL_OAUTH_FILE=/app/data/gmail-oauth.json' >> '{REMOTE}/.env.production'",
    )
    run(
        client,
        f"grep -q GMAIL_INBOUND= '{REMOTE}/.env.production' 2>/dev/null || "
        f"printf '%s\\n' 'GMAIL_INBOUND=1' "
        f"'GMAIL_INBOUND_FROM=vzion253@gmail.com,angelavanzandt1921@gmail.com' "
        f"'GMAIL_INBOUND_ORG_SLUG=zion' >> '{REMOTE}/.env.production'",
    )

    # recreate container to pick env if needed — restart often enough for file mount
    run(client, f"{DOCKER} restart denizen-server", timeout=180)
    time.sleep(20)

    run(client, f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/crm/email-inbound/status")
    run(
        client,
        f"{DOCKER} exec denizen-server node -e "
        "\"const g=require('./src/gmail-client');"
        "console.log(JSON.stringify({mode:g.mode(),real:g.isReal&&g.isReal()}));"
        "g.listMessages({q:'newer_than:2d',maxResults:3}).then(r=>console.log(JSON.stringify(r))).catch(e=>console.error(e));\"",
        timeout=60,
    )

    client.close()
    print("==> Gmail OAuth on NAS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
