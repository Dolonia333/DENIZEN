'use strict';

const base = (process.env.DENIZEN_URL || 'https://denizen.dolonia.cloud').replace(/\/$/, '');

async function head(pathSuffix) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${base}${pathSuffix}`, { method: 'HEAD', signal: ctrl.signal });
    return { status: r.status, ok: r.ok };
  } finally {
    clearTimeout(t);
  }
}

async function getYaml(pathSuffix) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${base}${pathSuffix}`, { signal: ctrl.signal });
    const text = await r.text();
    return { status: r.status, text };
  } finally {
    clearTimeout(t);
  }
}

function report(results) {
  let pass = 0;
  let fail = 0;
  for (const [name, ok, detail] of results) {
    if (ok) {
      pass += 1;
      console.log(`PASS ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
  }
  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  const ready = fail === 0;
  console.log(`DESKTOP_UPDATES_READY ${ready}`);
  process.exit(ready ? 0 : 1);
}

async function main() {
  const results = [];

  const manifest = await getYaml('/desktop/updates/latest.yml');
  const hasVersion = /^\s*version:\s*.+/m.test(manifest.text || '');
  const hasPath = /^\s*path:\s*.+/m.test(manifest.text || '');
  results.push([
    'latest_yml',
    manifest.status === 200 && hasVersion && hasPath,
    `status=${manifest.status}`,
  ]);

  const installer = manifest.text?.match(/^\s*path:\s*(\S+)/m)?.[1];
  if (installer) {
    const exe = await head(`/desktop/updates/${installer}`);
    results.push(['installer_binary', exe.status === 200, `status=${exe.status}`]);
  } else {
    results.push(['installer_binary', false, 'no path in latest.yml']);
  }

  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
