#!/usr/bin/env python3
"""Patch AGENT_TOKEN into NAS denizen-server .env for denizen-data / business-context-brief."""
from __future__ import annotations

from hostcfg import get_host
import os
import re
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
# NOTE: docker-compose.yml for denizen-server declares env_file: .env.production,
# so THAT is the file the container actually reads. Patching plain .env wrote to a
# file nothing loads — these patches silently had no effect (this is why the CLI
# bridge env never reached the server). Also: docker restart does NOT reload env;
# use .
ENV_PATH = "/volume1/docker/denizen-server/.env.production"
SECURE = REPO / "denizen" / "jelly" / "services" / "supabase-bridge" / ".env.secure"


def read_token() -> str:
    if os.environ.get("AGENT_TOKEN"):
        return os.environ["AGENT_TOKEN"].strip()
    if SECURE.is_file():
        for line in SECURE.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^AGENT_TOKEN=(.+)$", line.strip())
            if m:
                return m.group(1).strip().strip('"').strip("'")
    return ""


def patch_env(text: str, token: str) -> str:
    lines = text.splitlines()
    out = []
    found = False
    for line in lines:
        if line.startswith("AGENT_TOKEN="):
            out.append(f"AGENT_TOKEN={token}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"AGENT_TOKEN={token}")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    token = read_token()
    if not token:
        print("AGENT_TOKEN not found — set env or denizen/jelly/services/supabase-bridge/.env.secure")
        return 1
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command(f"cat '{ENV_PATH}' 2>/dev/null || true", timeout=30)
    current = o.read().decode("utf-8", errors="replace")
    patched = patch_env(current, token)

    cmd = f"cat > '{ENV_PATH}' <<'ENVEOF'\n{patched}ENVEOF"
    client.exec_command(cmd, timeout=30)
    client.exec_command(f"{DOCKER} restart denizen-server", timeout=120)
    client.close()

    print("Patched AGENT_TOKEN on NAS and restarted denizen-server")
    print("Verify: py infra/verify-phase3-marcus-business-crm.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
