#!/usr/bin/env python3
"""Grok + Claude mentor loop — peers discuss local NPC questions, inject synthesis.

Usage:
  py infra/grok-claude-mentor-loop.py watch
  py infra/grok-claude-mentor-loop.py run          # Claude API if ANTHROPIC_API_KEY; finalize when both ready
  py infra/grok-claude-mentor-loop.py demo         # test session + sample peer replies
  py infra/grok-claude-mentor-loop.py reply --agent claude --session ID --text "..."
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
from mcp_http import tool_call  # noqa: E402

ROOT = INFRA.parent
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
BASE = os.environ.get("DENIZEN_MCP_BASE", f"http://{HOST}:8888").rstrip("/")
TEAM_TOKEN_FILE = ROOT / ".mcp-team-token.local.json"
GROK_TOKEN_FILE = ROOT / ".mcp-token.local.json"


def load_token(team: bool = True) -> str:
    env_key = "DENIZEN_TEAM_MCP_TOKEN" if team else "DENIZEN_MCP_TOKEN"
    tok = os.environ.get(env_key, "").strip()
    if tok:
        return tok
    path = TEAM_TOKEN_FILE if team else GROK_TOKEN_FILE
    if path.is_file():
        return str(json.loads(path.read_text(encoding="utf-8")).get("token") or "")
    return ""


def mcp_rpc(endpoint: str, token: str, tool: str, arguments: dict | None = None, timeout: int = 120) -> dict:
    return tool_call(endpoint, token, tool, arguments, timeout=timeout)


def team_call(tool: str, args: dict | None = None) -> dict:
    tok = load_token(team=True)
    if not tok:
        return {"ok": False, "error": "no team token"}
    return mcp_rpc(f"{BASE}/mcp/team", tok, tool, args)


def grok_call(tool: str, args: dict | None = None) -> dict:
    tok = load_token(team=False)
    if not tok:
        return {"ok": False, "error": "no grok token"}
    return mcp_rpc(f"{BASE}/mcp/npc/grok", tok, tool, args)


def claude_api_reply(question: str, npc: str, grok_reply: str | None = None) -> str | None:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    try:
        import urllib.request as ur
    except ImportError:
        return None

    peer_ctx = f"\nGrok already said:\n{grok_reply}\n" if grok_reply else ""
    prompt = (
        f"You are Claude mentoring local LLM NPC '{npc}' in the Denizen office. "
        f"A local model on LM Studio asked: {question}\n"
        f"{peer_ctx}"
        "Reply in 3-5 sentences: warm, specific, human — how to research and talk like a real teammate. "
        "React to Grok if present; agree or add nuance. No corporate fluff."
    )
    payload = {
        "model": os.environ.get("MENTOR_CLAUDE_MODEL", "claude-haiku-4-5"),
        "max_tokens": 600,
        "messages": [{"role": "user", "content": prompt}],
    }
    req = ur.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with ur.urlopen(req, timeout=60) as res:
            data = json.loads(res.read().decode())
        blocks = data.get("content") or []
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    except Exception as e:
        print(f"Claude API skip: {e}", file=sys.stderr)
        return None


def cmd_watch(_: argparse.Namespace) -> int:
    res = team_call("mentor_list_pending", {})
    parsed = res.get("parsed") or {}
    sessions = parsed.get("sessions") or []
    print(f"Open mentor sessions: {len(sessions)}\n")
    for s in sessions:
        print(f"  [{s.get('id')[:8]}] {s.get('npc')} — {s.get('question', '')[:70]}")
        print(f"    grok={'yes' if s.get('has_grok') else 'NO'} claude={'yes' if s.get('has_claude') else 'NO'}")
    if not sessions:
        print("  (none — local NPCs use consult-mentors skill)")
    return 0


def cmd_reply(args: argparse.Namespace) -> int:
    agent = args.agent.lower()
    endpoint = f"{BASE}/mcp/team"
    tok = load_token(team=True)
    if agent == "grok":
        endpoint = f"{BASE}/mcp/npc/grok"
        tok = load_token(team=False)
    res = mcp_rpc(endpoint, tok, "mentor_peer_reply", {
        "session_id": args.session,
        "agent": agent,
        "reply": args.text,
    })
    print(json.dumps(res.get("parsed") or res, indent=2)[:2000])
    return 0 if res.get("ok") else 1


def process_sessions(auto_claude: bool = True) -> int:
    pending = team_call("mentor_list_pending", {})
    sessions = (pending.get("parsed") or {}).get("sessions") or []
    finalized = 0

    for s in sessions:
        sid = s["id"]
        needs_grok = not s.get("has_grok")
        needs_claude = not s.get("has_claude")

        if needs_claude and auto_claude:
            reply = claude_api_reply(s.get("question", ""), s.get("npc", ""), None)
            if reply:
                grok_call("mentor_peer_reply", {"session_id": sid, "agent": "claude", "reply": reply})
                print(f"Claude replied -> {s.get('npc')} ({sid[:8]})")
                needs_claude = False

        detail = team_call("mentor_get_session", {"session_id": sid})
        sess = (detail.get("parsed") or {}).get("session") or {}
        if sess.get("grok_reply") and sess.get("claude_reply") and sess.get("status") != "finalized":
            fin = team_call("mentor_finalize", {"session_id": sid, "announce": True})
            if fin.get("parsed", {}).get("ok"):
                print(f"Finalized -> {sess.get('npc')} memory injected ({sid[:8]})")
                finalized += 1
            else:
                print(f"Finalize failed {sid[:8]}: {fin}")

        if needs_grok:
            print(f"Awaiting Grok CLI reply: py infra/grok-claude-mentor-loop.py reply --agent grok --session {sid} --text \"...\"")
        if needs_claude and not auto_claude:
            print(f"Awaiting Claude Desktop: mentor_peer_reply session {sid}")

    print(f"\nDone — finalized {finalized} session(s)")
    return 0


def cmd_run(_: argparse.Namespace) -> int:
    return process_sessions(auto_claude=True)


def cmd_demo(_: argparse.Namespace) -> int:
    res = grok_call("run_skill", {
        "skill": "consult-mentors",
        "params": {
            "question": "How do I sound like a real person in think cycles instead of saying 'continuing current task'?",
            "topic": "human-like-autonomy",
            "context": "demo mentor loop",
        },
        "wait": True,
    })
    parsed = res.get("parsed") or {}
    sid = parsed.get("session_id")
    if not sid and parsed.get("output"):
        # extract from output line Session: uuid
        for line in str(parsed.get("output", "")).splitlines():
            if line.startswith("Session:"):
                sid = line.split(":", 1)[1].strip()
    if not sid:
        print("Demo failed to open session:", json.dumps(parsed, indent=2)[:1500])
        return 1

    grok_reply = (
        "Drop the status-bot voice. Open with what you actually noticed — mesh queue, a deal name, "
        "who's at their desk. One concrete next action beats five vague 'continuing' lines."
    )
    claude_reply = (
        "I agree with Grok — lead with specificity. Ask yourself: what would I say to a coworker in Slack? "
        "Short, warm, one observation plus one offer. Reference yesterday's thread when you can."
    )
    grok_call("mentor_peer_reply", {"session_id": sid, "agent": "grok", "reply": grok_reply})
    team_call("mentor_peer_reply", {"session_id": sid, "agent": "claude", "reply": claude_reply})
    fin = team_call("mentor_finalize", {"session_id": sid})
    print(json.dumps(fin.get("parsed") or fin, indent=2)[:2000])
    return 0 if fin.get("parsed", {}).get("ok") else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Grok + Claude mentor loop for local NPCs")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("watch", help="List open mentor sessions").set_defaults(func=cmd_watch)
    sub.add_parser("run", help="Auto Claude API + finalize ready sessions").set_defaults(func=cmd_run)
    sub.add_parser("demo", help="Demo consult-mentors + peer replies + finalize").set_defaults(func=cmd_demo)

    p_reply = sub.add_parser("reply", help="Post peer reply")
    p_reply.add_argument("--agent", required=True, choices=["grok", "claude"])
    p_reply.add_argument("--session", required=True)
    p_reply.add_argument("--text", required=True)
    p_reply.set_defaults(func=cmd_reply)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
