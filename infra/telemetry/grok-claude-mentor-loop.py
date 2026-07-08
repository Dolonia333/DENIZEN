#!/usr/bin/env python3
"""
CLI helper for Grok ↔ Claude mentor panel on /mcp/team.

Usage:
  py infra/grok-claude-mentor-loop.py list [--agent claude]
  py infra/grok-claude-mentor-loop.py reply --session <id> --agent grok --text "..."
  py infra/grok-claude-mentor-loop.py finalize --session <id> [--synthesis "..."]
"""
import argparse
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
TOKEN_FILE = ROOT / ".mcp-team-token.local.json"
MCP_URL = os.environ.get("DENIZEN_TEAM_MCP_URL", "https://denizen.dolonia.cloud/mcp/team")


def load_token():
    if not TOKEN_FILE.exists():
        print(f"No team token at {TOKEN_FILE}")
        sys.exit(1)
    return json.loads(TOKEN_FILE.read_text())["token"]


def mcp_call(tool, arguments):
    token = load_token()
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    })
    cmd = [
        "curl", "-fsS", "-m", "30", "-X", "POST", MCP_URL,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {token}",
        "-d", body,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr or res.stdout)
        sys.exit(1)
    print(res.stdout)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    lp = sub.add_parser("list")
    lp.add_argument("--agent")

    rp = sub.add_parser("reply")
    rp.add_argument("--session", required=True)
    rp.add_argument("--agent", required=True, choices=["grok", "claude"])
    rp.add_argument("--text", required=True)

    fp = sub.add_parser("finalize")
    fp.add_argument("--session", required=True)
    fp.add_argument("--synthesis")

    args = p.parse_args()
    if args.cmd == "list":
        payload = {"limit": 15}
        if args.agent:
            payload["agent"] = args.agent
        mcp_call("mentor_list_pending", payload)
    elif args.cmd == "reply":
        mcp_call("mentor_peer_reply", {
            "session_id": args.session,
            "agent": args.agent,
            "reply": args.text,
        })
    elif args.cmd == "finalize":
        payload = {"session_id": args.session, "announce": True}
        if args.synthesis:
            payload["synthesis"] = args.synthesis
        mcp_call("mentor_finalize", payload)


if __name__ == "__main__":
    main()
