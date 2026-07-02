#!/usr/bin/env python3
"""Add rchrisbyers (cb@vibecore.cx) to zion — copies password from vibecore-vaww account."""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

NODE_SCRIPT = r"""
const denizenDb = require('./src/denizen-db.js');

const EMAIL = 'cb@vibecore.cx';
const USERNAME = 'rchrisbyers';
const SOURCE_ORG = 'vibecore-vaww';
const TARGET_ORG = 'zion';

async function main() {
  if (!denizenDb.enabled) throw new Error('DB disabled');

  const zion = (await denizenDb._get(
    `denizen_organizations?select=id,slug&slug=eq.${encodeURIComponent(TARGET_ORG)}&limit=1`,
  ))?.[0];
  if (!zion?.id) throw new Error('zion org not found');

  const sourceOrg = (await denizenDb._get(
    `denizen_organizations?select=id&slug=eq.${encodeURIComponent(SOURCE_ORG)}&limit=1`,
  ))?.[0];
  if (!sourceOrg?.id) throw new Error('source org not found');

  const srcRows = await denizenDb._get(
    `denizen_team_accounts?select=email,display_name,username,password_hash,role`
    + `&email=eq.${encodeURIComponent(EMAIL)}`
    + `&org_id=eq.${encodeURIComponent(sourceOrg.id)}`
    + '&limit=1',
  );
  const src = srcRows?.[0];
  if (!src?.password_hash) throw new Error('Source account or password not found');

  const existing = await denizenDb._get(
    `denizen_team_accounts?select=id,username,email,role`
    + `&org_id=eq.${encodeURIComponent(zion.id)}`
    + `&email=eq.${encodeURIComponent(EMAIL)}`
    + '&limit=1',
  );
  if (existing?.[0]) {
    console.log(JSON.stringify({ ok: true, action: 'already_exists', account: existing[0] }));
    return;
  }

  const byUser = await denizenDb._get(
    `denizen_team_accounts?select=id&org_id=eq.${encodeURIComponent(zion.id)}`
    + `&username=eq.${encodeURIComponent(src.username || USERNAME)}`
    + '&limit=1',
  );
  if (byUser?.[0]) throw new Error('Username already taken on zion');

  const rows = await denizenDb._post(
    'denizen_team_accounts',
    {
      org_id: zion.id,
      email: src.email || EMAIL,
      display_name: src.display_name || USERNAME,
      username: src.username || USERNAME,
      password_hash: src.password_hash,
      role: 'member',
    },
    { prefer: 'return=representation' },
  );
  const account = rows?.[0];
  if (!account?.id) throw new Error('Insert failed');

  console.log(JSON.stringify({
    ok: true,
    action: 'created',
    username: account.username,
    email: account.email,
    role: account.role,
    org_slug: TARGET_ORG,
  }));
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
""".strip()


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD not set")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    b64 = base64.b64encode(NODE_SCRIPT.encode("utf-8")).decode("ascii")
    cmd = (
        f"echo {b64} | base64 -d | {DOCKER} exec -i denizen-server node"
    )
    _, o, e = client.exec_command(cmd, timeout=120)
    out = (o.read() + e.read()).decode("utf-8", errors="replace").strip()
    client.close()

    print(out)
    if '"ok":true' not in out.replace(" ", ""):
        return 1

    print("\nChris can log in at https://denizen.dolonia.cloud/")
    print("  Login - username: rchrisbyers")
    print("  Team code: 1921")
    print("  Email: cb@vibecore.cx")
    print("  Password: same as when he signed up")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
