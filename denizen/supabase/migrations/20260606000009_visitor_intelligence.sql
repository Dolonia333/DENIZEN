-- Visitor intelligence: deep memory, commitments, briefings, recurring tasks, proactive events
-- Requires: 20260606000001_denizen_visitor_assistants.sql

create table if not exists public.denizen_visitor_profiles (
  session_id uuid primary key references public.denizen_visitor_sessions(id) on delete cascade,
  preferences jsonb not null default '[]'::jsonb,
  vips jsonb not null default '[]'::jsonb,
  writing_style text,
  long_horizon text,
  slack_webhook_url text,
  slack_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.denizen_visitor_commitments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  npc_key text,
  text text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  source text default 'chat',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists denizen_visitor_commitments_session_status_idx
  on public.denizen_visitor_commitments (session_id, status, created_at desc);

create table if not exists public.denizen_visitor_briefings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  briefing_date date not null,
  content jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, briefing_date)
);

create table if not exists public.denizen_visitor_recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  npc_key text,
  label text not null,
  prompt text not null,
  schedule jsonb not null default '{"day_of_week":1,"hour":8}'::jsonb,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists denizen_visitor_recurring_tasks_session_idx
  on public.denizen_visitor_recurring_tasks (session_id, enabled);

create table if not exists public.denizen_visitor_proactive_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.denizen_visitor_sessions(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists denizen_visitor_proactive_events_session_status_idx
  on public.denizen_visitor_proactive_events (session_id, status, created_at desc);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000009', 'visitor_intelligence')
on conflict (version) do nothing;
