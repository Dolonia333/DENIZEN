-- Denizen compute mesh production RLS guidance
--
-- The Denizen server should use SUPABASE_SERVICE_ROLE_KEY for PostgREST access
-- (see src/denizen-db.js). Supabase's `service_role` has BYPASSRLS, so no extra
-- policies are required for server-side compute queue operations.
--
-- Migrations 20260608000001 and 20260608000002 keep permissive `anon` policies on
-- compute tables and denizen_user_identities for local dev and fleet agents
-- (NAS/desktop workers) that call mesh APIs with the anon key.
--
-- Production hardening: set SUPABASE_SERVICE_ROLE_KEY on the server; restrict
-- DENIZEN_INTERNAL_API_TOKEN on POST /api/compute/jobs/enqueue; leave anon
-- policies in place only if fleet agents need direct PostgREST access.

insert into public.denizen_schema_migrations (version, name)
values ('20260608000003', 'compute_mesh_service_role_production')
on conflict (version) do nothing;
