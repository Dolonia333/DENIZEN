#!/usr/bin/env node
/**
 * Smoke-test Google API keys for Denizen (Gemini + Gmail expectations).
 * Usage: node scripts/test-google-api-keys.mjs [key1] [key2]
 * Without args, reads denizen/data/google-api-keys.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function probe(label, key) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/profile?key=${key}`;
  const out = { label, gemini: null, gmail: null };

  try {
    const r = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply OK' }] }] }),
    });
    const body = await r.text();
    out.gemini = { ok: r.ok, status: r.status, snippet: body.slice(0, 180) };
  } catch (e) {
    out.gemini = { ok: false, error: e.message };
  }

  try {
    const r = await fetch(gmailUrl);
    const body = await r.text();
    out.gmail = { ok: r.ok, status: r.status, snippet: body.slice(0, 120) };
  } catch (e) {
    out.gmail = { ok: false, error: e.message };
  }

  return out;
}

function loadKeys(argv) {
  if (argv.length >= 2) {
    return [
      { label: 'arg1', key: argv[0] },
      { label: 'arg2', key: argv[1] },
    ];
  }
  const file = path.join(ROOT, 'data', 'google-api-keys.json');
  if (!fs.existsSync(file)) {
    console.error('No keys file and no CLI args. Pass keys or create data/google-api-keys.json');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(doc.keys || {}).map(([label, meta]) => ({ label, key: meta.key }));
}

const pairs = loadKeys(process.argv.slice(2));
const results = [];
for (const { label, key } of pairs) {
  results.push(await probe(label, key));
}
console.log(JSON.stringify(results, null, 2));
