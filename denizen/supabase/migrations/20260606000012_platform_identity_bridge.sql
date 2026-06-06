-- Platform identity bridge: org FKs, NPC agent FKs, indexes, RLS, job-app spine
-- Requires: 20260606000011_team_accounts_and_session_auth.sql

-- ── Helper: orgs the signed-in user may access ───────────────────────────────

create or replace function public.denizen_auth_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct ta.org_id
  from public.denizen_team_accounts ta
  where lower(ta.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  union
  select distinct c.org_id
  from public.clients c
  where c.owner_id = auth.uid() and c.org_id is not null
  union
  select public.denizen_default_org_id()
  where public.is_admin(auth.uid())
     or exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.role in ('admin', 'team_member')
     );
$$;

create or replace function public.denizen_user_can_access_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org_id is null
      or public.is_admin(auth.uid())
      or p_org_id in (select public.denizen_auth_user_org_ids());
$$;

-- Platform tables (client_appointments, subscriptions, intake_forms, leads,
-- room_bookings) are owned by supabase_admin — see 20260606000013.

-- ── denizen_job_applications: Roki attribution + org scope ───────────────────

alter table public.denizen_job_applications
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null,
  add column if not exists npc_key text references public.denizen_npcs(npc_key) on delete set null,
  add column if not exists session_id uuid references public.denizen_visitor_sessions(id) on delete set null;

update public.denizen_job_applications
set
  org_id = coalesce(org_id, public.denizen_default_org_id()),
  npc_key = coalesce(npc_key, 'roki')
where org_id is null or npc_key is null;

create index if not exists denizen_job_applications_org_idx
  on public.denizen_job_applications (org_id);
create index if not exists denizen_job_applications_npc_idx
  on public.denizen_job_applications (npc_key);
create index if not exists denizen_job_applications_session_idx
  on public.denizen_job_applications (session_id)
  where session_id is not null;

-- ── agent_id → denizen_npcs FK (documents, key_value, logs) ────────────────

update public.documents
set agent_id = 'lucy'
where agent_id is null
   or agent_id = 'default'
   or agent_id not in (select npc_key from public.denizen_npcs);

update public.key_value
set agent_id = 'lucy'
where agent_id is null
   or agent_id = 'default'
   or agent_id not in (select npc_key from public.denizen_npcs);

update public.logs
set agent_id = 'lucy'
where agent_id is null
   or agent_id = 'default'
   or agent_id not in (select npc_key from public.denizen_npcs);

alter table public.documents
  alter column agent_id set default 'lucy';
alter table public.key_value
  alter column agent_id set default 'lucy';
alter table public.logs
  alter column agent_id set default 'lucy';

alter table public.documents
  drop constraint if exists documents_agent_id_fkey;
alter table public.key_value
  drop constraint if exists key_value_agent_id_fkey;
alter table public.logs
  drop constraint if exists logs_agent_id_fkey;

alter table public.documents
  add constraint documents_agent_id_fkey
    foreign key (agent_id) references public.denizen_npcs(npc_key) on update cascade on delete restrict;
alter table public.key_value
  add constraint key_value_agent_id_fkey
    foreign key (agent_id) references public.denizen_npcs(npc_key) on update cascade on delete restrict;
alter table public.logs
  add constraint logs_agent_id_fkey
    foreign key (agent_id) references public.denizen_npcs(npc_key) on update cascade on delete restrict;

-- ── Composite indexes (postgres-owned / denizen tables) ──────────────────────

create index if not exists rfp_requirements_rfp_status_idx
  on public.rfp_requirements (rfp_id, status);
create index if not exists denizen_facts_org_type_time_idx
  on public.denizen_facts (org_id, fact_type, occurred_at desc);
create index if not exists denizen_llm_events_npc_at_idx
  on public.denizen_llm_events (npc_key, at desc);

-- ── Intelligence triggers: client_appointments + job_applications ──────────

create or replace function public.denizen_trg_client_appointments()
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
      v_org, 'appointment.booked', 'website', coalesce(NEW.client_email, 'website'),
      'client_appointment', NEW.id,
      jsonb_build_object(
        'client_email', NEW.client_email,
        'client_name', NEW.client_name,
        'purpose', NEW.purpose,
        'status', NEW.status,
        'client_id', NEW.client_id
      ),
      null, null, 'client_appointments', NEW.id, array['appointment', 'booked']
    );
  end if;

  if TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    perform public.denizen_record_fact(
      v_org, 'appointment.status_changed', 'system', 'website',
      'client_appointment', NEW.id,
      jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status),
      null, null, 'client_appointments', NEW.id, array['appointment', 'status']
    );
  end if;

  return NEW;
end;
$$;

create or replace function public.denizen_trg_job_applications()
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
      v_org, 'job_application.created', 'npc', coalesce(NEW.npc_key, 'roki'),
      null, null,
      jsonb_build_object(
        'id', NEW.id,
        'company', NEW.company,
        'role', NEW.role,
        'status', NEW.status,
        'score', NEW.score,
        'site', NEW.site,
        'entity_key', NEW.id
      ),
      null, null, 'denizen_job_applications', null, array['job', 'created']
    );
  end if;

  if TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    perform public.denizen_record_fact(
      v_org, 'job_application.status_changed', 'npc', coalesce(NEW.npc_key, 'roki'),
      null, null,
      jsonb_build_object(
        'id', NEW.id,
        'from_status', OLD.status,
        'to_status', NEW.status,
        'company', NEW.company,
        'entity_key', NEW.id
      ),
      null, null, 'denizen_job_applications', null, array['job', 'status']
    );

    if NEW.status in ('offer', 'interview_scheduled', 'recruiter_replied') then
      perform public.denizen_record_outcome(
        v_org, 'job.positive_signal', 'job_application', null, NEW.id,
        jsonb_build_object('status', NEW.status, 'company', NEW.company, 'score', NEW.score),
        null, NEW.score, NEW.status
      );
    elsif NEW.status in ('rejected', 'closed', 'withdrawn') then
      perform public.denizen_record_outcome(
        v_org, 'job.rejected', 'job_application', null, NEW.id,
        jsonb_build_object('status', NEW.status, 'company', NEW.company),
        null, NEW.score, NEW.status
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists denizen_job_applications_outcomes on public.denizen_job_applications;
create trigger denizen_job_applications_outcomes
  after insert or update on public.denizen_job_applications
  for each row execute function public.denizen_trg_job_applications();

insert into public.denizen_schema_migrations (version, name)
values ('20260606000012', 'platform_identity_bridge')
on conflict (version) do nothing;
