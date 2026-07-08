-- Platform tables owned by supabase_admin — apply as supabase_admin
-- Requires: 20260606000012_platform_identity_bridge.sql (denizen-owned objects)

-- ── client_appointments: link to clients + org ─────────────────────────────

alter table public.client_appointments
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

update public.client_appointments ca
set
  client_id = c.id,
  org_id = coalesce(c.org_id, public.denizen_default_org_id())
from public.clients c
where lower(ca.client_email) = lower(c.email)
  and ca.client_id is null;

update public.client_appointments
set org_id = public.denizen_default_org_id()
where org_id is null;

create index if not exists client_appointments_org_idx
  on public.client_appointments (org_id);
create index if not exists client_appointments_client_idx
  on public.client_appointments (client_id);

-- ── subscriptions: org-scoped billing ───────────────────────────────────────

alter table public.subscriptions
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete set null;

update public.subscriptions s
set org_id = c.org_id
from public.clients c
where s.client_id = c.id and s.org_id is null;

update public.subscriptions
set org_id = public.denizen_default_org_id()
where org_id is null;

create index if not exists subscriptions_org_idx
  on public.subscriptions (org_id);

-- ── room_bookings: profiles as identity layer ────────────────────────────────

alter table public.room_bookings
  drop constraint if exists room_bookings_booked_by_fkey;

alter table public.room_bookings
  add constraint room_bookings_booked_by_fkey
    foreign key (booked_by) references public.profiles(id) on delete set null;

-- ── Composite indexes on supabase_admin tables ───────────────────────────────

create index if not exists intake_forms_status_created_idx
  on public.intake_forms (status, created_at desc);
create index if not exists leads_status_org_idx
  on public.leads (status, org_id);

-- ── Org-scoped RLS (additive) ───────────────────────────────────────────────

drop policy if exists "Team org access intake forms" on public.intake_forms;
create policy "Team org access intake forms" on public.intake_forms
  for select using (public.denizen_user_can_access_org(org_id));

drop policy if exists "Team org access leads" on public.leads;
create policy "Team org access leads" on public.leads
  for select using (public.denizen_user_can_access_org(org_id));

drop policy if exists "Team org access client appointments" on public.client_appointments;
create policy "Team org access client appointments" on public.client_appointments
  for select using (public.denizen_user_can_access_org(org_id));

drop policy if exists "Team org access subscriptions" on public.subscriptions;
create policy "Team org access subscriptions" on public.subscriptions
  for select using (
    auth.uid() = user_id
    or public.denizen_user_can_access_org(org_id)
  );

-- Ensure appointment trigger exists (function created in 000012)
drop trigger if exists denizen_client_appointments_outcomes on public.client_appointments;
create trigger denizen_client_appointments_outcomes
  after insert or update on public.client_appointments
  for each row execute function public.denizen_trg_client_appointments();

insert into public.denizen_schema_migrations (version, name)
values ('20260606000013', 'platform_tables_admin')
on conflict (version) do nothing;
