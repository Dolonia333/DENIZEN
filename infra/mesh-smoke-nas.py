#!/usr/bin/env python3
"""Enqueue a mesh test job on NAS and poll until claimed/completed."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
NAS_URL = os.environ.get("DENIZEN_NAS_URL", f"http://{HOST}:8888")


def nas_env_token() -> str:
    if not PASSWORD:
        return os.environ.get("DENIZEN_INTERNAL_API_TOKEN", "")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command("grep '^DENIZEN_INTERNAL_API_TOKEN=' /volume1/docker/denizen-server/.env | head -1")
    line = o.read().decode().strip()
    client.close()
    if "=" in line:
        return line.split("=", 1)[1].strip()
    return ""


def api(method: str, path: str, body: dict | None = None, token: str = "") -> dict:
    url = f"{NAS_URL.rstrip('/')}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Internal-Token"] = token
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"ok": False, "error": raw[:300], "status": e.code}


def main() -> int:
    token = nas_env_token()

    status = api("GET", "/api/compute/node/status", token=token)
    print("before:", json.dumps({
        "pending": status.get("pending_count"),
        "running": status.get("running_count"),
        "db": status.get("db_enabled"),
    }))

    tag = f"mesh-activate-{int(time.time())}"
    enq = api(
        "POST",
        "/api/compute/jobs/enqueue",
        {
            "job_type": "web_search",
            "payload": {"query": "OMES EV00000919 Oklahoma RM Cyber", "tag": tag, "headless": False},
            "priority": 90,
        },
        token=token,
    )
    print("enqueue:", json.dumps(enq)[:500])
    job_id = (enq.get("job") or {}).get("id")
    if not job_id:
        return 1

    for i in range(20):
        time.sleep(3)
        st = api("GET", "/api/compute/node/status", token=token)
        running = st.get("running_jobs") or []
        recent = st.get("recent_completions") or []
        hit_run = next((j for j in running if j.get("id") == job_id), None)
        hit_done = next((j for j in recent if j.get("id") == job_id), None)
        print(f"poll {i+1}: pending={st.get('pending_count')} running={st.get('running_count')}")
        if hit_run:
            print("ASSIGNED", json.dumps(hit_run)[:300])
        if hit_done:
            print("DONE", json.dumps(hit_done)[:400])
            return 0

    print("timeout waiting for job completion")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
