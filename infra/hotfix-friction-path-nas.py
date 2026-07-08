#!/usr/bin/env python3
"""Deploy friction domain hooks (path_stuck client bridge + backlog thresholds) to NAS."""
from __future__ import annotations

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
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

SYNC_PATHS = [
    "src/npc-local-metrics.js",
    "src/npc-brains.js",
    "src/pathfinding.js",
    "src/agent-office-manager.js",
    "office-scene.js",
    "server.js",
    "infra/grok-analyze-telemetry.py",
    "infra/grok-mesh-telemetry-job.py",
    "tests/npc-local-metrics.test.js",
]


def run_ssh(client, cmd, timeout=180):
    print("$", cmd[:120], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:800])
    return code, out


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required (infra/.env)", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "friction-path-hotfix.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in SYNC_PATHS:
                local = DENIZEN / rel
                if not local.is_file():
                    print(f"ERROR: missing {local}", file=sys.stderr)
                    return 1
                tar.add(local, arcname=rel)
        print(f"==> Tarball {tar_path.stat().st_size // 1024} KB ({len(SYNC_PATHS)} files)")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/friction-path-hotfix.tar.gz"
        extract_dir = f"{REMOTE_DIR}/friction-path-hotfix"
        stdin, stdout, _ = client.exec_command(f"cat > '{remote_tar}'", timeout=300)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()

        code, _ = run_ssh(
            client,
            f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' && tar -xzf '{remote_tar}' -C '{extract_dir}'",
        )
        if code != 0:
            client.close()
            return 1

        for rel in SYNC_PATHS:
            parent = "/app/" + rel.rsplit("/", 1)[0]
            run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p {parent}")
            run_ssh(client, f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}")

        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=180)
        run_ssh(client, f"sleep 12 && curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 220")
        run_ssh(
            client,
            f"{DOCKER} exec denizen-server node -e \""
            "const lm=require('/app/src/npc-local-metrics.js');"
            "const r=lm.captureSystemError('bob','pathfinding',{code:'STUCK',message:'probe'});"
            "console.log('path_stuck domain:', r.domain);"
            "console.log('BACKLOG_THRESHOLD:', lm.BACKLOG_FRICTION_THRESHOLD);"
            "\"",
        )
        client.close()

    print("==> friction-path hotfix ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
