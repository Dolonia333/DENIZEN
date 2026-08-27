#!/usr/bin/env python3
"""Minimal NAS hotfix: MCP presence + roster collapse (cwr_2d111c46eafb79b4).

Copies only the three runtime files into denizen-server and restarts.
Requires SYNO_SSH_PASSWORD (infra/.env). Host defaults to 192.168.1.237.

  py infra/hotfix-mcp-presence-nas.py
"""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
DENIZEN = ROOT / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
CHUNK = 1024 * 512

SYNC_PATHS = [
    "src/denizen-mcp-team-tools.js",
    "src/denizen-mcp-team-gateway.js",
    "src/denizen-npc-mcp-gateway.js",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    log(f"$ {cmd[:160]}")
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def stream_to_remote(client: paramiko.SSHClient, local_path: Path, remote_path: str) -> int:
    parent = remote_path.rsplit("/", 1)[0]
    run_ssh(client, f"mkdir -p '{parent}'")
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'", timeout=7200)
    with open(local_path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            stdin.write(chunk)
    stdin.flush()
    stdin.channel.shutdown_write()
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code


def main() -> int:
    if not PASSWORD:
        log("ERROR: SYNO_SSH_PASSWORD required in infra/.env")
        return 1

    for rel in SYNC_PATHS:
        if not (DENIZEN / rel).is_file():
            log(f"ERROR: missing {rel}")
            return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "mcp-presence-hotfix.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in SYNC_PATHS:
                tar.add(DENIZEN / rel, arcname=rel)

        log(f"==> Hotfix {tar_path.stat().st_size // 1024} KB → {HOST}")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/mcp-presence-hotfix.tar.gz"
        if stream_to_remote(client, tar_path, remote_tar) != 0:
            return 1

        extract_dir = f"{REMOTE_DIR}/hotfix-mcp-presence"
        code, _ = run_ssh(
            client,
            f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' "
            f"&& tar -xzf '{remote_tar}' -C '{extract_dir}'",
        )
        if code != 0:
            return code

        for rel in SYNC_PATHS:
            run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p '/app/src'")
            run_ssh(
                client,
                f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}",
            )

        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=120)
        code, out = run_ssh(
            client,
            f"sleep 8 && curl -fsS -m 15 http://127.0.0.1:{PORT}/api/health | head -c 400",
        )
        run_ssh(
            client,
            f"{DOCKER} exec denizen-server grep -n 'touchMcpPresence' /app/src/denizen-mcp-team-tools.js | head -3",
        )
        run_ssh(
            client,
            f"{DOCKER} exec denizen-server grep -n 'collapseRosterByIdentity' /app/src/denizen-mcp-team-tools.js | head -3",
        )
        client.close()

    if code != 0:
        log("ERROR: health check failed after restart")
        return code
    log("==> MCP presence hotfix deployed on NAS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
