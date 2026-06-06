#!/usr/bin/env node
/**
 * browserclaw.mjs — thin CLI that calls the BrowserClaw HTTP server.
 * Start the server first: cd skills/browserclaw && node server.mjs
 */

const BASE = (process.env.BROWSERCLAW_URL || 'http://127.0.0.1:18792').replace(/\/$/, '');

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

async function main() {
  const args = parseArgs(process.argv);
  const task = args.task || args.query || args.q || '';
  const url = args.url || null;
  const action = String(args.action || 'execute').toLowerCase();

  try {
    if (action === 'health') {
      const res = await fetch(`${BASE}/health`);
      const data = await res.json();
      console.log(JSON.stringify({ ok: res.ok, ...data }));
      return;
    }

    let path = '/execute';
    let body = {};
    if (action === 'execute') {
      if (!task) throw new Error('--task required');
      body = { task };
      if (url) body.url = url;
    } else if (action === 'navigate') {
      path = '/navigate';
      if (!url) throw new Error('--url required for navigate');
      body = { url };
    } else if (action === 'extract') {
      path = '/extract';
      body = { instruction: task || args.instruction || 'Summarize this page' };
    } else if (action === 'act') {
      path = '/act';
      body = { action: task || args.instruction };
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log(JSON.stringify({ ok: res.ok, ...data }));
    if (!res.ok) process.exit(1);
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      error: String(err.message || err),
      hint: 'Start BrowserClaw: cd denizen/jelly/services/browserclaw && node server.mjs',
    }));
    process.exit(1);
  }
}

main();
