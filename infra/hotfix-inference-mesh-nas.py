#!/usr/bin/env python3
"""Sync inference mesh + gap-closure files to NAS denizen-server container."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import subprocess
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

SYNC_PATHS = [
    "server.js",
    "package.json",
    "data/brain-catalog.json",
    "src/competency-map.js",
    "src/outcome-scorer.js",
    "src/platform-bridge.js",
    "src/denizen-npc-mcp-gateway.js",
    "src/denizen-mcp-actions.js",
    "src/denizen-federation.js",
    "src/denizen-world-pubsub.js",
    "src/denizen-agent-ws-relay.js",
    "src/spectate-routing.js",
    "src/denizen-inference-runtime.js",
    "src/denizen-inference-rpc.js",
    "src/denizen-inference-metrics.js",
    "src/denizen-inference-progress.js",
    "src/denizen-embedding-worker.js",
    "src/denizen-sim-tick.js",
    "src/denizen-mesh-job-runner.js",
    "src/denizen-compute-queue.js",
    "src/denizen-compute-routes.js",
    "src/denizen-node-client.js",
    "src/denizen-hardware-monitor.js",
    "src/denizen-host-compute.js",
    "src/lm-studio-router.js",
    "src/lm-studio-advertise.js",
    "src/lm-studio-probe.js",
    "src/npc-brains.js",
    "src/visitor-node-ui.js",
    "tests/denizen-inference-runtime.test.js",
    "tests/denizen-inference-rpc.test.js",
    "tests/denizen-federation.test.js",
    "tests/denizen-world-pubsub.test.js",
    "tests/denizen-agent-ws-relay.test.js",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    log(f"$ {cmd[:120]}")
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        try:
            print(out.rstrip())
        except UnicodeEncodeError:
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


def build_tar(tmp: Path) -> Path:
    tar_path = tmp / "denizen-inference-hotfix.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in SYNC_PATHS:
            local = DENIZEN / rel
            if local.is_file():
                tar.add(local, arcname=rel)
            else:
                log(f"WARN: skip missing {rel}")
    return tar_path


def main() -> int:
    if not PASSWORD:
        log("ERROR: SYNO_SSH_PASSWORD required in infra/.env")
        return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = build_tar(tmp)
        log(f"==> Inference hotfix tarball: {tar_path.stat().st_size // 1024} KB")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/denizen-inference-hotfix.tar.gz"
        if stream_to_remote(client, tar_path, remote_tar) != 0:
            return 1

        extract_dir = f"{REMOTE_DIR}/inference-hotfix-src"
        code, _ = run_ssh(
            client,
            f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' "
            f"&& tar -xzf '{remote_tar}' -C '{extract_dir}'",
        )
        if code != 0:
            return code

        for rel in SYNC_PATHS:
            local = DENIZEN / rel
            if not local.is_file():
                continue
            if rel.startswith("tests/"):
                run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p /app/tests")
            if rel.startswith("data/"):
                run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p /app/data")
            run_ssh(
                client,
                f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}",
            )

        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=120)
        run_ssh(client, f"sleep 10 && curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 800")
        run_ssh(
            client,
            f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/compute/inference/nodes | head -c 600",
        )
        run_ssh(
            client,
            f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/compute/inference/catalog | head -c 400",
        )
        run_ssh(
            client,
            f"{DOCKER} exec denizen-server test -f /app/src/denizen-inference-rpc.js && echo INFERENCE_SYNC_OK",
        )
        client.close()

    log("==> Inference mesh hotfix complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
