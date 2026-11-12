#!/usr/bin/env python3
"""Verify n8n API key and patch NAS denizen-server .env with N8N_API_* vars."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
ENV_PATH = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server") + "/.env"
N8N_API_URL = os.environ.get("N8N_API_URL", "http://127.0.0.1:5679/api/v1")
INFRA_ENV = INFRA / ".env"


def patch_env_text(text: str, values: dict[str, str]) -> str:
    lines = text.splitlines()
    remaining = dict(values)
    out: list[str] = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in remaining:
            key = m.group(1)
            out.append(f"{key}={remaining.pop(key)}")
        else:
            out.append(line)
    for key in sorted(remaining):
        out.append(f"{key}={remaining[key]}")
    return "\n".join(out).rstrip() + "\n"


def probe_n8n(api_key: str) -> dict:
    req = urllib.request.Request(
        f"{N8N_API_URL.rstrip('/')}/workflows?limit=5",
        method="GET",
        headers={
            "Accept": "application/json",
            "X-N8N-API-KEY": api_key,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def probe_n8n_via_nas(client: paramiko.SSHClient, api_key: str) -> tuple[int, str]:
    cmd = (
        "curl -fsS -m 20 "
        "-H 'accept: application/json' "
        f"-H 'X-N8N-API-KEY: {api_key}' "
        "'http://127.0.0.1:5679/api/v1/workflows?limit=3'"
    )
    _, o, e = client.exec_command(cmd, timeout=30)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def main() -> int:
    api_key = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("N8N_API_KEY", "")).strip()
    if not api_key:
        print("Usage: patch-n8n-api-env.py <N8N_API_KEY>", file=sys.stderr)
        return 1
    if not PWD:
        print("SYNO_SSH_PASSWORD required in infra/.env", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    code, out = probe_n8n_via_nas(client, api_key)
    if code != 0:
        print("ERROR: n8n API probe failed:", out[:500], file=sys.stderr)
        client.close()
        return 1

    try:
        payload = json.loads(out)
    except json.JSONDecodeError:
        print("ERROR: non-JSON n8n response:", out[:300], file=sys.stderr)
        client.close()
        return 1

    names = [w.get("name", "?") for w in payload.get("data", [])[:5]]
    print("n8n API OK — workflows:", names)

    _, o, _ = client.exec_command(f"cat '{ENV_PATH}' 2>/dev/null || true", timeout=30)
    env_text = o.read().decode("utf-8", errors="replace")
    patched = patch_env_text(env_text, {
        "N8N_API_URL": N8N_API_URL,
        "N8N_API_KEY": api_key,
    })

    stdin, stdout, _ = client.exec_command(f"cat > '{ENV_PATH}'", timeout=60)
    stdin.write(patched.encode("utf-8"))
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    print(f"patched {ENV_PATH}")

    _, o, e = client.exec_command(
        f"cd '{os.environ.get('SYNO_DENIZEN_DIR', '/volume1/docker/denizen-server')}' && {DOCKER} compose up -d --force-recreate",
        timeout=180,
    )
    print((o.read() + e.read()).decode("utf-8", errors="replace")[:800])
    client.close()

    # Keep key locally for infra scripts / Cursor (gitignored).
    infra_text = INFRA_ENV.read_text(encoding="utf-8") if INFRA_ENV.exists() else ""
    infra_patched = patch_env_text(infra_text, {
        "N8N_API_URL": N8N_API_URL,
        "N8N_API_KEY": api_key,
        "N8N_URL": os.environ.get("N8N_URL", "https://n8n.dolonia.cloud"),
    })
    INFRA_ENV.write_text(infra_patched, encoding="utf-8")
    print(f"patched {INFRA_ENV}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
