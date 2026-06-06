insert into public.denizen_organizations (slug, display_name, plan, settings)
values ('acme', 'Acme Corp (Demo)', 'trial', '{"demo": true}'::jsonb)
on conflict (slug) do nothing;
insert into public.denizen_schema_migrations (version, name)
values ('20260606000008', 'denizen_demo_org') on conflict do nothing;
