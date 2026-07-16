'use strict';

/**
 * Company daily plan skeleton (A+ P2.2).
 *
 * Heuristic “today’s 5 priorities” from company-brief / office snapshot /
 * CRM brief / open directives — no LLM required. Persists to data/daily-plan.json.
 *
 * Per-NPC plans still live in npc-brains.getDailyPlan(); this module is the
 * company-level board Abby should drive.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLAN_PATH = path.join(ROOT, 'data', 'daily-plan.json');
const BRIEF_PATH = path.join(ROOT, 'data', 'company-brief.json');
const MODEL_PATH = path.join(ROOT, 'data', 'business-model.json');
const DIRECTIVES_PATH = path.join(ROOT, 'data', 'npc-directives.json');
const BACKLOG_PATH = path.join(ROOT, 'data', 'autonomy-backlog.jsonl');

const MAX_PRIORITIES = 5;

function todayDate(date) {
  if (date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function _readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function _truncate(s, n = 140) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function _pushUnique(list, item) {
  const t = _truncate(item, 160);
  if (!t) return;
  const key = t.toLowerCase();
  if (list.some((x) => x.toLowerCase() === key)) return;
  if (list.some((x) => x.toLowerCase().includes(key) || key.includes(x.toLowerCase()))) return;
  list.push(t);
}

function _prioritiesFromBrief(brief) {
  const out = [];
  if (!brief || typeof brief !== 'object') return out;
  const focus = Array.isArray(brief.current_focus) ? brief.current_focus : [];
  for (const f of focus) _pushUnique(out, f);
  const roleCto = brief.role_tasks?.CTO;
  if (Array.isArray(roleCto)) {
    for (const t of roleCto.slice(0, 2)) _pushUnique(out, t);
  }
  if (brief.sprint?.goal) {
    _pushUnique(out, `Sprint: ${brief.sprint.name || ''} — ${brief.sprint.goal}`.trim());
  }
  const pains = Array.isArray(brief.pain_points) ? brief.pain_points : [];
  for (const p of pains.slice(0, 2)) {
    _pushUnique(out, `Pain: ${p}`);
  }
  return out;
}

function _prioritiesFromModel(model) {
  const out = [];
  if (!model || typeof model !== 'object') return out;
  for (const opp of model.active_opportunities || []) {
    const blockers = (opp.blockers || [])
      .filter((b) => b && (b.severity === 'critical' || b.severity === 'high'))
      .slice(0, 2);
    for (const b of blockers) {
      _pushUnique(
        out,
        `${opp.name || opp.id}: ${b.label}${b.owner_npc ? ` [${b.owner_npc}]` : ''}`,
      );
    }
    if (!blockers.length && opp.summary) {
      _pushUnique(out, `${opp.name || opp.id}: ${opp.summary}`);
    }
  }
  for (const g of model.strategic_goals || []) {
    _pushUnique(out, typeof g === 'string' ? g : g.label || g.goal || '');
  }
  return out;
}

function _prioritiesFromCrm(crmBrief) {
  const out = [];
  if (!crmBrief) return out;
  if (typeof crmBrief === 'string') {
    const s = crmBrief.trim();
    if (s) _pushUnique(out, `CRM: ${s}`);
    return out;
  }
  if (typeof crmBrief !== 'object') return out;
  if (crmBrief.summary) _pushUnique(out, `CRM: ${crmBrief.summary}`);
  const overdue = Number(crmBrief.overdueTaskCount ?? crmBrief.overdue_tasks ?? 0);
  const openDeals = Number(crmBrief.openDealCount ?? crmBrief.open_deals ?? 0);
  const pending = Number(crmBrief.pendingTaskCount ?? crmBrief.pending_tasks ?? 0);
  if (overdue > 0) _pushUnique(out, `Clear ${overdue} overdue CRM task(s)`);
  if (openDeals > 0 && pending > 0) {
    _pushUnique(out, `Pipeline hygiene: ${openDeals} open deals, ${pending} open tasks`);
  } else if (openDeals > 0) {
    _pushUnique(out, `Advance ${openDeals} open deal(s) in Meridian CRM`);
  }
  if (Array.isArray(crmBrief.priorities)) {
    for (const p of crmBrief.priorities) _pushUnique(out, p);
  }
  return out;
}

function _prioritiesFromOffice(officeSnapshot) {
  const out = [];
  if (!officeSnapshot || typeof officeSnapshot !== 'object') return out;

  const npcs = officeSnapshot.npcs || officeSnapshot.agents || null;
  if (npcs && typeof npcs === 'object') {
    const stuck = [];
    const idle = [];
    for (const [name, st] of Object.entries(npcs)) {
      if (!st || typeof st !== 'object') continue;
      const state = String(st.state || st.status || '').toLowerCase();
      const task = String(st.currentTask || st.task || '');
      if (/stuck|blocked|error|failed/.test(state) || /stuck|blocked/.test(task.toLowerCase())) {
        stuck.push(name);
      } else if (/idle|wandering|afk/.test(state) && !task) {
        idle.push(name);
      }
    }
    if (stuck.length) {
      _pushUnique(out, `Unblock stuck agents: ${stuck.slice(0, 4).join(', ')}`);
    }
    if (idle.length >= 4) {
      _pushUnique(out, `Re-task idle floor (${idle.length} idle) toward capture / ship work`);
    }
  }

  const bg = officeSnapshot.backgroundTasks || officeSnapshot.openTasks || officeSnapshot.tasks;
  if (Array.isArray(bg) && bg.length) {
    for (const t of bg.slice(0, 3)) {
      const label = typeof t === 'string' ? t : (t.label || t.task || t.name || t.id);
      if (label) _pushUnique(out, `Office task: ${label}`);
    }
  }

  if (officeSnapshot.threats && (Array.isArray(officeSnapshot.threats) ? officeSnapshot.threats.length : true)) {
    _pushUnique(out, 'Review security / mesh threats with Bouncer before other non-critical work');
  }

  return out;
}

function _prioritiesFromDirectives() {
  const out = [];
  const store = _readJson(DIRECTIVES_PATH, null);
  const dirs = store?.directives || store || {};
  if (!dirs || typeof dirs !== 'object') return out;
  const entries = Object.entries(dirs)
    .filter(([, v]) => v && typeof v === 'object' && v.task)
    .sort((a, b) => Number(b[1].urgent) - Number(a[1].urgent) || (b[1].ts || 0) - (a[1].ts || 0));
  for (const [npc, d] of entries.slice(0, 3)) {
    _pushUnique(out, `${npc}: ${_truncate(d.task, 120)}`);
  }
  return out;
}

function _prioritiesFromBacklog() {
  const out = [];
  try {
    const lines = fs.readFileSync(BACKLOG_PATH, 'utf8').split('\n').filter(Boolean).slice(-40);
    const open = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const st = String(row.status || '').toLowerCase();
        if (st === 'resolved' || st === 'stale' || st === 'done') continue;
        open.push(row);
      } catch (_) { /* skip */ }
    }
    open.sort((a, b) => (b.friction_score || 0) - (a.friction_score || 0));
    for (const row of open.slice(0, 2)) {
      _pushUnique(
        out,
        `Autonomy backlog: ${row.domain || 'friction'} (${row.npc || '?'}) — ${_truncate(row.build_prompt, 100)}`,
      );
    }
  } catch (_) { /* optional */ }
  return out;
}

const FALLBACK_PRIORITIES = [
  'Capture: refresh OMES / RM Cyber pursuit status and CRM hygiene',
  'Ship: one CEO-visible DENIZEN improvement with evidence (skill + report)',
  'Mesh: confirm inference + fleet health; remediate if degraded',
  'CRM: clear overdue tasks and advance top open deal',
  'Standup: Abby sync with Marcus + Alex on blockers; report to CEO',
];

/**
 * Build a company daily plan (always 5 priorities).
 * @param {{ officeSnapshot?: object, crmBrief?: string|object, date?: string|Date }} opts
 * @returns {{ date: string, priorities: string[], source: string, at: string }}
 */
function buildDailyPlan({ officeSnapshot = null, crmBrief = null, date = null } = {}) {
  const day = todayDate(date);
  const brief = _readJson(BRIEF_PATH, null);
  const model = _readJson(MODEL_PATH, null);

  const sources = [];
  const pool = [];

  const fromCrm = _prioritiesFromCrm(crmBrief);
  if (fromCrm.length) {
    sources.push('crm');
    fromCrm.forEach((p) => _pushUnique(pool, p));
  }

  const fromOffice = _prioritiesFromOffice(officeSnapshot);
  if (fromOffice.length) {
    sources.push('office');
    fromOffice.forEach((p) => _pushUnique(pool, p));
  }

  const fromDirs = _prioritiesFromDirectives();
  if (fromDirs.length) {
    sources.push('directives');
    fromDirs.forEach((p) => _pushUnique(pool, p));
  }

  const fromBrief = _prioritiesFromBrief(brief);
  if (fromBrief.length) {
    sources.push('company-brief');
    fromBrief.forEach((p) => _pushUnique(pool, p));
  }

  const fromModel = _prioritiesFromModel(model);
  if (fromModel.length) {
    sources.push('business-model');
    fromModel.forEach((p) => _pushUnique(pool, p));
  }

  const fromBacklog = _prioritiesFromBacklog();
  if (fromBacklog.length) {
    sources.push('autonomy-backlog');
    fromBacklog.forEach((p) => _pushUnique(pool, p));
  }

  if (!sources.length) sources.push('fallback');

  const priorities = [];
  for (const p of pool) {
    if (priorities.length >= MAX_PRIORITIES) break;
    _pushUnique(priorities, p);
  }
  for (const p of FALLBACK_PRIORITIES) {
    if (priorities.length >= MAX_PRIORITIES) break;
    _pushUnique(priorities, p);
  }

  while (priorities.length < MAX_PRIORITIES) {
    priorities.push(FALLBACK_PRIORITIES[priorities.length % FALLBACK_PRIORITIES.length]);
  }

  return {
    date: day,
    priorities: priorities.slice(0, MAX_PRIORITIES),
    source: sources.join('+'),
    at: new Date().toISOString(),
  };
}

function saveDailyPlan(plan, filePath = PLAN_PATH) {
  if (!plan || typeof plan !== 'object') throw new Error('plan required');
  const payload = {
    date: plan.date || todayDate(),
    priorities: Array.isArray(plan.priorities) ? plan.priorities.slice(0, MAX_PRIORITIES) : [],
    source: plan.source || 'manual',
    at: plan.at || new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function loadDailyPlan(filePath = PLAN_PATH) {
  const data = _readJson(filePath, null);
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.priorities)) return null;
  return {
    date: data.date || null,
    priorities: data.priorities.map((p) => String(p)).filter(Boolean),
    source: data.source || 'file',
    at: data.at || null,
  };
}

/**
 * Return today's plan, regenerating + saving if missing or stale day.
 */
function getTodayPlan(opts = {}) {
  const day = todayDate(opts.date);
  const existing = loadDailyPlan(opts.filePath);
  if (
    existing
    && existing.date === day
    && existing.priorities.length >= 1
    && opts.force !== true
  ) {
    return existing;
  }
  const plan = buildDailyPlan({
    officeSnapshot: opts.officeSnapshot,
    crmBrief: opts.crmBrief,
    date: day,
  });
  try {
    saveDailyPlan(plan, opts.filePath);
  } catch (_) { /* read-only env */ }
  return plan;
}

/**
 * Short prompt block for Abby (CTO) think only.
 */
function formatAbbyThinkBlock(plan, maxChars = 420) {
  if (!plan?.priorities?.length) return '';
  const lines = [
    '## Company daily plan (drive the office)',
    ...plan.priorities.slice(0, 5).map((p, i) => `${i + 1}. ${p}`),
    'Own these five; assign/delegate; escalate blockers to CEO. Prefer evidence-backed outcomes.',
  ];
  const block = lines.join('\n');
  return block.length > maxChars ? `${block.slice(0, maxChars - 1)}…` : block;
}

module.exports = {
  PLAN_PATH,
  MAX_PRIORITIES,
  todayDate,
  buildDailyPlan,
  saveDailyPlan,
  loadDailyPlan,
  getTodayPlan,
  formatAbbyThinkBlock,
};
