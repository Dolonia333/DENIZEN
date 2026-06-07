#!/usr/bin/env python3
"""Deploy infra/supabase-project to Synology NAS over SSH/SFTP."""

from __future__ import annotations

import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
REMOTE_DIR = os.environ.get("SYNO_REMOTE_DIR", "/volume1/docker/supabase-project")
LOCAL_DIR = Path(__file__).resolve().parent / "supabase-project"
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

SKIP_DIRS = {
    "volumes/db/data",
    "volumes/storage",
    ".git",
}
SKIP_FILES = {"DOLONIA_CREDENTIALS.txt"}


def log(msg: str) -> None:
    print(msg, flush=True)


def should_skip(rel: str) -> bool:
    rel_norm = rel.replace("\\", "/")
    for part in SKIP_DIRS:
        if rel_norm == part or rel_norm.startswith(part + "/"):
            return True
    name = Path(rel_norm).name
    return name in SKIP_FILES


def sftp_mkdirs(sftp: paramiko.SFTPClient, remote_path: str) -> None:
    parts = remote_path.strip("/").split("/")
    cur = ""
    for part in parts:
        cur += "/" + part
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def build_tarball(local_root: Path) -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    count = 0
    with tarfile.open(tmp_path, "w:gz") as tar:
        for path in local_root.rglob("*"):
            rel = path.relative_to(local_root).as_posix()
            if should_skip(rel):
                continue
            tar.add(path, arcname=f"supabase-project/{rel}")
            if path.is_file():
                count += 1
    log(f"  packed {count} files into {tmp_path.name}")
    return tmp_path


def stream_tarball(client: paramiko.SSHClient, tar_path: Path, parent: str) -> int:
    """Pipe tarball over SSH stdin — works when SFTP upload is restricted."""
    cmd = (
        f"mkdir -p '{parent}' && cd '{parent}' && "
        "rm -rf supabase-project && tar xzf -"
    )
    log(f"$ {cmd}  < local.tar.gz")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=600)
    with open(tar_path, "rb") as fh:
        while True:
            chunk = fh.read(1024 * 512)
            if not chunk:
                break
            stdin.write(chunk)
    stdin.flush()
    stdin.channel.shutdown_write()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    log(f"$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code, out, err


def main() -> int:
    if not PASSWORD:
        log("ERROR: set SYNO_SSH_PASSWORD environment variable")
        return 1
    if not LOCAL_DIR.is_dir():
        log(f"ERROR: missing {LOCAL_DIR}")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"==> Connecting to {USER}@{HOST}")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, look_for_keys=False, allow_agent=False)

    code, out, _ = run_ssh(client, f"whoami && hostname && {DOCKER} --version")
    if code != 0:
        log("ERROR: docker not available on NAS")
        return code

    parent = os.path.dirname(REMOTE_DIR.rstrip("/"))
    run_ssh(client, f"mkdir -p '{parent}'")

    log(f"==> Packaging {LOCAL_DIR}")
    tar_path = build_tarball(LOCAL_DIR)
    try:
        log(f"==> Streaming tarball -> {HOST}:{parent}/supabase-project")
        code = stream_tarball(client, tar_path, parent)
        if code != 0:
            log("ERROR: failed to stream/extract tarball on NAS")
            return code
    finally:
        tar_path.unlink(missing_ok=True)

    log("==> Pulling images (may take several minutes)...")
    code, _, _ = run_ssh(
        client,
        f"cd '{REMOTE_DIR}' && sudo docker compose pull",
        timeout=1800,
    )
    if code != 0:
        log("WARN: docker compose pull returned non-zero; continuing")

    log("==> Starting Supabase stack...")
    code, _, _ = run_ssh(
        client,
        f"cd '{REMOTE_DIR}' && {DOCKER} compose up -d --wait",
        timeout=1800,
    )
    if code != 0:
        log("ERROR: docker compose up failed")
        run_ssh(client, f"cd '{REMOTE_DIR}' && {DOCKER} compose ps")
        return code

    time.sleep(5)
    run_ssh(client, f"cd '{REMOTE_DIR}' && {DOCKER} compose ps")

    log("==> Health check on port 8000")
    run_ssh(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/ || true")

    client.close()
    log("==> Done. Open http://192.168.1.237:8000 (or https://supabase.dolonia.cloud)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
