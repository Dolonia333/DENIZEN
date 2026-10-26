#!/usr/bin/env python3
"""Hotfix event-driven metrics consult + remediation tracking to NAS."""
from hostcfg import get_host
import os
import sys
import tarfile
import tempfile
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parent.parent
DENIZEN = ROOT / "denizen"
HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

SYNC_PATHS = [
    "src/npc-local-metrics.js",
    "src/npc-telemetry-rebalance.js",
    "src/npc-brains.js",
    "server.js",
    "jelly/skills/consult-grok/index.js",
    "infra/grok-analyze-telemetry.py",
    "infra/grok-mesh-telemetry-job.py",
    "infra/denizen-fleet-ops.py",
]


def run_ssh(client, cmd, timeout=120):
    print("$", cmd[:100])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:500])
    return o.channel.recv_exit_status()


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "metrics-consult-hotfix.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in SYNC_PATHS:
                local = DENIZEN / rel
                if local.is_file():
                    tar.add(local, arcname=rel)

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/metrics-consult-hotfix.tar.gz"
        extract_dir = f"{REMOTE_DIR}/metrics-consult-hotfix"
        stdin, stdout, _ = client.exec_command(f"cat > '{remote_tar}'", timeout=120)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()

        run_ssh(client, f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' && tar -xzf '{remote_tar}' -C '{extract_dir}'")
        for rel in SYNC_PATHS:
            parent = "/app/" + rel.rsplit("/", 1)[0]
            run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p {parent}")
            run_ssh(client, f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}")

        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=120)
        run_ssh(client, f"sleep 12 && curl -fsS -m 15 http://127.0.0.1:{PORT}/api/health | head -c 180")
        client.close()

    print("metrics-consult hotfix ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
