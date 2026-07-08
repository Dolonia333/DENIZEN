-- Quests + achievements durability layer (optional ΓÇö in-memory
-- world-state.js is primary; see 20260707000001_npc_stats_and_office_progress.sql).

create table if not exists public.denizen_office_achievements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  achievement_id text not null,
  unlocked_at timestamptz not null default now(),
  unique (org_id, achievement_id)
);

comment on table public.denizen_office_achievements is
  'Unlocked office achievement badges. Definitions live in data/achievements.json.';

create table if not exists public.denizen_office_quests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  quest_id text not null,
  period_key text not null,
  count integer not null default 0,
  claimed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (org_id, quest_id, period_key)
);

create index if not exists denizen_office_quests_org_period_idx
  on public.denizen_office_quests (org_id, period_key);

comment on table public.denizen_office_quests is
  'Per-period quest progress + claim state. Definitions live in data/quests.json.';

alter table public.denizen_office_progress
  add column if not exists counts jsonb not null default '{}'::jsonb;

comment on column public.denizen_office_progress.counts is
  'All-time tallies per real outcome type (task_shipped/deal_won/ticket_closed) ΓÇö feeds achievements.';

alter table public.denizen_office_achievements enable row level security;
alter table public.denizen_office_quests enable row level security;

drop policy if exists denizen_office_achievements_deny_all on public.denizen_office_achievements;
create policy denizen_office_achievements_deny_all on public.denizen_office_achievements
  for all using (false);

drop policy if exists denizen_office_quests_deny_all on public.denizen_office_quests;
create policy denizen_office_quests_deny_all on public.denizen_office_quests
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260707000002', 'quests_achievements')
on conflict (version) do nothing;
