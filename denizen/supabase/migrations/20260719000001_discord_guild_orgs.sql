-- Link Discord guilds to Denizen orgs for Spaces map team-code gating.
-- Owner binds via bot `,teamlink <teamCode>`; members unlock map with that code.

create table if not exists public.denizen_discord_guild_orgs (
  guild_id text not null primary key,
  org_id uuid not null references public.denizen_organizations (id) on delete cascade,
  created_by_discord_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists denizen_discord_guild_orgs_org_idx
  on public.denizen_discord_guild_orgs (org_id);

alter table public.denizen_discord_guild_orgs enable row level security;

insert into public.denizen_schema_migrations (version, name)
values ('20260719000001', 'discord_guild_orgs')
on conflict (version) do nothing;
