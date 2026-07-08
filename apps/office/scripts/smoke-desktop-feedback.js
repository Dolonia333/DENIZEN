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
  const tag = `smoke-fb-${Date.now()}`;

  const demo = await j('POST', '/api/visitor/session', {
    demo: true,
    display_name: `Feedback ${tag}`,
  });
  const sessionId = demo.session?.id;
  results.push([
    'demo_session',
    demo.status === 200 && demo.ok && sessionId,
    demo,
  ]);

  if (!sessionId) {
    report(results);
    return;
  }

  const submitPost = await j('POST', '/api/desktop/feedback', {
    session_id: sessionId,
    install_id: `install-${tag}`,
    app_version: '0.1.0-smoke',
    platform: process.platform,
    arch: process.arch,
    os_version: 'smoke',
    channel: 'dev',
    event: 'smoke_test',
    detail: `feedback smoke ${tag}`,
    logs_tail: 'smoke log line',
  }, sessionHeaders(sessionId));
  results.push([
    'feedback_submit_post',
    submitPost.status === 200 && submitPost.ok && submitPost.record?.event === 'smoke_test',
    submitPost,
  ]);

  const tunnelQs = new URLSearchParams({
    event: 'smoke_tunnel',
    detail: `tunnel ${tag}`,
    install_id: `install-tunnel-${tag}`,
    app_version: '0.1.0-smoke',
    platform: process.platform,
    arch: process.arch,
    os_version: 'smoke',
    channel: 'dev',
  });
  const submitGet = await j(
    'GET',
    `/api/desktop/feedback?${tunnelQs.toString()}`,
    null,
    sessionHeaders(sessionId),
  );
  results.push([
    'feedback_submit_get_tunnel',
    submitGet.status === 200 && submitGet.ok && submitGet.record?.id,
    submitGet,
  ]);

  const recent = await j(
    'GET',
    '/api/desktop/feedback/recent?limit=10',
    null,
    sessionHeaders(sessionId),
  );
  const found = Array.isArray(recent.items)
    && recent.items.some((row) => row.detail && String(row.detail).includes(tag));
  results.push([
    'feedback_recent_list',
    recent.status === 200 && recent.ok && found,
    recent,
  ]);

  const sync = await j('GET', '/api/desktop/capabilities/sync', null, sessionHeaders(sessionId));
  results.push([
    'capabilities_min_desktop_version',
    sync.status === 200 && typeof sync.min_desktop_version === 'string' && sync.min_desktop_version.length > 0,
    sync,
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
