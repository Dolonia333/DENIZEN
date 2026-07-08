-- Identity NPC team templates: each team member owns a saved mini-company.
-- Requires: 20260606000016_platform_user_identities.sql

create table if not exists public.denizen_identity_npc_team_templates (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  org_id uuid references public.denizen_organizations(id) on delete set null,
  name text not null default 'My NPC team',
  purpose text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_id)
);

create table if not exists public.denizen_identity_npc_team_members (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.denizen_identity_npc_team_templates(id) on delete cascade,
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  npc_key text not null references public.denizen_npcs(npc_key),
  display_name text,
  role text not null default 'assistant',
  focus text,
  instructions text,
  sort_order integer not null default 0,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_id, npc_key)
);

create index if not exists denizen_identity_npc_team_templates_identity_idx
  on public.denizen_identity_npc_team_templates (identity_id);

create index if not exists denizen_identity_npc_team_members_template_idx
  on public.denizen_identity_npc_team_members (template_id, sort_order, created_at);

create index if not exists denizen_identity_npc_team_members_identity_idx
  on public.denizen_identity_npc_team_members (identity_id, active);

alter table public.denizen_identity_npc_team_templates enable row level security;
alter table public.denizen_identity_npc_team_members enable row level security;

drop policy if exists denizen_identity_npc_team_templates_deny_all on public.denizen_identity_npc_team_templates;
create policy denizen_identity_npc_team_templates_deny_all on public.denizen_identity_npc_team_templates
  for all using (false);

drop policy if exists denizen_identity_npc_team_members_deny_all on public.denizen_identity_npc_team_members;
create policy denizen_identity_npc_team_members_deny_all on public.denizen_identity_npc_team_members
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260610000004', 'identity_npc_team_templates')
on conflict (version) do nothing;
