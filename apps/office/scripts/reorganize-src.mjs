#!/usr/bin/env node
/**
 * One-shot src/ reorganization: move flat modules into domain folders and
 * rewrite require/script paths across the office app tree.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Files that must stay at src/ root (bootstrap / cross-cutting). */
const KEEP_ROOT = new Set([
  'load-env.js',
  'logger.js',
  'world-state.js',
  'agent-bus.js',
  'pathfinding.js',
  'denizen-lazy-scripts.js',
  'route-registry.js',
  'chat-bootstrap.js',
  'tabler-icons.js',
  'touch-bind.js',
  'device-profile.js',
  'public-demo-mode.js',
  'gateway-bridge.js',
  'openclaw-chat.js',
  'openclaw-translator.js',
  'openclaw-worldstate-bridge.js',
  'openclaw-dispatch.js',
  'spectate-routing.js',
  'spectate-ui.js',
  'demo-scene.js',
  'demo-roster.js',
  'freeze-watchdog.js',
  'movement-guard.js',
  'office-bus.js',
  'office-director.js',
  'openplan-walls.js',
  'room-tile-renderer.js',
  'RoomAssembly.js',
  'RoomBuilder.js',
  'RoomGenerator.js',
]);

/** Prefix / pattern → target folder under src/. */
const RULES = [
  { re: /^denizen-crm-/, dir: 'crm' },
  { re: /^denizen-mcp-/, dir: 'mcp' },
  { re: /^denizen-compute-/, dir: 'compute' },
  { re: /^denizen-station-/, dir: 'station' },
  { re: /^denizen-desktop-/, dir: 'desktop' },
  { re: /^denizen-voice-/, dir: 'voice' },
  { re: /^denizen-achievements/, dir: 'office-hq' },
  { re: /^denizen-npc-stats/, dir: 'office-hq' },
  { re: /^denizen-office-progress/, dir: 'office-hq' },
  { re: /^denizen-quests/, dir: 'office-hq' },
  { re: /^office-hq-/, dir: 'office-hq' },
  { re: /^office-level-/, dir: 'office-hq' },
  { re: /^office-quests-/, dir: 'office-hq' },
  { re: /^npc-leaderboard-/, dir: 'office-hq' },
  { re: /^visitor-/, dir: 'visitors' },
  { re: /^denizen-visitor/, dir: 'visitors' },
  { re: /^denizen-team-/, dir: 'auth' },
  { re: /^denizen-demo-auth/, dir: 'auth' },
  { re: /^denizen-user-/, dir: 'auth' },
  { re: /^denizen-org-/, dir: 'auth' },
  { re: /-panel\.js$/, dir: 'hud/panels' },
  { re: /^bottom-dock/, dir: 'hud' },
  { re: /^mobile-/, dir: 'hud' },
  { re: /^denizen-phone-/, dir: 'hud' },
  { re: /^work-feed/, dir: 'hud' },
  { re: /^mesh-alert-toast/, dir: 'hud' },
  { re: /^diag\.js$/, dir: 'hud' },
  { re: /^player-chat/, dir: 'hud' },
  { re: /^proposals-panel/, dir: 'hud' },
  { re: /^content-pipeline-panel/, dir: 'hud' },
  { re: /^assistant-mode/, dir: 'hud' },
  { re: /^npc-/, dir: 'npc' },
  { re: /^agent-/, dir: 'npc' },
  { re: /^bouncer-/, dir: 'security' },
  { re: /^security-/, dir: 'security' },
  { re: /^robber-/, dir: 'security' },
  { re: /^linux-agent/, dir: 'security' },
  { re: /^pc-activity-tracker/, dir: 'security' },
  { re: /^screen-/, dir: 'security' },
  { re: /^permission-registry/, dir: 'security' },
  { re: /^voice-/, dir: 'voice' },
  { re: /^elevenlabs-provider/, dir: 'voice' },
  { re: /^elevenlabs-tts/, dir: 'voice' },
  { re: /^proximity-audio/, dir: 'voice' },
  { re: /^sfx\.js$/, dir: 'voice' },
  { re: /^llm-telemetry/, dir: 'intelligence' },
  { re: /^mirofish-/, dir: 'intelligence' },
  { re: /^denizen-prediction-/, dir: 'intelligence' },
  { re: /^denizen-db/, dir: 'intelligence' },
  { re: /^telemetry-/, dir: 'intelligence' },
  { re: /^external-sink/, dir: 'intelligence' },
  { re: /^hallucination-guard/, dir: 'intelligence' },
  { re: /^prompt-tuning/, dir: 'intelligence' },
  { re: /^away-notify/, dir: 'intelligence' },
  { re: /^federal-pipeline/, dir: 'intelligence' },
  { re: /^research-/, dir: 'intelligence' },
  { re: /^outcome-scorer/, dir: 'intelligence' },
  { re: /^content-pipeline/, dir: 'pipelines' },
  { re: /^job-/, dir: 'pipelines' },
  { re: /^task-/, dir: 'pipelines' },
  { re: /^coding-task-/, dir: 'pipelines' },
  { re: /^skill-/, dir: 'pipelines' },
  { re: /^meeting-runner/, dir: 'pipelines' },
  { re: /^escalation-engine/, dir: 'pipelines' },
  { re: /^conflict-detector/, dir: 'pipelines' },
  { re: /^animation-forge/, dir: 'pipelines' },
  { re: /^capability-proposal/, dir: 'pipelines' },
  { re: /^soul-reflection/, dir: 'pipelines' },
  { re: /^ambient-dialogue/, dir: 'pipelines' },
  { re: /^sentiment/, dir: 'pipelines' },
  { re: /^dossier-system/, dir: 'pipelines' },
  { re: /^email-handler/, dir: 'pipelines' },
  { re: /^gmail-client/, dir: 'pipelines' },
  { re: /^n8n-/, dir: 'integrations' },
  { re: /^lm-studio-/, dir: 'integrations' },
  { re: /^nas-connect/, dir: 'integrations' },
  { re: /^robinhood-/, dir: 'integrations' },
  { re: /^platform-bridge/, dir: 'integrations' },
  { re: /^market-data/, dir: 'integrations' },
  { re: /^denizen-market-/, dir: 'integrations' },
  { re: /^denizen-fleet-/, dir: 'integrations' },
  { re: /^denizen-federation/, dir: 'integrations' },
  { re: /^denizen-invite-/, dir: 'integrations' },
  { re: /^denizen-slack-/, dir: 'integrations' },
  { re: /^denizen-security-relay/, dir: 'integrations' },
  { re: /^denizen-agent-ws-relay/, dir: 'integrations' },
  { re: /^denizen-world-pubsub/, dir: 'integrations' },
  { re: /^denizen-node-/, dir: 'integrations' },
  { re: /^denizen-local-agent/, dir: 'integrations' },
  { re: /^denizen-mesh-/, dir: 'compute' },
  { re: /^denizen-host-compute/, dir: 'compute' },
  { re: /^denizen-hardware-/, dir: 'compute' },
  { re: /^denizen-inference-/, dir: 'compute' },
  { re: /^denizen-embedding-/, dir: 'compute' },
  { re: /^denizen-contribution-/, dir: 'compute' },
  { re: /^denizen-credits/, dir: 'compute' },
  { re: /^denizen-approvals-/, dir: 'compute' },
  { re: /^denizen-business-/, dir: 'compute' },
  { re: /^denizen-bouncer-/, dir: 'compute' },
  { re: /^denizen-companion-/, dir: 'compute' },
  { re: /^denizen-sim-tick/, dir: 'compute' },
  { re: /^denizen-prompt-budget/, dir: 'compute' },
  { re: /^mesh-/, dir: 'compute' },
  { re: /^resource-pressure/, dir: 'compute' },
  { re: /^cost-projector/, dir: 'compute' },
  { re: /^cloud-vm-provider/, dir: 'compute' },
  { re: /^vm-sandbox/, dir: 'compute' },
  { re: /^computer-use-agent/, dir: 'compute' },
  { re: /^desktop-agent/, dir: 'compute' },
  { re: /^desktop-permission-/, dir: 'compute' },
  { re: /^cofounder-agent/, dir: 'compute' },
  { re: /^file-agent/, dir: 'compute' },
  { re: /^lucy-/, dir: 'compute' },
  { re: /^live-infra-brief/, dir: 'compute' },
  { re: /^office-status-brief/, dir: 'compute' },
  { re: /^health-runbook/, dir: 'compute' },
  { re: /^city-debug/, dir: 'city' },
  { re: /^denizen-mentor-/, dir: 'intelligence' },
  { re: /^generic-soul-pack/, dir: 'npc' },
  { re: /^competency-map/, dir: 'npc' },
  { re: /^content-gate/, dir: 'pipelines' },
  { re: /^format-provider-error/, dir: 'core' },
  { re: /^web-research/, dir: 'intelligence' },
  { re: /^chat-attachments/, dir: 'hud' },
];

function targetDir(filename) {
  if (KEEP_ROOT.has(filename)) return null;
  for (const { re, dir } of RULES) {
    if (re.test(filename)) return dir;
  }
  return 'core';
}

function collectMoves() {
  const moves = [];
  for (const name of readdirSync(SRC)) {
    const full = join(SRC, name);
    if (!statSync(full).isFile() || !name.endsWith('.js')) continue;
    const dir = targetDir(name);
    if (!dir) continue;
    const dest = join(SRC, dir, name);
    if (full === dest) continue;
    moves.push({ from: full, to: dest, relFrom: `src/${name}`, relTo: `src/${dir}/${name}` });
  }
  return moves;
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function applyMoves(moves) {
  for (const m of moves) {
    ensureDir(dirname(m.to));
    renameSync(m.from, m.to);
    console.log(`mv ${m.relFrom} -> ${m.relTo}`);
  }
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist-build' || name === 'dist') continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(p, out);
    else if (/\.(js|mjs|cjs|html|md|json|ps1|yml|yaml)$/.test(name)) out.push(p);
  }
  return out;
}

function rewritePaths(moves) {
  const sorted = [...moves].sort((a, b) => b.relFrom.length - a.relFrom.length);
  const files = walkFiles(ROOT);
  // Also rewrite repo-root files outside office app
  const repoRoot = join(ROOT, '..', '..');
  for (const extra of ['README.md', 'MONOREPO.md', 'server.js', '.github/workflows/desktop-release.yml']) {
    const p = join(repoRoot, extra);
    try {
      if (statSync(p).isFile()) files.push(p);
    } catch {}
  }
  for (const infra of walkFiles(join(repoRoot, 'infra'))) files.push(infra);
  for (const tool of walkFiles(join(repoRoot, 'tools'))) files.push(tool);

  let changed = 0;
  for (const file of files) {
    let text = readFileSync(file, 'utf8');
    const orig = text;
    for (const m of sorted) {
      const base = basename(m.relFrom);
      const patterns = [
        [`./${m.relFrom}`, `./${m.relTo}`],
        [`'./${m.relFrom}'`, `'./${m.relTo}'`],
        [`"./${m.relFrom}"`, `"./${m.relTo}"`],
        [`'../${m.relFrom}'`, `'../${m.relTo}'`],
        [`"../${m.relFrom}"`, `"../${m.relTo}"`],
        [`require('./${m.relFrom}`, `require('./${m.relTo}`],
        [`require("../${m.relFrom}`, `require("../${m.relTo}`],
        [`from './${m.relFrom}'`, `from './${m.relTo}'`],
        [`from "./${m.relFrom}"`, `from "./${m.relTo}"`],
        [`src/${base}`, m.relTo],
        [`./src/${base}`, `./${m.relTo}`],
      ];
      for (const [from, to] of patterns) {
        if (text.includes(from)) text = text.split(from).join(to);
      }
    }
    // apps/office/ -> apps/office/ (path references only, not ~/.denizen)
    text = text.replace(/(?<![/~.])denizen\/(?!\.)/g, 'apps/office/');
    text = text.replace(/cd apps/office\b/g, 'cd apps/office');
    text = text.replace(/DENIZEN\/denizen/g, 'DENIZEN/apps/office');
    if (text !== orig) {
      writeFileSync(file, text);
      changed++;
      console.log('updated', relative(ROOT, file) || relative(repoRoot, file));
    }
  }
  return changed;
}

const moves = collectMoves();
console.log(`[reorganize-src] moving ${moves.length} files`);
applyMoves(moves);
const n = rewritePaths(moves);
console.log(`[reorganize-src] updated ${n} files`);
