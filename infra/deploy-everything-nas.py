#!/usr/bin/env python3
"""Deploy all pending Denizen hotfixes to NAS (LM, MCP bridge, Lucy fast-tier)."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

ROOT = Path(__file__).resolve().parent.parent / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

FILES = [
    "server.js",
    "src/openclaw-dispatch.js",
    "src/agent-office-manager.js",
    "src/browser-mirror-panel.js",
    "src/player-chat.js",
    "src/browser-mirror-panel.js",
    "src/player-chat-skill-bridge.js",
    "src/npc-peer-work-status.js",
    "src/format-provider-error.js",
    "src/llm-telemetry.js",
    "src/llm-telemetry-panel.js",
    "src/lm-studio-router.js",
    "src/cofounder-agent.js",
    "src/prompt-tuning.js",
    "src/demo-roster.js",
    "src/denizen-hardware-monitor.js",
    "src/denizen-prompt-budget.js",
    "src/npc-brains.js",
    "src/denizen-business-context.js",
    "src/generic-soul-pack.js",
    "src/agent-souls.js",
    "data/templates/generic-office/business-model.json",
    "data/templates/generic-office/company-brief.json",
    "src/denizen-db.js",
    "src/world-state.js",
    "src/visitor-office-registry.js",
    "scripts/seed-agent-souls.js",
    "supabase/migrations/20260624000001_agent_souls.sql",
    "supabase/migrations/20260624000002_add_grok_npc.sql",
    "supabase/migrations/20260624000003_org_business_models.sql",
    "scripts/seed-org-business-model.js",
    "scripts/smoke-org-soul-isolation.js",
    "scripts/clone-template-pack.js",
    "scripts/grok-mcp-ping.js",
    "src/denizen-mcp-actions.js",
    "src/coding-task-runner.js",
    "src/npc-capabilities.js",
    "src/denizen-mcp-mesh-tools.js",
    "src/denizen-mcp-cursor-tools.js",
    "src/denizen-mcp-scopes.js",
    "src/denizen-npc-mcp-gateway.js",
    "src/denizen-mcp-team-gateway.js",
    "src/denizen-compute-routes.js",
    "src/denizen-host-compute.js",
    "src/visitor-mcp-connect-ui.js",
    "src/denizen-lazy-scripts.js",
    "src/denizen-phone-ui.js",
    "index.html",
    "jelly/skills/cursor-bridge/index.js",
    "npcs/lucy/SOUL.md",
    "npcs/abby/SOUL.md",
    "npcs/abby/MEMORY.md",
    "npcs/conference_man/SOUL.md",
    "npcs/conference_woman/SOUL.md",
    "npcs/alex/SOUL.md",
    "npcs/bob/SOUL.md",
    "npcs/jenny/SOUL.md",
    "npcs/dan/SOUL.md",
    "npcs/edward/SOUL.md",
    "npcs/josh/SOUL.md",
    "npcs/molly/SOUL.md",
    "npcs/oscar/SOUL.md",
    "npcs/pier/SOUL.md",
    "npcs/rob/SOUL.md",
    "npcs/roki/SOUL.md",
    "npcs/bouncer/SOUL.md",
    "npcs/grok/SOUL.md",
    "assets/Grok.png",
    "src/npc-roster.js",
    "data/business-model.json",
    "data/company-brief.json",
    "jelly/lib/denizen-data-actions.js",
    "src/denizen-crm-npc-personas.js",
    "src/denizen-mcp-crm-tools.js",
    "src/denizen-mcp-scopes.js",
]


def stream_file(client: paramiko.SSHClient, local_path: Path, remote_path: str) -> None:
    parent = remote_path.rsplit("/", 1)[0]
    client.exec_command(f"mkdir -p '{parent}'")
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'")
    stdin.write(local_path.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()


def run(client: paramiko.SSHClient, cmd: str) -> str:
    print("$", cmd[:100])
    _, out, err = client.exec_command(cmd, timeout=120)
    text = (out.read() + err.read()).decode("utf-8", errors="replace")
    if text.strip():
        try:
            print(text.rstrip())
        except UnicodeEncodeError:
            print(text.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return text


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required (set in infra/.env)", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    remote_tmp = "/tmp/denizen-full-deploy"
    run(client, f"mkdir -p {remote_tmp}")

    for rel in FILES:
        local = ROOT / rel
        if not local.is_file():
            print(f"missing {local}", file=sys.stderr)
            return 1
        remote = f"{remote_tmp}/{rel.replace('/', '_')}"
        stream_file(client, local, remote)
        parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
        if parent:
            run(client, f"{DOCKER} exec denizen-server mkdir -p /app/{parent}")
        code_txt = run(client, f"{DOCKER} cp '{remote}' denizen-server:/app/{rel}")
        if "Error" in code_txt and "No such" in code_txt:
            print(f"FAILED copying {rel}", file=sys.stderr)
            return 1
        print(f"ok {rel}")

    run(client, f"{DOCKER} restart denizen-server")
    print("waiting for container…")
    time.sleep(12)

    for path in (
        "/api/health",
        "/api/compute/inference/nodes",
        "/mcp/team",
    ):
        run(client, f"curl -fsS -m 15 http://127.0.0.1:{PORT}{path} | head -c 1500")

    verify = run(
        client,
        f"{DOCKER} exec denizen-server grep -c _pinThinkToFastSlot /app/src/npc-brains.js",
    ).strip()
    if verify and verify != "0":
        print(f"ok think-routing patch present ({verify} refs)")
    else:
        print("FAILED: _pinThinkToFastSlot missing in container npc-brains.js", file=sys.stderr)
        client.close()
        return 1

    client.close()
    print("\n==> Full deploy complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
