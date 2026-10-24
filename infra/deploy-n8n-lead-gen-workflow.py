#!/usr/bin/env python3
"""Deploy Denizen Web Lead Intake workflow to NAS n8n via REST API."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

WORKFLOW_SRC = ROOT / "denizen" / "data" / "email-workflows" / "lead-gen-intake.n8n.json"
WORKFLOW_NAME = "Denizen — Web Lead Intake"
HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
N8N_API_URL = os.environ.get("N8N_API_URL", "http://127.0.0.1:5679/api/v1").rstrip("/")
PUBLIC_N8N = os.environ.get("N8N_URL", "https://n8n.dolonia.cloud").rstrip("/")
DENIZEN_URL = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
ORG_SLUG = os.environ.get("DENIZEN_CRM_ORG_SLUG", "zion")


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 90) -> tuple[int, str]:
    print("$", cmd[:160])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def build_workflow() -> dict:
    raw = json.loads(WORKFLOW_SRC.read_text(encoding="utf-8"))
    for node in raw["nodes"]:
        params = node.get("parameters", {})
        url = params.get("url")
        if isinstance(url, str) and "REPLACE_WITH_YOUR_DENIZEN_HOST" in url:
            params["url"] = url.replace("https://REPLACE_WITH_YOUR_DENIZEN_HOST", DENIZEN_URL)
        if node.get("name") == "Normalize lead":
            code = params.get("jsCode", "")
            params["jsCode"] = code.replace("'zion'", f"'{ORG_SLUG}'")
    return {
        "name": raw.get("name", WORKFLOW_NAME),
        "nodes": raw["nodes"],
        "connections": raw["connections"],
        "settings": raw.get("settings", {"executionOrder": "v1"}),
    }


def main() -> int:
    api_key = os.environ.get("N8N_API_KEY", "").strip()
    if not api_key or not PWD:
        print("N8N_API_KEY and SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    if not WORKFLOW_SRC.is_file():
        print(f"Missing {WORKFLOW_SRC}", file=sys.stderr)
        return 1

    wf_body = build_workflow()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    stdin, stdout, _ = client.exec_command("cat > /tmp/lead-gen-workflow.json", timeout=60)
    stdin.write(json.dumps(wf_body).encode("utf-8"))
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()

    list_cmd = (
        f"curl -fsS -m 30 -H 'X-N8N-API-KEY: {api_key}' "
        f"'{N8N_API_URL}/workflows?limit=100'"
    )
    code, out = run(client, list_cmd)
    if code != 0:
        print(out, file=sys.stderr)
        client.close()
        return 1

    existing_id = None
    for wf in json.loads(out).get("data", []):
        if wf.get("name") == WORKFLOW_NAME:
            existing_id = wf["id"]
            break

    if existing_id:
        cmd = (
            f"curl -fsS -m 45 -X PUT -H 'Content-Type: application/json' "
            f"-H 'X-N8N-API-KEY: {api_key}' "
            f"-d @/tmp/lead-gen-workflow.json '{N8N_API_URL}/workflows/{existing_id}'"
        )
        print(f"Updating workflow {existing_id}")
    else:
        cmd = (
            f"curl -fsS -m 45 -X POST -H 'Content-Type: application/json' "
            f"-H 'X-N8N-API-KEY: {api_key}' "
            f"-d @/tmp/lead-gen-workflow.json '{N8N_API_URL}/workflows'"
        )
        print("Creating workflow")

    code, out = run(client, cmd)
    if code != 0:
        print(out, file=sys.stderr)
        client.close()
        return 1

    wf_id = existing_id or json.loads(out).get("id")
    activate_cmd = (
        f"curl -fsS -m 30 -X POST -H 'X-N8N-API-KEY: {api_key}' "
        f"'{N8N_API_URL}/workflows/{wf_id}/activate'"
    )
    run(client, activate_cmd)
    client.close()

    webhook_url = f"{PUBLIC_N8N}/webhook/denizen-lead-intake"
    print("\n==> Lead Gen workflow deployed")
    print(f"  Workflow ID:  {wf_id}")
    print(f"  Webhook URL:  {webhook_url}")
    print(f"  org_slug:     {ORG_SLUG}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
