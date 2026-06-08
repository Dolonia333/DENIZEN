-- NPC MCP gateway: per-teammate tokens + memory lineage (v1.3)
-- Requires: 20260606000002, 20260606000004, 20260606000011

-- ── Memory lineage ───────────────────────────────────────────────────────────
alter table public.denizen_npc_memories
  add column if not exists org_id uuid references public.denizen_organizations(id) on delete cascade,
  add column if not exists source text not null default 'npc_brain',
  add column if not exists member_id uuid references public.denizen_team_accounts(id) on delete set null;

create index if not exists denizen_npc_memories_org_npc_idx
  on public.denizen_npc_memories (org_id, npc_key, recorded_at desc);

create index if not exists denizen_npc_memories_source_idx
  on public.denizen_npc_memories (source, recorded_at desc);

-- Backfill org_id for existing rows (default org)
update public.denizen_npc_memories m
set org_id = o.id
from public.denizen_organizations o
where m.org_id is null
  and o.slug = coalesce(nullif(current_setting('app.denizen_org_slug', true), ''), 'zion');

-- ── MCP bearer tokens (hash only — plaintext shown once at creation) ─────────
create table if not exists public.denizen_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  npc_key text not null references public.denizen_npcs(npc_key) on delete cascade,
  member_id uuid references public.denizen_team_accounts(id) on delete set null,
  session_id uuid references public.denizen_visitor_sessions(id) on delete set null,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_mcp_tokens_org_npc_idx
  on public.denizen_mcp_tokens (org_id, npc_key)
  where revoked_at is null;

create index if not exists denizen_mcp_tokens_hash_idx
  on public.denizen_mcp_tokens (token_hash)
  where revoked_at is null;

alter table public.denizen_mcp_tokens enable row level security;

-- No anon/authenticated policies — resolved via security definer RPC only
drop policy if exists denizen_mcp_tokens_deny_all on public.denizen_mcp_tokens;
create policy denizen_mcp_tokens_deny_all on public.denizen_mcp_tokens
  for all using (false);

-- ── RPC: resolve bearer token → scope ────────────────────────────────────────
create or replace function public.denizen_resolve_mcp_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  r record;
  v_protected boolean;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

  select t.id, t.org_id, t.npc_key, t.member_id, t.session_id, t.label,
         o.slug as org_slug, o.settings->>'tier' as org_tier
  into r
  from public.denizen_mcp_tokens t
  join public.denizen_organizations o on o.id = t.org_id
  where t.token_hash = v_hash
    and t.revoked_at is null
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if coalesce(r.org_tier, '') = 'demo' then
    return jsonb_build_object('ok', false, 'error', 'demo_org_blocked');
  end if;

  select protected into v_protected
  from public.denizen_npcs
  where npc_key = r.npc_key;

  if coalesce(v_protected, false) then
    return jsonb_build_object('ok', false, 'error', 'npc_protected');
  end if;

  update public.denizen_mcp_tokens
  set last_used_at = now()
  where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'token_id', r.id,
    'org_id', r.org_id,
    'org_slug', r.org_slug,
    'npc_key', r.npc_key,
    'member_id', r.member_id,
    'session_id', r.session_id,
    'label', r.label
  );
end;
$$;

-- ── RPC: register token hash (server-side after team session verification) ─
create or replace function public.denizen_register_mcp_token(
  p_org_id uuid,
  p_npc_key text,
  p_token_hash text,
  p_member_id uuid default null,
  p_session_id uuid default null,
  p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_protected boolean;
  v_tier text;
begin
  if p_org_id is null or p_npc_key is null or p_token_hash is null then
    raise exception 'org_id, npc_key, and token_hash required';
  end if;

  select settings->>'tier' into v_tier
  from public.denizen_organizations where id = p_org_id;

  if coalesce(v_tier, '') = 'demo' then
    raise exception 'demo org cannot create mcp tokens';
  end if;

  select protected into v_protected from public.denizen_npcs where npc_key = p_npc_key;
  if coalesce(v_protected, false) then
    raise exception 'npc is protected';
  end if;

  insert into public.denizen_mcp_tokens (
    org_id, npc_key, member_id, session_id, token_hash, label
  )
  values (
    p_org_id, p_npc_key, p_member_id, p_session_id, p_token_hash, p_label
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.denizen_resolve_mcp_token(text) to anon, authenticated, service_role;
grant execute on function public.denizen_register_mcp_token(uuid, text, text, uuid, uuid, text) to anon, authenticated, service_role;

insert into public.denizen_schema_migrations (version, name)
values ('20260606000015', 'npc_mcp_gateway')
on conflict (version) do nothing;
