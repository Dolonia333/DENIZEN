-- Group chats: visitor + multiple NPCs in one thread

create table if not exists public.denizen_visitor_group_chat (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  name text not null,
  member_npc_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists denizen_visitor_group_chat_identity_idx
  on public.denizen_visitor_group_chat (identity_id, updated_at desc);

create table if not exists public.denizen_visitor_group_chat_message (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.denizen_visitor_group_chat(id) on delete cascade,
  identity_id uuid not null references public.denizen_user_identities(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'npc')),
  sender_npc_key text,
  content text not null,
  session_id uuid references public.denizen_visitor_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists denizen_visitor_group_chat_msg_group_idx
  on public.denizen_visitor_group_chat_message (group_id, created_at asc);

alter table public.denizen_visitor_group_chat enable row level security;
alter table public.denizen_visitor_group_chat_message enable row level security;

drop policy if exists denizen_visitor_group_chat_deny_all on public.denizen_visitor_group_chat;
create policy denizen_visitor_group_chat_deny_all on public.denizen_visitor_group_chat
  for all using (false);

drop policy if exists denizen_visitor_group_chat_message_deny_all on public.denizen_visitor_group_chat_message;
create policy denizen_visitor_group_chat_message_deny_all on public.denizen_visitor_group_chat_message
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260611000001', 'visitor_group_chat')
on conflict (version) do nothing;
