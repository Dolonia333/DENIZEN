#!/usr/bin/env python3
"""Deploy/repair NAS n8n + import Denizen Lucy inbox workflow + EMAIL_INBOUND_SECRET."""
from __future__ import annotations

from hostcfg import get_host
import json
import os
import secrets
import sys
import tarfile
import tempfile
import time
import uuid
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE_DIR = os.environ.get("SYNO_N8N_DIR", "/volume1/docker/denizen-n8n")
DENIZEN_PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
PUBLIC_URL = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
N8N_URL = os.environ.get("N8N_URL", os.environ.get("N8N_PUBLIC_URL", f"https://{os.environ.get('N8N_PUBLIC_HOST', 'n8n.dolonia.cloud')}"))
DENIZEN_SERVER_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")

WORKFLOW_SRC = ROOT / "denizen" / "data" / "email-workflows" / "lucy-inbox.n8n.json"
COMPOSE_SRC = INFRA / "n8n" / "docker-compose.yml"


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 180) -> tuple[int, str]:
    print("$", cmd[:160], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:2000])
    return code, out


def wait_n8n(client: paramiko.SSHClient, attempts: int = 24) -> bool:
    for i in range(attempts):
        code, out = run_ssh(
            client,
            f"curl -fsS -m 8 -o /dev/null -w '%{{http_code}}' {N8N_URL}/healthz 2>/dev/null || echo fail",
            timeout=20,
        )
        status = out.strip().splitlines()[-1] if out.strip() else "fail"
        print(f"n8n health attempt {i + 1}: {status}")
        if status == "200":
            return True
        time.sleep(5)
    return False


def build_workflow_payload(secret: str) -> list[dict]:
    raw = json.loads(WORKFLOW_SRC.read_text(encoding="utf-8"))
    inbound_url = f"{PUBLIC_URL}/api/email-inbound"
    for node in raw.get("nodes", []):
        if node.get("name") == "POST → Denizen /api/email-inbound":
            node["parameters"]["url"] = inbound_url
            for hp in node["parameters"].get("headerParameters", {}).get("parameters", []):
                if hp.get("name") == "X-Denizen-Secret":
                    hp["value"] = secret
        if node.get("type") == "n8n-nodes-base.gmailTrigger":
            node.pop("credentials", None)
    wf = {
        "name": raw.get("name", "Denizen — Gmail inbox to Lucy"),
        "nodes": raw["nodes"],
        "connections": raw["connections"],
        "settings": raw.get("settings", {"executionOrder": "v1"}),
        "active": False,
        "versionId": str(uuid.uuid4()),
        "meta": {"templateCredsSetupCompleted": False},
    }
    return [wf]


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    if not WORKFLOW_SRC.is_file() or not COMPOSE_SRC.is_file():
        print("Missing workflow or compose file", file=sys.stderr)
        return 1

    secret = os.environ.get("EMAIL_INBOUND_SECRET") or secrets.token_urlsafe(32)
    workflow_json = json.dumps(build_workflow_payload(secret), indent=2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        tar_path = tmp / "n8n-deploy.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            tar.add(COMPOSE_SRC, arcname="docker-compose.yml")
            wf_file = tmp / "lucy-inbox.workflow.json"
            wf_file.write_text(workflow_json, encoding="utf-8")
            tar.add(wf_file, arcname="lucy-inbox.workflow.json")

        remote_tar = f"{REMOTE_DIR}.tar.gz"
        run_ssh(client, f"mkdir -p '{REMOTE_DIR}'")
        stdin, stdout, _ = client.exec_command(f"cat > '{remote_tar}'", timeout=300)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()
        run_ssh(client, f"tar -xzf '{remote_tar}' -C '{REMOTE_DIR}'")

    # Stop broken Synology Container Manager n8n if present
    run_ssh(client, f"{DOCKER} stop n8nio-n8n-1-1-1 2>/dev/null || true")
    run_ssh(client, f"{DOCKER} rm n8nio-n8n-1-1-1 2>/dev/null || true")
    run_ssh(client, f"{DOCKER} stop denizen-n8n 2>/dev/null || true")
    run_ssh(client, f"{DOCKER} rm denizen-n8n 2>/dev/null || true")

    # Backup sqlite before image pin downgrade attempt
    run_ssh(
        client,
        f"cp -a /volume1/docker/n8n/database.sqlite /volume1/docker/n8n/database.sqlite.bak-$(date +%Y%m%d%H%M) 2>/dev/null || true",
    )

    code, _ = run_ssh(client, f"cd '{REMOTE_DIR}' && {DOCKER} compose up -d --force-recreate", timeout=300)
    if code != 0:
        print("ERROR: docker compose up failed", file=sys.stderr)
        client.close()
        return 1

    if not wait_n8n(client):
        run_ssh(client, f"{DOCKER} logs --tail 60 denizen-n8n 2>&1")
        print("ERROR: n8n did not become healthy", file=sys.stderr)
        client.close()
        return 1

    # Repair sqlite schema if an older n8n image left user.role missing
    sqlite_fix = (
        "import sqlite3; c=sqlite3.connect('/volume1/docker/n8n/database.sqlite'); "
        "cur=c.cursor(); cur.execute('PRAGMA table_info(user)'); "
        "cols=[r[1] for r in cur.fetchall()]; "
        "import sys; "
        "sys.stdout.write('user cols ok\\n' if 'role' in cols else 'adding role\\n'); "
        "('role' not in cols) and cur.execute(\"ALTER TABLE user ADD COLUMN role TEXT DEFAULT 'global:owner'\") and c.commit()"
    )
    run_ssh(client, f"python3 -c \"{sqlite_fix}\"")

    # Import workflow via CLI
    run_ssh(client, f"{DOCKER} cp '{REMOTE_DIR}/lucy-inbox.workflow.json' denizen-n8n:/tmp/lucy-inbox.workflow.json")
    run_ssh(
        client,
        f"{DOCKER} exec denizen-n8n n8n import:workflow --input=/tmp/lucy-inbox.workflow.json",
        timeout=120,
    )

    # Set EMAIL_INBOUND_SECRET on denizen-server
    env_path = f"{DENIZEN_SERVER_DIR}/.env"
    patch_py = f"""import pathlib,re
p=pathlib.Path({env_path!r})
text=p.read_text(encoding='utf-8') if p.exists() else ''
key='EMAIL_INBOUND_SECRET'
val={secret!r}
if re.search(r'^'+key+r'=', text, re.M):
    text=re.sub(r'^'+key+r'=.*$', key+'='+val, text, flags=re.M)
else:
    text=(text.rstrip()+'\\n'+key+'='+val+'\\n') if text else (key+'='+val+'\\n')
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(text, encoding='utf-8')
print('patched', p)
"""
    remote_patch = f"{REMOTE_DIR}/_patch_denizen_env.py"
    stdin, stdout, _ = client.exec_command(f"cat > '{remote_patch}'", timeout=60)
    stdin.write(patch_py.encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    run_ssh(client, f"python3 '{remote_patch}'")
    run_ssh(client, f"cd '{DENIZEN_SERVER_DIR}' && {DOCKER} compose up -d --force-recreate", timeout=300)
    run_ssh(client, f"sleep 15 && curl -fsS -m 20 http://127.0.0.1:{DENIZEN_PORT}/api/health | head -c 120")

    # List workflows
    run_ssh(client, f"{DOCKER} exec denizen-n8n n8n list:workflow 2>&1 | head -20")

    client.close()

    print("\n==> n8n Lucy workflow deploy complete")
    print(f"  n8n UI:        {N8N_URL}")
    print(f"  Denizen POST:  {PUBLIC_URL}/api/email-inbound")
    print(f"  Secret:        {secret}")
    print("  NEXT: Open n8n UI, open 'Denizen - Gmail inbox to Lucy', connect Gmail OAuth, Activate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
