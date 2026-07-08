-- Persistent station task queue (survives server restart)
create table if not exists public.denizen_station_tasks (
  id text primary key,
  session_id uuid not null,
  install_id uuid not null,
  kind text not null,
  skill text,
  npc_name text,
  instruction text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  result jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

create index if not exists denizen_station_tasks_install_pending_idx
  on public.denizen_station_tasks (install_id, status)
  where status = 'pending';

create index if not exists denizen_station_tasks_created_idx
  on public.denizen_station_tasks (created_at desc);

insert into public.denizen_schema_migrations (version, name)
values ('20260614000001', 'denizen_station_tasks')
on conflict (version) do nothing;
