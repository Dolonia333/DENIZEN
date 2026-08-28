#!/usr/bin/env node
'use strict';

/**
 * Wave 5 live dispatch — NPC patrol routes, montage QA, NAS enriched catalog.
 *
 * Requires a Denizen MCP bearer token (Connect AI in the office):
 *   DENIZEN_URL          default http://127.0.0.1:8080
 *   DENIZEN_MCP_TOKEN    or MCP_SMOKE_TOKEN — NPC or team token with delegate scope
 *   WAVE5_NPC_KEY        MCP NPC key used for tools/call (default abby)
 *   WAVE5_DELEGATE_TO    target NPC for patrol routes (default abby)
 *
 * Usage:
 *   node scripts/dispatch-wave5.mjs              # all steps
 *   node scripts/dispatch-wave5.mjs --patrols-only
 *   node scripts/dispatch-wave5.mjs --montage-only
 *   node scripts/dispatch-wave5.mjs --nas-only
 *   node scripts/dispatch-wave5.mjs --dry-run    # print tasks, no MCP/NAS calls
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEN = join(__dirname, '..');
const ROUTES_PATH = join(DEN, 'data/city-specs/npc-patrol-routes.json');
const MONTAGE_SCRIPT = join(DEN, 'scripts/montage-qa-compiled-districts.py');
const NAS_SCRIPT = join(__dirname, '../../infra/setup-city-db-nas.py');

const base = String(process.env.DENIZEN_URL || process.env.DENIZEN_PUBLIC_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const token = String(process.env.DENIZEN_MCP_TOKEN || process.env.MCP_SMOKE_TOKEN || '').trim();
const npcKey = String(process.env.WAVE5_NPC_KEY || process.env.MCP_SMOKE_NPC_KEY || 'abby').toLowerCase();
const delegateTo = String(process.env.WAVE5_DELEGATE_TO || 'abby').trim();

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const patrolsOnly = argv.includes('--patrols-only');
const montageOnly = argv.includes('--montage-only');
const nasOnly = argv.includes('--nas-only');
const all = !patrolsOnly && !montageOnly && !nasOnly;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function formatPatrolTask(route) {
  const wps = route.waypoints.map((w) => `(${w.x},${w.y})`).join(' → ');
  const zones = route.interact_zones
    .slice(0, 8)
    .map((z) => `${z.me} [${z.verb}]`)
    .join('; ');
  const more = route.interact_zones.length > 8 ? ` (+${route.interact_zones.length - 8} more)` : '';
  return [
    `Exterior patrol — ${route.biome} biome (${route.npc_role}).`,
    `Walk waypoints: ${wps}. Dwell ${route.dwell_ms}ms at stops.`,
    zones ? `Interact zones: ${zones}${more}.` : '',
    `Sources: ${(route.sources || []).join(', ')}.`,
    'Use the full-world city plan (?world=full) coordinates.',
  ].filter(Boolean).join(' ');
}

async function mcpInitialize() {
  const url = `${base}/mcp/npc/${encodeURIComponent(npcKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dispatch-wave5', version: '1.0' },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.result?.serverInfo?.name) {
    fail(`MCP initialize failed (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  ok(`MCP connected — ${body.result.serverInfo.name} @ ${url}`);
}

async function mcpCall(toolName, args) {
  const url = `${base}/mcp/npc/${encodeURIComponent(npcKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  const body = await res.json().catch(() => ({}));
  const text = body.result?.content?.[0]?.text;
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }
  }
  if (body.error) {
    fail(`${toolName}: ${body.error.message || JSON.stringify(body.error)}`);
  }
  if (parsed && parsed.ok === false) {
    fail(`${toolName}: ${parsed.error || JSON.stringify(parsed)}`);
  }
  return parsed ?? body.result ?? body;
}

async function dispatchPatrols() {
  if (!existsSync(ROUTES_PATH)) fail(`missing ${ROUTES_PATH}`);
  const doc = JSON.parse(readFileSync(ROUTES_PATH, 'utf8'));
  const routes = doc.routes || [];
  console.log(`\n=== W5-A: ${routes.length} patrol route(s) → delegate_task(${delegateTo}) ===`);

  if (dryRun) {
    for (const route of routes) {
      console.log(`[dry-run] ${route.biome}: ${formatPatrolTask(route).slice(0, 120)}…`);
    }
    return;
  }
  if (!token) {
    fail('DENIZEN_MCP_TOKEN (or MCP_SMOKE_TOKEN) required — mint via Connect AI in the office');
  }

  await mcpInitialize();
  let assigned = 0;
  for (const route of routes) {
    const task = formatPatrolTask(route);
    const result = await mcpCall('delegate_task', {
      to_npc: delegateTo,
      task,
      urgent: false,
    });
    ok(`${route.biome} → ${result.to_npc || delegateTo}`);
    assigned += 1;
  }
  ok(`dispatched ${assigned} patrol route(s)`);
}

function runMontageQa() {
  console.log('\n=== W5-B: montage QA (compiled districts) ===');
  const args = [MONTAGE_SCRIPT];
  if (argv.includes('--no-render')) args.push('--no-render');
  const r = spawnSync('python3', args, { cwd: DEN, stdio: 'inherit' });
  if (r.status !== 0) fail('montage QA reported hard defects');
  ok('montage QA clean');
}

function runNasImport() {
  console.log('\n=== W5-C: NAS enriched catalog import ===');
  if (dryRun) {
    console.log('[dry-run] would run: python3 infra/setup-city-db-nas.py --enriched');
    return;
  }
  if (!process.env.SYNO_SSH_PASSWORD) {
    fail('SYNO_SSH_PASSWORD required for NAS import (or run from a machine on your LAN)');
  }
  const r = spawnSync('python3', [NAS_SCRIPT, '--enriched'], {
    cwd: join(DEN, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) fail('NAS catalog import failed');
  ok('NAS city.limezu_assets enriched load complete');
}

async function main() {
  console.log(`dispatch-wave5 → ${base} npc=${npcKey} delegate=${delegateTo}${dryRun ? ' (dry-run)' : ''}`);

  if (all || patrolsOnly) await dispatchPatrols();
  if (all || montageOnly) runMontageQa();
  if (all || nasOnly) runNasImport();

  console.log('\nWave 5 dispatch complete.');
}

main().catch((err) => fail(err.message));
