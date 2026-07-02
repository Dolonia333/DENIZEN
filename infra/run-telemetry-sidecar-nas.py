#!/usr/bin/env python3
"""Build/run denizen-telemetry-sidecar on NAS (shares volumes with denizen-server)."""

from __future__ import annotations

import os
import sys
import tarfile
import tempfile
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parents[1]
DENIZEN = ROOT / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
IMAGE = "denizen-telemetry-sidecar:latest"

SIDEcar_FILES = [
    "infra/Dockerfile.telemetry-sidecar",
    "infra/grok-analyze-telemetry.py",
    "infra/grok-mesh-telemetry-job.py",
]


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 300) -> tuple[int, str]:
    print("$", cmd[:140])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:2000])
    return code, out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    build_only = "--build-only" in sys.argv

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "telemetry-sidecar.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in SIDEcar_FILES:
                local = DENIZEN / rel
                if local.is_file():
                    tar.add(local, arcname=rel)

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/telemetry-sidecar.tar.gz"
        build_dir = f"{REMOTE_DIR}/telemetry-sidecar-build"
        stdin, stdout, _ = client.exec_command(f"cat > '{remote_tar}'", timeout=120)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()

        run_ssh(client, f"rm -rf '{build_dir}' && mkdir -p '{build_dir}'")
        run_ssh(client, f"tar -xzf '{remote_tar}' -C '{build_dir}'")
        code, _ = run_ssh(
            client,
            f"cd '{build_dir}' && {DOCKER} build -f infra/Dockerfile.telemetry-sidecar -t {IMAGE} .",
            timeout=600,
        )
        if code != 0:
            client.close()
            return code

        if build_only:
            print("telemetry-sidecar: build ok")
            client.close()
            return 0

        # Ensure denizen-server is running (volumes_from target)
        run_ssh(client, f"{DOCKER} ps --filter name=denizen-server --format '{{{{.Names}}}}'")

        code, out = run_ssh(
            client,
            f"{DOCKER} run --rm --network host --volumes-from denizen-server "
            f"-e GROK_AGENT=1 {IMAGE} python3 infra/grok-mesh-telemetry-job.py",
            timeout=180,
        )

        code2, snap = run_ssh(
            client,
            f"{DOCKER} exec denizen-server head -c 500 /app/data/grok-telemetry-latest.json",
        )
        if "generatedAt" in snap:
            print("VERIFY: telemetry regenerated via sidecar")
        elif code != 0:
            print("WARN: sidecar job may have failed", file=sys.stderr)

        client.close()
        return 0 if code == 0 else code


if __name__ == "__main__":
    raise SystemExit(main())
