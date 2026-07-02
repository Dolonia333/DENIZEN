#!/usr/bin/env python3
import load_infra_env  # noqa: F401
import json
import os
import urllib.request
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"


def ssh_cmd(client, cmd):
    _, o, e = client.exec_command(cmd)
    return (o.read() + e.read()).decode()


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    print("=== Denizen container env ===")
    for key in ("SUPABASE_URL", "DENIZEN_DB_ENABLED"):
        out = ssh_cmd(client, f"{DOCKER} exec denizen-server printenv {key} 2>/dev/null || echo '(unset)'")
        print(f"{key}={out.strip()}")

    print("\n=== denizen-server .env (redacted) ===")
    out = ssh_cmd(client, "cat /volume1/docker/denizen-server/.env 2>/dev/null | grep -E '^SUPABASE' || echo missing")
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            if "KEY" in k or "PASSWORD" in k:
                print(f"{k}=***")
            else:
                print(line)

    keys_out = ssh_cmd(client, "grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=' /volume1/docker/supabase-project/.env")
    keys = {}
    for line in keys_out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            keys[k.strip()] = v.strip()

    client.close()

    # Probe from NAS (LAN Kong) via SSH curl
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    srk = keys.get("SERVICE_ROLE_KEY", "")
    print("\n=== RPC probe via NAS LAN Kong ===")
    curl = (
        f"curl -s -w '\\nHTTP:%{{http_code}}' -X POST "
        f"'http://127.0.0.1:8000/rest/v1/rpc/denizen_resolve_mcp_token' "
        f"-H 'Content-Type: application/json' "
        f"-H 'apikey: {srk}' -H 'Authorization: Bearer {srk}' "
        f"-d '{{\"p_token\":\"{'x' * 20}\"}}'"
    )
    print(ssh_cmd(client, curl).strip())
    client.close()

    for label, base in [("Public", "https://supabase.dolonia.cloud")]:
        print(f"\n=== RPC probe via {label} ({base}) ===")
        for role, key in [("service_role", keys.get("SERVICE_ROLE_KEY")), ("anon", keys.get("ANON_KEY"))]:
            if not key:
                continue
            req = urllib.request.Request(
                f"{base}/rest/v1/rpc/denizen_resolve_mcp_token",
                data=json.dumps({"p_token": "x" * 20}).encode(),
                headers={"Content-Type": "application/json", "apikey": key, "Authorization": f"Bearer {key}"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    body = resp.read().decode()[:200]
                    print(f"  {role}: HTTP {resp.status} {body}")
            except Exception as exc:
                print(f"  {role}: {exc}")


if __name__ == "__main__":
    main()
