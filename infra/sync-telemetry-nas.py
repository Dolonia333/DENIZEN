#!/usr/bin/env python3
"""Push grok-telemetry-latest.json to NAS container and/or run analyzer in-container."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

ROOT = Path(__file__).resolve().parents[1]
LOCAL_TELEMETRY = ROOT / "denizen" / "data" / "grok-telemetry-latest.json"
LOCAL_TELEMETRY_JSONL = ROOT / "denizen" / "data" / "llm-telemetry.jsonl"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str]:
    print("$", cmd[:120])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:1200])
    return code, out


def stream_file(client: paramiko.SSHClient, local: Path, remote: str) -> None:
    data = local.read_bytes()
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote}'", timeout=60)
    stdin.write(data)
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    run_job = "--run-job" in sys.argv or os.environ.get("RUN_TELEMETRY_JOB", "").strip() == "1"
    skip_push = "--run-job-only" in sys.argv

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    remote_telemetry = f"{REMOTE_DIR}/grok-telemetry-latest.json"
    container_path = "/app/data/grok-telemetry-latest.json"

    if not skip_push:
        if not LOCAL_TELEMETRY.is_file():
            print(f"WARN: missing {LOCAL_TELEMETRY} — push skipped")
        else:
            print(f"==> Push local telemetry ({LOCAL_TELEMETRY.stat().st_size} bytes)")
            stream_file(client, LOCAL_TELEMETRY, remote_telemetry)
            run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p /app/data")
            run_ssh(client, f"{DOCKER} cp '{remote_telemetry}' denizen-server:{container_path}")

    if LOCAL_TELEMETRY_JSONL.is_file() and LOCAL_TELEMETRY_JSONL.stat().st_size > 0:
        print("==> Sync llm-telemetry.jsonl (source for in-container analyzer)")
        remote_jsonl = f"{REMOTE_DIR}/llm-telemetry.jsonl"
        stream_file(client, LOCAL_TELEMETRY_JSONL, remote_jsonl)
        run_ssh(client, f"{DOCKER} cp '{remote_jsonl}' denizen-server:/app/data/llm-telemetry.jsonl")

    if run_job or skip_push:
        # NOTE: denizen-server has NO volumes (Mounts: []), so --volumes-from shares
        # nothing — the old approach silently wrote to the sidecar's ephemeral layer.
        # Instead: stage the server's data on the host, bind-mount it into the sidecar,
        # run the job, then copy results back into the server container.
        staging = f"{REMOTE_DIR}/telemetry-staging"
        print("==> Stage server data on host, run job in sidecar via bind mount, copy back")
        run_ssh(client, f"mkdir -p '{staging}'")
        for fname in ("llm-telemetry.jsonl", "grok-consult-queue.jsonl",
                      ".grok-telemetry-cooldown", ".grok-telemetry-facts-hash"):
            run_ssh(client, f"{DOCKER} cp denizen-server:/app/data/{fname} '{staging}/{fname}' 2>/dev/null || true")
        code, out = run_ssh(
            client,
            f"{DOCKER} run --rm --network host -v '{staging}:/app/data' "
            f"-e GROK_AGENT=1 denizen-telemetry-sidecar:latest "
            f"python3 infra/grok-mesh-telemetry-job.py",
            timeout=180,
        )
        if code == 0:
            for fname in ("grok-telemetry-latest.json", "grok-consult-queue.jsonl"):
                run_ssh(client, f"{DOCKER} cp '{staging}/{fname}' denizen-server:/app/data/{fname} 2>/dev/null || true")
        if code != 0 or "executable file not found" in out or "Unable to find image" in out:
            print("==> Sidecar missing or failed — build via run-telemetry-sidecar-nas.py")
            sidecar_script = ROOT / "infra" / "run-telemetry-sidecar-nas.py"
            if sidecar_script.is_file():
                import subprocess
                sub = subprocess.run([sys.executable, str(sidecar_script)], cwd=str(ROOT))
                if sub.returncode != 0:
                    print("WARN: sidecar build/run failed", file=sys.stderr)
            else:
                print("WARN: run-telemetry-sidecar-nas.py not found", file=sys.stderr)

    # Verify via in-container read
    code, out = run_ssh(
        client,
        f"{DOCKER} exec denizen-server head -c 400 {container_path}",
    )
    if "generatedAt" in out and "null" not in out.split("generatedAt")[-1][:20]:
        print("VERIFY: telemetry populated on NAS")
    elif "Bouncer" in out or "facts" in out:
        print("VERIFY: telemetry file present on NAS")
    else:
        print("WARN: telemetry may still be empty — check llm-telemetry.jsonl on NAS")

    run_ssh(client, f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/health | head -c 120")
    client.close()
    print("sync-telemetry-nas: done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
