#!/usr/bin/env python3
"""
Verify coding-agent can produce a real git diff on NAS.

Sequence (one layer at a time):
  1. Cap your Anthropic key in console.anthropic.com (or use a dedicated capped key).
  2. Add ANTHROPIC_API_KEY=sk-ant-... to infra/.env (gitignored — never tracked).
  3. py infra/verify-coding-agent-auth-nas.py --ack-cap
     → manual worktree test with key inline (isolates key from env plumbing).
  4. py infra/patch-denizen-nas-env.py
  5. py infra/verify-coding-agent-auth-nas.py --via-container-env --ack-cap
  6. py infra/verify-phase1-abby-alex.py

Never prints the full API key.
"""
from __future__ import annotations

from hostcfg import get_host
import argparse
import os
import secrets
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_KEY = "/tmp/denizen-anthropic-key-{token}"


def run(client, cmd, timeout=180):
    print(f"$ {cmd[:120]}")
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        try:
            print(out.rstrip())
        except UnicodeEncodeError:
            print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def stream_bytes(client, data: bytes, remote_path: str) -> None:
    parent = remote_path.rsplit("/", 1)[0]
    client.exec_command(f"mkdir -p '{parent}'")
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'")
    stdin.write(data)
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()


def key_status() -> tuple[str | None, str]:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None, "ANTHROPIC_API_KEY missing from infra/.env"
    if len(key) < 20:
        return None, "ANTHROPIC_API_KEY looks too short"
    return key, f"ANTHROPIC_API_KEY loaded (chars={len(key)}, prefix={key[:7]}...)"


def ensure_worktree(client) -> str:
  """Return worktree path; create one if none exist."""
  _, out = run(
      client,
      f"{DOCKER} exec denizen-server sh -c '"
      "wt=$(ls -td /app/.npc-worktrees/*/ 2>/dev/null | head -1); "
      "if [ -n \"$wt\" ]; then echo $wt; exit 0; fi; "
      "cd /app && git worktree add /app/.npc-worktrees/probe-$(date +%s) -b probe-auth-$(date +%s) "
      "2>/dev/null && ls -td /app/.npc-worktrees/*/ | head -1'",
      timeout=60,
  )
  wt = out.strip().splitlines()[-1].strip() if out.strip() else ""
  if not wt.startswith("/app/.npc-worktrees/"):
      raise RuntimeError(f"Could not resolve worktree path: {out[:200]!r}")
  return wt.rstrip("/")


def claude_probe(client, wt: str, use_container_env: bool, key: str | None) -> tuple[bool, int]:
    token = secrets.token_hex(8)
    host_key = REMOTE_KEY.format(token=token)
    container_key = f"/tmp/anthropic-key-{token}"

    if not use_container_env:
        if not key:
            raise RuntimeError("inline key required for manual test")
        stream_bytes(client, (key + "\n").encode(), host_key)
        run(client, f"chmod 600 {host_key}")
        run(client, f"{DOCKER} cp {host_key} denizen-server:{container_key}")
        run(client, f"rm -f {host_key}")
        env_prefix = f"export ANTHROPIC_API_KEY=$(cat {container_key});"
        cleanup = f"rm -f {container_key};"
    else:
        env_prefix = ""
        cleanup = ""
        _, chk = run(
            client,
            f"{DOCKER} exec denizen-server sh -c '"
            "v=$(printenv ANTHROPIC_API_KEY 2>/dev/null); "
            "if [ -n \"$v\" ]; then echo SET chars=${#v}; else echo UNSET; fi'",
            timeout=30,
        )
        if "UNSET" in chk:
            raise RuntimeError(
                "ANTHROPIC_API_KEY not in container — run: py infra/patch-denizen-nas-env.py"
            )

    probe_cmd = (
        f"{DOCKER} exec denizen-server sh -c '"
        f"{env_prefix} "
        f"cd \"{wt}\" && "
        "npx --yes @anthropic-ai/claude-code --print "
        "\"Add HTML comment <!-- auth-probe --> as the very first line of README.md only.\" "
        "2>&1 | tail -15; "
        f"{cleanup}"
        "echo DIFF_BYTES=$(git diff HEAD 2>/dev/null | wc -c); "
        "git diff HEAD 2>/dev/null | head -20'"
    )
    code, out = run(client, probe_cmd, timeout=300)
    diff_bytes = 0
    for line in out.splitlines():
        if line.startswith("DIFF_BYTES="):
            try:
                diff_bytes = int(line.split("=", 1)[1].strip())
            except ValueError:
                pass
    login_fail = "not logged in" in out.lower() or "please run /login" in out.lower()
    ok = diff_bytes > 0 and not login_fail
    return ok, diff_bytes


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify coding-agent auth produces a git diff on NAS")
    parser.add_argument(
        "--ack-cap",
        action="store_true",
        help="Confirm you set a billing spend cap (or dedicated capped key) on this API key",
    )
    parser.add_argument(
        "--via-container-env",
        action="store_true",
        help="Use ANTHROPIC_API_KEY already in container (after patch-denizen-nas-env.py)",
    )
    args = parser.parse_args()

    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required in infra/.env", file=sys.stderr)
        return 1

    key, key_msg = key_status()
    if not args.via_container_env and not key:
        print(f"BLOCKED: {key_msg}", file=sys.stderr)
        print(
            "\nAdd a capped ANTHROPIC_API_KEY to infra/.env, then re-run with --ack-cap.\n"
            "See infra/.env.example for comments.",
            file=sys.stderr,
        )
        return 1

    if not args.ack_cap:
        print(
            "BLOCKED: confirm billing spend cap on this key first, then pass --ack-cap.\n"
            "console.anthropic.com → Settings → Limits (or use a dedicated capped key).",
            file=sys.stderr,
        )
        return 1

    print("==> coding-agent auth verification\n")
    if key:
        print(key_msg)
    print(f"mode: {'container env' if args.via_container_env else 'inline key (manual worktree)'}\n")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    try:
        wt = ensure_worktree(client)
        print(f"worktree: {wt}\n")
        ok, diff_bytes = claude_probe(client, wt, args.via_container_env, key)
    finally:
        client.close()

    print("\n--- result ---")
    print(f"git diff bytes: {diff_bytes}")
    if ok:
        print("PASS: coding-agent can produce a real diff")
        return 0
    print("FAIL: no diff or auth error — see output above")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
