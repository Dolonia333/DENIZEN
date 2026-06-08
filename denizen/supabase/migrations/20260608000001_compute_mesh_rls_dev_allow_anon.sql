-- Denizen compute mesh RLS dev fix
-- Problem: denizen_compute_jobs / denizen_compute_nodes have deny-all policies,
-- which prevents the server (using SUPABASE_ANON_KEY / without service role)
-- from enqueueing and updating jobs.
--
-- For local/dev testing, allow `anon` to read/write those tables so the
-- public enqueue route can drive the proof:
--   enqueue -> node claim -> node complete -> jobs_completed increments
--
-- Security note: this is intentionally permissive for development.
-- In production, prefer service-role usage or proper auth-based policies.

-- Compute jobs: allow anon insert/select/update
drop policy if exists denizen_compute_jobs_anon_allow_all on public.denizen_compute_jobs;
create policy denizen_compute_jobs_anon_allow_all
  on public.denizen_compute_jobs
  for all
  to anon
  using (true)
  with check (true);

-- Compute nodes: allow anon insert/select/update (needed for jobs_completed updates)
drop policy if exists denizen_compute_nodes_anon_allow_all on public.denizen_compute_nodes;
create policy denizen_compute_nodes_anon_allow_all
  on public.denizen_compute_nodes
  for all
  to anon
  using (true)
  with check (true);

-- Node profiles: allow anon select/upsert from server-side code paths
drop policy if exists denizen_node_profiles_anon_allow_all on public.denizen_node_profiles;
create policy denizen_node_profiles_anon_allow_all
  on public.denizen_node_profiles
  for all
  to anon
  using (true)
  with check (true);

-- Credits ledger: allow anon insert/select/update (for award/spend flows)
drop policy if exists denizen_credits_ledger_anon_allow_all on public.denizen_credits_ledger;
create policy denizen_credits_ledger_anon_allow_all
  on public.denizen_credits_ledger
  for all
  to anon
  using (true)
  with check (true);

