-- Denizen intelligence layer: multi-tenant spine + facts/outcomes/predictions
-- Requires: 20260606000000 through 20260606000003
--
-- Design goal: every meaningful action becomes durable data that can power
-- analytics today and prediction tomorrow — without duplicating business tables.

create extension if not exists "pgcrypto";

-- ── Multi-tenant root ────────────────────────────────────────────────────────

create table if not exists public.denizen_organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  plan text not null default 'internal',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.denizen_organizations (slug, display_name, plan, settings)
values (
  'zion',
  'Zion / Default Org',
  'internal',
  '{"is_default": true}'::jsonb
)
on conflict (slug) do nothing;

-- Maps humans (profiles), visitors, or API actors to an org
create table if not exists public.denizen_org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  member_type text not null check (member_type in ('profile', 'visitor_session', 'api_token', 'system')),
  member_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer', 'npc')),
  created_at timestamptz not null default now(),
  unique (org_id, member_type, member_id)
);

create index if not exists denizen_org_members_member_idx
  on public.denizen_org_members (member_type, member_id);

-- Scope existing denizen runtime tables to an org (nullable → backfill to default org)
alter table public.denizen_office_sessions
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.denizen_visitor_sessions
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.denizen_work_output
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.denizen_llm_events
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.denizen_office_events
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

-- ── Universal entity index (join key across website, RFP, office) ───────────

create table if not exists public.denizen_entity_registry (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  external_key text,
  title text,
  status text,
  summary jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (org_id, entity_type, entity_id)
);

create index if not exists denizen_entity_registry_type_status_idx
  on public.denizen_entity_registry (org_id, entity_type, status);
create index if not exists denizen_entity_registry_external_key_idx
  on public.denizen_entity_registry (org_id, external_key)
  where external_key is not null;

-- Links NPC/office actions to any business entity (rfp, intake_form, lead, …)
create table if not exists public.denizen_entity_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  source_type text not null,
  source_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  link_kind text not null default 'worked_on',
  npc_key text references public.denizen_npcs(npc_key),
  office_session_id uuid references public.denizen_office_sessions(id) on delete set null,
  work_output_id uuid references public.denizen_work_output(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists denizen_entity_links_entity_idx
  on public.denizen_entity_links (org_id, entity_type, entity_id, created_at desc);
create index if not exists denizen_entity_links_source_idx
  on public.denizen_entity_links (source_type, source_id);

-- ── Facts: immutable spine for analytics + future ML ─────────────────────────

create table if not exists public.denizen_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  fact_type text not null,
  actor_type text not null check (actor_type in ('npc', 'human', 'system', 'workflow', 'website', 'ingest')),
  actor_id text,
  entity_type text,
  entity_id uuid,
  entity_registry_id uuid references public.denizen_entity_registry(id) on delete set null,
  correlation_id uuid,
  causation_id uuid references public.denizen_facts(id) on delete set null,
  source_table text,
  source_id uuid,
  payload jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'
);

create index if not exists denizen_facts_org_occurred_idx
  on public.denizen_facts (org_id, occurred_at desc);
create index if not exists denizen_facts_type_entity_idx
  on public.denizen_facts (org_id, fact_type, entity_type, entity_id, occurred_at desc);
create index if not exists denizen_facts_correlation_idx
  on public.denizen_facts (correlation_id)
  where correlation_id is not null;
create index if not exists denizen_facts_tags_idx
  on public.denizen_facts using gin (tags);
create index if not exists denizen_facts_payload_idx
  on public.denizen_facts using gin (payload);

-- ── Outcomes: what actually happened (labels for supervised learning) ───────

create table if not exists public.denizen_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  observed_at timestamptz not null default now(),
  outcome_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  caused_by_fact_id uuid references public.denizen_facts(id) on delete set null,
  horizon text,
  value_numeric numeric,
  value_text text,
  value_json jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_outcomes_entity_idx
  on public.denizen_outcomes (org_id, entity_type, entity_id, observed_at desc);
create index if not exists denizen_outcomes_type_idx
  on public.denizen_outcomes (org_id, outcome_type, observed_at desc);

-- ── Predictions: store forecasts, validate later ─────────────────────────────

create table if not exists public.denizen_predictions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  model_key text not null default 'heuristic_v0',
  model_version text not null default '0.1.0',
  prediction_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  horizon text,
  prediction jsonb not null,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  input_fact_ids uuid[],
  validated_at timestamptz,
  actual_outcome_id uuid references public.denizen_outcomes(id) on delete set null,
  accuracy_score numeric,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_predictions_entity_idx
  on public.denizen_predictions (org_id, entity_type, entity_id, created_at desc);
create index if not exists denizen_predictions_type_idx
  on public.denizen_predictions (org_id, prediction_type, created_at desc);
create index if not exists denizen_predictions_unvalidated_idx
  on public.denizen_predictions (org_id, prediction_type)
  where validated_at is null;

-- ── Snapshots: periodic state for time-series features ────────────────────────

create table if not exists public.denizen_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  entity_type text not null,
  entity_id uuid not null,
  snapshot_kind text not null default 'state',
  state jsonb not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_snapshots_entity_at_idx
  on public.denizen_snapshots (org_id, entity_type, entity_id, snapshot_at desc);

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.denizen_default_org_id()
returns uuid
language sql
stable
as $$
  select id from public.denizen_organizations where slug = 'zion' limit 1;
$$;

create or replace function public.denizen_upsert_entity(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_external_key text default null,
  p_title text default null,
  p_status text default null,
  p_summary jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.denizen_entity_registry (
    org_id, entity_type, entity_id, external_key, title, status, summary, last_seen_at
  )
  values (
    p_org_id, p_entity_type, p_entity_id, p_external_key, p_title, p_status, p_summary, now()
  )
  on conflict (org_id, entity_type, entity_id) do update set
    external_key = coalesce(excluded.external_key, denizen_entity_registry.external_key),
    title = coalesce(excluded.title, denizen_entity_registry.title),
    status = coalesce(excluded.status, denizen_entity_registry.status),
    summary = denizen_entity_registry.summary || excluded.summary,
    last_seen_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.denizen_record_fact(
  p_org_id uuid,
  p_fact_type text,
  p_actor_type text,
  p_actor_id text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_correlation_id uuid default null,
  p_causation_id uuid default null,
  p_source_table text default null,
  p_source_id uuid default null,
  p_tags text[] default '{}'
)
returns uuid
language plpgsql
as $$
declare
  v_fact_id uuid;
  v_registry_id uuid;
begin
  if p_entity_type is not null and p_entity_id is not null then
    v_registry_id := public.denizen_upsert_entity(
      p_org_id, p_entity_type, p_entity_id,
      p_payload->>'external_key',
      p_payload->>'title',
      p_payload->>'status',
      coalesce(p_payload->'summary', '{}'::jsonb)
    );
  end if;

  insert into public.denizen_facts (
    org_id, fact_type, actor_type, actor_id,
    entity_type, entity_id, entity_registry_id,
    correlation_id, causation_id,
    source_table, source_id, payload, tags
  )
  values (
    p_org_id, p_fact_type, p_actor_type, p_actor_id,
    p_entity_type, p_entity_id, v_registry_id,
    p_correlation_id, p_causation_id,
    p_source_table, p_source_id, p_payload, p_tags
  )
  returning id into v_fact_id;

  return v_fact_id;
end;
$$;

-- Unified timeline view for dashboards + future feature engineering
create or replace view public.denizen_unified_timeline as
select
  f.id,
  f.org_id,
  f.occurred_at as at,
  'fact'::text as row_kind,
  f.fact_type as event_type,
  f.actor_type,
  f.actor_id,
  f.entity_type,
  f.entity_id,
  f.payload,
  f.tags
from public.denizen_facts f
union all
select
  o.id,
  o.org_id,
  o.observed_at as at,
  'outcome'::text as row_kind,
  o.outcome_type as event_type,
  'system'::text as actor_type,
  null::text as actor_id,
  o.entity_type,
  o.entity_id,
  o.value_json as payload,
  array[]::text[] as tags
from public.denizen_outcomes o;

insert into public.denizen_schema_migrations (version, name)
values ('20260606000004', 'denizen_intelligence_layer')
on conflict (version) do nothing;
