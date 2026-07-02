'use strict';

/**
 * MCP Resources — telemetry spine for NPC + Team gateways.
 * Parameterized templates avoid shipping full-office JSON to external clients.
 */

const fs = require('node:fs');
const path = require('node:path');
const npcRoster = require('./npc-roster');

const mentorDialogue = require('./denizen-mentor-dialogue.js');

const TELEMETRY_PATH = path.join(__dirname, '..', 'data', 'grok-telemetry-latest.json');

const GROK_LATEST_URI = 'telemetry://grok/latest';
const GROK_LATEST_PREFIX = 'telemetry://grok/latest/';
const FLEET_LATEST_URI = 'telemetry://fleet/latest';
const FLEET_LATEST_PREFIX = 'telemetry://fleet/latest/';
const MENTOR_PENDING_URI = 'mentor://dialogue/pending';
const MENTOR_SESSION_PREFIX = 'mentor://dialogue/';

const CONSULT_PENDING_URI = 'telemetry://grok/consultations/pending';
const CONSULT_QUEUE_PATH = path.join(__dirname, '..', 'data', 'grok-consult-queue.jsonl');

const AUTONOMY_BACKLOG_URI = 'telemetry://fleet/autonomy/backlog';
const AUTONOMY_BACKLOG_PATH = path.join(__dirname, '..', 'data', 'autonomy-backlog.jsonl');

const EMPTY_TELEMETRY = {
  facts: [],
  npcs: {},
  generatedAt: null,
  note: 'Telemetry not yet generated. Run grok-mesh-telemetry-job.',
};

function loadTelemetryRaw() {
  try {
    if (fs.existsSync(TELEMETRY_PATH)) {
      return fs.readFileSync(TELEMETRY_PATH, 'utf-8');
    }
  } catch (_) {
    /* fall through */
  }
  return JSON.stringify(EMPTY_TELEMETRY, null, 2);
}

function loadTelemetryParsed() {
  try {
    return JSON.parse(loadTelemetryRaw());
  } catch (_) {
    return { ...EMPTY_TELEMETRY };
  }
}

function loadConsultPending() {
  if (!fs.existsSync(CONSULT_QUEUE_PATH)) return [];
  try {
    const lines = fs.readFileSync(CONSULT_QUEUE_PATH, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && (!e.status || e.status === 'pending' || !e.answer));
  } catch (_) {
    return [];
  }
}

function loadAutonomyBacklog() {
  if (!fs.existsSync(AUTONOMY_BACKLOG_PATH)) return [];
  try {
    const lines = fs.readFileSync(AUTONOMY_BACKLOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .filter(e => !e.status || e.status === 'pending');
  } catch (_) {
    return [];
  }
}

/** Folder keys + display names that match an npcId query. */
function npcMatchKeys(npcId) {
  const id = String(npcId || '').toLowerCase().trim();
  if (!id) return [];
  const keys = new Set([id]);
  for (const entry of npcRoster.entries || []) {
    const folder = String(entry.folder || '').toLowerCase();
    const display = String(entry.display || '').toLowerCase();
    if (folder === id || display === id || folder.includes(id) || display.includes(id)) {
      keys.add(folder);
      keys.add(display);
    }
  }
  return [...keys];
}

function factMatchesNpc(fact, keys) {
  const text = String(fact || '').toLowerCase();
  return keys.some((k) => text.includes(k));
}

function filterTelemetryForNpc(parsed, npcId) {
  const keys = npcMatchKeys(npcId);
  const facts = (parsed.facts || []).filter((f) => factMatchesNpc(f, keys));
  const npcs = {};
  for (const [name, stats] of Object.entries(parsed.npcs || {})) {
    const lower = String(name).toLowerCase();
    if (keys.some((k) => lower.includes(k) || k.includes(lower))) {
      npcs[name] = stats;
    }
  }
  return {
    generatedAt: parsed.generatedAt ?? null,
    npcId: String(npcId || '').toLowerCase(),
    filtered: true,
    match_keys: keys,
    facts,
    npcs,
    issues: parsed.issues ?? null,
    total_events: parsed.total_events ?? null,
  };
}

function parseNpcIdFromUri(uri, prefix) {
  if (!uri || !String(uri).startsWith(prefix)) return null;
  const tail = String(uri).slice(prefix.length).trim();
  if (!tail || tail.includes('/')) return null;
  return tail.toLowerCase();
}

function readTelemetryResource(uri) {
  const parsed = loadTelemetryParsed();

  if (uri === GROK_LATEST_URI || uri === FLEET_LATEST_URI) {
    return JSON.stringify(parsed, null, 2);
  }

  const grokNpcId = parseNpcIdFromUri(uri, GROK_LATEST_PREFIX);
  if (grokNpcId) {
    return JSON.stringify(filterTelemetryForNpc(parsed, grokNpcId), null, 2);
  }

  const fleetNpcId = parseNpcIdFromUri(uri, FLEET_LATEST_PREFIX);
  if (fleetNpcId) {
    return JSON.stringify(filterTelemetryForNpc(parsed, fleetNpcId), null, 2);
  }

  return null;
}

function readMentorResource(uri) {
  if (uri === MENTOR_PENDING_URI) {
    const pending = mentorDialogue.listPending({ limit: 20 });
    return JSON.stringify({ generatedAt: new Date().toISOString(), sessions: pending }, null, 2);
  }
  if (uri.startsWith(MENTOR_SESSION_PREFIX) && uri !== MENTOR_PENDING_URI) {
    const sessionId = uri.slice(MENTOR_SESSION_PREFIX.length).trim();
    const session = mentorDialogue.getSession(sessionId);
    if (!session) return JSON.stringify({ ok: false, error: 'session_not_found' }, null, 2);
    return JSON.stringify(session, null, 2);
  }
  return null;
}

function readResource(uri) {
  const tel = readTelemetryResource(uri);
  if (tel != null) return tel;
  if (uri === CONSULT_PENDING_URI) {
    const pending = loadConsultPending();
    return JSON.stringify({ generatedAt: new Date().toISOString(), pending }, null, 2);
  }
  if (uri === AUTONOMY_BACKLOG_URI) {
    const backlog = loadAutonomyBacklog();
    return JSON.stringify({ generatedAt: new Date().toISOString(), backlog }, null, 2);
  }
  return readMentorResource(uri);
}

const GROK_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'telemetry://grok/latest/{npcId}',
    name: 'Filtered NPC Telemetry State',
    description: 'Latest telemetry facts filtered for one agent (e.g. bouncer, bob, grok).',
    mimeType: 'application/json',
  },
];

const FLEET_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'telemetry://fleet/latest/{npcId}',
    name: 'Filtered Fleet Telemetry',
    description: 'Office telemetry filtered to a single NPC — for CEO/CTO debugging without full-fleet context bloat.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'telemetry://fleet/autonomy/backlog',
    name: 'Autonomy Backlog',
    description: 'Agent-generated self-build tasks from friction detection. Review and approve before execution.',
    mimeType: 'application/json',
  },
];

const MENTOR_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'mentor://dialogue/{sessionId}',
    name: 'Mentor dialogue session',
    description: 'Grok + Claude mentor panel session for a local NPC question.',
    mimeType: 'application/json',
  },
];

function grokResourcesList() {
  return [
    {
      uri: GROK_LATEST_URI,
      name: 'Live Grok Telemetry State',
      description: 'Full structured JSON analysis of the DENIZEN agent fleet (latency, token bloat, optimization facts).',
      mimeType: 'application/json',
    },
    {
      uri: CONSULT_PENDING_URI,
      name: 'Pending Grok Consultations',
      description: 'Local NPCs that have called consult-grok or are waiting for real Grok / mentor replies. Visibility into what Bob and Bouncer are stuck on.',
      mimeType: 'application/json',
    },
  ];
}

function fleetResourcesList() {
  return [{
    uri: FLEET_LATEST_URI,
    name: 'Fleet Telemetry (full)',
    description: 'Full office telemetry snapshot — mesh latency, token bloat, stuck NPC signals.',
    mimeType: 'application/json',
  }, {
    uri: AUTONOMY_BACKLOG_URI,
    name: 'Fleet Autonomy Backlog',
    description: 'Pending self-build tasks generated from agent friction. Agents deposit needs here for later autonomous execution or mentor review.',
    mimeType: 'application/json',
  }];
}

function canReadGrokTelemetry(scope, uri) {
  if (!uri) return false;
  if (uri === GROK_LATEST_URI) return scope?.npc_key === 'grok';
  if (uri.startsWith(GROK_LATEST_PREFIX)) return !!scope?.npc_key;
  if (uri === CONSULT_PENDING_URI) return scope?.npc_key === 'grok' || scope?.npc_key === '_team';
  return false;
}

function canReadFleetTelemetry(scope, uri) {
  if (!uri) return false;
  if (uri === FLEET_LATEST_URI || uri.startsWith(FLEET_LATEST_PREFIX) || uri === AUTONOMY_BACKLOG_URI) {
    return scope?.npc_key === '_team' || scope?.scope_mode === 'team';
  }
  return false;
}

function mentorResourcesList() {
  return [{
    uri: MENTOR_PENDING_URI,
    name: 'Mentor panel — pending dialogues',
    description: 'Local NPC questions awaiting Grok + Claude peer replies.',
    mimeType: 'application/json',
  }];
}

function canReadMentor(scope, uri) {
  if (!uri || !uri.startsWith('mentor://dialogue')) return false;
  return scope?.npc_key === 'grok' || scope?.npc_key === '_team' || scope?.scope_mode === 'team';
}

function canReadTelemetry(scope, uri) {
  return canReadGrokTelemetry(scope, uri)
    || canReadFleetTelemetry(scope, uri)
    || canReadMentor(scope, uri);
}

module.exports = {
  GROK_LATEST_URI,
  FLEET_LATEST_URI,
  MENTOR_PENDING_URI,
  GROK_RESOURCE_TEMPLATES,
  FLEET_RESOURCE_TEMPLATES,
  MENTOR_RESOURCE_TEMPLATES,
  loadTelemetryRaw,
  loadTelemetryParsed,
  filterTelemetryForNpc,
  readTelemetryResource,
  readMentorResource,
  readResource,
  grokResourcesList,
  fleetResourcesList,
  mentorResourcesList,
  canReadTelemetry,
  canReadGrokTelemetry,
  canReadFleetTelemetry,
  canReadMentor,
};
