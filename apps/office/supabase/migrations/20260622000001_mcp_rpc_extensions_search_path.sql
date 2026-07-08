-- Fix denizen_resolve_mcp_token on Supabase: pgcrypto digest() lives in extensions schema.
-- Without extensions in search_path, PostgREST RPC returns HTTP 404 / digest does not exist.

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

grant execute on function public.denizen_resolve_mcp_token(text) to anon, authenticated, service_role;

insert into public.denizen_schema_migrations (version, name)
values ('20260622000001', 'mcp_rpc_extensions_search_path')
on conflict (version) do nothing;
