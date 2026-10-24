#!/usr/bin/env python3
"""Check Robinhood OAuth/MCP state on NAS Denizen container."""

from __future__ import annotations

from hostcfg import get_host
import json
import load_infra_env  # noqa: F401

import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    cmds = [
        f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/market/auth-status",
        f"{DOCKER} exec denizen-server printenv ROBINHOOD_API_TOKEN 2>/dev/null | wc -c",
        f"{DOCKER} exec denizen-server test -f /app/data/robinhood-oauth.json && "
        f"{DOCKER} exec denizen-server cat /app/data/robinhood-oauth.json || echo '(no oauth file)'",
        f"{DOCKER} exec denizen-server ls -la /app/data/roki-watchlist.json /app/data/trade-suggestions.json 2>/dev/null || true",
    ]
    for cmd in cmds:
        print("===", cmd[:100])
        _, o, e = c.exec_command(cmd, timeout=30)
        text = (o.read() + e.read()).decode("utf-8", errors="replace")
        # redact tokens
        if "access_token" in text:
            try:
                data = json.loads(text)
                for key in ("access_token", "refresh_token"):
                    if data.get(key):
                        data[key] = "***"
                text = json.dumps(data, indent=2)
            except Exception:
                pass
        print(text[:2000])
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
