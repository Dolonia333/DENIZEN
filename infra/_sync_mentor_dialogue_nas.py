#!/usr/bin/env python3
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "denizen" / "data" / "mentor-dialogue.jsonl"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    if not LOCAL.is_file():
        print(f"Missing {LOCAL}", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
    remote = f"{REMOTE_DIR}/mentor-dialogue.jsonl"
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote}'", timeout=60)
    stdin.write(LOCAL.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    _, o, e = client.exec_command(
        f"{DOCKER} cp '{remote}' denizen-server:/app/data/mentor-dialogue.jsonl",
        timeout=60,
    )
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())
    print("synced mentor-dialogue.jsonl to NAS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
