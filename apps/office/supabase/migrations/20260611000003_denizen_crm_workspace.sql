-- Org-scoped CRM workspace (Deal Weaver / Meridian bridge for Denizen teams)
create table if not exists public.denizen_crm_workspaces (
  org_id uuid primary key references public.denizen_organizations(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  updated_by uuid references public.denizen_user_identities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists denizen_crm_workspaces_updated_idx
  on public.denizen_crm_workspaces (updated_at desc);

comment on table public.denizen_crm_workspaces is
  'Per-organization CRM state synced from Denizen /crm (contacts, deals, tasks, etc.)';

alter table public.denizen_crm_workspaces enable row level security;

drop policy if exists denizen_crm_workspaces_deny_all on public.denizen_crm_workspaces;
create policy denizen_crm_workspaces_deny_all on public.denizen_crm_workspaces
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260611000003', 'denizen_crm_workspace')
on conflict (version) do nothing;
