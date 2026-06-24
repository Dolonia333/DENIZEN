#!/usr/bin/env python3
"""Build denizen-agent tarball to stdout (gzip). Used by fleet agent-bundle API."""

from __future__ import annotations

import argparse
import io
import os
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT_FILES = [
    ("scripts/nas-compute-agent.js", "nas-compute-agent.js"),
    ("scripts/nas-metrics-agent.js", "nas-metrics-agent.js"),
    ("src/denizen-hardware-monitor.js", "src/denizen-hardware-monitor.js"),
    ("src/denizen-node-client.js", "src/denizen-node-client.js"),
    ("src/denizen-mesh-job-runner.js", "src/denizen-mesh-job-runner.js"),
    ("src/denizen-inference-runtime.js", "src/denizen-inference-runtime.js"),
    ("src/denizen-embedding-worker.js", "src/denizen-embedding-worker.js"),
    ("src/denizen-sim-tick.js", "src/denizen-sim-tick.js"),
    ("src/lm-studio-probe.js", "src/lm-studio-probe.js"),
    ("src/lm-studio-advertise.js", "src/lm-studio-advertise.js"),
]


def env_lines(opts: argparse.Namespace) -> str:
    machine_id = opts.machine_id or "hp81081d"
    label = opts.label or f"Kali · {machine_id}"
    agent_root = opts.agent_root or "~/denizen-agent"
    denizen_url = (opts.denizen_url or os.environ.get("DENIZEN_LAN_URL") or os.environ.get("DENIZEN_URL") or "http://127.0.0.1:8081").rstrip("/")
    public_url = (opts.public_url or os.environ.get("DENIZEN_PUBLIC_URL") or "https://denizen.dolonia.cloud").rstrip("/")
    return "\n".join(
        [
            f"DENIZEN_URL={denizen_url}",
            f"DENIZEN_PUBLIC_URL={public_url}",
            f"DENIZEN_LAN_URL={denizen_url}",
            f"DENIZEN_IDENTITY_ID={opts.identity_id or os.environ.get('DENIZEN_FLEET_IDENTITY_ID', '')}",
            f"DENIZEN_FLEET_SESSION_ID={opts.session_id or os.environ.get('DENIZEN_FLEET_SESSION_ID', '')}",
            f"DENIZEN_FLEET_SESSION_TOKEN={opts.session_token or os.environ.get('DENIZEN_FLEET_SESSION_TOKEN', '')}",
            f"DENIZEN_FLEET_AGENT_TOKEN={opts.fleet_token or os.environ.get('DENIZEN_FLEET_AGENT_TOKEN', '')}",
            f"DENIZEN_MACHINE_ID={machine_id}",
            f"DENIZEN_MACHINE_LABEL={label}",
            "DENIZEN_REPORT_INTERVAL_MS=30000",
            f"DENIZEN_AGENT_ROOT={agent_root}",
            "",
        ]
    )


def start_script() -> bytes:
    return (
        "#!/bin/sh\n"
        "cd \"$(dirname \"$0\")\" || exit 1\n"
        "export DENIZEN_AGENT_ROOT=\"$(pwd)\"\n"
        "export DENIZEN_HARDWARE_MONITOR_PATH=\"$DENIZEN_AGENT_ROOT/src/denizen-hardware-monitor.js\"\n"
        "NODE=\"\"\n"
        "for candidate in /usr/bin/node /usr/local/bin/node node; do\n"
        "  if command -v \"$candidate\" >/dev/null 2>&1; then NODE=\"$candidate\"; break; fi\n"
        "done\n"
        "if [ -z \"$NODE\" ]; then echo \"Node.js not found\"; exit 1; fi\n"
        "AGENT=\"$DENIZEN_AGENT_ROOT/nas-compute-agent.js\"\n"
        "if [ ! -f \"$AGENT\" ]; then AGENT=\"$DENIZEN_AGENT_ROOT/nas-metrics-agent.js\"; fi\n"
        "exec \"$NODE\" \"$AGENT\"\n"
    ).encode("utf-8")


def build_tarball(opts: argparse.Namespace) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for src_rel, arc_name in AGENT_FILES:
            src = ROOT / src_rel
            tar.add(src, arcname=f"denizen-agent/{arc_name}")
        env_data = env_lines(opts).encode("utf-8")
        info = tarfile.TarInfo(name="denizen-agent/.env")
        info.size = len(env_data)
        tar.addfile(info, io.BytesIO(env_data))
        start = start_script()
        sinfo = tarfile.TarInfo(name="denizen-agent/start.sh")
        sinfo.size = len(start)
        sinfo.mode = 0o755
        tar.addfile(sinfo, io.BytesIO(start))
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--machine-id", default="hp81081d")
    parser.add_argument("--label", default="")
    parser.add_argument("--agent-root", default="~/denizen-agent")
    parser.add_argument("--denizen-url", default="")
    parser.add_argument("--public-url", default="")
    parser.add_argument("--identity-id", default="")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--session-token", default="")
    parser.add_argument("--fleet-token", default="")
    opts = parser.parse_args()
    sys.stdout.buffer.write(build_tarball(opts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
