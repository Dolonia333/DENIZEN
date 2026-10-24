#!/usr/bin/env python3
from __future__ import annotations

from hostcfg import get_host
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")


def run_psql(client: paramiko.SSHClient, sql: str) -> str:
    cmd = (
        f"{DOCKER} exec supabase-db psql -U postgres -d postgres "
        f"-t -A -F'|' -c \"{sql}\""
    )
    _, o, e = client.exec_command(cmd, timeout=30)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    sql = """
SELECT ui.username, ui.email, np.client_type, np.desktop_linked_at::text,
       np.setup_wizard_completed, np.opt_in, np.contribution_level,
       np.hardware_score, np.updated_at::text
FROM denizen_node_profiles np
JOIN denizen_user_identities ui ON ui.id = np.identity_id
WHERE ui.email ILIKE '%rilwanhollis1%' OR ui.username = 'k3yz'
ORDER BY np.updated_at DESC NULLS LAST
LIMIT 5
""".strip().replace("\n", " ")

    print("=== k3yz node profile ===")
    print(run_psql(client, sql) or "(none)")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
