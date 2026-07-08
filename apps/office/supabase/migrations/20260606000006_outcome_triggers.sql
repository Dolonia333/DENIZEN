-- Outcome writers + prediction validation (website + business table triggers)
-- Requires: 20260606000004, 20260606000005
-- Apply as supabase_admin (owns intake_forms).

-- Optional text key for non-uuid entities (job applications, etc.)
alter table public.denizen_outcomes
  add column if not exists entity_key text;

alter table public.denizen_predictions
  add column if not exists entity_key text;

create index if not exists denizen_outcomes_entity_key_idx
  on public.denizen_outcomes (org_id, entity_type, entity_key)
  where entity_key is not null;

-- ── Outcome + validation helpers ─────────────────────────────────────────────

create or replace function public.denizen_record_outcome(
  p_org_id uuid,
  p_outcome_type text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_entity_key text default null,
  p_value_json jsonb default '{}'::jsonb,
  p_horizon text default null,
  p_value_numeric numeric default null,
  p_value_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.denizen_outcomes (
    org_id, outcome_type, entity_type, entity_id, entity_key,
    horizon, value_numeric, value_text, value_json
  )
  values (
    p_org_id, p_outcome_type, p_entity_type, p_entity_id, p_entity_key,
    p_horizon, p_value_numeric, p_value_text, p_value_json
  )
  returning id into v_id;

  perform public.denizen_validate_predictions(
    p_org_id, p_entity_type, p_entity_id, p_entity_key, v_id, p_outcome_type
  );

  return v_id;
end;
$$;

create or replace function public.denizen_validate_predictions(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_key text,
  p_outcome_id uuid,
  p_outcome_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pred record;
  predicted_positive boolean;
  actual_positive boolean;
  pred_prob numeric;
  score numeric;
begin
  actual_positive := p_outcome_type in (
    'intake.converted', 'lead.converted', 'client.created',
    'rfp.bid', 'job.offer', 'job.interview'
  );

  for pred in
    select *
    from public.denizen_predictions
    where org_id = p_org_id
      and entity_type = p_entity_type
      and validated_at is null
      and (
        (p_entity_id is not null and entity_id = p_entity_id)
        or (p_entity_key is not null and entity_key = p_entity_key)
      )
  loop
    pred_prob := nullif(pred.prediction->>'close_probability', '')::numeric;
    predicted_positive := coalesce(
      nullif(pred.prediction->>'will_convert', '')::boolean,
      nullif(pred.prediction->>'will_bid', '')::boolean,
      pred_prob is not null and pred_prob >= 0.5,
      false
    );

    if pred_prob is not null and actual_positive in (true, false) then
      score := case when actual_positive then pred_prob else 1 - pred_prob end;
    else
      score := case when predicted_positive = actual_positive then 1.0 else 0.0 end;
    end if;

    update public.denizen_predictions
    set validated_at = now(),
        actual_outcome_id = p_outcome_id,
        accuracy_score = score
    where id = pred.id;
  end loop;
end;
$$;

create or replace function public.denizen_predict_intake_close(p_org_id uuid, p_intake_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  conf numeric := 0.25;
begin
  select * into r from public.intake_forms where id = p_intake_id;
  if not found then return; end if;

  if coalesce(r.priority_score, 0) >= 80 then conf := conf + 0.35;
  elsif coalesce(r.priority_score, 0) >= 60 then conf := conf + 0.20;
  end if;

  if r.budget_range in ('10k_plus', 'custom') then
    conf := conf + 0.15;
  end if;

  if r.service_category is not null and r.service_category <> '' then
    conf := conf + 0.05;
  end if;

  if r.recommended_tier ilike '%premium%' or r.recommended_tier ilike '%enterprise%' then
    conf := conf + 0.10;
  end if;

  conf := least(conf, 0.95);

  insert into public.denizen_predictions (
    org_id, model_key, model_version, prediction_type,
    entity_type, entity_id, prediction, confidence
  )
  values (
    p_org_id, 'heuristic_v0', '0.2.0', 'intake.close_probability',
    'intake_form', p_intake_id,
    jsonb_build_object(
      'will_convert', conf >= 0.5,
      'close_probability', conf,
      'signals', jsonb_build_object(
        'priority_score', r.priority_score,
        'budget_range', r.budget_range,
        'service_category', r.service_category,
        'recommended_tier', r.recommended_tier
      )
    ),
    conf
  );
end;
$$;

create or replace function public.denizen_predict_rfp_bid(p_org_id uuid, p_rfp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  req_count integer;
  conf numeric := 0.30;
begin
  select * into r from public.rfps where id = p_rfp_id;
  if not found then return; end if;

  select count(*) into req_count from public.rfp_requirements where rfp_id = p_rfp_id;

  if r.estimated_value_max is not null and r.estimated_value_max >= 500000 then conf := conf + 0.15; end if;
  if req_count > 20 then conf := conf + 0.10;
  elsif req_count > 5 then conf := conf + 0.05;
  end if;
  if r.set_aside_type is not null and r.set_aside_type <> '' then conf := conf + 0.10; end if;
  if r.proposal_due_date is not null and r.proposal_due_date > current_date + 21 then conf := conf + 0.05; end if;

  conf := least(conf, 0.90);

  insert into public.denizen_predictions (
    org_id, model_key, model_version, prediction_type,
    entity_type, entity_id, prediction, confidence
  )
  values (
    p_org_id, 'heuristic_v0', '0.2.0', 'rfp.bid_probability',
    'rfp', p_rfp_id,
    jsonb_build_object(
      'will_bid', conf >= 0.5,
      'bid_probability', conf,
      'signals', jsonb_build_object(
        'requirement_count', req_count,
        'estimated_value_max', r.estimated_value_max,
        'set_aside_type', r.set_aside_type
      )
    ),
    conf
  );
end;
$$;

-- ── intake_forms ─────────────────────────────────────────────────────────────

create or replace function public.denizen_trg_intake_forms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_outcome_id uuid;
begin
  v_org := coalesce(NEW.org_id, public.denizen_default_org_id());

  if TG_OP = 'INSERT' then
    perform public.denizen_record_fact(
      v_org, 'intake.submitted', 'website', 'intake-form',
      'intake_form', NEW.id,
      jsonb_build_object(
        'status', NEW.status,
        'priority_score', NEW.priority_score,
        'service_category', NEW.service_category,
        'budget_range', NEW.budget_range,
        'title', coalesce(NEW.company_name, NEW.full_name),
        'email', NEW.email
      ),
      null, null, 'intake_forms', NEW.id, array['intake', 'submitted']
    );
    perform public.denizen_predict_intake_close(v_org, NEW.id);
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.status is distinct from OLD.status then
      perform public.denizen_record_fact(
        v_org, 'intake.status_changed', 'website', coalesce(NEW.assigned_to::text, 'system'),
        'intake_form', NEW.id,
        jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status),
        null, null, 'intake_forms', NEW.id, array['intake', 'status']
      );

      if NEW.status = 'converted'
         or NEW.status ilike '%convert%'
         or NEW.status in ('client', 'won', 'closed_won', 'signed', 'active') then
        v_outcome_id := public.denizen_record_outcome(
          v_org, 'intake.converted', 'intake_form', NEW.id, null,
          jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status),
          null, NEW.priority_score, NEW.status
        );
      elsif NEW.status = 'archived'
         or NEW.status ilike '%lost%'
         or NEW.status ilike '%reject%'
         or NEW.status in ('closed', 'spam', 'declined', 'no_go') then
        v_outcome_id := public.denizen_record_outcome(
          v_org, 'intake.lost', 'intake_form', NEW.id, null,
          jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status),
          null, null, NEW.status
        );
      end if;
    end if;

    if NEW.followed_up_at is not null and OLD.followed_up_at is null then
      perform public.denizen_record_fact(
        v_org, 'intake.followed_up', 'human', coalesce(NEW.assigned_to::text, 'team'),
        'intake_form', NEW.id,
        jsonb_build_object('followed_up_at', NEW.followed_up_at),
        null, null, 'intake_forms', NEW.id, array['intake', 'followup']
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists denizen_intake_forms_outcomes on public.intake_forms;
create trigger denizen_intake_forms_outcomes
  after insert or update on public.intake_forms
  for each row execute function public.denizen_trg_intake_forms();

-- ── leads ────────────────────────────────────────────────────────────────────

create or replace function public.denizen_trg_leads()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := coalesce(NEW.org_id, public.denizen_default_org_id());

  if TG_OP = 'INSERT' then
    perform public.denizen_record_fact(
      v_org, 'lead.submitted', 'website', coalesce(NEW.source, 'website'),
      'lead', NEW.id,
      jsonb_build_object('status', NEW.status, 'source', NEW.source, 'company', NEW.company, 'email', NEW.email),
      null, null, 'leads', NEW.id, array['lead', 'submitted']
    );
  end if;

  if TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    perform public.denizen_record_fact(
      v_org, 'lead.status_changed', 'website', coalesce(NEW.assigned_to::text, 'system'),
      'lead', NEW.id,
      jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status),
      null, null, 'leads', NEW.id, array['lead', 'status']
    );

    if NEW.status ilike '%convert%' or NEW.status in ('client', 'won', 'qualified', 'active') then
      perform public.denizen_record_outcome(
        v_org, 'lead.converted', 'lead', NEW.id, null,
        jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status),
        null, null, NEW.status
      );
    elsif NEW.status ilike '%archiv%' or NEW.status ilike '%reject%' or NEW.status = 'spam' then
      perform public.denizen_record_outcome(
        v_org, 'lead.lost', 'lead', NEW.id, null,
        jsonb_build_object('archive_reason', NEW.archive_reason, 'to_status', NEW.status),
        null, null, NEW.status
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists denizen_leads_outcomes on public.leads;
create trigger denizen_leads_outcomes
  after insert or update on public.leads
  for each row execute function public.denizen_trg_leads();

-- ── rfps ─────────────────────────────────────────────────────────────────────

create or replace function public.denizen_trg_rfps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := coalesce(NEW.org_id, public.denizen_default_org_id());

  if TG_OP = 'INSERT' then
    perform public.denizen_record_fact(
      v_org, 'rfp.ingested', 'ingest', coalesce(NEW.source_type, 'manual'),
      'rfp', NEW.id,
      jsonb_build_object(
        'title', NEW.title,
        'agency', NEW.agency,
        'solicitation_number', NEW.solicitation_number,
        'status', NEW.status
      ),
      null, null, 'rfps', NEW.id, array['rfp', 'ingested']
    );
    perform public.denizen_predict_rfp_bid(v_org, NEW.id);
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.bid_decision is distinct from OLD.bid_decision and NEW.bid_decision is not null then
      perform public.denizen_record_fact(
        v_org, 'rfp.bid_decision_set', 'human', coalesce(NEW.capture_manager::text, 'team'),
        'rfp', NEW.id,
        jsonb_build_object('bid_decision', NEW.bid_decision, 'no_bid_reason', NEW.no_bid_reason),
        null, null, 'rfps', NEW.id, array['rfp', 'bid_decision']
      );

      if NEW.bid_decision ilike '%bid%' and NEW.bid_decision not ilike '%no%' then
        perform public.denizen_record_outcome(
          v_org, 'rfp.bid', 'rfp', NEW.id, null,
          jsonb_build_object('bid_decision', NEW.bid_decision),
          null, null, NEW.bid_decision
        );
      else
        perform public.denizen_record_outcome(
          v_org, 'rfp.no_bid', 'rfp', NEW.id, null,
          jsonb_build_object('bid_decision', NEW.bid_decision, 'no_bid_reason', NEW.no_bid_reason),
          null, null, NEW.bid_decision
        );
      end if;
    end if;

    if NEW.status is distinct from OLD.status then
      perform public.denizen_record_fact(
        v_org, 'rfp.status_changed', 'system', 'rfp-pipeline',
        'rfp', NEW.id,
        jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status),
        null, null, 'rfps', NEW.id, array['rfp', 'status']
      );

      if NEW.status in ('won', 'awarded', 'submitted') then
        perform public.denizen_record_outcome(
          v_org, 'rfp.won', 'rfp', NEW.id, null,
          jsonb_build_object('status', NEW.status),
          null, null, NEW.status
        );
      elsif NEW.status in ('lost', 'not_awarded', 'cancelled') then
        perform public.denizen_record_outcome(
          v_org, 'rfp.lost', 'rfp', NEW.id, null,
          jsonb_build_object('status', NEW.status),
          null, null, NEW.status
        );
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists denizen_rfps_outcomes on public.rfps;
create trigger denizen_rfps_outcomes
  after insert or update on public.rfps
  for each row execute function public.denizen_trg_rfps();

-- ── clients (new client = conversion outcome) ────────────────────────────────

create or replace function public.denizen_trg_clients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_intake_id uuid;
  v_lead_id uuid;
begin
  v_org := coalesce(NEW.org_id, public.denizen_default_org_id());

  if TG_OP = 'INSERT' then
    perform public.denizen_record_fact(
      v_org, 'client.created', 'website', coalesce(NEW.owner_id::text, 'team'),
      'client', NEW.id,
      jsonb_build_object('name', NEW.name, 'company', NEW.company, 'email', NEW.email, 'status', NEW.status),
      null, null, 'clients', NEW.id, array['client', 'created']
    );

    perform public.denizen_record_outcome(
      v_org, 'client.created', 'client', NEW.id, null,
      jsonb_build_object('company', NEW.company, 'email', NEW.email),
      null, null, NEW.status
    );

    if NEW.email is not null then
      select id into v_intake_id from public.intake_forms
        where lower(email) = lower(NEW.email) and org_id = v_org
        order by created_at desc limit 1;
      if v_intake_id is not null then
        perform public.denizen_record_outcome(
          v_org, 'intake.converted', 'intake_form', v_intake_id, null,
          jsonb_build_object('via', 'client.created', 'client_id', NEW.id),
          null, null, 'linked_by_email'
        );
      end if;

      select id into v_lead_id from public.leads
        where lower(email) = lower(NEW.email) and org_id = v_org
        order by created_at desc limit 1;
      if v_lead_id is not null then
        perform public.denizen_record_outcome(
          v_org, 'lead.converted', 'lead', v_lead_id, null,
          jsonb_build_object('via', 'client.created', 'client_id', NEW.id),
          null, null, 'linked_by_email'
        );
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists denizen_clients_outcomes on public.clients;
create trigger denizen_clients_outcomes
  after insert on public.clients
  for each row execute function public.denizen_trg_clients();

-- Backfill prediction for existing RFP without one
insert into public.denizen_predictions (
  org_id, model_key, model_version, prediction_type, entity_type, entity_id, prediction, confidence
)
select
  coalesce(r.org_id, public.denizen_default_org_id()),
  'heuristic_v0', '0.2.0', 'rfp.bid_probability', 'rfp', r.id,
  jsonb_build_object('will_bid', true, 'bid_probability', 0.45, 'signals', jsonb_build_object('backfill', true)),
  0.45
from public.rfps r
where not exists (
  select 1 from public.denizen_predictions p
  where p.entity_type = 'rfp' and p.entity_id = r.id
);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000006', 'outcome_triggers')
on conflict (version) do nothing;
