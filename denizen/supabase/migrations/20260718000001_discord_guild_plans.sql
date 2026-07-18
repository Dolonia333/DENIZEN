-- Per-Discord-guild subscription plan (bot premium tier).
-- One row per guild the bot serves; absence of a row == free plan.
-- Written by the Stripe subscription webhook, read by the bot at command
-- dispatch to gate premium modules (security / avatar / community).

create table if not exists public.denizen_guild_plans (
  guild_id text primary key,
  plan text not null default 'free'
    check (plan in ('free', 'pro', 'ultra')),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid')),
  stripe_customer_id text,
  stripe_subscription_id text,
  price_id text,
  current_period_end timestamptz,
  linked_user_id text,          -- discord_user_id of whoever subscribed
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists denizen_guild_plans_customer_idx
  on public.denizen_guild_plans (stripe_customer_id)
  where stripe_customer_id is not null;

-- UNIQUE (not just indexed): one Stripe subscription maps to exactly one guild,
-- so a replayed/misrouted event can't silently entitle a second guild. Partial
-- so the many free rows (null subscription) are unaffected.
create unique index if not exists denizen_guild_plans_subscription_uidx
  on public.denizen_guild_plans (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Server-side only: the bot and app reach this via the service role key;
-- no anon/authenticated client should read or write guild billing rows.
alter table public.denizen_guild_plans enable row level security;

-- Register so the migration runner's skip-logic doesn't re-run this every deploy.
insert into public.denizen_schema_migrations (version, name)
values ('20260718000001', 'discord_guild_plans')
on conflict (version) do nothing;
