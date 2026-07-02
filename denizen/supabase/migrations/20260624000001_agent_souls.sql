-- Per-org SOUL + MEMORY content (multi-user office foundation)
-- Requires: denizen_organizations, denizen_npcs

create table if not exists public.agent_souls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  npc_key text not null references public.denizen_npcs(npc_key) on delete cascade,
  display_name text,
  soul_content text not null default '',
  memory_content text not null default '',
  template_pack text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, npc_key)
);

create index if not exists agent_souls_org_idx on public.agent_souls (org_id);
create index if not exists agent_souls_template_idx on public.agent_souls (org_id, template_pack);

alter table public.agent_souls enable row level security;

drop policy if exists agent_souls_deny_all on public.agent_souls;
create policy agent_souls_deny_all on public.agent_souls for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260624000001', 'agent_souls')
on conflict (version) do nothing;
