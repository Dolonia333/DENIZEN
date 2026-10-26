#!/usr/bin/env python3
"""Patch DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET into the NAS denizen-server
.env from the local denizen/.env, and recreate the container so they take
effect (container is started with `node server.js`, no --env-file — env vars
are baked in at container-create time, so a plain restart won't pick this up).

Only touches these two keys. Never prints their values.
"""

from __future__ import annotations

from hostcfg import get_host
import base64
import os
import re
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
LOCAL_ENV = ROOT / "denizen" / ".env"

HOST = get_host("SYNO_HOST")
PASSWORD = None  # loaded below from infra/.env
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
ENV_PATH = "/volume1/docker/denizen-server/.env.production"
REMOTE_DIR = "/volume1/docker/denizen-server"

KEYS = ("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET")
# Generated fresh (not pulled from local AGENT_TOKEN — that token grants
# broader privileges elsewhere; this is a dedicated HMAC key for
# visitor-session-auth.js's signed tokens only).
GENERATED_KEYS = ("DENIZEN_SESSION_SIGNING_KEY",)


def load_local_keys() -> dict[str, str]:
    text = LOCAL_ENV.read_text(encoding="utf-8", errors="replace")
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
        if m and m.group(1) in KEYS:
            out[m.group(1)] = m.group(2)
    return out


def patch_env(text: str, patch: dict[str, str]) -> str:
    lines = text.splitlines()
    keys = set(patch)
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in keys:
            key = m.group(1)
            out.append(f"{key}={patch[key]}")
            keys.remove(key)
        else:
            out.append(line)
    for key in sorted(keys):
        out.append(f"{key}={patch[key]}")
    return "\n".join(out).rstrip() + "\n"


def run(client, cmd, timeout=180):
    print("$", cmd[:140], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def main() -> int:
    import load_infra_env  # noqa: F401 — populates os.environ from infra/.env

    global PASSWORD
    PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
    if not PASSWORD:
        print("ERROR: SYNO_SSH_PASSWORD required in infra/.env")
        return 1

    local_keys = load_local_keys()
    missing = [k for k in KEYS if not local_keys.get(k)]
    if missing:
        print(f"ERROR: missing/empty in denizen/.env: {missing}")
        return 1
    print(f"==> Loaded {len(local_keys)} keys from local denizen/.env (values not shown)")

    import secrets
    for key in GENERATED_KEYS:
        local_keys[key] = secrets.token_urlsafe(32)
    print(f"==> Generated {len(GENERATED_KEYS)} fresh key(s): {list(GENERATED_KEYS)}")

    # Also persist the generated signing key locally so local dev matches
    # (it doesn't already have one — falls back to AGENT_TOKEN today).
    local_text = LOCAL_ENV.read_text(encoding="utf-8", errors="replace")
    if "DENIZEN_SESSION_SIGNING_KEY=" not in local_text:
        with LOCAL_ENV.open("a", encoding="utf-8") as fh:
            fh.write(f"\nDENIZEN_SESSION_SIGNING_KEY={local_keys['DENIZEN_SESSION_SIGNING_KEY']}\n")
        print("==> Appended DENIZEN_SESSION_SIGNING_KEY to local denizen/.env")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command(f"cat {ENV_PATH} 2>/dev/null || echo ''")
    current = o.read().decode("utf-8", errors="replace")

    # Sanity: don't silently create keys that already exist with a DIFFERENT
    # unrelated meaning — just report what we found (no values printed).
    for key in (*KEYS, *GENERATED_KEYS):
        had_it = any(line.startswith(f"{key}=") for line in current.splitlines())
        print(f"    {key}: {'already present, will update' if had_it else 'not present, will add'}")

    updated = patch_env(current, local_keys)
    b64 = base64.b64encode(updated.encode()).decode()
    code, _ = run(client, f"printf '%s' '{b64}' | base64 -d > {ENV_PATH}")
    if code != 0:
        client.close()
        return code
    print(f"==> Patched {ENV_PATH}")

    code, _ = run(
        client,
        f"cd {REMOTE_DIR} && {DOCKER} compose -f docker-compose.yml up -d --force-recreate",
        timeout=300,
    )
    if code != 0:
        client.close()
        return code

    import time
    time.sleep(15)
    code, status = run(
        client,
        f"{DOCKER} ps -a --filter name=denizen-server --format \"{{{{.Names}}}}\\t{{{{.Status}}}}\"",
    )
    if "Restarting" in status or "Exited" in status:
        print("==> WARNING: container is not staying up — check logs")
        run(client, f"{DOCKER} logs denizen-server --tail 40")
        client.close()
        return 1

    run(client, f"curl -fsS -m 15 http://127.0.0.1:8888/api/health -o /dev/null -w 'health status: %{{http_code}}\\n'")
    for key in (*KEYS, *GENERATED_KEYS):
        run(client, f"{DOCKER} exec denizen-server printenv {key} | wc -c")
    run(
        client,
        f"curl -s -o /dev/null -w 'oauth connect status: %{{http_code}}\\n' "
        f"'http://127.0.0.1:8888/api/visitor/auth/discord/connect?mode=signup&return=%2Fdiscord-map%2F'",
    )

    client.close()
    print("==> Done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
