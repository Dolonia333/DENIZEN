-- Visitor connections: accepted relationships for cross-team assistant messaging

create table if not exists public.denizen_visitor_connections (
  id uuid primary key default gen_random_uuid(),
  requester_identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  recipient_identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  requester_org_id uuid references public.denizen_organizations(id) on delete set null,
  recipient_org_id uuid references public.denizen_organizations(id) on delete set null,
  requester_session_id uuid references public.denizen_visitor_sessions(id) on delete set null,
  recipient_session_id uuid references public.denizen_visitor_sessions(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'blocked')),
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_identity_id <> recipient_identity_id)
);

create index if not exists denizen_visitor_connections_requester_idx
  on public.denizen_visitor_connections (requester_identity_id, updated_at desc);

create index if not exists denizen_visitor_connections_recipient_idx
  on public.denizen_visitor_connections (recipient_identity_id, updated_at desc);

create index if not exists denizen_visitor_connections_status_idx
  on public.denizen_visitor_connections (status, updated_at desc);

alter table public.denizen_visitor_connections enable row level security;

drop policy if exists denizen_visitor_connections_deny_all on public.denizen_visitor_connections;
create policy denizen_visitor_connections_deny_all on public.denizen_visitor_connections
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260616000001', 'visitor_connections')
on conflict (version) do nothing;
