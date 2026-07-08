-- MCP governance: token scopes in metadata, audit log, list/revoke RPCs

create table if not exists public.denizen_mcp_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  token_id uuid references public.denizen_mcp_tokens(id) on delete set null,
  npc_key text,
  tool_name text not null,
  ok boolean not null default true,
  error_code text,
  session_id uuid,
  member_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists denizen_mcp_audit_org_created_idx
  on public.denizen_mcp_audit (org_id, created_at desc);

create index if not exists denizen_mcp_audit_token_idx
  on public.denizen_mcp_audit (token_id, created_at desc)
  where token_id is not null;

alter table public.denizen_mcp_audit enable row level security;

drop policy if exists denizen_mcp_audit_deny_all on public.denizen_mcp_audit;
create policy denizen_mcp_audit_deny_all on public.denizen_mcp_audit
  for all using (false);

-- ── register token (scopes stored in metadata.scopes) ────────────────────────
create or replace function public.denizen_register_mcp_token(
  p_org_id uuid,
  p_npc_key text,
  p_token_hash text,
  p_member_id uuid default null,
  p_session_id uuid default null,
  p_label text default null,
  p_metadata jsonb default '{}'::jsonb
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

  if p_npc_key <> '_team' then
    select protected into v_protected from public.denizen_npcs where npc_key = p_npc_key;
    if coalesce(v_protected, false) then
      raise exception 'npc is protected';
    end if;
  end if;

  insert into public.denizen_mcp_tokens (
    org_id, npc_key, member_id, session_id, token_hash, label, metadata
  )
  values (
    p_org_id, p_npc_key, p_member_id, p_session_id, p_token_hash, p_label,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ── resolve token → scope (includes scopes array) ────────────────────────────
create or replace function public.denizen_resolve_mcp_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  r record;
  v_protected boolean;
  v_scopes jsonb;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

  select t.id, t.org_id, t.npc_key, t.member_id, t.session_id, t.label, t.metadata,
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

  if r.npc_key <> '_team' then
    select protected into v_protected
    from public.denizen_npcs
    where npc_key = r.npc_key;

    if coalesce(v_protected, false) then
      return jsonb_build_object('ok', false, 'error', 'npc_protected');
    end if;
  end if;

  v_scopes := r.metadata->'scopes';
  if v_scopes is null or jsonb_typeof(v_scopes) <> 'array' or jsonb_array_length(v_scopes) = 0 then
    v_scopes := '["read","skills","crm_write","handoff","delegate"]'::jsonb;
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
    'label', r.label,
    'scopes', v_scopes,
    'scope_mode', case when r.npc_key = '_team' then 'team' else 'npc' end
  );
end;
$$;

-- ── list active tokens for session or whole org (admin) ──────────────────────
create or replace function public.denizen_list_mcp_tokens(
  p_org_id uuid,
  p_session_id uuid,
  p_org_wide boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'org_id required');
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      t.id,
      t.npc_key,
      t.label,
      t.session_id,
      t.created_at,
      t.last_used_at,
      coalesce(t.metadata->'scopes', '["read","skills","crm_write","handoff","delegate"]'::jsonb) as scopes
    from public.denizen_mcp_tokens t
    where t.org_id = p_org_id
      and t.revoked_at is null
      and (p_org_wide or t.session_id = p_session_id)
    order by t.created_at desc
    limit 50
  ) x;

  return jsonb_build_object('ok', true, 'tokens', v_rows);
end;
$$;

-- ── revoke token (owner session or org-wide admin flag from server) ───────────
create or replace function public.denizen_revoke_mcp_token(
  p_token_id uuid,
  p_org_id uuid,
  p_session_id uuid,
  p_org_wide boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_token_id is null or p_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'token_id and org_id required');
  end if;

  update public.denizen_mcp_tokens t
  set revoked_at = now()
  where t.id = p_token_id
    and t.org_id = p_org_id
    and t.revoked_at is null
    and (p_org_wide or t.session_id = p_session_id)
  returning t.id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_forbidden');
  end if;

  return jsonb_build_object('ok', true, 'token_id', v_id);
end;
$$;

-- ── audit log (fire-and-forget from gateway) ─────────────────────────────────
create or replace function public.denizen_log_mcp_audit(
  p_org_id uuid,
  p_token_id uuid,
  p_npc_key text,
  p_tool_name text,
  p_ok boolean,
  p_error_code text default null,
  p_session_id uuid default null,
  p_member_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.denizen_mcp_audit (
    org_id, token_id, npc_key, tool_name, ok, error_code,
    session_id, member_id, meta
  )
  values (
    p_org_id, p_token_id, p_npc_key, p_tool_name, coalesce(p_ok, true), p_error_code,
    p_session_id, p_member_id, coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.denizen_register_mcp_token(uuid, text, text, uuid, uuid, text, jsonb)
  to anon, authenticated, service_role;
grant execute on function public.denizen_resolve_mcp_token(text) to anon, authenticated, service_role;
grant execute on function public.denizen_list_mcp_tokens(uuid, uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.denizen_revoke_mcp_token(uuid, uuid, uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.denizen_log_mcp_audit(uuid, uuid, text, text, boolean, text, uuid, uuid, jsonb)
  to anon, authenticated, service_role;

insert into public.denizen_schema_migrations (version, name)
values ('20260623000002', 'mcp_scopes_audit')
on conflict (version) do nothing;
