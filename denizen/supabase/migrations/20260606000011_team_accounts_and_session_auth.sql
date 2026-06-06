-- Team accounts (website signup / email login) + session token hash on visitor sessions

alter table public.denizen_visitor_sessions
  add column if not exists session_token_hash text;

create table if not exists public.denizen_team_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  email text not null,
  display_name text not null,
  visitor_session_id uuid references public.denizen_visitor_sessions(id) on delete set null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (org_id, email)
);

create index if not exists denizen_team_accounts_email_idx
  on public.denizen_team_accounts (email);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000011', 'team_accounts_and_session_auth')
on conflict (version) do nothing;
