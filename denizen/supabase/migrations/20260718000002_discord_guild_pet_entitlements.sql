-- Per-guild, per-user companion pet entitlements (Spaces map).
-- Purchase / gift / pro_grant — not unlocked by guild Pro for everyone.
-- Written by Stripe pet checkout webhook + bot grant/gift commands.

create table if not exists public.denizen_guild_pet_entitlements (
  guild_id text not null,
  user_id text not null,
  source text not null
    check (source in ('purchase', 'gift', 'pro_grant')),
  granted_by text,
  stripe_session_id text,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create index if not exists denizen_guild_pet_entitlements_guild_idx
  on public.denizen_guild_pet_entitlements (guild_id);

create index if not exists denizen_guild_pet_entitlements_session_idx
  on public.denizen_guild_pet_entitlements (stripe_session_id)
  where stripe_session_id is not null;

alter table public.denizen_guild_pet_entitlements enable row level security;

insert into public.denizen_schema_migrations (version, name)
values ('20260718000002', 'discord_guild_pet_entitlements')
on conflict (version) do nothing;
