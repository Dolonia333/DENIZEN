-- Allow outcomes/predictions keyed by entity_key (job applications use text ids)
alter table public.denizen_outcomes
  alter column entity_id drop not null;

alter table public.denizen_predictions
  alter column entity_id drop not null;

insert into public.denizen_schema_migrations (version, name)
values ('20260606000007', 'entity_key_nullable')
on conflict (version) do nothing;
