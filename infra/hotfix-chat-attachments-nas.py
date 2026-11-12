#!/usr/bin/env python3
"""Deploy the chat-attachments feature (files/photos in NPC chat) to the NAS container."""

from __future__ import annotations

from hostcfg import get_host
import os
import sys
import tarfile
import tempfile
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

ROOT = INFRA.parent
DENIZEN = ROOT / "denizen"
HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

SYNC_PATHS = [
    "server.js",
    "index.html",
    "src/player-chat.js",
    "src/chat-attachments.js",
    "tests/chat-attachments.test.js",
]


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 300) -> tuple[int, str]:
    print("$", cmd[:120], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip().encode("ascii", errors="replace").decode("ascii")[:1500])
    return code, out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required (infra/.env)", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "chat-attachments.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in SYNC_PATHS:
                local = DENIZEN / rel
                if not local.is_file():
                    print(f"ERROR: missing {local}", file=sys.stderr)
                    return 1
                tar.add(local, arcname=rel)
        print(f"==> Tarball: {tar_path.stat().st_size // 1024} KB ({len(SYNC_PATHS)} files)")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/chat-attachments.tar.gz"
        stdin, stdout, _ = client.exec_command(f"cat > '{remote_tar}'", timeout=600)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()

        extract_dir = f"{REMOTE_DIR}/chat-attachments-src"
        code, _ = run_ssh(
            client,
            f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' && tar -xzf '{remote_tar}' -C '{extract_dir}'",
        )
        if code != 0:
            client.close()
            return 1

        for rel in SYNC_PATHS:
            run_ssh(client, f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}")

        run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p /app/data/uploads/chat")
        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=180)
        run_ssh(client, f"sleep 10 && curl -fsS -m 15 http://127.0.0.1:{PORT}/api/health | head -c 200")
        run_ssh(
            client,
            f"{DOCKER} exec denizen-server node -e \"require('/app/src/chat-attachments.js'); console.log('chat-attachments loads OK')\"",
        )
        client.close()

    print("==> chat-attachments deployed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
