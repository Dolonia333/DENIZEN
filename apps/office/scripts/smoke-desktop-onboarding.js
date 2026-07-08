'use strict';

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8081';

async function j(method, path, body, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
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

function sessionHeaders(sessionId, extra = {}) {
  return { 'X-Session-Id': sessionId, 'X-Denizen-Client': 'desktop', ...extra };
}

async function main() {
  const results = [];
  const tag = `smoke-${Date.now()}`;

  const demo = await j('POST', '/api/visitor/session', {
    demo: true,
    display_name: `Desktop ${tag}`,
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

  const pair = await j('GET', '/api/desktop/pairing/create', null, sessionHeaders(sessionId));
  results.push([
    'pairing_create',
    pair.status === 200 && pair.ok && pair.token && pair.deep_link?.includes('denizen://pair'),
    pair,
  ]);

  const token = pair.token;
  const claim = token
    ? await j('GET', `/api/desktop/pairing/claim?token=${encodeURIComponent(token)}`)
    : { status: 0, ok: false };
  results.push([
    'pairing_claim',
    claim.status === 200 && claim.ok && claim.session_id === sessionId,
    claim,
  ]);

  const replay = token
    ? await j('GET', `/api/desktop/pairing/claim?token=${encodeURIComponent(token)}`)
    : { status: 0, ok: false };
  results.push([
    'pairing_replay_403',
    replay.status === 403 && replay.ok === false,
    replay,
  ]);

  const pendingEmpty = await j('GET', '/api/desktop/permission/pending', null, sessionHeaders(sessionId));
  results.push([
    'permission_pending_empty',
    pendingEmpty.status === 200 && pendingEmpty.ok && pendingEmpty.pending == null,
    pendingEmpty,
  ]);

  const wizard = await j('POST', '/api/desktop/wizard/complete', {
    session_id: sessionId,
    desktop_install_id: `smoke-install-${tag}`,
    agent_permission_level: 'trusted',
    opt_in: true,
    desktop_capabilities: {
      read_files: true,
      run_code: true,
      contribute_compute: true,
    },
  }, sessionHeaders(sessionId));
  results.push([
    'wizard_complete',
    wizard.status === 200 && wizard.ok && wizard.profile?.setup_wizard_completed,
    wizard,
  ]);

  const installId = wizard.profile?.desktop_install_id || `smoke-install-${tag}`;
  const stationTaskQueue = require('../src/station/denizen-station-task-queue');
  const enqueued = await stationTaskQueue.enqueueTask({
    sessionId,
    installId,
    kind: 'file_read',
    instruction: `/tmp/smoke-${tag}.txt`,
  });
  results.push([
    'station_enqueue',
    !!enqueued?.queued && !!enqueued?.task?.id,
    { queued: enqueued?.queued, taskId: enqueued?.task?.id },
  ]);

  const stationClaim = enqueued?.task?.id
    ? await j(
      'GET',
      `/api/desktop/station/tasks/claim?install_id=${encodeURIComponent(installId)}`,
      null,
      sessionHeaders(sessionId, { 'X-Desktop-Install-Id': installId }),
    )
    : { status: 0, ok: false };
  results.push([
    'station_claim',
    stationClaim.status === 200 && stationClaim.ok && stationClaim.task?.id === enqueued?.task?.id,
    stationClaim,
  ]);

  const stationComplete = enqueued?.task?.id
    ? await j('POST', '/api/desktop/station/tasks/complete', {
      session_id: sessionId,
      task_id: enqueued.task.id,
      install_id: installId,
      ok: true,
      summary: `smoke read ${tag}`,
    }, sessionHeaders(sessionId, { 'X-Desktop-Install-Id': installId }))
    : { status: 0, ok: false };
  results.push([
    'station_complete',
    stationComplete.status === 200 && stationComplete.ok,
    stationComplete,
  ]);

  const permAsk = await j('POST', '/api/desktop/permission/request', {
    session_id: sessionId,
    capability: 'run_code',
    detail: `smoke ${tag}`,
    npc: 'Abby',
  }, sessionHeaders(sessionId, { 'X-Agent-Permission-Level': 'ask' }));
  const requestId = permAsk.request_id || permAsk.requestId || null;
  results.push([
    'permission_request_ask_enqueue',
    permAsk.status === 200 && permAsk.ok && permAsk.pending === true && requestId,
    permAsk,
  ]);

  const pending = await j('GET', '/api/desktop/permission/pending', null, sessionHeaders(sessionId));
  results.push([
    'permission_pending_has_request',
    pending.status === 200 && pending.ok && pending.pending?.id === requestId,
    pending,
  ]);

  const respond = requestId
    ? await j('POST', '/api/desktop/permission/respond', {
      session_id: sessionId,
      request_id: requestId,
      approved: true,
    }, sessionHeaders(sessionId))
    : { status: 0, ok: false };
  results.push([
    'permission_respond',
    respond.status === 200 && respond.ok && respond.approved === true,
    respond,
  ]);

  const pendingAfter = await j('GET', '/api/desktop/permission/pending', null, sessionHeaders(sessionId));
  results.push([
    'permission_pending_cleared',
    pendingAfter.status === 200 && pendingAfter.ok && pendingAfter.pending == null,
    pendingAfter,
  ]);

  const sync = await j('GET', '/api/desktop/capabilities/sync', null, sessionHeaders(sessionId, {
    'X-Opt-In': 'true',
    'X-Agent-Permission-Level': 'trusted',
  }));
  results.push([
    'capabilities_sync',
    sync.status === 200 && sync.ok && sync.profile?.agent_permission_level === 'trusted',
    sync,
  ]);

  const permTrusted = await j('POST', '/api/desktop/permission/request', {
    session_id: sessionId,
    capability: 'run_code',
    detail: 'trusted auto',
  }, sessionHeaders(sessionId));
  results.push([
    'permission_trusted_auto_approve',
    permTrusted.status === 200 && permTrusted.ok && permTrusted.pending === false && permTrusted.approved === true,
    permTrusted,
  ]);

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
    }));
  }
  const passed = results.length - failed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
