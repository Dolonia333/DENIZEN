-- Dolonia conversation intelligence — product-agnostic quality data layer.
-- Denizen is product_key = 'denizen' (first product). Future products reuse the same tables.
-- Privacy: user_hash only (never raw Discord snowflakes). Bodies optional + redacted upstream.

create extension if not exists pgcrypto;

-- Catalog of Dolonia products that emit conversation data
create table if not exists public.dolonia_products (
  product_key text primary key,
  display_name text not null,
  description text,
  created_at timestamptz not null default now()
);

insert into public.dolonia_products (product_key, display_name, description)
values (
  'denizen',
  'Denizen',
  'First Dolonia product — office OS + Discord Spaces. Conversation sense improves how AI talks to different people.'
)
on conflict (product_key) do update
  set display_name = excluded.display_name,
      description = excluded.description;

-- Append-only conversation events (quality-scored, privacy-aware)
create table if not exists public.dolonia_conv_events (
  id uuid primary key default gen_random_uuid(),
  product_key text not null default 'denizen'
    references public.dolonia_products (product_key) on delete cascade,
  org_id uuid,
  source text not null default 'discord',
  guild_id text,
  channel_id text,
  user_hash text not null,
  message_id text,
  event_ts timestamptz not null default now(),
  msg_len integer,
  signals text[] not null default '{}',
  topics text[] not null default '{}',
  style_primary text,
  style_types text[] not null default '{}',
  body_redacted text,
  quality_score real not null default 0
    check (quality_score >= 0 and quality_score <= 1),
  is_quality boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dolonia_conv_events_product_ts_idx
  on public.dolonia_conv_events (product_key, event_ts desc);
create index if not exists dolonia_conv_events_user_idx
  on public.dolonia_conv_events (product_key, user_hash, event_ts desc);
create index if not exists dolonia_conv_events_quality_idx
  on public.dolonia_conv_events (product_key, is_quality, event_ts desc)
  where is_quality = true;
create index if not exists dolonia_conv_events_guild_idx
  on public.dolonia_conv_events (product_key, guild_id, event_ts desc)
  where guild_id is not null;
create index if not exists dolonia_conv_events_style_idx
  on public.dolonia_conv_events (product_key, style_primary, event_ts desc)
  where style_primary is not null;

-- Per-person communication style profiles (hashed identities)
create table if not exists public.dolonia_conv_person_styles (
  product_key text not null default 'denizen'
    references public.dolonia_products (product_key) on delete cascade,
  user_hash text not null,
  sample_n integer not null default 0,
  primary_style text,
  style_types text[] not null default '{}',
  stats jsonb not null default '{}'::jsonb,
  quality_score real not null default 0,
  last_guild_id text,
  last_source text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (product_key, user_hash)
);

create index if not exists dolonia_conv_person_styles_primary_idx
  on public.dolonia_conv_person_styles (product_key, primary_style);

-- Per-community (guild / office) voice profiles
create table if not exists public.dolonia_conv_communities (
  product_key text not null default 'denizen'
    references public.dolonia_products (product_key) on delete cascade,
  community_id text not null,
  sample_n integer not null default 0,
  primary_style text,
  style_types text[] not null default '{}',
  type_counts jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  quality_score real not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (product_key, community_id)
);

-- Theme rollups (what people talk about)
create table if not exists public.dolonia_conv_themes (
  product_key text not null default 'denizen'
    references public.dolonia_products (product_key) on delete cascade,
  topic text not null,
  hit_count integer not null default 0,
  friction_count integer not null default 0,
  question_count integer not null default 0,
  last_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (product_key, topic)
);

create index if not exists dolonia_conv_themes_hits_idx
  on public.dolonia_conv_themes (product_key, hit_count desc);

-- Daily quality aggregates for dashboards / data products
create table if not exists public.dolonia_conv_quality_daily (
  product_key text not null default 'denizen'
    references public.dolonia_products (product_key) on delete cascade,
  day date not null,
  events integer not null default 0,
  quality_events integer not null default 0,
  unique_people integer not null default 0,
  friction integer not null default 0,
  questions integer not null default 0,
  avg_quality real,
  style_mix jsonb not null default '{}'::jsonb,
  top_topics jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (product_key, day)
);

-- Quality view: only high-value rows (is_quality)
create or replace view public.dolonia_conv_quality_events as
  select *
  from public.dolonia_conv_events
  where is_quality = true;

-- Upsert theme hit (atomic increment)
create or replace function public.dolonia_conv_bump_theme(
  p_product_key text,
  p_topic text,
  p_friction int default 0,
  p_question int default 0,
  p_at timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_topic is null or length(trim(p_topic)) < 2 then
    return;
  end if;
  insert into public.dolonia_conv_themes as t (
    product_key, topic, hit_count, friction_count, question_count, last_at, updated_at
  ) values (
    coalesce(nullif(p_product_key, ''), 'denizen'),
    lower(trim(p_topic)),
    1,
    greatest(0, coalesce(p_friction, 0)),
    greatest(0, coalesce(p_question, 0)),
    p_at,
    now()
  )
  on conflict (product_key, topic) do update set
    hit_count = t.hit_count + 1,
    friction_count = t.friction_count + greatest(0, coalesce(p_friction, 0)),
    question_count = t.question_count + greatest(0, coalesce(p_question, 0)),
    last_at = greatest(coalesce(t.last_at, p_at), p_at),
    updated_at = now();
end;
$$;

-- Roll daily quality stats for a product
create or replace function public.dolonia_conv_rollup_daily(
  p_product_key text default 'denizen',
  p_day date default (timezone('utc', now()))::date
) returns public.dolonia_conv_quality_daily
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.dolonia_conv_quality_daily;
  v_start timestamptz := p_day::timestamptz;
  v_end timestamptz := (p_day + 1)::timestamptz;
begin
  insert into public.dolonia_conv_quality_daily as d (
    product_key, day, events, quality_events, unique_people,
    friction, questions, avg_quality, style_mix, top_topics, updated_at
  )
  select
    coalesce(nullif(p_product_key, ''), 'denizen'),
    p_day,
    count(*)::int,
    count(*) filter (where e.is_quality)::int,
    count(distinct e.user_hash)::int,
    count(*) filter (where 'friction' = any (e.signals))::int,
    count(*) filter (where 'question' = any (e.signals))::int,
    avg(e.quality_score)::real,
    coalesce(
      (
        select jsonb_object_agg(style_primary, cnt)
        from (
          select style_primary, count(*)::int as cnt
          from public.dolonia_conv_events e2
          where e2.product_key = coalesce(nullif(p_product_key, ''), 'denizen')
            and e2.event_ts >= v_start and e2.event_ts < v_end
            and e2.style_primary is not null
          group by style_primary
        ) s
      ),
      '{}'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('topic', topic, 'count', cnt) order by cnt desc)
        from (
          select unnest(topics) as topic, count(*)::int as cnt
          from public.dolonia_conv_events e3
          where e3.product_key = coalesce(nullif(p_product_key, ''), 'denizen')
            and e3.event_ts >= v_start and e3.event_ts < v_end
          group by 1
          order by cnt desc
          limit 10
        ) t
      ),
      '[]'::jsonb
    ),
    now()
  from public.dolonia_conv_events e
  where e.product_key = coalesce(nullif(p_product_key, ''), 'denizen')
    and e.event_ts >= v_start and e.event_ts < v_end
  on conflict (product_key, day) do update set
    events = excluded.events,
    quality_events = excluded.quality_events,
    unique_people = excluded.unique_people,
    friction = excluded.friction,
    questions = excluded.questions,
    avg_quality = excluded.avg_quality,
    style_mix = excluded.style_mix,
    top_topics = excluded.top_topics,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Retention: keep events N days; keep profiles/themes/daily forever
create or replace function public.dolonia_conv_retain(
  p_product_key text default 'denizen',
  p_keep_days int default 90
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.dolonia_conv_events
  where product_key = coalesce(nullif(p_product_key, ''), 'denizen')
    and event_ts < (now() - make_interval(days => greatest(7, coalesce(p_keep_days, 90))));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- RLS: service role full access; authenticated read quality aggregates only
alter table public.dolonia_products enable row level security;
alter table public.dolonia_conv_events enable row level security;
alter table public.dolonia_conv_person_styles enable row level security;
alter table public.dolonia_conv_communities enable row level security;
alter table public.dolonia_conv_themes enable row level security;
alter table public.dolonia_conv_quality_daily enable row level security;

-- Drop if re-applied
drop policy if exists dolonia_products_service_all on public.dolonia_products;
drop policy if exists dolonia_conv_events_service_all on public.dolonia_conv_events;
drop policy if exists dolonia_conv_person_styles_service_all on public.dolonia_conv_person_styles;
drop policy if exists dolonia_conv_communities_service_all on public.dolonia_conv_communities;
drop policy if exists dolonia_conv_themes_service_all on public.dolonia_conv_themes;
drop policy if exists dolonia_conv_quality_daily_service_all on public.dolonia_conv_quality_daily;
drop policy if exists dolonia_conv_quality_daily_auth_read on public.dolonia_conv_quality_daily;
drop policy if exists dolonia_products_auth_read on public.dolonia_products;

create policy dolonia_products_service_all on public.dolonia_products
  for all to service_role using (true) with check (true);
create policy dolonia_conv_events_service_all on public.dolonia_conv_events
  for all to service_role using (true) with check (true);
create policy dolonia_conv_person_styles_service_all on public.dolonia_conv_person_styles
  for all to service_role using (true) with check (true);
create policy dolonia_conv_communities_service_all on public.dolonia_conv_communities
  for all to service_role using (true) with check (true);
create policy dolonia_conv_themes_service_all on public.dolonia_conv_themes
  for all to service_role using (true) with check (true);
create policy dolonia_conv_quality_daily_service_all on public.dolonia_conv_quality_daily
  for all to service_role using (true) with check (true);

-- Optional: authenticated can read product catalog + daily quality (no raw events)
create policy dolonia_products_auth_read on public.dolonia_products
  for select to authenticated using (true);
create policy dolonia_conv_quality_daily_auth_read on public.dolonia_conv_quality_daily
  for select to authenticated using (true);

grant select on public.dolonia_products to authenticated, anon;
grant select on public.dolonia_conv_quality_daily to authenticated;
grant select on public.dolonia_conv_quality_events to service_role;
grant execute on function public.dolonia_conv_bump_theme(text, text, int, int, timestamptz) to service_role;
grant execute on function public.dolonia_conv_rollup_daily(text, date) to service_role;
grant execute on function public.dolonia_conv_retain(text, int) to service_role;

comment on table public.dolonia_conv_events is
  'Dolonia quality conversation events. product_key scopes multi-product (denizen first). user_hash only.';
comment on table public.dolonia_conv_person_styles is
  'Communication style profiles for adaptive AI replies across Dolonia products.';
comment on table public.dolonia_conv_quality_daily is
  'Daily quality aggregates — data-company dashboard surface.';
