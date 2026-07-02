-- Production tighten: remove permissive anon policies on compute mesh tables.
-- The Denizen server uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
-- Fleet/desktop workers use POST /api/compute/node/* — not direct PostgREST anon writes.
--
-- Re-apply dev policies locally only if needed (20260608000001).

drop policy if exists denizen_compute_jobs_anon_allow_all on public.denizen_compute_jobs;
drop policy if exists denizen_compute_nodes_anon_allow_all on public.denizen_compute_nodes;
drop policy if exists denizen_node_profiles_anon_allow_all on public.denizen_node_profiles;
drop policy if exists denizen_credits_ledger_anon_allow_all on public.denizen_credits_ledger;

insert into public.denizen_schema_migrations (version, name)
values ('20260622000002', 'compute_mesh_rls_production_tighten')
on conflict (version) do nothing;
