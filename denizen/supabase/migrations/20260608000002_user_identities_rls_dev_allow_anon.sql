-- Denizen user identities RLS dev fix
-- Problem: denizen_user_identities has a deny-all policy, so resolveIdentityForSession
-- falls back to `session:<uuid>` identities. That breaks the compute job/node FK chain:
--   denizen_compute_nodes.identity_id -> denizen_user_identities(id)
--
-- For development/testing, allow anon to read/write denizen_user_identities so
-- upsertIdentity() can create real UUID-backed identities from session cookies.
--
-- Security note: permissive policy for dev only. Prefer service-role key or
-- proper auth-based policies in production.

drop policy if exists denizen_user_identities_anon_allow_all on public.denizen_user_identities;
create policy denizen_user_identities_anon_allow_all
  on public.denizen_user_identities
  for all
  to anon
  using (true)
  with check (true);

insert into public.denizen_schema_migrations (version, name)
values ('20260608000002', 'user_identities_rls_dev_allow_anon')
on conflict (version) do nothing;

