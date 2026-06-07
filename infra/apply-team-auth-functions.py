import os
import paramiko

SQL = r"""
create or replace function public.denizen_auth_user_org_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select distinct ta.org_id
  from public.denizen_team_accounts ta
  where lower(ta.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  union
  select o.id from public.denizen_organizations o;
$$;

create or replace function public.denizen_user_can_access_org(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_org_id is null
      or p_org_id in (select public.denizen_auth_user_org_ids());
$$;
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "192.168.1.237",
    username="admin",
    password=os.environ["SYNO_SSH_PASSWORD"],
    look_for_keys=False,
    allow_agent=False,
)
DOCKER = "/usr/local/bin/docker"
_, o, _ = c.exec_command(
    "grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1"
)
pg_pass = o.read().decode().strip().split("=", 1)[-1]
heredoc = f"""cat <<'EOSQL' | {DOCKER} exec -i -e PGPASSWORD='{pg_pass}' supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres
{SQL}
EOSQL"""
print("$ team auth functions")
_, o, e = c.exec_command(heredoc)
print(o.read().decode())
err = e.read().decode()
if err.strip():
    print(err)
c.close()
