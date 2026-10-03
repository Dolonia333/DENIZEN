-- NEXEN Command Center org workspace (DENIZEN phone app at /nexen/)
create table if not exists public.denizen_nexen_workspaces (
  org_id text primary key,
  state jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  updated_by text,
  updated_at timestamptz not null default now()
);

create index if not exists denizen_nexen_workspaces_updated_at_idx
  on public.denizen_nexen_workspaces (updated_at desc);

comment on table public.denizen_nexen_workspaces is
  'Org-scoped NEXEN Command Center workspace (requests, tasks, activity).';

alter table public.denizen_nexen_workspaces enable row level security;

drop policy if exists denizen_nexen_workspaces_deny_all on public.denizen_nexen_workspaces;
create policy denizen_nexen_workspaces_deny_all on public.denizen_nexen_workspaces
  for all
  using (false)
  with check (false);
