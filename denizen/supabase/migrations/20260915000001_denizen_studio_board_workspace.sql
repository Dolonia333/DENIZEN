-- Org-scoped Studio Board workspace (agency tracker shared across team + MCP)
create table if not exists public.denizen_studio_board_workspaces (
  org_id uuid primary key references public.denizen_organizations(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  updated_by uuid references public.denizen_user_identities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists denizen_studio_board_workspaces_updated_idx
  on public.denizen_studio_board_workspaces (updated_at desc);

comment on table public.denizen_studio_board_workspaces is
  'Per-organization Studio Board state (tasks, people, events, notes, pipeline config)';

alter table public.denizen_studio_board_workspaces enable row level security;

drop policy if exists denizen_studio_board_workspaces_deny_all on public.denizen_studio_board_workspaces;
create policy denizen_studio_board_workspaces_deny_all on public.denizen_studio_board_workspaces
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260915000001', 'denizen_studio_board_workspace')
on conflict (version) do nothing;
