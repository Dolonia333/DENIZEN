#!/usr/bin/env python3
"""Deploy Denizen NAS metrics agent to Synology over SSH."""

from __future__ import annotations

import load_infra_env  # noqa: F401 — loads infra/.env

import io
import os
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
REMOTE_DIR = os.environ.get("SYNO_AGENT_DIR", "/volume1/docker/denizen-agent").replace("\\", "/")
ROOT = Path(__file__).resolve().parent.parent
DENIZEN_DIR = ROOT / "denizen"
BUNDLE_ENV = ROOT / "infra" / "nas-agent-bundle" / ".env"
NODE_CANDIDATES = [
    "/usr/local/bin/node",
    "/var/packages/Node.js_v20/target/usr/local/bin/node",
    "/var/packages/Node.js_v18/target/usr/local/bin/node",
    "node",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str, str]:
    log(f"$ {cmd}")
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code, out, err


def build_tarball() -> Path:
    files = [
        (DENIZEN_DIR / "scripts" / "nas-compute-agent.js", "nas-compute-agent.js"),
        (DENIZEN_DIR / "scripts" / "nas-metrics-agent.js", "nas-metrics-agent.js"),
        (DENIZEN_DIR / "src" / "denizen-hardware-monitor.js", "src/denizen-hardware-monitor.js"),
        (DENIZEN_DIR / "src" / "denizen-node-client.js", "src/denizen-node-client.js"),
        (DENIZEN_DIR / "src" / "denizen-mesh-job-runner.js", "src/denizen-mesh-job-runner.js"),
        (DENIZEN_DIR / "src" / "lm-studio-probe.js", "src/lm-studio-probe.js"),
    ]
    if BUNDLE_ENV.is_file():
        files.append((BUNDLE_ENV, ".env"))

    tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    with tarfile.open(tmp_path, "w:gz") as tar:
        for src, arc in files:
            if not src.is_file():
                raise FileNotFoundError(src)
            tar.add(src, arcname=f"denizen-agent/{arc}")
        start_sh = (
            "#!/bin/sh\n"
            "cd \"$(dirname \"$0\")\" || exit 1\n"
            "export DENIZEN_AGENT_ROOT=\"$(pwd)\"\n"
            "export DENIZEN_HARDWARE_MONITOR_PATH=\"$DENIZEN_AGENT_ROOT/src/denizen-hardware-monitor.js\"\n"
            "NODE=\"\"\n"
            "for candidate in /usr/local/bin/node "
            "/var/packages/Node.js_v20/target/usr/local/bin/node "
            "/var/packages/Node.js_v18/target/usr/local/bin/node node; do\n"
            "  if command -v \"$candidate\" >/dev/null 2>&1; then NODE=\"$candidate\"; break; fi\n"
            "done\n"
            "if [ -z \"$NODE\" ]; then echo 'Node.js not found on NAS'; exit 1; fi\n"
            "AGENT=\"$DENIZEN_AGENT_ROOT/nas-compute-agent.js\"\n"
            "if [ ! -f \"$AGENT\" ]; then AGENT=\"$DENIZEN_AGENT_ROOT/nas-metrics-agent.js\"; fi\n"
            "exec \"$NODE\" \"$AGENT\"\n"
        )
        info = tarfile.TarInfo(name="denizen-agent/start.sh")
        encoded = start_sh.encode("utf-8")
        info.size = len(encoded)
        info.mode = 0o755
        tar.addfile(info, fileobj=io.BytesIO(encoded))
    return tmp_path


def stream_tarball(client: paramiko.SSHClient, tar_path: Path, parent: str) -> int:
    cmd = (
        f"mkdir -p '{parent}' && cd '{parent}' && "
        "rm -rf denizen-agent && tar xzf -"
    )
    log(f"$ {cmd}  < local.tar.gz")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=300)
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


def main() -> int:
    if not PASSWORD:
        log("ERROR: set SYNO_SSH_PASSWORD environment variable")
        return 1
    if not BUNDLE_ENV.is_file():
        log("ERROR: run infra/provision-nas-agent.py first")
        return 1

    tar_path = build_tarball()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"==> Connecting to {USER}@{HOST}")
    client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

    parent = REMOTE_DIR.rsplit("/", 1)[0] if "/" in REMOTE_DIR else "/volume1/docker"
    code = stream_tarball(client, tar_path, parent)
    tar_path.unlink(missing_ok=True)
    if code != 0:
        log(f"ERROR: upload failed (exit {code})")
        return code

    node_probe = " || ".join(f"test -x {p} && echo {p}" for p in NODE_CANDIDATES[:-1])
    run_ssh(client, f"{node_probe} || which node || echo NO_NODE")

    run_ssh(client, f"chmod +x '{REMOTE_DIR}/start.sh'")
    run_ssh(client, f"pkill -f '{REMOTE_DIR}/nas-compute-agent.js' || true")
    run_ssh(client, f"pkill -f '{REMOTE_DIR}/nas-metrics-agent.js' || true")
    run_ssh(client, "pkill -f nas-compute-agent.js || true")
    run_ssh(client, "pkill -f nas-metrics-agent.js || true")
    run_ssh(
        client,
        (
            f"cd '{REMOTE_DIR}' && "
            f"export DENIZEN_AGENT_ROOT='{REMOTE_DIR}' && "
            f"export DENIZEN_HARDWARE_MONITOR_PATH='{REMOTE_DIR}/src/denizen-hardware-monitor.js' && "
            f"AGENT=nas-compute-agent.js; "
            f"[ -f nas-compute-agent.js ] || AGENT=nas-metrics-agent.js; "
            f"nohup /usr/local/bin/node \"$AGENT\" >> agent.log 2>&1 </dev/null & "
            f"sleep 3 && tail -n 8 agent.log"
        ),
        timeout=45,
    )
    run_ssh(
        client,
        f"ps aux | grep -E '[n]as-(compute|metrics)-agent.js' || echo 'agent not running'",
    )

    client.close()
    log("==> NAS agent deploy complete")
    log(f"    Remote: {REMOTE_DIR}")
    log("    Verify: python infra/probe-nas-agent.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
