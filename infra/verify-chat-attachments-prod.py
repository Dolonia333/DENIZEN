#!/usr/bin/env python3
"""Verify chat attachments end-to-end on NAS (local WS) and/or public production URL."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
DENIZEN = REPO / "denizen"
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
PUBLIC_BASE = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
PROBE = DENIZEN / "scripts" / "chat-attachment-probe.mjs"


def run_probe(ws_url: str, npc: str = "Bob", timeout: int = 130) -> dict:
    proc = subprocess.run(
        ["node", str(PROBE), ws_url, npc],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    for line in reversed((proc.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                data = json.loads(line)
                data["_exit"] = proc.returncode
                return data
            except json.JSONDecodeError:
                continue
    return {
        "ok": False,
        "error": proc.stderr or proc.stdout or "no json output",
        "_exit": proc.returncode,
    }


def ssh_check_module(client) -> tuple[bool, str]:
    cmd = (
        f"{DOCKER} exec denizen-server node -e "
        "\"const c=require('/app/src/chat-attachments.js');"
        "const r=c.validateAttachments([{name:'t.txt',mime:'text/plain',data:Buffer.from('hi').toString('base64')}]);"
        "console.log(JSON.stringify({ok:r.ok}));\""
    )
    _, o, e = client.exec_command(cmd, timeout=60)
    out = (o.read() + e.read()).decode("utf-8", errors="replace").strip()
    return "ok\":true" in out or '"ok":true' in out, out[:300]


def main() -> int:
    if not PROBE.is_file():
        print(f"Missing probe script: {PROBE}", file=sys.stderr)
        return 1

    results = {}

    if PASSWORD:
        print("==> NAS module check")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
        mod_ok, mod_out = ssh_check_module(client)
        results["nas_module"] = {"ok": mod_ok, "detail": mod_out}
        print(f"    chat-attachments loads: {'OK' if mod_ok else 'FAIL'}")
        client.close()

        print(f"\n==> NAS live WS probe (ws://{HOST}:{PORT}/agent-ws)")
        nas = run_probe(f"ws://{HOST}:{PORT}/agent-ws")
        results["nas_ws"] = nas
        print(f"    ack={nas.get('ack')} cited_marker={nas.get('cited_marker')} ok={nas.get('ok')}")
        if nas.get("replies"):
            print(f"    reply: {str(nas['replies'][-1].get('text', ''))[:240]}")

    prod_ws = PUBLIC_BASE.replace("https://", "wss://").replace("http://", "ws://") + "/agent-ws"
    print(f"\n==> Production WS probe ({prod_ws})")
    prod = run_probe(prod_ws)
    results["production_ws"] = prod
    print(f"    ack={prod.get('ack')} cited_marker={prod.get('cited_marker')} ok={prod.get('ok')}")
    if prod.get("replies"):
        print(f"    reply: {str(prod['replies'][-1].get('text', ''))[:240]}")
    if prod.get("error"):
        print(f"    error: {prod['error']}")

    report = INFRA.parent / "denizen" / "reports" / "chat-attachment-probe.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nWrote {report}")

    all_ok = (
        results.get("nas_module", {}).get("ok", True)
        and results.get("production_ws", {}).get("ok") is True
    )
    # NAS WS only reachable on LAN — don't fail CI if absent
    if results.get("nas_ws") and not results["nas_ws"].get("ok"):
        nas_err = str(results["nas_ws"].get("error") or "")
        if "ECONNREFUSED" in nas_err or "timedOut" in str(results["nas_ws"]):
            print("(NAS WS unreachable from this host — skipped in pass/fail)")
        else:
            all_ok = False
    print("PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
