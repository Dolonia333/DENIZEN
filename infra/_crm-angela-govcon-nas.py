#!/usr/bin/env python3
"""
Deploy CRM audit + switch Dolo/zion CRM to GovCon + promote Angela to admin.
"""
from __future__ import annotations
import json
import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

DENIZEN = INFRA.parent / "denizen"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
ZION_ORG = "be6080e8-638a-495a-b05d-2d90cd1b838f"
ANGELA_EMAIL = "vzion253@gmail.com"

FILES = [
    ("src/denizen-crm-audit-diff.js", "/app/src/denizen-crm-audit-diff.js"),
    ("src/denizen-crm-store.js", "/app/src/denizen-crm-store.js"),
    ("src/denizen-crm-routes.js", "/app/src/denizen-crm-routes.js"),
]


def run(c, cmd, timeout=180):
    print("$", cmd[:160], flush=True)
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:2000].encode("ascii", "replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    for rel, _ in FILES:
        if not (DENIZEN / rel).is_file():
            print("missing", DENIZEN / rel)
            return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "crm-angela.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel, _ in FILES:
                tar.add(DENIZEN / rel, arcname=rel)
        rt = f"{REMOTE}/crm-angela.tar.gz"
        ed = f"{REMOTE}/crm-angela"
        stdin, stdout, _ = c.exec_command(f"cat > '{rt}'", timeout=120)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()
        run(c, f"rm -rf '{ed}' && mkdir -p '{ed}' && tar -xzf '{rt}' -C '{ed}'")
        run(c, f"{DOCKER} exec denizen-server mkdir -p /app/src")
        for rel, dst in FILES:
            run(c, f"{DOCKER} cp '{ed}/{rel}' denizen-server:{dst}")

    run(c, f"{DOCKER} restart denizen-server", timeout=180)
    time.sleep(20)

    # Promote Angela to admin
    run(
        c,
        f"{DOCKER} exec supabase-db psql -U postgres -d postgres -c "
        f"\"update denizen_team_accounts set role='admin' "
        f"where org_id='{ZION_ORG}' and lower(email)=lower('{ANGELA_EMAIL}'); "
        f"select email, display_name, role from denizen_team_accounts "
        f"where org_id='{ZION_ORG}' and lower(email)=lower('{ANGELA_EMAIL}');\"",
    )

    # Apply govcon preset via node inside container
    js = r"""
const store = require('./src/denizen-crm-store');
const { applyGovconPreset } = require('./src/denizen-crm-audit-diff');
const ORG = process.env.ZION_ORG;
(async () => {
  const existing = await store.getWorkspace(ORG);
  const next = applyGovconPreset(existing?.state || {}, {
    user: 'System',
    email: null,
    role: 'system',
    source: 'nas_govcon_bootstrap',
  });
  const saved = await store.upsertWorkspace(ORG, next, null, {
    actor: { user: 'System', role: 'system', source: 'nas_govcon_bootstrap' },
    skipAudit: true,
  });
  console.log(JSON.stringify({
    ok: true,
    industry: next.industryConfig?.id,
    stages: next.industryConfig?.pipelineStages?.slice(0, 4),
    deals: Array.isArray(next.deals) ? next.deals.length : 0,
    audit: Array.isArray(next.auditLog) ? next.auditLog.length : 0,
    updated_at: saved?.updated_at,
  }));
})().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
"""
    # write js to remote and run
    remote_js = f"{REMOTE}/govcon-bootstrap.js"
    stdin, stdout, _ = c.exec_command(f"cat > '{remote_js}'", timeout=60)
    stdin.write(js.encode("utf-8"))
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    run(c, f"{DOCKER} cp '{remote_js}' denizen-server:/app/govcon-bootstrap.js")
    run(
        c,
        f"{DOCKER} exec -e ZION_ORG={ZION_ORG} denizen-server node /app/govcon-bootstrap.js",
        timeout=60,
    )

    run(c, f"curl -fsS -m 10 http://127.0.0.1:{PORT}/api/crm/health")

    # verify industry + angela role via sql
    run(
        c,
        f"{DOCKER} exec supabase-db psql -U postgres -d postgres -t -A -c "
        f"\"select state->'industryConfig'->>'id' from denizen_crm_workspaces where org_id='{ZION_ORG}';\"",
    )
    run(
        c,
        f"{DOCKER} exec supabase-db psql -U postgres -d postgres -c "
        f"\"select email, display_name, role from denizen_team_accounts where org_id='{ZION_ORG}' order by role, email;\"",
    )

    c.close()
    print("==> Angela admin + GovCon CRM live", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
