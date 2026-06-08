-- Desktop agent link: machine capabilities + setup wizard state
-- Requires: 20260606000017_denizen_compute_network.sql

alter table public.denizen_node_profiles
  add column if not exists client_type text not null default 'browser'
    check (client_type in ('browser', 'desktop', 'host')),
  add column if not exists desktop_install_id uuid,
  add column if not exists desktop_linked_at timestamptz,
  add column if not exists setup_wizard_completed boolean not null default false,
  add column if not exists agent_permission_level text not null default 'off'
    check (agent_permission_level in ('off', 'ask', 'trusted')),
  add column if not exists desktop_capabilities jsonb not null default '{}'::jsonb,
  add column if not exists home_server_url text,
  add column if not exists last_capability_sync_at timestamptz;

create unique index if not exists denizen_node_profiles_desktop_install_idx
  on public.denizen_node_profiles (desktop_install_id)
  where desktop_install_id is not null;

create index if not exists denizen_node_profiles_client_type_idx
  on public.denizen_node_profiles (client_type, setup_wizard_completed);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000018', 'desktop_agent_link')
on conflict (version) do nothing;
