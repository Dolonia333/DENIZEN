#!/usr/bin/env python3
"""Emergency: sync server.js + full src/ to NAS primary + followers (crash-loop recovery)."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import tarfile
import tempfile
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
DENIZEN = ROOT / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
CHUNK = 1024 * 512

CONTAINERS = ["denizen-server", "denizen-follower", "denizen-follower-b"]


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print("$", cmd[:120], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        try:
            print(out.rstrip())
        except UnicodeEncodeError:
            print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def stream_to_remote(client: paramiko.SSHClient, local_path: Path, remote_path: str) -> int:
    parent = remote_path.rsplit("/", 1)[0]
    run(client, f"mkdir -p '{parent}'")
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
        print(err.rstrip())
    return code


def build_tar(tmp: Path) -> Path:
    tar_path = tmp / "denizen-src-recovery.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(DENIZEN / "server.js", arcname="server.js")
        tar.add(DENIZEN / "security-monitor-server.js", arcname="security-monitor-server.js")
        tar.add(DENIZEN / "index.html", arcname="index.html")
        tar.add(DENIZEN / "office-scene.js", arcname="office-scene.js")
        tar.add(DENIZEN / "src", arcname="src")
    return tar_path


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tar_path = build_tar(Path(tmp_name))
        print(f"==> Recovery tarball: {tar_path.stat().st_size // 1024} KB")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/recovery-src.tar.gz"
        if stream_to_remote(client, tar_path, remote_tar) != 0:
            client.close()
            return 1

        extract = (
            f"rm -rf '{REMOTE_DIR}/recovery-src' && mkdir -p '{REMOTE_DIR}/recovery-src' "
            f"&& tar -xzf '{remote_tar}' -C '{REMOTE_DIR}/recovery-src'"
        )
        if run(client, extract)[0] != 0:
            client.close()
            return 1

        for name in CONTAINERS:
            code, out = run(client, f"{DOCKER} ps -a --filter name=^{name}$ --format '{{{{.Names}}}}'")
            if name not in out:
                print(f"skip {name} (not present)")
                continue
            run(
                client,
                f"{DOCKER} cp '{REMOTE_DIR}/recovery-src/.' {name}:/app/ && {DOCKER} restart {name}",
                timeout=180,
            )

        run(client, "sleep 12 && curl -fsS -m 15 http://127.0.0.1:8888/api/health | head -c 500")
        run(client, "curl -fsS -m 15 http://127.0.0.1:8889/api/health | head -c 300")
        client.close()
    print("==> Recovery sync complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
