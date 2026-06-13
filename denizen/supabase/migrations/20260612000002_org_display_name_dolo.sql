-- Rebrand default org display name (slug stays internal; CRM shows display_name).
update public.denizen_organizations
set display_name = 'Dolo'
where slug = 'zion'
  and display_name ilike '%zion%';
