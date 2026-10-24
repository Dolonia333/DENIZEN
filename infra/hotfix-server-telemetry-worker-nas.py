#!/usr/bin/env python3
"""Deploy server-side grok_telemetry_check worker + python3 in NAS container."""
from __future__ import annotations

from hostcfg import get_host
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
HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

SYNC_PATHS = [
    "server.js",
    "src/denizen-compute-producer.js",
    "src/denizen-compute-queue.js",
    "src/denizen-node-worker.js",
    "src/denizen-mesh-telemetry-worker.js",
    "src/mesh-worker-watchdog.js",
    "infra/grok-analyze-telemetry.py",
    "infra/grok-mesh-telemetry-job.py",
    "tests/denizen-mesh-telemetry-worker.test.js",
]


def run_ssh(client, cmd, timeout=300):
    print("$", cmd[:150], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:1500])
    return code, out


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "server-telemetry-worker.tar.gz"
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

        remote_tar = f"{REMOTE_DIR}/server-telemetry-worker.tar.gz"
        extract_dir = f"{REMOTE_DIR}/server-telemetry-worker"
        stdin, stdout, _ = client.exec_command(f"cat > '{remote_tar}'", timeout=600)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()

        run_ssh(client, f"rm -rf '{extract_dir}' && mkdir -p '{extract_dir}' && tar -xzf '{remote_tar}' -C '{extract_dir}'")
        for rel in SYNC_PATHS:
            parent = "/app/" + rel.rsplit("/", 1)[0]
            run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p {parent}")
            run_ssh(client, f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}")

        print("==> Ensure python3 in container (one-time apt if missing)")
        _, py_out = run_ssh(
            client,
            f"{DOCKER} exec denizen-server sh -c 'command -v python3 || echo MISSING'",
        )
        if "MISSING" in py_out or not py_out.strip().endswith("python3"):
            run_ssh(
                client,
                f"{DOCKER} exec -u 0 denizen-server sh -c "
                "'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*'",
                timeout=600,
            )

        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=180)
        run_ssh(client, f"sleep 18 && curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 200")

        # Force immediate drain via in-container worker tick
        tick_js = (
            "const w=require('/app/src/denizen-mesh-telemetry-worker.js');"
            "const cq=require('/app/src/denizen-compute-queue.js');"
            "w.drainTelemetryQueue(cq,{maxJobs:5}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exit(1);});"
        )
        _, tick_out = run_ssh(
            client,
            f"{DOCKER} exec denizen-server node -e \"{tick_js}\"",
            timeout=180,
        )

        _, status_out = run_ssh(
            client,
            f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/compute/node/status?limit=10",
        )
        try:
            st = json.loads(status_out.strip().splitlines()[-1])
            print(f"==> Queue: pending={st.get('pending_count')} running={st.get('running_count')}")
        except Exception:
            pass

        client.close()

    print("==> server telemetry worker hotfix ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
