-- Per-identity office layout (virtual office instance per team member)
create table if not exists public.denizen_office_layout (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid references public.denizen_user_identities(id) on delete cascade,
  office_id text not null,
  layout jsonb not null default '{"items":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (office_id)
);

create index if not exists denizen_office_layout_identity_idx
  on public.denizen_office_layout (identity_id);

comment on table public.denizen_office_layout is
  'Per-identity virtual office layout; office_id usually equals identity_id';
