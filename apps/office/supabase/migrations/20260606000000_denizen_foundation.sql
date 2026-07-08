-- Denizen foundation: extensions + migration tracker + office session id
-- Apply first. Safe to re-run (idempotent).

create extension if not exists "pgcrypto";

create table if not exists public.denizen_schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000000', 'denizen_foundation')
on conflict (version) do nothing;

-- One row per Denizen server boot — Pier's restart_id / idempotency anchor
create table if not exists public.denizen_office_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  hostname text,
  denizen_version text,
  metadata jsonb not null default '{}'::jsonb
);

-- Canonical NPC roster mirror (SOUL.md stays on disk; this is for FK + protected flags)
create table if not exists public.denizen_npcs (
  npc_key text primary key,
  display_name text not null,
  role text,
  folder text,
  protected boolean not null default false,
  claimable boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.denizen_npcs (npc_key, display_name, role, folder, protected, claimable) values
  ('abby', 'Abby', 'CTO', 'abby', true, false),
  ('alex', 'Alex', 'Developer', 'alex', false, true),
  ('bob', 'Bob', 'Researcher', 'bob', false, true),
  ('jenny', 'Jenny', 'Developer', 'jenny', false, true),
  ('dan', 'Dan', 'IT Support', 'dan', false, true),
  ('lucy', 'Lucy', 'Receptionist', 'lucy', true, false),
  ('bouncer', 'Bouncer', 'Security Guard', 'bouncer', true, false),
  ('marcus', 'Marcus', 'Project Manager', 'conference_man', false, true),
  ('sarah', 'Sarah', 'Product Manager', 'conference_woman', false, true),
  ('edward', 'Edward', 'Backend Developer', 'edward', false, true),
  ('josh', 'Josh', 'Frontend Developer', 'josh', false, true),
  ('molly', 'Molly', 'QA Engineer', 'molly', false, true),
  ('oscar', 'Oscar', 'DevOps Engineer', 'oscar', false, true),
  ('pier', 'Pier', 'Data Engineer', 'pier', false, true),
  ('rob', 'Rob', 'UI/UX Designer', 'rob', false, true),
  ('roki', 'Roki', 'Intern', 'roki', false, true)
on conflict (npc_key) do nothing;
