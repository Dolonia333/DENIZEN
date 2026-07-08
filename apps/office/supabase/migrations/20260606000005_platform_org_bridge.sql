-- Platform bridge: scope existing website/RFP tables to organizations
-- Requires: 20260606000004_denizen_intelligence_layer.sql
--
-- Additive only: nullable org_id + default org. Existing website keeps working.

alter table public.intake_forms
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.leads
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.clients
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.projects
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.rfps
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.workflow_runs
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

alter table public.tickets
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

-- Backfill existing rows to default org
update public.intake_forms set org_id = public.denizen_default_org_id() where org_id is null;
update public.leads set org_id = public.denizen_default_org_id() where org_id is null;
update public.clients set org_id = public.denizen_default_org_id() where org_id is null;
update public.projects set org_id = public.denizen_default_org_id() where org_id is null;
update public.rfps set org_id = public.denizen_default_org_id() where org_id is null;
update public.workflow_runs set org_id = public.denizen_default_org_id() where org_id is null;
update public.tickets set org_id = public.denizen_default_org_id() where org_id is null;

-- Seed entity registry from existing business data (idempotent)
insert into public.denizen_entity_registry (org_id, entity_type, entity_id, external_key, title, status, summary)
select
  coalesce(r.org_id, public.denizen_default_org_id()),
  'rfp',
  r.id,
  r.solicitation_number,
  r.title,
  r.status,
  jsonb_build_object(
    'agency', r.agency,
    'bid_decision', r.bid_decision,
    'source_type', r.source_type,
    'proposal_due_date', r.proposal_due_date
  )
from public.rfps r
on conflict (org_id, entity_type, entity_id) do update set
  external_key = excluded.external_key,
  title = excluded.title,
  status = excluded.status,
  summary = excluded.summary,
  last_seen_at = now();

insert into public.denizen_entity_registry (org_id, entity_type, entity_id, external_key, title, status, summary)
select
  coalesce(i.org_id, public.denizen_default_org_id()),
  'intake_form',
  i.id,
  i.email,
  coalesce(i.company_name, i.full_name),
  i.status,
  jsonb_build_object(
    'service_category', i.service_category,
    'budget_range', i.budget_range,
    'priority_score', i.priority_score,
    'recommended_tier', i.recommended_tier
  )
from public.intake_forms i
on conflict (org_id, entity_type, entity_id) do update set
  external_key = excluded.external_key,
  title = excluded.title,
  status = excluded.status,
  summary = excluded.summary,
  last_seen_at = now();

insert into public.denizen_entity_registry (org_id, entity_type, entity_id, external_key, title, status, summary)
select
  coalesce(l.org_id, public.denizen_default_org_id()),
  'lead',
  l.id,
  l.email,
  coalesce(l.company, l.name),
  l.status,
  jsonb_build_object('source', l.source, 'message_preview', left(l.message, 200))
from public.leads l
on conflict (org_id, entity_type, entity_id) do update set
  external_key = excluded.external_key,
  title = excluded.title,
  status = excluded.status,
  summary = excluded.summary,
  last_seen_at = now();

-- Prediction-ready views (simple heuristics today, ML features tomorrow)
create or replace view public.denizen_intake_funnel as
select
  i.org_id,
  i.id as intake_id,
  i.status,
  i.priority_score,
  i.service_category,
  i.budget_range,
  i.created_at as submitted_at,
  i.followed_up_at,
  extract(epoch from (i.followed_up_at - i.created_at)) / 3600.0 as hours_to_followup,
  (select count(*) from public.denizen_facts f
    where f.entity_type = 'intake_form' and f.entity_id = i.id) as fact_count,
  (select count(*) from public.denizen_outcomes o
    where o.entity_type = 'intake_form' and o.entity_id = i.id) as outcome_count
from public.intake_forms i;

create or replace view public.denizen_rfp_velocity as
select
  r.org_id,
  r.id as rfp_id,
  r.solicitation_number,
  r.title,
  r.status,
  r.bid_decision,
  r.created_at,
  r.proposal_due_date,
  r.completed_at,
  extract(epoch from (r.completed_at - r.created_at)) / 86400.0 as days_to_complete,
  extract(epoch from (r.proposal_due_date::timestamptz - r.created_at)) / 86400.0 as days_until_due_at_create,
  (select count(*) from public.rfp_requirements rr where rr.rfp_id = r.id) as requirement_count,
  (select count(*) from public.workflow_runs w where w.rfp_id = r.id) as workflow_run_count,
  (select sum(coalesce(w.tokens_input, 0) + coalesce(w.tokens_output, 0))
    from public.workflow_runs w where w.rfp_id = r.id) as total_tokens
from public.rfps r;

insert into public.denizen_schema_migrations (version, name)
values ('20260606000005', 'platform_org_bridge')
on conflict (version) do nothing;
