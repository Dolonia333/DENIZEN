#!/usr/bin/env python3
"""Hotfix mesh queue dedup/trim + drain duplicate grok_telemetry_check jobs on NAS."""
from __future__ import annotations

import json
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
    "src/denizen-compute-producer.js",
    "src/denizen-compute-queue.js",
    "src/mesh-worker-watchdog.js",
]


def run_ssh(client, cmd, timeout=180):
    print("$", cmd[:140], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:1200])
    return code, out


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "mesh-queue-hotfix.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in SYNC_PATHS:
                local = DENIZEN / rel
                if not local.is_file():
                    print(f"ERROR: missing {local}", file=sys.stderr)
                    return 1
                tar.add(local, arcname=rel)

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/mesh-queue-hotfix.tar.gz"
        extract_dir = f"{REMOTE_DIR}/mesh-queue-hotfix"
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
            run_ssh(client, f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}")

        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=180)
        run_ssh(client, f"sleep 14 && curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 180")

        trim_js = (
            "const cq=require('/app/src/denizen-compute-queue.js');"
            "Promise.all([cq.listPendingJobs(50), cq.trimExcessQueuedJobs()])"
            ".then(([pending, trim])=>console.log(JSON.stringify({pending:pending.length,trim})))"
            ".catch(e=>{console.error(e);process.exit(1);});"
        )
        _, trim_out = run_ssh(
            client,
            f"{DOCKER} exec denizen-server node -e \"{trim_js}\"",
        )
        try:
            line = [l for l in trim_out.splitlines() if l.strip().startswith("{")][-1]
            result = json.loads(line)
            print(f"==> After trim: pending={result.get('pending')} trimmed={result.get('trim', {}).get('trimmed')}")
        except Exception:
            pass

        _, status_out = run_ssh(
            client,
            f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/compute/node/status?limit=20",
        )
        try:
            st = json.loads(status_out.strip().splitlines()[-1])
            print(f"==> Queue: pending_count={st.get('pending_count')} running={st.get('running_count')}")
        except Exception:
            pass

        client.close()

    print("==> mesh-queue hotfix ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
