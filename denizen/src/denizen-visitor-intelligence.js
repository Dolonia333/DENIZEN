'use strict';

/**
 * Visitor intelligence — deep memory, commitments, briefings, recurring tasks, proactive triggers.
 */

const denizenDb = require('./denizen-db.js');
const denizenVisitor = require('./denizen-visitor.js');

class IntelligenceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'IntelligenceError';
    this.code = code;
  }
}

function _ensureDb() {
  if (!denizenDb.enabled) {
    throw new IntelligenceError('DenizenDb disabled', 'DB_DISABLED');
  }
}

function intelligenceErrorStatus(err) {
  if (!(err instanceof IntelligenceError)) return 500;
  switch (err.code) {
    case 'BAD_INPUT':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'DB_DISABLED':
      return 503;
    default:
      return 500;
  }
}

// ── Deep memory / profile ─────────────────────────────────────────────────────

async function getProfile(sessionId) {
  _ensureDb();
  if (!sessionId) throw new IntelligenceError('sessionId required', 'BAD_INPUT');
  const rows = await denizenDb._get(
    `denizen_visitor_profiles?select=*&session_id=eq.${encodeURIComponent(sessionId)}&limit=1`,
  );
  if (rows?.[0]) return rows[0];
  return {
    session_id: sessionId,
    preferences: [],
    vips: [],
    writing_style: null,
    long_horizon: null,
    slack_webhook_url: null,
    slack_user_id: null,
    metadata: {},
  };
}

async function upsertProfile(sessionId, patch = {}) {
  _ensureDb();
  if (!sessionId) throw new IntelligenceError('sessionId required', 'BAD_INPUT');

  const existing = await getProfile(sessionId);
  const body = {
    session_id: sessionId,
    preferences: patch.preferences ?? existing.preferences ?? [],
    vips: patch.vips ?? existing.vips ?? [],
    writing_style: patch.writing_style !== undefined ? patch.writing_style : existing.writing_style,
    long_horizon: patch.long_horizon !== undefined ? patch.long_horizon : existing.long_horizon,
    slack_webhook_url: patch.slack_webhook_url !== undefined
      ? patch.slack_webhook_url
      : existing.slack_webhook_url,
    slack_user_id: patch.slack_user_id !== undefined ? patch.slack_user_id : existing.slack_user_id,
    metadata: { ...(existing.metadata || {}), ...(patch.metadata || {}) },
    updated_at: new Date().toISOString(),
  };

  if (existing.updated_at) {
    const rows = await denizenDb._patch(
      `denizen_visitor_profiles?session_id=eq.${encodeURIComponent(sessionId)}`,
      body,
      { prefer: 'return=representation' },
    );
    return rows?.[0] || body;
  }

  const rows = await denizenDb._post(
    'denizen_visitor_profiles',
    body,
    { prefer: 'return=representation' },
  );
  return rows?.[0] || body;
}

/** Heuristic preference extraction from user chat. */
function extractPreferencesFromText(text) {
  const prefs = [];
  const raw = String(text || '');
  const patterns = [
    [/prefer\s+(?:that\s+)?(?:you\s+)?(.+?)(?:\.|$)/i, 1],
    [/always\s+(.+?)(?:\.|$)/i, 1],
    [/never\s+(.+?)(?:\.|$)/i, 1],
    [/keep\s+(?:it\s+)?(.+?)(?:\.|$)/i, 1],
  ];
  for (const [re, idx] of patterns) {
    const m = raw.match(re);
    if (m?.[idx]) prefs.push(m[idx].trim().slice(0, 120));
  }
  return prefs;
}

/** Heuristic VIP name extraction. */
function extractVipsFromText(text) {
  const vips = [];
  const raw = String(text || '');
  const re = /\b(?:vip|important|priority)\s+(?:contact|client|person)?\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    vips.push({ name: m[1].trim(), note: 'mentioned in chat' });
  }
  return vips;
}

async function absorbChatContext(sessionId, { userMessage, npcResponse, npcKey } = {}) {
  if (!sessionId) return null;
  const prefs = extractPreferencesFromText(userMessage);
  const vips = extractVipsFromText(userMessage);
  if (!prefs.length && !vips.length) return null;

  const profile = await getProfile(sessionId);
  const mergedPrefs = [...(profile.preferences || [])];
  for (const p of prefs) {
    if (!mergedPrefs.includes(p)) mergedPrefs.push(p);
  }
  const mergedVips = [...(profile.vips || [])];
  for (const v of vips) {
    if (!mergedVips.some((x) => x.name === v.name)) mergedVips.push(v);
  }
  return upsertProfile(sessionId, {
    preferences: mergedPrefs.slice(-20),
    vips: mergedVips.slice(-15),
  });
}

// ── Commitments ───────────────────────────────────────────────────────────────

const COMMITMENT_RE = /\b(I(?:'ll| will)|let me|I can|I'?m going to)\s+(.{8,120}?)(?:\.|!|\?|$| by )/gi;

function extractCommitmentsFromText(text, { npcKey, source = 'chat' } = {}) {
  const commitments = [];
  const raw = String(text || '');
  let m;
  const re = new RegExp(COMMITMENT_RE.source, COMMITMENT_RE.flags);
  while ((m = re.exec(raw)) !== null) {
    const phrase = `${m[1]} ${m[2]}`.trim().slice(0, 300);
    if (phrase.length < 12) continue;
    commitments.push({ text: phrase, npc_key: npcKey || null, source });
  }
  return commitments;
}

async function listCommitments(sessionId, { status = 'open' } = {}) {
  _ensureDb();
  if (!sessionId) throw new IntelligenceError('sessionId required', 'BAD_INPUT');
  let path = `denizen_visitor_commitments?select=*&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.desc&limit=50`;
  if (status) path += `&status=eq.${encodeURIComponent(status)}`;
  const rows = await denizenDb._get(path);
  return rows || [];
}

async function addCommitment(sessionId, { text, npcKey, dueAt, source } = {}) {
  _ensureDb();
  if (!sessionId || !text) throw new IntelligenceError('sessionId and text required', 'BAD_INPUT');
  const rows = await denizenDb._post(
    'denizen_visitor_commitments',
    {
      session_id: sessionId,
      npc_key: npcKey || null,
      text: String(text).slice(0, 500),
      due_at: dueAt || null,
      status: 'open',
      source: source || 'chat',
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function resolveCommitment(commitmentId, sessionId, status = 'done') {
  _ensureDb();
  if (!commitmentId || !sessionId) throw new IntelligenceError('ids required', 'BAD_INPUT');
  const rows = await denizenDb._patch(
    `denizen_visitor_commitments?id=eq.${encodeURIComponent(commitmentId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    { status, resolved_at: new Date().toISOString() },
    { prefer: 'return=representation' },
  );
  if (!rows?.length) throw new IntelligenceError('Commitment not found', 'NOT_FOUND');
  return rows[0];
}

async function recordCommitmentsFromChat(sessionId, { userMessage, npcResponse, npcKey } = {}) {
  if (!sessionId) return [];
  const fromNpc = extractCommitmentsFromText(npcResponse, { npcKey, source: 'npc' });
  const fromUser = extractCommitmentsFromText(userMessage, { source: 'user' });
  const all = [...fromNpc, ...fromUser];
  const created = [];
  for (const c of all) {
    const row = await addCommitment(sessionId, {
      text: c.text,
      npcKey: c.npc_key,
      source: c.source,
    }).catch(() => null);
    if (row) created.push(row);
  }
  return created;
}

// ── Morning briefing ──────────────────────────────────────────────────────────

function _todayDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function buildMorningBriefing(sessionId) {
  _ensureDb();
  if (!sessionId) throw new IntelligenceError('sessionId required', 'BAD_INPUT');

  const [session, assistant, projects, commitments, handoffs, profile] = await Promise.all([
    denizenVisitor.getSession(sessionId),
    denizenVisitor.getAssistant(sessionId).catch(() => null),
    denizenVisitor.listProjects(sessionId).catch(() => []),
    listCommitments(sessionId, { status: 'open' }).catch(() => []),
    denizenVisitor.getPendingHandoffs(sessionId).catch(() => []),
    getProfile(sessionId).catch(() => ({})),
  ]);

  const sections = [];
  sections.push(`Good morning${session?.display_name ? `, ${session.display_name}` : ''}.`);

  if (assistant?.npc_key) {
    sections.push(`Your assistant: ${assistant.assistant_name || assistant.npc_key}.`);
  }

  if (handoffs.length) {
    sections.push('', 'Pending handoffs:');
    handoffs.slice(0, 5).forEach((h, i) => {
      sections.push(`${i + 1}. From ${h.from_display_name || 'teammate'}: "${String(h.message || '').slice(0, 80)}"`);
    });
  }

  if (projects.length) {
    sections.push('', 'Active projects:');
    projects.filter((p) => p.status === 'active').slice(0, 5).forEach((p, i) => {
      sections.push(`${i + 1}. ${p.name}${p.notes ? ` — ${String(p.notes).slice(0, 60)}` : ''}`);
    });
  }

  if (commitments.length) {
    sections.push('', 'Open commitments:');
    commitments.slice(0, 5).forEach((c, i) => {
      sections.push(`${i + 1}. ${c.text}${c.npc_key ? ` (${c.npc_key})` : ''}`);
    });
  }

  let predictionNote = '';
  if (denizenDb.orgId) {
    try {
      const preds = await denizenDb._get(
        `denizen_predictions?select=entity_type,prediction,confidence&org_id=eq.${encodeURIComponent(denizenDb.orgId)}&validated_at=is.null&order=confidence.desc&limit=3`,
      );
      if (preds?.length) {
        sections.push('', 'High-confidence forecasts:');
        preds.forEach((p, i) => {
          const label = p.entity_type || 'entity';
          const conf = p.confidence != null ? `${Math.round(Number(p.confidence) * 100)}%` : 'n/a';
          sections.push(`${i + 1}. ${label} (${conf})`);
        });
      }
    } catch (_) { /* non-fatal */ }
  }

  const prefs = Array.isArray(profile.preferences) ? profile.preferences.slice(0, 3) : [];
  if (prefs.length) {
    sections.push('', `Remembered preferences: ${prefs.join('; ')}`);
  }

  const text = sections.join('\n');
  const content = {
    text,
    handoffs: handoffs.length,
    projects: projects.filter((p) => p.status === 'active').length,
    commitments: commitments.length,
    predictionNote,
    generated_at: new Date().toISOString(),
  };

  return { sessionId, briefingDate: _todayDateStr(), content };
}

async function getOrCreateTodayBriefing(sessionId, { force = false } = {}) {
  _ensureDb();
  const date = _todayDateStr();
  const existing = await denizenDb._get(
    `denizen_visitor_briefings?select=*&session_id=eq.${encodeURIComponent(sessionId)}&briefing_date=eq.${date}&limit=1`,
  );
  if (existing?.[0] && !force) return existing[0];

  const built = await buildMorningBriefing(sessionId);
  if (existing?.[0]) {
    const rows = await denizenDb._patch(
      `denizen_visitor_briefings?id=eq.${encodeURIComponent(existing[0].id)}`,
      { content: built.content },
      { prefer: 'return=representation' },
    );
    return rows?.[0] || existing[0];
  }

  const rows = await denizenDb._post(
    'denizen_visitor_briefings',
    {
      session_id: sessionId,
      briefing_date: date,
      content: built.content,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || { session_id: sessionId, briefing_date: date, content: built.content };
}

async function markBriefingDelivered(briefingId, sessionId) {
  _ensureDb();
  const rows = await denizenDb._patch(
    `denizen_visitor_briefings?id=eq.${encodeURIComponent(briefingId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    { delivered_at: new Date().toISOString() },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

// ── Recurring tasks (autopilot) ───────────────────────────────────────────────

async function listRecurringTasks(sessionId) {
  _ensureDb();
  if (!sessionId) throw new IntelligenceError('sessionId required', 'BAD_INPUT');
  const rows = await denizenDb._get(
    `denizen_visitor_recurring_tasks?select=*&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc`,
  );
  return rows || [];
}

async function addRecurringTask(sessionId, { label, prompt, npcKey, schedule } = {}) {
  _ensureDb();
  if (!sessionId || !label || !prompt) {
    throw new IntelligenceError('sessionId, label, and prompt required', 'BAD_INPUT');
  }
  const rows = await denizenDb._post(
    'denizen_visitor_recurring_tasks',
    {
      session_id: sessionId,
      label: String(label).slice(0, 120),
      prompt: String(prompt).slice(0, 2000),
      npc_key: npcKey || null,
      schedule: schedule || { day_of_week: 1, hour: 8 },
      enabled: true,
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

function _scheduleMatchesNow(schedule, now = new Date()) {
  const dow = schedule?.day_of_week;
  const hour = schedule?.hour;
  if (dow != null && now.getDay() !== Number(dow)) return false;
  if (hour != null && now.getHours() !== Number(hour)) return false;
  return true;
}

async function runDueRecurringTasks(sessionId, deps = {}) {
  const tasks = await listRecurringTasks(sessionId);
  const now = new Date();
  const ran = [];

  for (const task of tasks) {
    if (!task.enabled) continue;
    if (!_scheduleMatchesNow(task.schedule, now)) continue;
    const lastRun = task.last_run_at ? new Date(task.last_run_at) : null;
    if (lastRun && now - lastRun < 20 * 60 * 60 * 1000) continue;

    const event = await createProactiveEvent(sessionId, {
      eventType: 'recurring_task',
      title: task.label,
      body: task.prompt,
      metadata: { task_id: task.id, npc_key: task.npc_key },
    });

    await denizenDb._patch(
      `denizen_visitor_recurring_tasks?id=eq.${encodeURIComponent(task.id)}`,
      { last_run_at: now.toISOString() },
      { prefer: 'return=minimal' },
    );

    if (typeof deps.onRecurringTask === 'function') {
      deps.onRecurringTask({ task, event, sessionId });
    }
    ran.push({ task, event });
  }
  return ran;
}

// ── Proactive triggers ────────────────────────────────────────────────────────

async function createProactiveEvent(sessionId, { eventType, title, body, metadata } = {}) {
  _ensureDb();
  if (!sessionId || !title || !body) {
    throw new IntelligenceError('sessionId, title, body required', 'BAD_INPUT');
  }
  const rows = await denizenDb._post(
    'denizen_visitor_proactive_events',
    {
      session_id: sessionId,
      event_type: eventType || 'alert',
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 4000),
      status: 'pending',
      metadata: metadata || {},
    },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

async function getPendingProactiveEvents(sessionId) {
  _ensureDb();
  if (!sessionId) throw new IntelligenceError('sessionId required', 'BAD_INPUT');
  const rows = await denizenDb._get(
    `denizen_visitor_proactive_events?select=*&session_id=eq.${encodeURIComponent(sessionId)}&status=eq.pending&order=created_at.asc&limit=20`,
  );
  return rows || [];
}

async function markProactiveDelivered(eventId, sessionId) {
  _ensureDb();
  const rows = await denizenDb._patch(
    `denizen_visitor_proactive_events?id=eq.${encodeURIComponent(eventId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    { status: 'delivered', delivered_at: new Date().toISOString() },
    { prefer: 'return=representation' },
  );
  return rows?.[0] || null;
}

const TRIGGER_FACT_TYPES = [
  'intake.created',
  'rfp.deadline',
  'lead.hot',
  'prediction.high_confidence',
];

async function evaluateProactiveTriggers(sessionId) {
  if (!denizenDb.orgId) return [];
  const created = [];
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  try {
    const facts = await denizenDb._get(
      `denizen_facts?select=fact_type,payload,created_at&org_id=eq.${encodeURIComponent(denizenDb.orgId)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=30`,
    );
    for (const fact of facts || []) {
      if (!TRIGGER_FACT_TYPES.some((t) => String(fact.fact_type || '').includes(t.split('.')[0]))) {
        continue;
      }
      const title = `Update: ${fact.fact_type}`;
      const body = JSON.stringify(fact.payload || {}).slice(0, 500);
      const ev = await createProactiveEvent(sessionId, {
        eventType: 'fact_trigger',
        title,
        body,
        metadata: { fact_type: fact.fact_type },
      }).catch(() => null);
      if (ev) created.push(ev);
      if (created.length >= 3) break;
    }
  } catch (_) { /* table may not exist in test mocks */ }

  return created;
}

// ── WS broadcast helpers ──────────────────────────────────────────────────────

function buildBriefingBroadcast(briefing, ts = Date.now()) {
  return { type: 'visitor_briefing', briefing, ts };
}

function buildProactiveBroadcast(event, ts = Date.now()) {
  return { type: 'visitor_proactive', event, ts };
}

function buildCommitmentNudgeBroadcast(commitments, ts = Date.now()) {
  return { type: 'visitor_commitment_nudge', commitments, ts };
}

// ── Intelligence tick (scheduler entry) ───────────────────────────────────────

function _localEightAm(reference = new Date()) {
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
    8, 0, 0, 0,
  );
}

async function listActiveVisitorSessions() {
  _ensureDb();
  if (!denizenDb.orgId) return [];
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await denizenDb._get(
    `denizen_visitor_sessions?select=id,display_name&org_id=eq.${encodeURIComponent(denizenDb.orgId)}&last_seen_at=gte.${encodeURIComponent(cutoff)}&denizen_user_assistants!inner(session_id)`,
  );
  return rows || [];
}

async function runIntelligenceTick(deps = {}) {
  if (!denizenDb.enabled) return { briefings: 0, nudges: 0, recurring: 0, triggers: 0 };

  const now = new Date();
  const isBriefingHour = now.getHours() >= 8 && now.getHours() < 9;
  const sessions = await listActiveVisitorSessions().catch(() => []);
  let briefings = 0;
  let nudges = 0;
  let recurring = 0;
  let triggers = 0;

  for (const sess of sessions) {
    const sid = sess.id;
    if (!sid) continue;

    if (isBriefingHour) {
      const briefing = await getOrCreateTodayBriefing(sid).catch(() => null);
      if (briefing && !briefing.delivered_at) {
        briefings += 1;
        if (typeof deps.broadcast === 'function') {
          deps.broadcast(buildBriefingBroadcast(briefing), sid);
        }
        if (briefing.id) await markBriefingDelivered(briefing.id, sid).catch(() => {});
      }
    }

    const open = await listCommitments(sid, { status: 'open' }).catch(() => []);
    const stale = open.filter((c) => {
      const age = Date.now() - new Date(c.created_at).getTime();
      return age > 24 * 60 * 60 * 1000;
    });
    if (stale.length) {
      nudges += 1;
      if (typeof deps.broadcast === 'function') {
        deps.broadcast(buildCommitmentNudgeBroadcast(stale.slice(0, 3)), sid);
      }
    }

    const ran = await runDueRecurringTasks(sid, deps).catch(() => []);
    recurring += ran.length;

    const trig = await evaluateProactiveTriggers(sid).catch(() => []);
    for (const ev of trig) {
      triggers += 1;
      if (typeof deps.broadcast === 'function') {
        deps.broadcast(buildProactiveBroadcast(ev), sid);
      }
    }
  }

  return { briefings, nudges, recurring, triggers, sessions: sessions.length };
}

module.exports = {
  IntelligenceError,
  intelligenceErrorStatus,
  getProfile,
  upsertProfile,
  absorbChatContext,
  extractPreferencesFromText,
  extractCommitmentsFromText,
  listCommitments,
  addCommitment,
  resolveCommitment,
  recordCommitmentsFromChat,
  buildMorningBriefing,
  getOrCreateTodayBriefing,
  markBriefingDelivered,
  listRecurringTasks,
  addRecurringTask,
  runDueRecurringTasks,
  createProactiveEvent,
  getPendingProactiveEvents,
  markProactiveDelivered,
  evaluateProactiveTriggers,
  buildBriefingBroadcast,
  buildProactiveBroadcast,
  buildCommitmentNudgeBroadcast,
  runIntelligenceTick,
  listActiveVisitorSessions,
};
