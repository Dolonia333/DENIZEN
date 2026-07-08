// One-time cleanup: the old host-operator detection marked every tunneled
// visitor as the host (is_host_operator: true on their identity metadata).
// Clears the flag from every identity except the real CEO/host one, and
// stamps is_ceo_principal on the CEO identity.
// Usage (from apps/office/): node --env-file=.env scripts/scrub-host-flags.mjs
const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error('SUPABASE_URL / key missing in .env'); process.exit(1); }

const CEO_EMAILS = new Set(
  [
    process.env.DENIZEN_CEO_IDENTITY_EMAIL,
    `ceo@${process.env.DENIZEN_ORG_SLUG || 'zion'}.denizen.local`,
  ].filter(Boolean).map((e) => e.trim().toLowerCase()),
);

async function api(path, opts = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const rows = await fetch(
  `${url}/rest/v1/denizen_user_identities?select=id,email,display_name,metadata&limit=1000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
).then((r) => r.json());

let scrubbed = 0;
let ceoStamped = 0;
for (const row of rows) {
  const email = String(row.email || '').toLowerCase();
  const meta = row.metadata && typeof row.metadata === 'object' ? { ...row.metadata } : {};
  const isCeo = CEO_EMAILS.has(email);

  if (isCeo) {
    if (!meta.is_ceo_principal || !meta.is_host_operator) {
      meta.is_ceo_principal = true;
      meta.is_host_operator = true;
      await api(`denizen_user_identities?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ metadata: meta }),
      });
      ceoStamped += 1;
      console.log(`stamped CEO   ${row.display_name} <${row.email}>`);
    }
    continue;
  }

  if (meta.is_host_operator || meta.host_operator_marked_at || meta.is_ceo_principal) {
    delete meta.is_host_operator;
    delete meta.host_operator_marked_at;
    delete meta.is_ceo_principal;
    delete meta.ceo_principal;
    await api(`denizen_user_identities?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: meta }),
    });
    scrubbed += 1;
    console.log(`scrubbed      ${row.display_name} <${row.email}>`);
  }
}
console.log(`\nDone: ${scrubbed} identities scrubbed, ${ceoStamped} CEO identity stamped, ${rows.length} total checked.`);
