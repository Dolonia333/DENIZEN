-- Index Discord user ids for OAuth link lookups (Discord Spaces map)
create index if not exists denizen_user_identities_discord_user_id_idx
  on public.denizen_user_identities (discord_user_id)
  where discord_user_id is not null;

insert into public.denizen_schema_migrations (version, name)
values ('20260715000001', 'discord_user_id_index')
on conflict (version) do nothing;
