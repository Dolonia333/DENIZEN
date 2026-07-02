#!/usr/bin/env python3
"""Watch consult-grok queue and inject real Grok answers back into NPC memory via MCP.

Usage:
  py infra/grok-consult-relay.py watch              # print pending questions (NAS queue)
  py infra/grok-consult-relay.py test               # fire consult-grok via Grok MCP
  py infra/grok-consult-relay.py inject --npc grok --topic grok-mentor-lesson --answer-file answer.txt
  py infra/grok-consult-relay.py inject --npc Bob --answer "Short CLI-style reply"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
TOKEN_FILE = ROOT / ".mcp-token.local.json"
LOCAL_QUEUE = ROOT / "denizen" / "data" / "grok-consult-queue.jsonl"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
BASE = os.environ.get("DENIZEN_MCP_BASE", f"http://{HOST}:8888").rstrip("/")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def load_token() -> str:
    tok = os.environ.get("DENIZEN_MCP_TOKEN", "").strip()
    if tok:
        return tok
    if TOKEN_FILE.is_file():
        return str(json.loads(TOKEN_FILE.read_text(encoding="utf-8")).get("token") or "")
    return ""


def mcp_call(token: str, npc: str, tool: str, arguments: dict | None = None, timeout: int = 120) -> dict:
    body = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments or {}},
    }
    url = f"{BASE}/mcp/npc/{npc}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": e.read().decode(errors="replace")[:500], "status": e.code}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    result = raw.get("result") or raw
    text = None
    if isinstance(result, dict):
        content = result.get("content") or []
        if content and isinstance(content[0], dict):
            text = content[0].get("text")
    if text:
        try:
            return {"ok": True, "parsed": json.loads(text), "raw": result}
        except json.JSONDecodeError:
            return {"ok": True, "text": text, "raw": result}
    return {"ok": "error" not in raw, "raw": result, "full": raw}


def read_nas_queue() -> str:
    password = os.environ.get("SYNO_SSH_PASSWORD", "").strip()
    if not password:
        return ""
    try:
        import paramiko
    except ImportError:
        return ""

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=password, look_for_keys=False, allow_agent=False)
    cmd = f'{DOCKER} exec denizen-server cat /app/data/grok-consult-queue.jsonl 2>/dev/null || true'
    _, stdout, _ = client.exec_command(cmd, timeout=30)
    text = stdout.read().decode("utf-8", errors="replace")
    client.close()
    return text


def load_queue_lines() -> list[dict]:
    text = read_nas_queue()
    if not text.strip() and LOCAL_QUEUE.is_file():
        text = LOCAL_QUEUE.read_text(encoding="utf-8")
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            lines.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return lines


def cmd_watch(_: argparse.Namespace) -> int:
    rows = load_queue_lines()
    pending = [r for r in rows if r.get("status") == "pending"]
    answered = [r for r in rows if r.get("status") == "answered"]
    print(f"Queue: {len(pending)} pending, {len(answered)} answered\n")
    for row in pending[-20:]:
        print(f"[PENDING] {row.get('ts')} | {row.get('npc')} | {row.get('topic')}")
        print(f"  Q: {row.get('question', '')[:500]}\n")
    if not pending and rows:
        last = rows[-1]
        print(f"Latest: {last.get('status')} — {last.get('npc')}: {(last.get('question') or last.get('answer', ''))[:200]}")
    elif not rows:
        print("Queue empty — run: py infra/grok-consult-relay.py test")
    return 0


def cmd_test(args: argparse.Namespace) -> int:
    token = load_token()
    if not token:
        print("No MCP token — py infra/mint-mcp-token-nas.py grok", file=sys.stderr)
        return 1
    npc = args.npc or "grok"
    question = args.question or (
        "How can real Grok in the CLI help local LLMs learn research and office work? "
        "Give 3 practical tips I can use in my next think cycle."
    )
    print(f"==> consult-grok via MCP ({npc})\n")
    res = mcp_call(
        token,
        npc,
        "run_skill",
        {
            "skill": "consult-grok",
            "params": {
                "question": question,
                "topic": args.topic or "mentor-demo",
                "context": "bridge-all capture sprint; mesh healthy on .232",
            },
            "wait": True,
            "timeout_ms": 60000,
        },
        timeout=90,
    )
    print(json.dumps(res.get("parsed") or res, indent=2)[:4000])
    print("\nNext: answer here in CLI style, then:")
    print(f"  py infra/grok-consult-relay.py inject --npc {npc} --topic grok-mentor-lesson --answer \"...\"")
    return 0 if res.get("ok") else 1


def cmd_inject(args: argparse.Namespace) -> int:
    token = load_token()
    if not token:
        print("No MCP token", file=sys.stderr)
        return 1
    answer = args.answer or ""
    if args.answer_file:
        answer = Path(args.answer_file).read_text(encoding="utf-8").strip()
    if not answer:
        print("--answer or --answer-file required", file=sys.stderr)
        return 1

    npc_key = (args.npc or "grok").lower()
    topic = args.topic or "grok-mentor-lesson"
    body = answer[:2000]

    mem = mcp_call(
        token,
        npc_key,
        "update_memory",
        {"body": body, "topic": topic, "outcome": "mentor-lesson"},
        timeout=60,
    )
    act = mcp_call(
        token,
        npc_key,
        "log_activity",
        {
            "note": f"Real Grok mentor reply injected ({topic}): {body[:120]}…",
            "phase": "mentor",
            "action": "consult-grok-answer",
        },
        timeout=60,
    )
    print("update_memory:", json.dumps(mem.get("parsed") or mem, indent=2)[:1500])
    print("log_activity:", json.dumps(act.get("parsed") or act, indent=2)[:800])

    # Append answered record locally if queue exists
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "npc": npc_key,
        "topic": topic,
        "answer": body[:500],
        "status": "answered",
        "source": "grok-consult-relay",
    }
    LOCAL_QUEUE.parent.mkdir(parents=True, exist_ok=True)
    with LOCAL_QUEUE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    print(f"\nAppended answered record to {LOCAL_QUEUE}")
    return 0 if mem.get("ok") else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="consult-grok queue watch + MCP inject")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_watch = sub.add_parser("watch", help="Show pending consult-grok questions")
    p_watch.set_defaults(func=cmd_watch)

    p_test = sub.add_parser("test", help="Trigger consult-grok via MCP run_skill")
    p_test.add_argument("--npc", default="grok")
    p_test.add_argument("--topic", default="mentor-demo")
    p_test.add_argument("--question", default="")
    p_test.set_defaults(func=cmd_test)

    p_inj = sub.add_parser("inject", help="Inject real Grok answer into NPC memory")
    p_inj.add_argument("--npc", default="grok")
    p_inj.add_argument("--topic", default="grok-mentor-lesson")
    p_inj.add_argument("--answer", default="")
    p_inj.add_argument("--answer-file", default="")
    p_inj.set_defaults(func=cmd_inject)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
