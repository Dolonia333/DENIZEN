-- Fast lookup for public client portal links (quote portalToken → org + quote id)
create table if not exists public.denizen_crm_portal_tokens (
  token text primary key,
  org_id uuid not null references public.denizen_organizations(id) on delete cascade,
  quote_id bigint not null,
  valid_until date,
  updated_at timestamptz not null default now()
);

create index if not exists denizen_crm_portal_tokens_org_idx
  on public.denizen_crm_portal_tokens (org_id);

comment on table public.denizen_crm_portal_tokens is
  'Index for /api/crm/quote/:token public portal — synced from workspace quotes on save';

alter table public.denizen_crm_portal_tokens enable row level security;

drop policy if exists denizen_crm_portal_tokens_deny_all on public.denizen_crm_portal_tokens;
create policy denizen_crm_portal_tokens_deny_all on public.denizen_crm_portal_tokens
  for all using (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260612000001', 'denizen_crm_portal_tokens')
on conflict (version) do nothing;
