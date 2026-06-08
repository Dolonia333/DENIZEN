'use strict';

const fs = require('node:fs');
const path = require('node:path');

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8081';

async function j(method, pathSuffix, body, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${base}${pathSuffix}`, {
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

function sessionHeaders(sessionId, extra = {}) {
  return {
    'X-Session-Id': sessionId,
    'X-Denizen-Client': 'desktop',
    'X-Denizen-Local-Client': '1',
    ...extra,
  };
}

function checkVisitorSessionExports() {
  const srcPath = path.join(__dirname, '..', 'src', 'visitor-session.js');
  const src = fs.readFileSync(srcPath, 'utf8');
  const hasLogout = /\blogout\s*\(\s*\)\s*\{/.test(src) || /async\s+logout\s*\(/.test(src);
  const hasGetProfile = /\bgetProfile\s*\(\s*\)\s*\{/.test(src);
  return { hasLogout, hasGetProfile, ok: hasLogout && hasGetProfile };
}

async function main() {
  const results = [];
  const tag = `mesh-${Date.now()}`;

  const exportsCheck = checkVisitorSessionExports();
  results.push(['visitor_session_logout_method', exportsCheck.hasLogout, exportsCheck]);
  results.push(['visitor_session_getProfile_method', exportsCheck.hasGetProfile, exportsCheck]);

  const demo = await j('POST', '/api/visitor/session', {
    demo: true,
    display_name: `Mesh ${tag}`,
  });
  const sessionId = demo.session?.id;
  results.push([
    'demo_session',
    demo.status === 200 && demo.ok && demo.org?.slug === 'acme' && sessionId,
    demo,
  ]);

  if (!sessionId) {
    report(results);
    return;
  }

  const wizard = await j('POST', '/api/desktop/wizard/complete', {
    session_id: sessionId,
    agent_permission_level: 'ask',
    opt_in: true,
    desktop_capabilities: { contribute_compute: true, network_jobs: true },
  }, sessionHeaders(sessionId));
  results.push([
    'wizard_identity_bootstrap',
    wizard.status === 200 && wizard.ok && wizard.profile?.identity_id,
    wizard,
  ]);

  const summary = await j(
    'GET',
    `/api/compute/contribution/summary?session_id=${encodeURIComponent(sessionId)}`,
    null,
    sessionHeaders(sessionId),
  );
  results.push([
    'contribution_summary',
    summary.status === 200
      && summary.ok
      && Array.isArray(summary.contribution_modes)
      && typeof summary.contribution_level === 'string',
    summary,
  ]);

  const status = await j(
    'GET',
    `/api/compute/node/status?session_id=${encodeURIComponent(sessionId)}`,
    null,
    sessionHeaders(sessionId),
  );
  const resolvedIdentityId = summary.identity_id
    || wizard.profile?.identity_id
    || demo.identity?.id
    || status.profile?.identity_id
    || null;
  results.push([
    'node_status',
    status.status === 200 && status.ok,
    status,
  ]);

  const ceoStatus = await j(
    'GET',
    `/api/compute/node/status?session_id=${encodeURIComponent(sessionId)}`,
    null,
    {
      'X-Session-Id': sessionId,
      'X-Ceo-Principal': '1',
      'X-Denizen-Client': 'host',
      'X-Denizen-Local-Client': '1',
    },
  );
  results.push([
    'ceo_host_operator_detected',
    ceoStatus.status === 200
      && ceoStatus.ok
      && ceoStatus.contributor_state === 'host'
      && ceoStatus.is_host_operator === true
      && ceoStatus.needs_desktop_download === false,
    ceoStatus,
  ]);

  let nodeId = null;
  let nodeToken = null;
  let dbEnabled = summary.db_enabled ?? status.db_enabled ?? wizard.db_enabled;

  if (resolvedIdentityId) {
    const register = await j('POST', '/api/compute/node/register', {
      identityId: resolvedIdentityId,
    }, sessionHeaders(sessionId));
    dbEnabled = register.db_enabled ?? dbEnabled;
    nodeId = register.node?.id || null;
    nodeToken = register.node?.endpoint_token || null;
    const registerOk = register.status === 200
      && (register.ok ? (!!nodeId && !!nodeToken) : dbEnabled === false);
    results.push([
      'node_register_post',
      registerOk,
      register,
    ]);

    const registerGet = await j(
      'GET',
      `/api/compute/node/register?identity_id=${encodeURIComponent(resolvedIdentityId)}`,
      null,
      sessionHeaders(sessionId),
    );
    results.push([
      'node_register_get',
      registerGet.status === 200,
      registerGet,
    ]);
  } else {
    results.push(['node_register_post', false, { error: 'identity unavailable' }]);
    results.push(['node_register_get', false, { error: 'skipped — no identity' }]);
  }

  if (nodeId && nodeToken) {
    const claimPost = await j('POST', '/api/compute/node/claim', {
      nodeId,
      nodeToken,
    }, sessionHeaders(sessionId));
    results.push([
      'node_claim_post',
      claimPost.status === 200 && claimPost.ok,
      claimPost,
    ]);

    const claimGet = await j(
      'GET',
      `/api/compute/node/claim?node_id=${encodeURIComponent(nodeId)}&token=${encodeURIComponent(nodeToken)}`,
      null,
      sessionHeaders(sessionId),
    );
    results.push([
      'node_claim_get',
      claimGet.status === 200 && claimGet.ok,
      claimGet,
    ]);

    const completeNoJob = await j(
      'GET',
      `/api/compute/node/complete?node_id=${encodeURIComponent(nodeId)}&token=${encodeURIComponent(nodeToken)}`,
      null,
      sessionHeaders(sessionId),
    );
    results.push([
      'node_complete_get_requires_job',
      completeNoJob.status === 400 && completeNoJob.error?.includes('jobId'),
      completeNoJob,
    ]);

    if (claimPost.job?.id) {
      const completePost = await j('POST', '/api/compute/node/complete', {
        nodeId,
        nodeToken,
        jobId: claimPost.job.id,
        result: { ok: true, smoke: tag },
      }, sessionHeaders(sessionId));
      results.push([
        'node_complete_post',
        completePost.status === 200 && completePost.ok,
        completePost,
      ]);
    } else {
      results.push(['node_complete_post', true, { note: 'no queued job — claim ok is sufficient' }]);
    }
  } else {
    const claimGetFallback = await j(
      'GET',
      '/api/compute/node/claim?node_id=smoke-node&token=smoke-token',
      null,
      sessionHeaders(sessionId),
    );
    results.push([
      'node_claim_get',
      claimGetFallback.status === 401,
      claimGetFallback,
    ]);

    const completeGetFallback = await j(
      'GET',
      '/api/compute/node/complete?node_id=smoke-node&token=smoke-token',
      null,
      sessionHeaders(sessionId),
    );
    results.push([
      'node_complete_get_requires_job',
      completeGetFallback.status === 401 || completeGetFallback.status === 400,
      completeGetFallback,
    ]);

    results.push(['node_claim_post', dbEnabled === false, { note: 'register skipped — db disabled', dbEnabled }]);
    results.push(['node_complete_post', dbEnabled === false, { note: 'register skipped — db disabled', dbEnabled }]);
  }

  report(results);
}

function report(results) {
  let failed = 0;
  for (const [name, ok, detail] of results) {
    const mark = ok ? 'PASS' : 'FAIL';
    if (!ok) failed += 1;
    console.log(`${mark} ${name}`, ok ? '' : JSON.stringify({
      status: detail.status,
      error: detail.error,
      code: detail.code,
      note: detail.note,
    }));
  }
  const passed = results.length - failed;
  const meshReady = failed === 0;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  console.log(`MESH_READY ${meshReady}`);
  if (!meshReady) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  console.log('MESH_READY false');
  process.exit(1);
});
