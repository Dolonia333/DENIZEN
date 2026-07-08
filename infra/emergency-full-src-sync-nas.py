#!/usr/bin/env python3
"""Emergency: sync full denizen/src (+ npcs, server.js) into NAS container."""
from __future__ import annotations

import os
import sys
import tarfile
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parent.parent
DENIZEN = ROOT / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
CHUNK = 1024 * 512


def log(msg: str) -> None:
    print(msg, flush=True)


def run_ssh(client, cmd: str, timeout: int = 600) -> int:
    log(f"$ {cmd[:110]}")
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[-2000:])
    return o.channel.recv_exit_status()


def stream_to_remote(client, local_path: Path, remote_path: str) -> int:
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
    stderr.read()
    return stdout.channel.recv_exit_status()


def build_tar(tmp: Path) -> Path:
    tar_path = tmp / "denizen-full-src.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in ["src", "npcs", "scripts", "jelly", "desktop"]:
            base = DENIZEN / rel
            if not base.exists():
                continue
            for path in base.rglob("*"):
                if path.is_file() and "node_modules" not in path.parts:
                    tar.add(path, arcname=str(Path(rel) / path.relative_to(base)))
        for name in ("server.js", "package.json", "package-lock.json", "office-scene.js", "index.html"):
            p = DENIZEN / name
            if p.is_file():
                tar.add(p, arcname=name)
    return tar_path


def main() -> int:
    if not PASSWORD:
        log("SYNO_SSH_PASSWORD required")
        return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tar_path = build_tar(Path(tmp_name))
        log(f"==> Full src tarball: {tar_path.stat().st_size // 1024} KB")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

        run_ssh(client, f"{DOCKER} update --restart=no denizen-server")
        run_ssh(client, f"{DOCKER} stop denizen-server", timeout=90)

        remote_tar = f"{REMOTE_DIR}/denizen-full-src.tar.gz"
        if stream_to_remote(client, tar_path, remote_tar) != 0:
            return 1

        extract_dir = f"{REMOTE_DIR}/full-src-extract"
        code = run_ssh(
            client,
            f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' "
            f"&& tar -xzf '{remote_tar}' -C '{extract_dir}'",
        )
        if code != 0:
            return code

        for dest, src_rel in [
            ("/app/src", "src"),
            ("/app/npcs", "npcs"),
            ("/app/scripts", "scripts"),
            ("/app/jelly", "jelly"),
            ("/app/desktop", "desktop"),
        ]:
            run_ssh(
                client,
                f"test -d '{extract_dir}/{src_rel}' && "
                f"{DOCKER} cp '{extract_dir}/{src_rel}/.' denizen-server:{dest}/ || true",
            )

        for name in ("server.js", "package.json", "office-scene.js", "index.html"):
            run_ssh(
                client,
                f"test -f '{extract_dir}/{name}' && "
                f"{DOCKER} cp '{extract_dir}/{name}' denizen-server:/app/{name} || true",
            )

        run_ssh(client, f"{DOCKER} update --restart=unless-stopped denizen-server")
        run_ssh(client, f"{DOCKER} start denizen-server")
        run_ssh(client, f"sleep 14 && curl -fsS -m 25 http://127.0.0.1:8888/api/health | head -c 500")
        run_ssh(
            client,
            f"{DOCKER} exec denizen-server test -f /app/src/grok-cli-chat.js && "
            f"{DOCKER} exec denizen-server printenv GROK_CLI_BRIDGE_URL",
        )
        client.close()

    log("==> Full src sync complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
