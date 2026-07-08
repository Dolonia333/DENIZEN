#!/usr/bin/env python3
"""Sync changed Denizen source files to running NAS container (no local Docker build)."""

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

# Hotfix paths — add workflow / office-build tooling when deploying UI changes
SYNC_PATHS = [
    "index.html",
    "office-scene.js",
    "workflow-dashboard.html",
    "singles-viewer.html",
    "sprite-labeler.html",
    "tools/room-preview.html",
    "src/denizen-phone-ui.js",
    "data/furniture_catalog_openplan.json",
    "data/openplan_walls.json",
    "src/openplan-walls.js",
    "src/pathfinding.js",
    # Office HQ (quests, achievements, progress UI)
    "src/bottom-dock.js",
    "src/office-progress-routes.js",
    "src/tabler-icons.js",
    "src/office-hq/denizen-achievements.js",
    "src/office-hq/denizen-npc-stats.js",
    "src/office-hq/denizen-office-progress.js",
    "src/office-hq/denizen-quests.js",
    "src/office-hq/npc-leaderboard-panel.js",
    "src/office-hq/office-hq-panel.js",
    "src/office-hq/office-level-chip.js",
    "src/office-hq/office-quests-panel.js",
    "data/quests.json",
    "data/achievements.json",
    "data/office-level-thresholds.json",
    "data/sheet_extract/modern_office_black_shadow_32.objects.json",
    "data/singles/modern_office_singles_16.manifest.json",
    "server.js",
    "package.json",
    "src/denizen-approvals-scope.js",
    "src/denizen-station-tokens.js",
    "src/n8n-routes.js",
    "src/n8n-client.js",
    "src/npc-brains.js",
    "src/npc-think-runner.js",
    "src/openclaw-dispatch.js",
    "src/office-status-brief.js",
    "src/agent-office-manager.js",
    "src/movement-guard.js",
    "src/freeze-watchdog.js",
    "src/visitor-session.js",
    "src/visitor-onboarding.js",
    "src/visitor-superuser-onboarding.js",
    "src/outcome-scorer.js",
    "src/competency-map.js",
    "src/lm-studio-advertise.js",
    "src/lm-studio-router.js",
    "src/denizen-hardware-monitor.js",
    "src/visitor-node-ui.js",
    "src/prompt-tuning.js",
    "src/player-chat.js",
    "src/denizen-phone-chat-ui.js",
    "src/proposals-panel.js",
    "src/diag.js",
    "src/security-feed.js",
    "src/mesh-jobs-panel.js",
    "src/llm-telemetry-panel.js",
    "src/browser-mirror-panel.js",
    "src/content-pipeline-panel.js",
    "src/voice-input.js",
    "src/proximity-audio.js",
    "src/chat-bootstrap.js",
    "src/visitor-capabilities-guide.js",
    "src/denizen-lazy-scripts.js",
    "src/denizen-security-relay.js",
    "src/bouncer-investigation.js",
    "src/linux-agent.js",
    "src/security-ip.js",
    "src/denizen-world-pubsub.js",
    "src/denizen-agent-ws-relay.js",
    "src/world-state.js",
    "security-monitor-server.js",
    "src/bouncer-client-init.js",
    "src/denizen-bouncer-mesh-patrol.js",
    "src/denizen-bouncer-patrol-aggregate.js",
    "src/denizen-compute-producer.js",
    "src/denizen-compute-routes.js",
    "src/denizen-mesh-job-runner.js",
    "src/denizen-compute-queue.js",
    "src/grok-cli-chat.js",
    "src/agent-souls.js",
    "src/denizen-inference-runtime.js",
    "src/denizen-inference-rpc.js",
    "src/inference-sampling.js",
    "src/grok-mentor-drainer.js",
    "src/office-awareness.js",
    "scripts/run-grok-mentor-drainer.cjs",
    "src/denizen-mcp-mesh-tools.js",
    "src/denizen-db.js",
    "src/content-pipeline.js",
    "src/content-pipeline-scheduler.js",
    "src/visitor-access.js",
    "src/visitor-capabilities.js",
    "scripts/smoke-bouncer-e2e.js",
    "scripts/bouncer-investigation-agent.js",
    "src/touch-bind.js",
    "src/route-registry.js",
    "src/demo-roster.js",
    "src/public-demo-mode.js",
    "tests/outcome-scorer.test.js",
    ".env.production.template",
    # Team MCP consult-resource routing fix + soul contract updates (2026-07-02)
    "src/denizen-mcp-team-gateway.js",
    "src/denizen-mcp-resources.js",
    "src/denizen-mcp-mentor-tools.js",
    "src/denizen-mentor-dialogue.js",
    "src/npc-roster.js",
    "npcs/claude/SOUL.md",
    "npcs/grok/SOUL.md",
    "npcs/abby/SOUL.md",
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
    tar_path = tmp / "denizen-hotfix.tar.gz"
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
        log(f"==> Hotfix tarball: {tar_path.stat().st_size // 1024} KB ({len(SYNC_PATHS)} paths)")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

        remote_tar = f"{REMOTE_DIR}/denizen-hotfix.tar.gz"
        if stream_to_remote(client, tar_path, remote_tar) != 0:
            return 1

        extract_dir = f"{REMOTE_DIR}/hotfix-src"
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
            remote_parent = "/app/" + rel.replace("\\", "/").rsplit("/", 1)[0]
            if "/" in rel.replace("\\", "/"):
                run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p '{remote_parent}'")
            if rel.startswith("tests/"):
                run_ssh(client, f"{DOCKER} exec denizen-server mkdir -p /app/tests")
            run_ssh(
                client,
                f"{DOCKER} cp '{extract_dir}/{rel}' denizen-server:/app/{rel}",
            )

        run_ssh(client, f"{DOCKER} restart denizen-server", timeout=120)
        run_ssh(
            client,
            f"sleep 8 && curl -fsS -m 15 http://127.0.0.1:{PORT}/api/health | head -c 600",
        )
        run_ssh(
            client,
            f"{DOCKER} exec denizen-server test -f /app/src/outcome-scorer.js && echo SYNC_OK",
        )
        run_ssh(
            client,
            f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/platform-bridge/status",
        )
        client.close()

    log("==> Hotfix sync complete (env: run py infra/patch-denizen-nas-env.py)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
