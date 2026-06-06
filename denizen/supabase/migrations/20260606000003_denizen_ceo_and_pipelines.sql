-- Denizen: CEO profile, permissions, job CRM, research, email, task chains
-- Requires: 20260606000000_denizen_foundation.sql

create table if not exists public.denizen_ceo_profiles (
  id uuid primary key default gen_random_uuid(),
  user_key text not null unique default 'ceo',
  display_name text not null default 'CEO',
  communication_style text default 'direct',
  timezone text default 'local',
  preferences jsonb not null default '[]'::jsonb,
  autonomy_policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.denizen_ceo_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.denizen_ceo_profiles(id) on delete cascade,
  name text not null,
  status text default 'active',
  priority text default 'medium',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.denizen_permissions (
  id uuid primary key default gen_random_uuid(),
  npc_key text not null references public.denizen_npcs(npc_key),
  permission text not null,
  granted_by text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.denizen_job_applications (
  id text primary key,
  company text,
  role text,
  status text not null default 'new',
  score numeric,
  url text,
  site text,
  prep_path text,
  last_email_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.denizen_research_queue (
  id text primary key,
  topic text not null,
  priority text default 'normal',
  assigned_npc text references public.denizen_npcs(npc_key),
  status text not null default 'pending',
  result_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.denizen_research_sessions (
  id text primary key,
  topic text not null,
  npc_key text references public.denizen_npcs(npc_key),
  status text not null default 'active',
  brief_path text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.denizen_email_drafts (
  id text primary key,
  npc_key text references public.denizen_npcs(npc_key),
  to_addr text,
  subject text,
  body text,
  sent boolean not null default false,
  mode text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.denizen_task_chains (
  id text primary key,
  name text,
  triggered_by text,
  status text not null default 'running',
  current_step integer not null default 0,
  steps jsonb not null default '[]'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.denizen_security_threats (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  category text not null,
  severity text,
  source text,
  detail text,
  confronted text,
  countermeasure text,
  resolved boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.denizen_soul_proposals (
  id text primary key,
  npc_key text not null references public.denizen_npcs(npc_key),
  patch text,
  status text not null default 'pending',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.denizen_capability_proposals (
  id text primary key,
  npc_key text not null references public.denizen_npcs(npc_key),
  capability text,
  description text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000003', 'denizen_ceo_and_pipelines')
on conflict (version) do nothing;
