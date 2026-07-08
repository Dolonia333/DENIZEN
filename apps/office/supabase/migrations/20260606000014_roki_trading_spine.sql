-- Roki trading intelligence spine (org-scoped watchlist + suggestions)
-- Requires: 20260606000012_platform_identity_bridge.sql

create table if not exists public.denizen_watchlist_symbols (
  id bigserial primary key,
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  npc_key text not null default 'roki' references public.denizen_npcs(npc_key) on delete set default,
  symbol text not null,
  added_at timestamptz not null default now(),
  constraint denizen_watchlist_symbols_symbol_chk
    check (char_length(trim(symbol)) > 0),
  constraint denizen_watchlist_symbols_org_symbol_key
    unique (org_id, symbol)
);

create table if not exists public.denizen_trade_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  npc_key text not null default 'roki' references public.denizen_npcs(npc_key) on delete set default,
  symbol text not null,
  action text not null,
  rationale text,
  status text not null default 'pending'
    check (status in ('pending', 'dismissed', 'acted')),
  created_at timestamptz not null default now()
);

create index if not exists denizen_watchlist_symbols_org_idx
  on public.denizen_watchlist_symbols (org_id);
create index if not exists denizen_watchlist_symbols_npc_idx
  on public.denizen_watchlist_symbols (npc_key);
create index if not exists denizen_trade_suggestions_org_idx
  on public.denizen_trade_suggestions (org_id);
create index if not exists denizen_trade_suggestions_npc_idx
  on public.denizen_trade_suggestions (npc_key);
create index if not exists denizen_trade_suggestions_status_idx
  on public.denizen_trade_suggestions (status);

alter table public.denizen_watchlist_symbols enable row level security;
alter table public.denizen_trade_suggestions enable row level security;

drop policy if exists "Team org access watchlist symbols" on public.denizen_watchlist_symbols;
create policy "Team org access watchlist symbols" on public.denizen_watchlist_symbols
  for select using (public.denizen_user_can_access_org(org_id));

drop policy if exists "Team org access trade suggestions" on public.denizen_trade_suggestions;
create policy "Team org access trade suggestions" on public.denizen_trade_suggestions
  for select using (public.denizen_user_can_access_org(org_id));

create or replace function public.denizen_trg_trade_suggestions()
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
      v_org, 'trade_suggestion.created', 'npc', coalesce(NEW.npc_key, 'roki'),
      null, null,
      jsonb_build_object(
        'id', NEW.id,
        'symbol', NEW.symbol,
        'action', NEW.action,
        'rationale', NEW.rationale,
        'status', NEW.status
      ),
      null, null, 'denizen_trade_suggestions', NEW.id, array['trade', 'suggestion']
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists denizen_trade_suggestions_facts on public.denizen_trade_suggestions;
create trigger denizen_trade_suggestions_facts
  after insert on public.denizen_trade_suggestions
  for each row execute function public.denizen_trg_trade_suggestions();

insert into public.denizen_schema_migrations (version, name)
values ('20260606000014', 'roki_trading_spine')
on conflict (version) do nothing;
