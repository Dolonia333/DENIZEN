-- Per-org business model + company brief (multi-tenant template packs)

create table if not exists public.org_business_models (
  org_id uuid primary key references public.denizen_organizations(id) on delete cascade,
  template_pack text,
  business_model jsonb not null default '{}'::jsonb,
  company_brief jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists org_business_models_pack_idx
  on public.org_business_models (template_pack);

alter table public.org_business_models enable row level security;

drop policy if exists org_business_models_deny_all on public.org_business_models;
create policy org_business_models_deny_all on public.org_business_models
  for all using (false) with check (false);

insert into public.denizen_schema_migrations (version, name)
values ('20260624000003', 'org_business_models')
on conflict (version) do nothing;
