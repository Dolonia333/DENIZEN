-- Register Grok NPC for MCP tokens, agent_souls FK, and office roster.

insert into public.denizen_npcs (npc_key, display_name, role, folder, protected, claimable)
values ('grok', 'Grok', 'xAI Researcher & Engineer', 'grok', false, true)
on conflict (npc_key) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  folder = excluded.folder,
  claimable = excluded.claimable,
  updated_at = now();

insert into public.denizen_schema_migrations (version, name)
values ('20260624000002', 'add_grok_npc')
on conflict (version) do nothing;
