// Read-only audit: how are visitor sessions linked to user identities?
// Usage: node --env-file=.env scripts/identity-audit.mjs
const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error('SUPABASE_URL / key missing in .env'); process.exit(1); }

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const identities = await get(
  'denizen_user_identities?select=id,email,display_name,tier,source,login_count,last_login_at,primary_session_id,metadata&order=last_login_at.desc&limit=30',
);
console.log(`--- denizen_user_identities (${identities.length}) ---`);
for (const i of identities) {
  const meta = typeof i.metadata === 'object' && i.metadata ? i.metadata : {};
  console.log(
    `${(i.display_name || '?').padEnd(18)} ${(i.email || '?').padEnd(34)} tier=${(i.tier || '?').padEnd(5)}`
    + ` src=${(i.source || '?').padEnd(8)} logins=${String(i.login_count ?? '?').padEnd(3)}`
    + ` host_op=${meta.is_host_operator ? 'Y' : 'n'} ceo=${meta.is_ceo_principal || meta.ceo_principal ? 'Y' : 'n'}`
    + ` id=${String(i.id).slice(0, 8)}`,
  );
}

const sessions = await get(
  'denizen_visitor_sessions?select=id,display_name,identity_id,created_at,last_seen_at,metadata&order=last_seen_at.desc.nullslast&limit=40',
);
console.log(`\n--- denizen_visitor_sessions (${sessions.length} most recent) ---`);
for (const s of sessions) {
  const meta = typeof s.metadata === 'object' && s.metadata ? s.metadata : {};
  console.log(
    `${(s.display_name || '?').padEnd(18)} identity=${s.identity_id ? String(s.identity_id).slice(0, 8) : 'NULL'.padEnd(8)}`
    + ` access=${(meta.access_method || '?').padEnd(10)} tier=${(meta.tier || '?').padEnd(5)}`
    + ` ceo_meta=${meta.is_ceo_principal ? 'Y' : 'n'} seen=${(s.last_seen_at || s.created_at || '').slice(0, 16)}`
    + ` sid=${String(s.id).slice(0, 8)}`,
  );
}

// Cross-tab: sessions per identity
const counts = new Map();
for (const s of sessions) {
  const k = s.identity_id || 'NULL';
  counts.set(k, (counts.get(k) || 0) + 1);
}
console.log('\n--- sessions per identity (within sample) ---');
for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  const ident = identities.find((i) => i.id === k);
  console.log(`${String(n).padStart(3)}x  ${k === 'NULL' ? '(no identity linked)' : `${ident?.display_name || '?'} <${ident?.email || k.slice(0, 8)}>`}`);
}
