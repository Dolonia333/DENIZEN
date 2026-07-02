#!/usr/bin/env python3
"""Hotfix denizen_resolve_mcp_token search_path for Supabase extensions schema."""
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"

HOTFIX_SQL = r"""
create or replace function public.denizen_resolve_mcp_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  r record;
  v_protected boolean;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

  select t.id, t.org_id, t.npc_key, t.member_id, t.session_id, t.label,
         o.slug as org_slug, o.settings->>'tier' as org_tier
  into r
  from public.denizen_mcp_tokens t
  join public.denizen_organizations o on o.id = t.org_id
  where t.token_hash = v_hash
    and t.revoked_at is null
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if coalesce(r.org_tier, '') = 'demo' then
    return jsonb_build_object('ok', false, 'error', 'demo_org_blocked');
  end if;

  select protected into v_protected
  from public.denizen_npcs
  where npc_key = r.npc_key;

  if coalesce(v_protected, false) then
    return jsonb_build_object('ok', false, 'error', 'npc_protected');
  end if;

  update public.denizen_mcp_tokens
  set last_used_at = now()
  where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'token_id', r.id,
    'org_id', r.org_id,
    'org_slug', r.org_slug,
    'npc_key', r.npc_key,
    'member_id', r.member_id,
    'session_id', r.session_id,
    'label', r.label
  );
end;
$$;
"""


def run(client, cmd):
    print("$", cmd[:100], flush=True)
    _, o, e = client.exec_command(cmd, timeout=120)
    out = (o.read() + e.read()).decode()
    if out.strip():
        print(out.rstrip())
    return o.channel.recv_exit_status(), out


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command("grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg_pass = o.read().decode().strip().split("=", 1)[-1]

    local_sql = os.path.join(os.path.dirname(__file__), "_hotfix_mcp_rpc.sql")
    with open(local_sql, "w", encoding="utf-8") as fh:
        fh.write(HOTFIX_SQL.strip() + "\n")

    import base64
    b64 = base64.b64encode(HOTFIX_SQL.strip().encode()).decode()
    code, _ = run(
        client,
        (
            f"printf '%s' '{b64}' | base64 -d | "
            f"{DOCKER} exec -i -e PGPASSWORD='{pg_pass}' supabase-db "
            f"psql -v ON_ERROR_STOP=1 -U postgres -d postgres"
        ),
    )
    if code != 0:
        client.close()
        return code

    _, o, _ = client.exec_command("grep '^SERVICE_ROLE_KEY=' /volume1/docker/supabase-project/.env | head -1")
    srk = o.read().decode().strip().split("=", 1)[-1]
    curl = (
        f"curl -s -w '\\nHTTP:%{{http_code}}' -X POST "
        f"'http://127.0.0.1:8000/rest/v1/rpc/denizen_resolve_mcp_token' "
        f"-H 'Content-Type: application/json' "
        f"-H 'apikey: {srk}' -H 'Authorization: Bearer {srk}' "
        f"-d '{{\"p_token\":\"{'x' * 20}\"}}'"
    )
    _, out = run(client, curl)
    client.close()
    return 0 if "not_found" in out or '"ok":true' in out.replace(" ", "") else 1


if __name__ == "__main__":
    raise SystemExit(main())
