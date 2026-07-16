-- One Denizen identity per linked Discord account
create unique index if not exists denizen_user_identities_discord_user_id_idx
  on public.denizen_user_identities (discord_user_id)
  where discord_user_id is not null;
