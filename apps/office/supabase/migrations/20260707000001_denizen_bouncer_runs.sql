-- Denizen: bouncer run persistence + threat org linkage
-- Requires: 20260606000003_denizen_ceo_and_pipelines.sql

alter table if exists public.denizen_security_threats
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete cascade;

create table if not exists public.denizen_bouncer_runs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  threat_category text not null,
  source text,
  ok boolean not null default false,
  report_path text,
  patrol_mode text,
  node_id text,
  elapsed_ms integer,
  verdict text,
  metadata jsonb not null default '{}'::jsonb
);

insert into public.denizen_schema_migrations (version, name)
values ('20260707000001', 'denizen_bouncer_runs')
on conflict (version) do nothing;
