-- Demo users can secure their profile with username + password on denizen_user_identities

alter table public.denizen_user_identities
  add column if not exists username text,
  add column if not exists password_hash text;

create unique index if not exists denizen_user_identities_username_idx
  on public.denizen_user_identities (lower(username))
  where username is not null;

insert into public.denizen_schema_migrations (version, name)
values ('20260613000002', 'demo_identity_credentials')
on conflict (version) do nothing;
