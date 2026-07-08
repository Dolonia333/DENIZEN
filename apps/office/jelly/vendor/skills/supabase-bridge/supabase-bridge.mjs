#!/usr/bin/env node
/**
 * supabase-bridge.mjs — CLI for the local secure Supabase proxy (secure-bridge.py).
 *
 * Usage:
 *   node supabase-bridge.mjs --action health
 *   node supabase-bridge.mjs --action tables
 *   node supabase-bridge.mjs --action query --table documents --limit 5
 *   node supabase-bridge.mjs --action insert --table logs --json '{"event":"test","level":"info","detail":{}}'
 */

const BRIDGE_URL = (process.env.SUPABASE_BRIDGE_URL || 'http://127.0.0.1:18790').replace(/\/$/, '');
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      a[key] = next;
      i++;
    } else {
      a[key] = 'true';
    }
  }
  return a;
}

async function bridgeFetch(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${AGENT_TOKEN}` };
  if (body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Bridge ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  return data;
}

async function main() {
  const args = parseArgs(process.argv);
  const action = String(args.action || 'health').toLowerCase();

  if (!AGENT_TOKEN && action !== 'health') {
    console.log(JSON.stringify({ ok: false, error: 'AGENT_TOKEN not set' }));
    process.exit(1);
  }

  try {
    if (action === 'health') {
      const data = await bridgeFetch('/health');
      console.log(JSON.stringify({ ok: true, bridge: BRIDGE_URL, ...data }));
      return;
    }
    if (action === 'tables') {
      const data = await bridgeFetch('/tables');
      console.log(JSON.stringify({ ok: true, tables: data.tables || data }));
      return;
    }
    if (action === 'query') {
      const table = args.table;
      if (!table) throw new Error('--table required for query');
      let filters;
      let select;
      if (args.filters) filters = JSON.parse(args.filters);
      if (args.select) select = JSON.parse(args.select);
      const body = {
        table,
        limit: Number(args.limit) || 10,
      };
      if (filters) body.filters = filters;
      if (select) body.select = select;
      if (args.order) body.order = JSON.parse(args.order);
      const data = await bridgeFetch('/query', { method: 'POST', body });
      console.log(JSON.stringify({ ok: true, data: data.data ?? data }));
      return;
    }
    if (action === 'insert') {
      const table = args.table;
      if (!table || !args.json) throw new Error('--table and --json required for insert');
      const row = JSON.parse(args.json);
      const data = await bridgeFetch('/insert', {
        method: 'POST',
        body: { table, rows: Array.isArray(row) ? row : [row] },
      });
      console.log(JSON.stringify({ ok: true, data: data.data ?? data }));
      return;
    }
    if (action === 'update') {
      const table = args.table;
      if (!table || !args.filters || !args.json) {
        throw new Error('--table, --filters, and --json required for update');
      }
      const data = await bridgeFetch('/update', {
        method: 'POST',
        body: {
          table,
          filters: JSON.parse(args.filters),
          data: JSON.parse(args.json),
        },
      });
      console.log(JSON.stringify({ ok: true, data }));
      return;
    }
    if (action === 'delete') {
      const table = args.table;
      if (!table || !args.filters) throw new Error('--table and --filters required for delete');
      const data = await bridgeFetch('/delete', {
        method: 'POST',
        body: { table, filters: JSON.parse(args.filters) },
      });
      console.log(JSON.stringify({ ok: true, data }));
      return;
    }
    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String(err.message || err) }));
    process.exit(1);
  }
}

main();
