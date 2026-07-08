-- Visible economy + office progression durability layer.
-- In-memory (world-state.js) is the primary source of truth for these
-- features ΓÇö this migration is an optional durability/multi-session
-- upgrade. Server code works with or without it (denizenDb.enabled gate).

create table if not exists public.denizen_npc_stats_daily (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  npc_key text not null references public.denizen_npcs(npc_key),
  stat_date date not null,
  shipped_count integer not null default 0,
  ok_count integer not null default 0,
  stuck_count integer not null default 0,
  blocked_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, npc_key, stat_date)
);

create index if not exists denizen_npc_stats_daily_org_date_idx
  on public.denizen_npc_stats_daily (org_id, stat_date desc);

comment on table public.denizen_npc_stats_daily is
  'Daily per-NPC outcome counts, feeding the leaderboard + streak calculation.';

create table if not exists public.denizen_office_progress (
  org_id uuid primary key references public.denizen_organizations(id) on delete cascade,
  total_xp bigint not null default 0,
  level integer not null default 1,
  updated_at timestamptz not null default now()
);

comment on table public.denizen_office_progress is
  'Single-row-per-org office XP/level, driven by real outcomes (tasks shipped, deals won, tickets closed).';

create table if not exists public.denizen_office_progress_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  event_type text not null,
  weight integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists denizen_office_progress_events_org_created_idx
  on public.denizen_office_progress_events (org_id, created_at desc);

comment on table public.denizen_office_progress_events is
  'Audit ledger of XP-awarding events, mirrors denizen_credits_ledger. Read by the weekly recap email.';

alter table public.denizen_npc_stats_daily enable row level security;
alter table public.denizen_office_progress enable row level security;
alter table public.denizen_office_progress_events enable row level security;

drop policy if exists denizen_npc_stats_daily_deny_all on public.denizen_npc_stats_daily;
create policy denizen_npc_stats_daily_deny_all on public.denizen_npc_stats_daily
  for all using (false);

drop policy if exists denizen_office_progress_deny_all on public.denizen_office_progress;
create policy denizen_office_progress_deny_all on public.denizen_office_progress
  for all using (false);

drop policy if exists denizen_office_progress_events_deny_all on public.denizen_office_progress_events;
create policy denizen_office_progress_events_deny_all on public.denizen_office_progress_events
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260707000001', 'npc_stats_and_office_progress')
on conflict (version) do nothing;
