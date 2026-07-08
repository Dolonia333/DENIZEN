-- Denizen compute network foundation (Phase A-D)
-- Requires: 20260606000016_platform_user_identities.sql

create table if not exists public.denizen_node_profiles (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  hardware_score integer not null default 0 check (hardware_score >= 0),
  tier text not null default 'player'
    check (tier in ('player', 'contributor', 'super_node')),
  gpu_model text,
  vram_mb integer check (vram_mb is null or vram_mb >= 0),
  ram_mb integer check (ram_mb is null or ram_mb >= 0),
  cpu_cores integer check (cpu_cores is null or cpu_cores >= 0),
  opt_in boolean not null default false,
  contribution_level text not null default 'off'
    check (contribution_level in ('off', 'light', 'standard', 'max')),
  idle_only boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_id)
);

create index if not exists denizen_node_profiles_tier_idx
  on public.denizen_node_profiles (tier, hardware_score desc);

create table if not exists public.denizen_credits_ledger (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  reason text not null,
  job_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists denizen_credits_ledger_identity_created_idx
  on public.denizen_credits_ledger (identity_id, created_at desc);

create index if not exists denizen_credits_ledger_job_idx
  on public.denizen_credits_ledger (job_id)
  where job_id is not null;

create table if not exists public.denizen_compute_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'assigned', 'running', 'done', 'failed')),
  assigned_node_id uuid,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error text
);

create index if not exists denizen_compute_jobs_status_priority_idx
  on public.denizen_compute_jobs (status, priority desc, created_at asc);

create index if not exists denizen_compute_jobs_assigned_node_idx
  on public.denizen_compute_jobs (assigned_node_id, status);

create table if not exists public.denizen_compute_nodes (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  node_profile_id uuid not null references public.denizen_node_profiles(id) on delete cascade,
  status text not null default 'offline'
    check (status in ('online', 'offline', 'busy')),
  last_heartbeat timestamptz,
  jobs_completed integer not null default 0 check (jobs_completed >= 0),
  reputation_score integer not null default 0,
  endpoint_token_hash text not null unique
);

create index if not exists denizen_compute_nodes_status_heartbeat_idx
  on public.denizen_compute_nodes (status, last_heartbeat desc);

create index if not exists denizen_compute_nodes_identity_idx
  on public.denizen_compute_nodes (identity_id);

alter table public.denizen_compute_jobs
  add constraint denizen_compute_jobs_assigned_node_fkey
  foreign key (assigned_node_id) references public.denizen_compute_nodes(id) on delete set null;

alter table public.denizen_user_identities
  add column if not exists credits_balance integer default 0;

update public.denizen_user_identities
set credits_balance = 0
where credits_balance is null;

alter table public.denizen_user_identities
  alter column credits_balance set default 0;

alter table public.denizen_user_identities
  alter column credits_balance set not null;

alter table public.denizen_node_profiles enable row level security;
alter table public.denizen_credits_ledger enable row level security;
alter table public.denizen_compute_jobs enable row level security;
alter table public.denizen_compute_nodes enable row level security;

drop policy if exists denizen_node_profiles_deny_all on public.denizen_node_profiles;
create policy denizen_node_profiles_deny_all on public.denizen_node_profiles
  for all using (false);

drop policy if exists denizen_credits_ledger_deny_all on public.denizen_credits_ledger;
create policy denizen_credits_ledger_deny_all on public.denizen_credits_ledger
  for all using (false);

drop policy if exists denizen_compute_jobs_deny_all on public.denizen_compute_jobs;
create policy denizen_compute_jobs_deny_all on public.denizen_compute_jobs
  for all using (false);

drop policy if exists denizen_compute_nodes_deny_all on public.denizen_compute_nodes;
create policy denizen_compute_nodes_deny_all on public.denizen_compute_nodes
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000017', 'denizen_compute_network')
on conflict (version) do nothing;
