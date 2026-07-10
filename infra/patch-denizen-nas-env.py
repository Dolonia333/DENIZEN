#!/usr/bin/env python3
"""Patch NAS denizen-server .env for production LLM behavior and restart container."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import re
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
ENV_PATH = "/volume1/docker/denizen-server/.env"

PATCH = {
    "DENIZEN_ECONOMY_MODE": "false",
    "DENIZEN_COFOUNDER_LLM": "true",
    "DENIZEN_REAL_WORK_MODE": "true",
    "DENIZEN_AUTO_CLAIM_SPRINT": "true",
    "DENIZEN_REAL_WORK_CYCLES": "2",
    "DENIZEN_LIGHT_OFFICE": "false",
    "DENIZEN_PUBLIC_URL": "https://denizen.dolonia.cloud",
    "DENIZEN_PUBLIC_DEMO": "true",
    "DENIZEN_PUBLIC_DEMO_TRIM_BRAINS": "false",
    "DENIZEN_PUBLIC_DEMO_NPCS": "abby,alex,lucy,bouncer",
    "DENIZEN_PUBLIC_DEMO_MODEL": "claude-haiku-3-5-20241022",
    "DENIZEN_MAX_WS_CLIENTS": "30",
    "DENIZEN_PLATFORM_BRIDGE": "false",
    "DENIZEN_INFERENCE_RPC_TIMEOUT_MS": "120000",
    "DENIZEN_INFERENCE_BACKEND": "auto",
    "DENIZEN_THINK_USE_FAST_MODEL": "true",
    "LM_STUDIO_PARALLEL": "1",
    "BOUNCER_PATROL": "container",
    "DENIZEN_HOST_IP": "192.168.1.232",
    "BOUNCER_INVESTIGATION_URL": os.environ.get(
        "BOUNCER_INVESTIGATION_URL", "http://192.168.1.232:8890"
    ),
}
_token = os.environ.get("BOUNCER_INVESTIGATION_TOKEN", "").strip()
if _token:
    PATCH["BOUNCER_INVESTIGATION_TOKEN"] = _token

_demo_key = os.environ.get("DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY") or os.environ.get("ANTHROPIC_API_KEY")
if _demo_key:
    PATCH["DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY"] = _demo_key

# coding-agent / Claude Code CLI reads ANTHROPIC_API_KEY specifically.
_anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
if _anthropic_key:
    PATCH["ANTHROPIC_API_KEY"] = _anthropic_key


def run(client, cmd, timeout=120):
    print("$", cmd[:100], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())
    return o.channel.recv_exit_status(), out


def patch_env(text: str) -> str:
    lines = text.splitlines()
    keys = set(PATCH)
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in keys:
            key = m.group(1)
            out.append(f"{key}={PATCH[key]}")
            keys.remove(key)
        else:
            out.append(line)
    for key in sorted(keys):
        out.append(f"{key}={PATCH[key]}")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command(f"cat {ENV_PATH} 2>/dev/null || echo ''")
    current = o.read().decode("utf-8", errors="replace")
    updated = patch_env(current)

    import base64
    b64 = base64.b64encode(updated.encode()).decode()
    code, _ = run(
        client,
        f"printf '%s' '{b64}' | base64 -d > {ENV_PATH}",
    )
    if code != 0:
        client.close()
        return code
    print(f"Patched {ENV_PATH}")

    code, _ = run(client, f"cd /volume1/docker/denizen-server && {DOCKER} compose -f docker-compose.yml up -d --force-recreate")

    # Verify keys reached container (names + length only — never print values).
    for key in ("ANTHROPIC_API_KEY", "DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY"):
        run(
            client,
            f"{DOCKER} exec denizen-server sh -c 'v=$(printenv {key} 2>/dev/null); "
            f"if [ -n \"$v\" ]; then echo {key}=SET chars=${{#v}}; else echo {key}=UNSET; fi'",
        )
    for key in PATCH:
        if key not in ("ANTHROPIC_API_KEY", "DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY"):
            run(client, f"{DOCKER} exec denizen-server printenv {key} 2>/dev/null || true")

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
