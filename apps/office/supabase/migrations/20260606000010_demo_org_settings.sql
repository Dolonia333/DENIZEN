-- Demo org sandbox settings: acme is read-only for business tables; zion keeps full access.

update public.denizen_organizations
set settings = settings || '{"tier":"demo","allow_business_data":false,"allow_real_work":false,"allow_ceo_handoff":false}'::jsonb
where slug = 'acme';

update public.denizen_organizations
set settings = settings || '{"tier":"team","allow_business_data":true,"allow_real_work":true,"allow_ceo_handoff":true}'::jsonb
where slug = 'zion';

insert into public.denizen_schema_migrations (version, name)
values ('20260606000010', 'demo_org_settings')
on conflict (version) do nothing;
