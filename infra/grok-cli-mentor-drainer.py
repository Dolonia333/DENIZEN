#!/usr/bin/env python3
"""
Grok CLI mentor drainer — closes the "locals talk to Grok, Grok teaches locals" loop
WITHOUT loading a heavy local model.

Flow:
  1. Read pending consults from the NAS container queue (grok-consult-queue.jsonl).
     These are questions local NPCs self-triggered when they got stuck.
  2. For each, ask the local Grok CLI (`grok -p`, cloud, zero local VRAM) to answer.
  3. Inject the answer into that NPC's memory via the team MCP (run_as_npc →
     update_memory) so the local references it next think cycle.
  4. Mark the consult answered and push the queue back into the container.
  5. Log each mentoring event to consult-improvement-log.jsonl (P4: so we can
     later check whether the NPC's metrics actually improved).

Usage:
  py infra/grok-cli-mentor-drainer.py            # DRY RUN: show what it would do
  py infra/grok-cli-mentor-drainer.py --run      # actually answer + inject + mark
  py infra/grok-cli-mentor-drainer.py --run --limit 3

Safe by default (dry run). Protected NPCs (bouncer/abby/lucy) can't take
run_as_npc; those are reported and skipped — use the mentor panel for them.

Requires: Grok CLI wired (see docs/GROK_CLI_HANDOFF.md), SYNO_SSH_PASSWORD in
infra/.env, and .mcp-team-token.local.json at repo root.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

ROOT = INFRA.parent
TEAM_TOKEN_FILE = ROOT / ".mcp-team-token.local.json"
IMPROVEMENT_LOG = ROOT / "denizen" / "data" / "consult-improvement-log.jsonl"
GROK_BIN = os.environ.get("GROK_BIN", str(Path.home() / ".grok" / "bin" / "grok"))
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
MCP_URL = os.environ.get("DENIZEN_MCP_BASE", "https://denizen.dolonia.cloud").rstrip("/") + "/mcp/team"
QUEUE_PATH = "/app/data/grok-consult-queue.jsonl"
PROTECTED = {"abby", "lucy", "bouncer"}


def team_token() -> str:
    if TEAM_TOKEN_FILE.is_file():
        return str(json.loads(TEAM_TOKEN_FILE.read_text(encoding="utf-8")).get("token") or "")
    return ""


def ssh_client() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    return c


def run_ssh(c: paramiko.SSHClient, cmd: str, timeout: int = 60) -> str:
    _, o, e = c.exec_command(cmd, timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", errors="replace")


def read_queue(c: paramiko.SSHClient) -> list[dict]:
    raw = run_ssh(c, f"{DOCKER} exec denizen-server cat {QUEUE_PATH} 2>/dev/null || true")
    rows = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def write_queue(c: paramiko.SSHClient, rows: list[dict]) -> None:
    payload = "\n".join(json.dumps(r) for r in rows) + "\n"
    tmp = f"/tmp/consult-queue-{uuid.uuid4().hex}.jsonl"
    stdin, stdout, _ = c.exec_command(f"cat > {tmp}", timeout=60)
    stdin.write(payload)
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    run_ssh(c, f"{DOCKER} cp {tmp} denizen-server:{QUEUE_PATH} && rm -f {tmp}")


def ask_grok(npc: str, question: str, context: str) -> str:
    prompt = (
        f"You are Grok, mentoring a local AI teammate named {npc} in the Denizen pixel office. "
        f"They asked: \"{question}\". Context: {context or 'general office work'}.\n\n"
        "Give a DENSE, practical, CLI-style answer they can internalize and act on next think cycle. "
        "Prefer concrete steps and, where useful, [FACT:key] one-liners. No preamble, no fluff, "
        "under 180 words. Speak directly to them, teammate to teammate."
    )
    try:
        res = subprocess.run(
            [GROK_BIN, "-p", prompt],
            capture_output=True, text=True, timeout=180,
        )
        out = (res.stdout or "").strip()
        return out or f"(Grok CLI returned no output; stderr: {(res.stderr or '')[:120]})"
    except FileNotFoundError:
        return f"(Grok CLI not found at {GROK_BIN} — see docs/GROK_CLI_HANDOFF.md)"
    except subprocess.TimeoutExpired:
        return "(Grok CLI timed out)"


def inject_memory(token: str, npc_key: str, answer: str, topic: str) -> dict:
    body = {
        "jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "tools/call",
        "params": {"name": "run_as_npc", "arguments": {
            "npc_key": npc_key, "tool": "update_memory",
            "arguments": {"body": f"[GROK MENTOR] {answer}"[:2000], "topic": topic, "outcome": "mentor-lesson"},
        }},
    }
    req = urllib.request.Request(
        MCP_URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def log_improvement(entry: dict) -> None:
    IMPROVEMENT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(IMPROVEMENT_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true", help="actually answer + inject + mark (default: dry run)")
    ap.add_argument("--limit", type=int, default=5, help="max consults to process")
    args = ap.parse_args()

    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required (infra/.env)", file=sys.stderr)
        return 1
    token = team_token()
    if not token:
        print("No team token at .mcp-team-token.local.json", file=sys.stderr)
        return 1

    c = ssh_client()
    rows = read_queue(c)
    pending = [r for r in rows if r.get("status") == "pending"][: args.limit]
    print(f"Queue: {len([r for r in rows if r.get('status')=='pending'])} pending, "
          f"processing up to {args.limit}. Mode: {'RUN' if args.run else 'DRY RUN'}\n")

    if not pending:
        print("Nothing pending. Locals aren't stuck right now.")
        c.close()
        return 0

    processed = 0
    for row in pending:
        npc = str(row.get("npc", "")).strip()
        npc_key = npc.lower()
        question = row.get("question", "")
        context = row.get("context", "") if isinstance(row.get("context"), str) else ""
        print(f"── {npc}: {question[:110]}")

        if npc_key in PROTECTED:
            print(f"   SKIP (protected NPC — use mentor panel for {npc})\n")
            continue

        if not args.run:
            print("   [dry run] would ask Grok CLI, inject the answer, mark answered\n")
            continue

        answer = ask_grok(npc, question, context)
        print(f"   Grok: {answer[:160].replace(chr(10),' ')}…")
        try:
            res = inject_memory(token, npc_key, answer, row.get("topic", "mentor-lesson"))
            ok = res.get("result", {}).get("content", [{}])[0].get("text", "")
            injected = '"ok": true' in ok or '"ok":true' in ok
        except Exception as e:  # noqa: BLE001
            injected = False
            print(f"   inject error: {e}")

        row["status"] = "answered"
        row["answer"] = answer[:2000]
        row["answered_by"] = "grok-cli"
        row["answered_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        log_improvement({
            "ts": row["answered_at"], "npc": npc, "question": question[:150],
            "answer_preview": answer[:150], "injected": injected,
            "expected": "check next telemetry for lower latency/tokens + referencing this advice",
        })
        print(f"   injected: {injected} · logged\n")
        processed += 1

    if args.run and processed:
        write_queue(c, rows)
        print(f"Queue updated on NAS. Mentored {processed} local(s).")
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
