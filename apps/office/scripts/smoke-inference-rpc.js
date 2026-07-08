'use strict';

const base = process.env.DENIZEN_URL || 'http://127.0.0.1:8081';

async function j(method, pathSuffix, body, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
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

function report(results) {
  let failed = 0;
  for (const [name, ok, detail] of results) {
    console.log(`${ok ? 'OK' : 'FAIL'} ${name}`);
    if (!ok) {
      failed += 1;
      console.log('  ', JSON.stringify(detail).slice(0, 300));
    }
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exit(1);
}

async function main() {
  const results = [];

  const health = await j('GET', '/api/health');
  results.push([
    'health_ok',
    health.status === 200 && health.ok,
    { inference: health.inference, pool: health.lmStudioPool?.enabled },
  ]);

  const nodes = await j('GET', '/api/compute/inference/nodes');
  results.push([
    'inference_nodes',
    nodes.status === 200 && nodes.ok && Array.isArray(nodes.nodes),
    { count: nodes.nodes?.length, selected: nodes.selected },
  ]);

  const catalog = await j('GET', '/api/compute/inference/catalog');
  results.push([
    'inference_catalog',
    catalog.status === 200 && catalog.ok && Array.isArray(catalog.models) && catalog.models.length > 0,
    { models: catalog.models?.length },
  ]);

  const queue = await j('GET', '/api/compute/node/status');
  results.push([
    'node_status_inference_block',
    queue.status === 200 && queue.ok && queue.inference != null,
    { inference_enabled: queue.inference?.enabled },
  ]);

  const runtime = require('../src/compute/denizen-inference-runtime');
  const block = runtime.buildInferenceBlockFromProbe({
    backend: 'ollama',
    url: 'http://127.0.0.1:11434',
    reachable: true,
    models: ['llama3.2'],
    main_model: 'llama3.2',
    probed_at: new Date().toISOString(),
  });
  results.push([
    'runtime_rpc_capable',
    block.rpc_capable === true,
    block,
  ]);

  const queueMod = require('../src/compute/denizen-compute-queue');
  results.push([
    'targeted_job_match',
    queueMod.jobMatchesNode(
      { payload: { target_machine_id: 'desktop-test' } },
      'node-1',
      null,
      { machineId: 'desktop-test' },
    ),
    {},
  ]);

  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
