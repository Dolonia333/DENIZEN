'use strict';

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8080';

async function j(method, path, body, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: r.status, ...data };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const results = [];

  const verify = await j('POST', '/api/visitor/access/verify', { code: '1921', kind: 'team' });
  results.push(['team_verify', verify.status === 200 && verify.ok && verify.access_grant, verify]);

  const demo = await j('POST', '/api/visitor/session', { demo: true, display_name: 'Demo Guest' });
  results.push(['demo_session', demo.status === 200 && demo.org?.slug === 'acme', demo]);

  const spoof = await j('POST', '/api/visitor/session', {
    display_name: 'Hacker',
    metadata: { tier: 'team', org_slug: 'zion' },
  });
  results.push(['spoof_blocked', spoof.status === 403 && spoof.code === 'DENIED', spoof]);

  let team = null;
  if (verify.access_grant) {
    team = await j('POST', '/api/visitor/session', {
      display_name: 'Zion Teammate',
      access_grant: verify.access_grant,
    });
    results.push(['team_session', team.status === 200 && team.org?.slug === 'zion' && team.session_token, team]);
  }

  if (team?.session?.id && team.session_token) {
    const claimBad = await j('POST', '/api/visitor/claim', {
      session_id: team.session.id,
      npc_key: 'bob',
    });
    results.push(['claim_no_token_denied', claimBad.status === 403, claimBad]);

    const claimOk = await j('POST', '/api/visitor/claim', {
      session_id: team.session.id,
      npc_key: 'bob',
    }, { 'X-Session-Token': team.session_token });
    results.push(['claim_with_token', claimOk.status === 200 && claimOk.ok, claimOk]);
  }

  if (demo.session?.id) {
    const ceo = await j('POST', '/api/visitor/handoff', {
      from_session_id: demo.session.id,
      message: 'hi',
      to_ceo: true,
    });
    results.push(['demo_ceo_handoff_blocked', ceo.status === 403 && ceo.code === 'DEMO_RESTRICTED', ceo]);
  }

  const policy = await j('GET', '/api/org/policy?slug=acme&table=intake_forms');
  results.push(['acme_intake_blocked', policy.status === 200 && policy.allowed === false, policy]);

  const ceoVerify = await j('POST', '/api/visitor/access/verify', { code: 'wrong', kind: 'ceo' });
  results.push(['ceo_code_rejects_wrong', ceoVerify.ok === false, ceoVerify]);

  let failed = 0;
  for (const [name, ok, detail] of results) {
    const mark = ok ? 'PASS' : 'FAIL';
    if (!ok) failed += 1;
    console.log(`${mark} ${name}`, ok ? '' : JSON.stringify({
      status: detail.status,
      code: detail.code,
      error: detail.error,
    }));
  }
  if (failed) process.exit(1);
  console.log(`All ${results.length} smoke checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
