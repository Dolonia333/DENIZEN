-- Denizen: work output, artifacts, LLM telemetry, office events
-- Requires: 20260606000000_denizen_foundation.sql

-- Pier pipeline: WS npc_work_output → insert
create table if not exists public.denizen_work_output (
  id uuid primary key default gen_random_uuid(),
  office_session_id uuid references public.denizen_office_sessions(id) on delete set null,
  ts timestamptz not null default now(),
  npc_key text not null references public.denizen_npcs(npc_key),
  role text,
  phase text,
  action text,
  note text,
  artifact_path text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_work_output_npc_ts_idx
  on public.denizen_work_output (npc_key, ts desc);
create index if not exists denizen_work_output_session_idx
  on public.denizen_work_output (office_session_id);

-- reports/*.md metadata (body stays on disk)
create table if not exists public.denizen_artifacts (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  category text,
  severity text,
  author_npc text references public.denizen_npcs(npc_key),
  work_output_id uuid references public.denizen_work_output(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

-- Replaces data/llm-telemetry.jsonl over time (append-only)
create table if not exists public.denizen_llm_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  npc_key text,
  kind text not null,
  provider text,
  model text,
  latency_ms integer,
  tokens_in integer,
  tokens_out integer,
  error text,
  prompt_preview text,
  response_preview text,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_llm_events_at_idx
  on public.denizen_llm_events (at desc);
create index if not exists denizen_llm_events_npc_kind_idx
  on public.denizen_llm_events (npc_key, kind, at desc);

-- Office-wide feed (npc-brains _eventFeed + worldState.recentEvents)
create table if not exists public.denizen_office_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null,
  text text not null,
  npc_key text references public.denizen_npcs(npc_key),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_office_events_at_idx
  on public.denizen_office_events (at desc);

-- Structured MEMORY.md lines (optional mirror; SOUL/MEMORY files remain source for prompts)
create table if not exists public.denizen_npc_memories (
  id uuid primary key default gen_random_uuid(),
  npc_key text not null references public.denizen_npcs(npc_key),
  recorded_at timestamptz not null default now(),
  body text not null,
  topic text,
  outcome text,
  skill_tag text,
  task_phase text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists denizen_npc_memories_npc_at_idx
  on public.denizen_npc_memories (npc_key, recorded_at desc);

insert into public.denizen_schema_migrations (version, name)
values ('20260606000002', 'denizen_work_and_events')
on conflict (version) do nothing;
