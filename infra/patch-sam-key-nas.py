#!/usr/bin/env python3
"""Patch SAM_GOV_API_KEY into the NAS denizen-server .env.production from the
local denizen/.env, and recreate the container so it takes effect (env is baked
in at container-create time, so a plain `docker restart` won't pick it up).

Only touches SAM_GOV_API_KEY. Never prints its value. The key lives only in the
gitignored denizen/.env — it is never committed and never echoed.
"""

from __future__ import annotations

from hostcfg import get_host
import base64
import os
import re
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
LOCAL_ENV = ROOT / "denizen" / ".env"

HOST = get_host("SYNO_HOST")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
ENV_PATH = "/volume1/docker/denizen-server/.env.production"
REMOTE_DIR = "/volume1/docker/denizen-server"

KEYS = ("SAM_GOV_API_KEY", "SAM_GOV_NAICS")


def load_local_keys() -> dict[str, str]:
    text = LOCAL_ENV.read_text(encoding="utf-8", errors="replace")
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
        if m and m.group(1) in KEYS:
            out[m.group(1)] = m.group(2)
    return out


def patch_env(text: str, patch: dict[str, str]) -> str:
    """Rewrite matching keys in place; append any not already present. Every
    other line passes through untouched."""
    keys = set(patch)
    out = []
    for line in text.splitlines():
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

    password = os.environ.get("SYNO_SSH_PASSWORD", "")
    if not password:
        print("ERROR: SYNO_SSH_PASSWORD required in infra/.env")
        return 1

    local_keys = load_local_keys()
    missing = [k for k in KEYS if not local_keys.get(k)]
    if missing:
        print(f"ERROR: missing/empty in denizen/.env: {missing}")
        return 1
    print(f"==> Loaded {len(local_keys)} key(s) from local denizen/.env (values not shown)")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=password, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command(f"cat {ENV_PATH} 2>/dev/null || echo ''")
    current = o.read().decode("utf-8", errors="replace")
    for key in KEYS:
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

    time.sleep(15)
    _, status = run(
        client,
        f"{DOCKER} ps -a --filter name=denizen-server --format \"{{{{.Names}}}}\\t{{{{.Status}}}}\"",
    )
    if "Restarting" in status or "Exited" in status:
        print("==> WARNING: container is not staying up — check logs")
        run(client, f"{DOCKER} logs denizen-server --tail 40")
        client.close()
        return 1

    run(client, f"curl -fsS -m 15 http://127.0.0.1:8888/api/health -o /dev/null -w 'health status: %{{http_code}}\\n'")
    for key in KEYS:
        run(client, f"{DOCKER} exec denizen-server printenv {key} | wc -c")
    # Confirm the feature reports configured (does not print the key):
    run(
        client,
        "curl -s -m 25 'http://127.0.0.1:8888/api/crm/sam/search?days=7&limit=1' "
        "| head -c 200; echo",
    )

    client.close()
    print("==> Done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
