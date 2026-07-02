#!/usr/bin/env python3
"""Diagnose coding-agent empty diff: Claude Code binary, auth, worktrees."""
from __future__ import annotations

import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def run(client, cmd, timeout=120):
    print(f"\n--- {cmd[:140]}")
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        try:
            print(out.rstrip())
        except UnicodeEncodeError:
            print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    print("==> coding-agent empty-diff diagnostics\n")

    run(client, f"{DOCKER} exec denizen-server which claude || true")
    run(client, f"{DOCKER} exec denizen-server npx --version")
    run(client, f"{DOCKER} exec denizen-server sh -c 'npx --yes @anthropic-ai/claude-code --version 2>&1 | head -3'", timeout=180)

    for key in ("ANTHROPIC_API_KEY", "DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY", "CLAUDE_API_KEY"):
        run(client, f"{DOCKER} exec denizen-server sh -c 'v=$(printenv {key} 2>/dev/null); if [ -n \"$v\" ]; then echo {key}=SET chars=${{#v}} prefix=${{v:0:7}}...; else echo {key}=UNSET; fi'")

    run(client, f"{DOCKER} exec denizen-server sh -c 'ls -la /app/.npc-worktrees 2>/dev/null || echo NO_WORKTREES'")
    run(
        client,
        f"{DOCKER} exec denizen-server sh -c '"
        "wt=$(ls -td /app/.npc-worktrees/*/ 2>/dev/null | head -1); "
        "echo LATEST=$wt; "
        "if [ -d \"$wt\" ]; then ls -la \"$wt\"; wc -c \"$wt/README.md\" 2>/dev/null; "
        "cd \"$wt\" && git status -sb 2>&1; echo DIFF_BYTES=$(git diff HEAD 2>/dev/null | wc -c); "
        "git diff HEAD 2>/dev/null | head -25; fi'"
    )

    run(client, f"{DOCKER} exec denizen-server sh -c 'ls -t /app/reports/code-reviews/*.md 2>/dev/null | head -3'")
    run(
        client,
        f"{DOCKER} exec denizen-server sh -c 'head -60 /app/reports/code-reviews/abby_to-add-a-one-line-comment-to-readme-and-_20260624.md 2>/dev/null'",
    )

    print("\n==> manual Claude Code probe in latest worktree (may take ~2 min)")
    run(
        client,
        f"{DOCKER} exec denizen-server sh -c '"
        "wt=$(ls -td /app/.npc-worktrees/*/ 2>/dev/null | head -1); "
        "cd \"$wt\" && npx --yes @anthropic-ai/claude-code --print "
        "\"Add HTML comment <!-- probe-test --> as the very first line of README.md only. Minimal change.\" "
        "2>&1 | head -40'",
        timeout=180,
    )
    run(
        client,
        f"{DOCKER} exec denizen-server sh -c '"
        "wt=$(ls -td /app/.npc-worktrees/*/ 2>/dev/null | head -1); "
        "cd \"$wt\" && echo POST_DIFF_BYTES=$(git diff HEAD 2>/dev/null | wc -c) && git diff HEAD 2>/dev/null | head -30'"
    )

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
