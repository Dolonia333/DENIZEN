#!/usr/bin/env python3
"""One-file hotfix: denizen-npc-mcp-gateway.js actor_type fix."""
from hostcfg import get_host
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parent.parent
HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = "/volume1/docker/denizen-server/hotfix-denizen-npc-mcp-gateway.js"
LOCAL = ROOT / "denizen" / "src" / "denizen-npc-mcp-gateway.js"


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
    c.exec_command(f"mkdir -p '{Path(REMOTE).parent.as_posix()}'")[1].channel.recv_exit_status()
    data = LOCAL.read_bytes()
    stdin, stdout, stderr = c.exec_command(f"cat > '{REMOTE}'", timeout=60)
    stdin.write(data)
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    for cmd in (
        f"{DOCKER} cp '{REMOTE}' denizen-server:/app/src/denizen-npc-mcp-gateway.js",
        f"{DOCKER} restart denizen-server",
        "sleep 10",
        "curl -fsS -m 15 http://127.0.0.1:8888/api/health | head -c 200",
    ):
        _, o, e = c.exec_command(cmd, timeout=120)
        out = (o.read() + e.read()).decode("utf-8", errors="replace")
        if out.strip():
            print(out.strip()[:400])
    c.close()
    print("hotfix ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
