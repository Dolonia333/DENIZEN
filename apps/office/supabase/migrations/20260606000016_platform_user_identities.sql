-- Platform user identities: persistent email-based profiles across sessions
-- NPC chat history keyed by identity (not ephemeral session_id)
-- Notification log for email/Discord outreach

create table if not exists public.denizen_user_identities (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  display_name text not null,
  tier text not null default 'demo'
    check (tier in ('demo', 'team', 'subscriber')),
  org_id uuid references public.denizen_organizations(id) on delete set null,
  team_account_id uuid references public.denizen_team_accounts(id) on delete set null,
  primary_session_id uuid references public.denizen_visitor_sessions(id) on delete set null,
  notify_email boolean not null default true,
  notify_discord boolean not null default false,
  discord_user_id text,
  subscription_status text not null default 'none'
    check (subscription_status in ('none', 'trial', 'active', 'cancelled', 'past_due')),
  source text,
  login_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (email_normalized)
);

create index if not exists denizen_user_identities_org_idx
  on public.denizen_user_identities (org_id, tier);

create index if not exists denizen_user_identities_team_account_idx
  on public.denizen_user_identities (team_account_id)
  where team_account_id is not null;

alter table public.denizen_visitor_sessions
  add column if not exists identity_id uuid references public.denizen_user_identities(id) on delete set null;

create index if not exists denizen_visitor_sessions_identity_idx
  on public.denizen_visitor_sessions (identity_id)
  where identity_id is not null;

create table if not exists public.denizen_visitor_npc_chat (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  npc_key text not null,
  role text not null check (role in ('user', 'npc')),
  content text not null,
  session_id uuid references public.denizen_visitor_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists denizen_visitor_npc_chat_identity_npc_idx
  on public.denizen_visitor_npc_chat (identity_id, npc_key, created_at desc);

create table if not exists public.denizen_notification_log (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid references public.denizen_user_identities(id) on delete set null,
  channel text not null check (channel in ('email', 'discord', 'in_app')),
  template text not null,
  recipient text,
  subject text,
  body_preview text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists denizen_notification_log_identity_idx
  on public.denizen_notification_log (identity_id, created_at desc);

alter table public.denizen_user_identities enable row level security;
alter table public.denizen_visitor_npc_chat enable row level security;
alter table public.denizen_notification_log enable row level security;

drop policy if exists denizen_user_identities_deny_all on public.denizen_user_identities;
create policy denizen_user_identities_deny_all on public.denizen_user_identities
  for all using (false);

drop policy if exists denizen_visitor_npc_chat_deny_all on public.denizen_visitor_npc_chat;
create policy denizen_visitor_npc_chat_deny_all on public.denizen_visitor_npc_chat
  for all using (false);

drop policy if exists denizen_notification_log_deny_all on public.denizen_notification_log;
create policy denizen_notification_log_deny_all on public.denizen_notification_log
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000016', 'platform_user_identities')
on conflict (version) do nothing;
