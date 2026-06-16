-- Rebrand default org display name (slug stays internal; CRM shows display_name).
update public.denizen_organizations
set display_name = 'Dolo'
where slug = 'zion'
  and display_name ilike '%zion%';

insert into public.denizen_schema_migrations (version, name)
values ('20260612000002', 'org_display_name_dolo')
on conflict (version) do nothing;
