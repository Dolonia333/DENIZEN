#!/usr/bin/env python3
"""Copy LM Studio router hotfix into running NAS container and restart."""

from __future__ import annotations

from hostcfg import get_host
import os
import sys
import time
from pathlib import Path

import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parent.parent / "denizen"
HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

FILES = [
    "src/format-provider-error.js",
    "src/llm-telemetry.js",
    "src/lm-studio-router.js",
    "src/cofounder-agent.js",
    "src/denizen-hardware-monitor.js",
    "src/denizen-mcp-mesh-tools.js",
    "src/denizen-mcp-cursor-tools.js",
    "src/denizen-mcp-scopes.js",
    "src/denizen-npc-mcp-gateway.js",
    "src/denizen-mcp-team-gateway.js",
    "src/denizen-compute-routes.js",
    "src/visitor-mcp-connect-ui.js",
    "src/denizen-lazy-scripts.js",
    "jelly/skills/cursor-bridge/index.js",
    "src/denizen-host-compute.js",
    "src/npc-brains.js",
    "server.js",
]


def stream_file(client: paramiko.SSHClient, local_path: Path, remote_path: str) -> None:
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'")
    stdin.write(local_path.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    remote_tmp = "/tmp/denizen-hotfix"
    client.exec_command(f"mkdir -p {remote_tmp}")

    for rel in FILES:
        local = ROOT / rel
        if not local.is_file():
            print(f"missing {local}", file=sys.stderr)
            return 1
        remote = f"{remote_tmp}/{rel.replace('/', '_')}"
        stream_file(client, local, remote)
        cmd = f"{DOCKER} cp '{remote}' denizen-server:/app/{rel}"
        _, out, err = client.exec_command(cmd)
        code = out.channel.recv_exit_status()
        if code != 0:
            print((out.read() + err.read()).decode(), file=sys.stderr)
            return code
        print(f"copied {rel}")

    _, out, err = client.exec_command(f"{DOCKER} restart denizen-server")
    print((out.read() + err.read()).decode().strip())
    time.sleep(10)

    for path in ("/api/health", "/api/compute/inference/nodes"):
        _, out, err = client.exec_command(f"curl -fsS http://127.0.0.1:{PORT}{path}")
        text = (out.read() + err.read()).decode("utf-8", errors="replace")
        print(f"\n--- {path} ---\n{text[:1200]}")

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
