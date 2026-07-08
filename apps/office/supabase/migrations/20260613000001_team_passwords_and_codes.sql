-- Team accounts: username + password; org-specific invite codes in settings.team_code

alter table public.denizen_team_accounts
  add column if not exists username text,
  add column if not exists password_hash text;

create unique index if not exists denizen_team_accounts_org_username_idx
  on public.denizen_team_accounts (org_id, lower(username))
  where username is not null;

insert into public.denizen_schema_migrations (version, name)
values ('20260613000001', 'team_passwords_and_codes')
on conflict (version) do nothing;
