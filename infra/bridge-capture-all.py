#!/usr/bin/env python3
"""Bridge capture gaps — enqueue mesh intel jobs + verify platform health."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
DENIZEN = ROOT / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
NAS_URL = os.environ.get("DENIZEN_NAS_URL", f"http://{HOST}:8888").rstrip("/")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")


def log(msg: str) -> None:
    print(msg, flush=True)


def nas_token() -> str:
    if not PASSWORD:
        return os.environ.get("DENIZEN_INTERNAL_API_TOKEN", "")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command(
        "grep '^DENIZEN_INTERNAL_API_TOKEN=' /volume1/docker/denizen-server/.env | head -1"
    )
    line = o.read().decode().strip()
    client.close()
    if "=" in line:
        return line.split("=", 1)[1].strip()
    return ""


def api(method: str, path: str, body: dict | None = None, token: str = "") -> dict:
    url = f"{NAS_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Internal-Token"] = token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"ok": False, "error": raw[:300], "status": e.code}


def enqueue_research(token: str, query: str, tag: str, priority: int = 85) -> str | None:
    enq = api(
        "POST",
        "/api/compute/jobs/enqueue",
        {
            "job_type": "web_search",
            "payload": {"query": query, "tag": tag, "headless": False},
            "priority": priority,
        },
        token=token,
    )
    job_id = (enq.get("job") or {}).get("id")
    log(f"  enqueue {tag}: {job_id or enq.get('error', 'fail')}")
    return job_id


def poll_job(token: str, job_id: str, attempts: int = 25) -> dict | None:
    for i in range(attempts):
        time.sleep(3)
        st = api("GET", "/api/compute/node/status", token=token)
        for j in (st.get("recent_completions") or []):
            if j.get("id") == job_id:
                return j
        for j in (st.get("running_jobs") or []):
            if j.get("id") == job_id:
                log(f"  poll {i + 1}: running {job_id[:8]}…")
    return None


def run_marcus_phase3() -> int:
    script = DENIZEN / "scripts" / "phase3-marcus-business-crm.js"
    if not script.is_file():
        log("SKIP phase3 (script missing)")
        return 0
    log("==> Marcus business-context probe (WS)")
    proc = subprocess.run(
        ["node", str(script), HOST, "8888"],
        cwd=str(DENIZEN),
        capture_output=True,
        text=True,
        timeout=90,
    )
    out = (proc.stdout or proc.stderr or "").strip()
    if out:
        try:
            data = json.loads(out.splitlines()[-1] if "\n" in out else out)
            text = (data.get("reply") or {}).get("text") or ""
            log(f"  Marcus ({len(text)} chars): {text[:280]}…" if len(text) > 280 else f"  Marcus: {text}")
        except json.JSONDecodeError:
            log(out[-500:])
    return proc.returncode


def main() -> int:
    log("==> Bridge capture — mesh intel + CRM context\n")
    token = nas_token()

    health = api("GET", "/api/health")
    pool = (health.get("lmStudioPool") or {}).get("selected") or {}
    log(f"mesh: lm={health.get('lmStudio', {}).get('reachable')} router={pool.get('url')}")

    status = api("GET", "/api/compute/node/status", token=token)
    log(f"queue: pending={status.get('pending_count')} running={status.get('running_count')}")

    bridge = api("GET", "/api/platform-bridge/status")
    log(f"platform-bridge: enabled={bridge.get('enabled')} mode={bridge.get('mode')}")

    jobs = [
        (
            "omes-ev00000919",
            "OMES EV00000919 Oklahoma state IT modernization solicitation RM Cyber teaming 2026",
        ),
        (
            "rm-cyber-ballard",
            "RM Cyber Benjamin Ballard Oklahoma cybersecurity government modernization partnership",
        ),
        (
            "omes-crm-hygiene",
            "Oklahoma OMES state procurement EV00000919 deadline October 2026 teaming agreement requirements",
        ),
    ]

    log("\n==> Enqueue capture research (web_search)")
    job_ids: list[str] = []
    for tag, query in jobs:
        jid = enqueue_research(token, query, f"capture-{tag}-{int(time.time())}")
        if jid:
            job_ids.append(jid)

    log("\n==> Poll first job (others run in background)")
    if job_ids:
        done = poll_job(token, job_ids[0])
        log(f"  first job: {done or 'timeout (may still complete)'}")

    log("")
    run_marcus_phase3()

    log("\n==> Gap bridge gate")
    proc = subprocess.run([sys.executable, str(INFRA / "verify-gap-bridge-all.py")], cwd=str(ROOT))
    if proc.returncode != 0:
        return proc.returncode

    log("\nPASS: capture bridge complete — check CRM + research outputs in office")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
