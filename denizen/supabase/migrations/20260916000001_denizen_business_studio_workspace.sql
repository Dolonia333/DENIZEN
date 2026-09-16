-- Business Studio org workspace (JSON state blob; mirrors studio board pattern)
create table if not exists public.denizen_business_studio_workspaces (
  org_id text primary key,
  state jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists denizen_business_studio_workspaces_updated_at_idx
  on public.denizen_business_studio_workspaces (updated_at desc);

comment on table public.denizen_business_studio_workspaces is
  'Founder OS / Business Studio workspace state per organization';
