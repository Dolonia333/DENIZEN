#!/usr/bin/env python3
"""
Wire Grok + Claude CLIs to drive the live Denizen office (Path B).

Steps:
  1. Mint NPC MCP tokens on NAS (if missing locally)
  2. Register denizen-grok / denizen-claude HTTP MCP in Grok CLI + Claude Code
  3. Preflight handshake (tools/list)
  4. Print how to start autonomy loops

Usage:
  py infra/setup-office-cli-drivers.py
  py infra/setup-office-cli-drivers.py --skip-mint
  py infra/setup-office-cli-drivers.py --verify-only
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

PUBLIC_BASE = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
GROK_BIN = Path(os.environ.get("GROK_BIN", Path.home() / ".grok" / "bin" / "grok"))
CLAUDE_BIN = Path(os.environ.get("CLAUDE_BIN", Path.home() / ".local" / "bin" / "claude"))
if os.name == "nt" and not GROK_BIN.suffix:
    GROK_BIN = GROK_BIN.with_suffix(".exe")
if os.name == "nt" and not CLAUDE_BIN.suffix:
    claude_alt = Path.home() / ".local" / "bin" / "claude.exe"
    if claude_alt.is_file():
        CLAUDE_BIN = claude_alt

TOKEN_FILES = {
    "grok": REPO / ".mcp-token.local.json",
    "claude": REPO / ".mcp-claude-token.local.json",
}
MCP_NAMES = {
    "grok": "denizen-grok",
    "claude": "denizen-claude",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def load_token(npc: str) -> dict | None:
    path = TOKEN_FILES[npc]
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def mint_token(npc: str) -> int:
    script = "mint-mcp-claude-token-nas.py" if npc == "claude" else "mint-mcp-token-nas.py"
    log(f"==> Minting {npc} MCP token via {script}")
    return subprocess.call([sys.executable, str(INFRA / script), "office-cli-driver"])


def mcp_preflight(npc: str, token: str) -> bool:
    url = f"{PUBLIC_BASE}/mcp/npc/{npc}"
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/list",
        "params": {},
    })
    proc = subprocess.run(
        [
            "curl", "-fsS", "-m", "30",
            "-X", "POST", url,
            "-H", "Content-Type: application/json",
            "-H", f"Authorization: Bearer {token}",
            "-d", body,
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        log(f"  FAIL preflight {npc}: {proc.stderr or proc.stdout}")
        return False
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        log(f"  FAIL preflight {npc}: invalid JSON")
        return False
    tools = (data.get("result") or {}).get("tools") or []
    log(f"  OK {npc}: {len(tools)} MCP tools at {url}")
    return len(tools) > 0


def wire_grok_mcp(name: str, mcp_url: str, token: str) -> int:
    if not GROK_BIN.is_file():
        log(f"  SKIP grok mcp: binary not found at {GROK_BIN}")
        return 1
    # Remove stale entry if present (ignore errors)
    subprocess.run([str(GROK_BIN), "mcp", "remove", name], capture_output=True)
    cmd = [
        str(GROK_BIN), "mcp", "add",
        "--transport", "http",
        "--scope", "user",
        name,
        mcp_url,
        "--header", f"Authorization: Bearer {token}",
    ]
    log(f"  $ grok mcp add {name} …")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log(proc.stderr or proc.stdout or "grok mcp add failed")
        return proc.returncode
    proc2 = subprocess.run([str(GROK_BIN), "mcp", "doctor"], capture_output=True, text=True)
    out = (proc2.stdout or proc2.stderr or "").strip()
    if out:
        log(out[:600])
    return 0


def wire_claude_mcp(name: str, mcp_url: str, token: str) -> int:
    if not CLAUDE_BIN.is_file():
        log(f"  SKIP claude mcp: binary not found at {CLAUDE_BIN}")
        return 1
    subprocess.run([str(CLAUDE_BIN), "mcp", "remove", name], capture_output=True)
    cmd = [
        str(CLAUDE_BIN), "mcp", "add",
        "--transport", "http",
        name,
        mcp_url,
        "--header", f"Authorization: Bearer {token}",
    ]
    log(f"  $ claude mcp add {name} …")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log(proc.stderr or proc.stdout or "claude mcp add failed")
        return proc.returncode
    proc2 = subprocess.run([str(CLAUDE_BIN), "mcp", "list"], capture_output=True, text=True)
    out = (proc2.stdout or proc2.stderr or "").strip()
    if out:
        log(out[:600])
    return 0


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-mint", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()

    log("==> Denizen office CLI drivers (Path B)\n")

    for npc in ("grok", "claude"):
        row = load_token(npc)
        if not row and not args.skip_mint and not args.verify_only:
            if mint_token(npc) != 0:
                return 1
            row = load_token(npc)
        if not row or not row.get("token"):
            log(f"ERROR: no token for {npc} — run py infra/mint-mcp-{npc}-token-nas.py" if npc == "claude" else "py infra/mint-mcp-token-nas.py grok")
            return 1
        token = str(row["token"])
        mcp_url = str(row.get("mcp_url") or f"{PUBLIC_BASE}/mcp/npc/{npc}")
        if not mcp_preflight(npc, token):
            return 1
        if args.verify_only:
            continue
        name = MCP_NAMES[npc]
        if npc == "grok":
            wire_grok_mcp(name, mcp_url, token)
        else:
            wire_claude_mcp(name, mcp_url, token)

    if args.verify_only:
        log("\nVerify-only complete.")
        return 0

    log("\n==> CLI wired. Drive the office (no API keys):\n")
    log("  # One-shot")
    log(f'  "{GROK_BIN}" -p "Use denizen-grok MCP: get_status, announce online, log_activity"')
    log(f'  "{CLAUDE_BIN}" -p "Use denizen-claude MCP: get_status, announce online, log_activity"')
    log("")
    log("  # Loop on a timer (CLI + MCP)")
    log("  py infra/run-office-cli-loop.py grok --loop --interval 300")
    log("  py infra/run-office-cli-loop.py both --loop --interval 600")
    log("")
    log("  # Optional API runners (need XAI_API_KEY / ANTHROPIC_API_KEY)")
    log("  py infra/run-grok-autonomy.py --loop --interval 300")
    log("  py infra/run-claude-autonomy.py --loop --interval 300")
    log("")
    log("  Watch: https://denizen.dolonia.cloud")
    log("  Docs: denizen/docs/OFFICE_CLI_DRIVERS.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
