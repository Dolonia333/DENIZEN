#!/usr/bin/env python3
"""Deploy the ?world=full LimeZu city world to the NAS container.

Ships the full-world module, the office-scene hook, the blueprint/tile JSONs,
and the whole assets/limezu tree (~15 MB — the NAS never had it; the office
container serves it statically). Static files only — no restart needed — but
server.js is untouched so a restart is skipped entirely.
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
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
CHUNK = 1024 * 512

FILES = [
    "office-scene.js",
    "index.html",
    "src/full-world.js",
    "src/room-tile-renderer.js",
    "data/full-world-blueprint.json",
    "data/room-builder-tiles.json",
    # the merged city itself — full-world.js fetches this at runtime
    "data/city-plan.json",
]
DIRS = [
    "assets/limezu",
    # district fragments + previews so the NAS copy can re-merge/QA
    "data/city-specs",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 900) -> tuple[int, str]:
    log(f"$ {cmd[:160]}")
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
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

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "full-world.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in FILES:
                local = DENIZEN / rel
                if local.is_file():
                    tar.add(local, arcname=rel)
                else:
                    log(f"WARN: skip missing {rel}")
            for rel in DIRS:
                local = DENIZEN / rel
                if local.is_dir():
                    tar.add(local, arcname=rel)
                else:
                    log(f"WARN: skip missing dir {rel}")
        log(f"==> Tarball: {tar_path.stat().st_size // (1024*1024)} MB")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/full-world.tar.gz"
        if stream_to_remote(client, tar_path, remote_tar) != 0:
            return 1

        extract_dir = f"{REMOTE_DIR}/full-world-src"
        code, _ = run_ssh(
            client,
            f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' "
            f"&& tar -xzf '{remote_tar}' -C '{extract_dir}'",
        )
        if code != 0:
            return code

        for rel in FILES:
            remote_parent = "/app/" + rel.rsplit("/", 1)[0] if "/" in rel else "/app"
            run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p '{remote_parent}'")
            run_ssh(client, f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}")
        for rel in DIRS:
            parent = "/app/" + rel.rsplit("/", 1)[0]
            run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p '{parent}'")
            run_ssh(client, f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:{parent}/", timeout=1200)

        run_ssh(client, f"{DOCKER} exec denizen-server node --check /app/office-scene.js && echo SYNTAX_OK")
        code, out = run_ssh(
            client,
            f"curl -fsS -m 10 'http://127.0.0.1:{PORT}/assets/limezu/index.json' | head -c 120 "
            f"&& echo && curl -fsS -m 10 'http://127.0.0.1:{PORT}/src/full-world.js' | head -c 80",
        )
        client.close()
        if code != 0:
            log("==> WARN: post-deploy probe failed")
            return 1

    log("==> Full world deployed (static files, no restart needed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
