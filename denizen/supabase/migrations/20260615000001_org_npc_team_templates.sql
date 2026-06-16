-- Org-wide NPC team defaults (team tier). Identity members override per user.

create table if not exists public.denizen_org_npc_team_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  name text not null default 'Org NPC defaults',
  purpose text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

create table if not exists public.denizen_org_npc_team_members (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.denizen_org_npc_team_templates(id) on delete cascade,
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
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
  unique (org_id, npc_key)
);

create index if not exists denizen_org_npc_team_templates_org_idx
  on public.denizen_org_npc_team_templates (org_id);

create index if not exists denizen_org_npc_team_members_org_idx
  on public.denizen_org_npc_team_members (org_id, active, sort_order);

alter table public.denizen_org_npc_team_templates enable row level security;
alter table public.denizen_org_npc_team_members enable row level security;

drop policy if exists denizen_org_npc_team_templates_deny_all on public.denizen_org_npc_team_templates;
create policy denizen_org_npc_team_templates_deny_all on public.denizen_org_npc_team_templates
  for all using (false);

drop policy if exists denizen_org_npc_team_members_deny_all on public.denizen_org_npc_team_members;
create policy denizen_org_npc_team_members_deny_all on public.denizen_org_npc_team_members
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260615000001', 'org_npc_team_templates')
on conflict (version) do nothing;
