-- Contribution credit economy metadata (Phase 1-5)
-- Requires: 20260606000017_denizen_compute_network.sql

alter table public.denizen_credits_ledger
  add column if not exists formula_version integer,
  add column if not exists machine_id text;

create table if not exists public.denizen_contribution_daily_totals (
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  day date not null,
  job_credits integer not null default 0 check (job_credits >= 0),
  uptime_credits integer not null default 0 check (uptime_credits >= 0),
  host_stipend_credits integer not null default 0 check (host_stipend_credits >= 0),
  fleet_bonus_credits integer not null default 0 check (fleet_bonus_credits >= 0),
  total_credits integer not null default 0 check (total_credits >= 0),
  updated_at timestamptz not null default now(),
  primary key (identity_id, day)
);

alter table public.denizen_contribution_daily_totals enable row level security;

drop policy if exists denizen_contribution_daily_totals_deny_all on public.denizen_contribution_daily_totals;
create policy denizen_contribution_daily_totals_deny_all on public.denizen_contribution_daily_totals
  for all using (false) with check (false);
