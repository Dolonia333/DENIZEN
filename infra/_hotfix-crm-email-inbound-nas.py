#!/usr/bin/env python3
"""Hotfix Gmail→CRM inbound + restart denizen-server."""
from __future__ import annotations
import os, sys, tarfile, tempfile, time
from pathlib import Path
INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa
import paramiko

DENIZEN = INFRA.parent / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

FILES = [
    ("src/gmail-client.js", "/app/src/gmail-client.js"),
    ("src/denizen-crm-email-inbound.js", "/app/src/denizen-crm-email-inbound.js"),
    ("src/denizen-crm-routes.js", "/app/src/denizen-crm-routes.js"),
    ("src/denizen-crm-scheduler.js", "/app/src/denizen-crm-scheduler.js"),
    ("docs/EMAIL_INTEGRATION.md", "/app/docs/EMAIL_INTEGRATION.md"),
]

def run(c, cmd, timeout=180):
    print("$", cmd[:160], flush=True)
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:2000].encode("ascii", "replace").decode("ascii"))
    return o.channel.recv_exit_status()

def main():
    if not PWD:
        print("need password", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)
    with tempfile.TemporaryDirectory() as tmp:
        tp = Path(tmp) / "t.tar.gz"
        with tarfile.open(tp, "w:gz") as t:
            for rel, _ in FILES:
                t.add(DENIZEN / rel, arcname=rel)
        rt = f"{REMOTE}/crm-email-in.tar.gz"
        ed = f"{REMOTE}/crm-email-in"
        stdin, stdout, _ = c.exec_command(f"cat > '{rt}'", timeout=120)
        stdin.write(tp.read_bytes()); stdin.flush(); stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()
        run(c, f"rm -rf '{ed}' && mkdir -p '{ed}' && tar -xzf '{rt}' -C '{ed}'")
        run(c, f"{DOCKER} exec denizen-server mkdir -p /app/src /app/docs")
        for rel, dst in FILES:
            run(c, f"{DOCKER} cp '{ed}/{rel}' denizen-server:{dst}")
    # ensure env defaults on production if missing
    run(c, f"""grep -q GMAIL_INBOUND '{REMOTE}/.env.production' 2>/dev/null || echo '
# Gmail CRM inbound (Angela)
GMAIL_INBOUND=1
GMAIL_INBOUND_FROM=vzion253@gmail.com,angelavanzandt1921@gmail.com
GMAIL_INBOUND_ORG_SLUG=zion
' >> '{REMOTE}/.env.production'""")
    run(c, f"{DOCKER} restart denizen-server", timeout=180)
    time.sleep(18)
    run(c, f"curl -fsS -m 12 http://127.0.0.1:{PORT}/api/crm/email-inbound/status")
    run(c, f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/crm/health | head -c 500")
    # inject test without gmail
    run(c, f"""{DOCKER} exec denizen-server node -e "
const i=require('./src/denizen-crm-email-inbound');
console.log(JSON.stringify(i.getInboundStatus()));
" """)
    c.close()
    print("==> CRM email inbound live")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
