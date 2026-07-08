#!/usr/bin/env python3
"""
Drive the live Denizen office via Grok/Claude **CLI + MCP** — no API keys.

Uses your existing grok.com / Claude Code login. MCP servers must be wired first:
  py infra/setup-office-cli-drivers.py

Usage:
  py infra/run-office-cli-loop.py grok "Announce online, get_status, log_activity"
  py infra/run-office-cli-loop.py claude "Check get_status, announce online"
  py infra/run-office-cli-loop.py grok --loop --interval 300
  py infra/run-office-cli-loop.py both --loop --interval 600
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

GROK_BIN = Path(os.environ.get("GROK_BIN", Path.home() / ".grok" / "bin" / "grok"))
CLAUDE_BIN = Path(os.environ.get("CLAUDE_BIN", Path.home() / ".local" / "bin" / "claude"))
if os.name == "nt":
    if not GROK_BIN.suffix:
        GROK_BIN = GROK_BIN.with_suffix(".exe")
    claude_exe = Path.home() / ".local" / "bin" / "claude.exe"
    if claude_exe.is_file():
        CLAUDE_BIN = claude_exe

DEFAULT_GOALS = {
    "grok": (
        "You are Grok in the Denizen pixel office. Use the denizen-grok MCP server. "
        "Act autonomously: get_status, announce_in_office that you're online, "
        "list_skills, do one small safe action, log_activity. No preamble."
    ),
    "claude": (
        "You are Claude in the Denizen pixel office. Use the denizen-claude MCP server. "
        "Act autonomously: get_status, announce_in_office that you're online, "
        "check mentor_list_pending if available, log_activity. No preamble."
    ),
}

SYSTEM = {
    "grok": (
        "You are Grok NPC in denizen.dolonia.cloud. Call MCP tools yourself; "
        "make work visible with announce_in_office and log_activity."
    ),
    "claude": (
        "You are Claude NPC in denizen.dolonia.cloud. Call MCP tools yourself; "
        "verify claims, mentor locals, announce_in_office and log_activity."
    ),
}


def log(msg: str) -> None:
    print(msg, flush=True)


def run_grok(goal: str, timeout: int) -> int:
    if not GROK_BIN.is_file():
        log(f"Grok CLI not found: {GROK_BIN}")
        return 1
    cmd = [
        str(GROK_BIN),
        "-p",
        goal,
        "--append-system-prompt",
        SYSTEM["grok"],
        "--cwd",
        str(REPO / "denizen"),
    ]
    log(f"\n==> grok -p ({GROK_BIN.name})")
    proc = subprocess.run(cmd, timeout=timeout)
    return proc.returncode


def run_claude(goal: str, timeout: int) -> int:
    if not CLAUDE_BIN.is_file():
        log(f"Claude CLI not found: {CLAUDE_BIN}")
        return 1
    cmd = [
        str(CLAUDE_BIN),
        "-p",
        goal,
        "--append-system-prompt",
        SYSTEM["claude"],
        "--add-dir",
        str(REPO / "denizen"),
    ]
    log(f"\n==> claude -p ({CLAUDE_BIN.name})")
    proc = subprocess.run(cmd, timeout=timeout)
    return proc.returncode


def run_agent(agent: str, goal: str, timeout: int) -> int:
    if agent == "grok":
        return run_grok(goal, timeout)
    if agent == "claude":
        return run_claude(goal, timeout)
    log(f"Unknown agent: {agent}")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Office driver via CLI + MCP (no API keys)")
    ap.add_argument("agent", choices=["grok", "claude", "both"], nargs="?", default="grok")
    ap.add_argument("goal", nargs="?", default="")
    ap.add_argument("--loop", action="store_true", help="Repeat on interval")
    ap.add_argument("--interval", type=int, default=300, help="Seconds between loops")
    ap.add_argument("--max", type=int, default=0, help="Max iterations (0 = unlimited)")
    ap.add_argument("--timeout", type=int, default=300, help="Per-invocation timeout (sec)")
    args = ap.parse_args()

    agents = ["grok", "claude"] if args.agent == "both" else [args.agent]
    n = 0

    log("Office CLI loop — uses grok/claude login + MCP (no XAI/Anthropic API keys)")
    log("Watch: https://denizen.dolonia.cloud\n")

    while True:
        n += 1
        if args.loop:
            log(f"--- iteration {n} ---")
        for agent in agents:
            goal = args.goal.strip() or DEFAULT_GOALS[agent]
            rc = run_agent(agent, goal, args.timeout)
            if rc != 0:
                log(f"  exit {rc} ({agent})")
        if not args.loop:
            break
        if args.max and n >= args.max:
            break
        log(f"\nSleeping {args.interval}s…")
        time.sleep(args.interval)

    log("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
