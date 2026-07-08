-- Denizen: per-visitor personal assistants (no login)
-- Requires: 20260606000000_denizen_foundation.sql

create table if not exists public.denizen_visitor_sessions (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default 'Guest',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.denizen_user_assistants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  npc_key text not null references public.denizen_npcs(npc_key),
  assistant_name text,
  focus text,
  role_overlay text,
  claimed_at timestamptz not null default now(),
  unique (session_id)
);

create table if not exists public.denizen_user_projects (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  name text not null,
  status text default 'active',
  priority text default 'medium',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.denizen_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  from_session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  to_session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  from_npc text not null,
  to_npc text not null,
  message text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_user_assistants_session_idx
  on public.denizen_user_assistants (session_id);
create index if not exists denizen_user_projects_session_idx
  on public.denizen_user_projects (session_id);
create index if not exists denizen_assistant_messages_to_idx
  on public.denizen_assistant_messages (to_session_id, created_at desc);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000001', 'denizen_visitor_assistants')
on conflict (version) do nothing;
