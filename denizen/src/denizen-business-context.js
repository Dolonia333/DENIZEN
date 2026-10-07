'use strict';

/**
 * Canonical business context — company model + CRM linkage + proactive gaps.
 * All NPCs query the same snapshot; CRM NPCs get pipeline cross-reference.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRIEF_PATH = path.join(ROOT, 'data', 'company-brief.json');
const MODEL_PATH = path.join(ROOT, 'data', 'business-model.json');

const CRM_NPCS = new Set(['Lucy', 'Marcus', 'Sarah', 'Pier', 'Abby', 'Rob', 'Roki', 'Bob', 'Molly']);

let _briefCache = null;
let _modelCache = null;
let _briefMtime = 0;
let _modelMtime = 0;

function _readJson(filePath, cache, mtimeKey) {
  try {
    const stat = fs.statSync(filePath);
    if (cache && stat.mtimeMs === mtimeKey) return cache;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { data, mtime: stat.mtimeMs };
  } catch (_) {
    return { data: null, mtime: 0 };
  }
}

function loadCompanyBrief() {
  const { data, mtime } = _readJson(BRIEF_PATH, _briefCache, _briefMtime);
  if (data) {
    _briefCache = data;
    _briefMtime = mtime;
  }
  return _briefCache;
}

function loadBusinessModel() {
  const { data, mtime } = _readJson(MODEL_PATH, _modelCache, _modelMtime);
  if (data) {
    _modelCache = data;
    _modelMtime = mtime;
  }
  return _modelCache;
}

async function loadBusinessModelForOrg(orgId) {
  if (orgId) {
    try {
      const denizenDb = require('./denizen-db');
      if (denizenDb.enabled) {
        if (!denizenDb.orgId) await denizenDb.init().catch(() => null);
        const row = await denizenDb.getOrgBusinessModel(orgId);
        if (row?.business_model && typeof row.business_model === 'object') {
          return row.business_model;
        }
        if (orgId) {
          try {
            const denizenDb = require('./denizen-db');
            if (denizenDb.orgId && String(orgId) !== String(denizenDb.orgId)) {
              const genericSoulPack = require('./generic-soul-pack');
              return genericSoulPack.loadGenericBusinessModel();
            }
          } catch (_) { /* file fallback */ }
        }
      }
    } catch (_) { /* file fallback */ }
  }
  return loadBusinessModel();
}

async function loadCompanyBriefForOrg(orgId) {
  if (orgId) {
    try {
      const denizenDb = require('./denizen-db');
      if (denizenDb.enabled) {
        if (!denizenDb.orgId) await denizenDb.init().catch(() => null);
        const row = await denizenDb.getOrgBusinessModel(orgId);
        if (row?.company_brief && typeof row.company_brief === 'object') {
          return row.company_brief;
        }
        if (denizenDb.orgId && String(orgId) !== String(denizenDb.orgId)) {
          const genericSoulPack = require('./generic-soul-pack');
          return genericSoulPack.loadGenericCompanyBrief();
        }
      }
    } catch (_) { /* file fallback */ }
  }
  return loadCompanyBrief();
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr).getTime();
  if (!Number.isFinite(due)) return null;
  return Math.ceil((due - Date.now()) / 86400000);
}

function formatOpportunity(opp) {
  if (!opp) return '';
  const days = daysUntil(opp.deadline);
  const deadline = days != null ? `${opp.deadline} (${days}d)` : opp.deadline || '';
  const blockers = (opp.blockers || [])
    .map((b) => `${b.label}${b.owner_npc ? ` [${b.owner_npc}]` : ''}`)
    .join('; ');
  return [
    `${opp.name}: ${opp.summary || opp.type || ''}`.trim(),
    deadline ? `Deadline: ${deadline}` : '',
    blockers ? `Blockers: ${blockers}` : '',
  ].filter(Boolean).join(' | ');
}

function opportunityIsCurrent(opp) {
  const status = String(opp?.status || '').toLowerCase();
  if (/expired|historical|duplicate|closed|lost|parked/.test(status)) return false;
  const days = daysUntil(opp?.deadline);
  if (days != null && days < 0) return false;
  return true;
}

function isCurrentDeal(deal) {
  if (!deal) return false;
  const blob = `${deal.status || ''} ${deal.stage || ''} ${(deal.tags || []).join(' ')}`.toLowerCase();
  if (/historical|expired|duplicate|closed lost|closed won|watchlist|parked/.test(blob)) return false;
  const due = deal.deadline || deal.closeDate;
  const days = daysUntil(due);
  if (days != null && days < 0 && /closed|expired|historical/.test(blob)) return false;
  return true;
}

function dealToOpportunity(deal) {
  return {
    id: `deal-${deal.id}`,
    deal_id: deal.id,
    name: deal.title || deal.name || `Deal ${deal.id}`,
    customer: deal.company || deal.contact || '',
    type: 'crm',
    deadline: deal.deadline || deal.closeDate || null,
    status: deal.status || deal.stage || 'active',
    summary: [deal.stage, deal.value != null ? `$${Number(deal.value) || 0}` : '', deal.nextAction || deal.next_action || '']
      .filter(Boolean)
      .join(' · '),
    blockers: [],
    crm_keywords: [deal.title, deal.company, deal.contact].filter(Boolean),
  };
}

function goalTitle(goal) {
  if (typeof goal === 'string') return goal.trim();
  if (!goal || typeof goal !== 'object') return '';
  return String(goal.title || goal.name || goal.text || goal.label || goal.summary || '').trim();
}

const LEGACY_MILESTONE_TITLES = new Set([
  '10 discovery interviews complete',
  'pave part b drafted',
  'first pilot commitment',
]);

function isLegacyTemplateGoal(title) {
  const text = String(title || '').trim().toLowerCase();
  if (!text) return false;
  if (/\bdana\b/.test(text)) return true;
  if (/problem-solution fit/.test(text)) return true;
  if (/30-day revenue conversion sprint/.test(text)) return true;
  return false;
}

function isLegacyTemplateMilestone(title) {
  return LEGACY_MILESTONE_TITLES.has(String(title || '').trim().toLowerCase());
}

function currentGoalTitles(goals) {
  return (goals || []).map(goalTitle).filter((title) => title && !isLegacyTemplateGoal(title));
}

function applyLivePriorities(model, { deals = [], goals = [] } = {}) {
  const base = model && typeof model === 'object' ? model : {};
  const live = (deals || []).filter(isCurrentDeal).slice(0, 12).map(dealToOpportunity);
  const fileCurrent = (base.active_opportunities || []).filter(opportunityIsCurrent);
  const historical = [
    ...(base.historical_opportunities || []),
    ...(base.active_opportunities || []).filter((opp) => !opportunityIsCurrent(opp)),
  ];
  const goalTitles = currentGoalTitles(goals);
  const storedGoals = currentGoalTitles(base.strategic_goals);
  return {
    ...base,
    active_opportunities: live.length ? live : fileCurrent,
    historical_opportunities: historical,
    strategic_goals: goalTitles.length ? goalTitles : storedGoals,
    synced_from: live.length || goalTitles.length ? ['crm', 'business_studio'] : ['file'],
    synced_at: new Date().toISOString(),
  };
}

function staleNeedles(model) {
  const needles = [];
  for (const opp of model?.historical_opportunities || []) {
    const name = String(opp?.name || '').trim().toLowerCase();
    const id = String(opp?.id || '').trim().toLowerCase();
    if (name.length > 4) needles.push(name);
    if (id.length > 4 && !id.startsWith('deal-')) needles.push(id);
  }
  return needles;
}

function lineIsStale(line, needles) {
  const text = String(line || '').toLowerCase();
  if (!text) return false;
  if (isLegacyTemplateGoal(text)) return true;
  if (/before october 2026|before oct 2026|2026-10-01/.test(text) && /omes|teaming/.test(text)) return true;
  return needles.some((needle) => text.includes(needle));
}

function scrubStaleNarrative(brief, model) {
  const source = brief && typeof brief === 'object' ? brief : {};
  const needles = staleNeedles(model);
  const next = { ...source };
  if (Array.isArray(source.current_focus)) {
    next.current_focus = source.current_focus.filter((line) => !lineIsStale(line, needles));
  }
  if (Array.isArray(source.pain_points)) {
    next.pain_points = source.pain_points.filter((line) => !lineIsStale(line, needles));
  }
  if (source.role_tasks && typeof source.role_tasks === 'object') {
    const tasks = {};
    for (const [role, lines] of Object.entries(source.role_tasks)) {
      tasks[role] = (Array.isArray(lines) ? lines : []).filter((line) => !lineIsStale(line, needles));
    }
    next.role_tasks = tasks;
  }
  return next;
}

function detectProactiveSignals(model, crmText = '') {
  const signals = [];
  const crmLower = String(crmText || '').toLowerCase();
  for (const opp of model?.active_opportunities || []) {
    if (!opportunityIsCurrent(opp)) continue;
    for (const blocker of opp.blockers || []) {
      const dueDays = daysUntil(blocker.due || opp.deadline);
      if (dueDays != null && dueDays < 0) continue;
      const keywords = opp.crm_keywords || [];
      const linkedInCrm = keywords.some((k) => crmLower.includes(String(k).toLowerCase()));
      const urgent = blocker.severity === 'critical' || (dueDays != null && dueDays <= 90);
      if (!urgent && !linkedInCrm) continue;
      const crmGap = keywords.length && !linkedInCrm
        ? ` CRM may not reflect ${opp.name} yet.`
        : '';
      signals.push({
        priority: blocker.severity === 'critical' ? 'high' : 'medium',
        opportunity_id: opp.id,
        owner_npc: blocker.owner_npc || 'Marcus',
        message: `${blocker.label} for ${opp.name}.${crmGap}`,
        suggested_skill: 'crm-pipeline-brief',
      });
    }
  }
  return signals.sort((a, b) => (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0));
}

async function fetchCrmSummary(orgId) {
  if (!orgId) return { text: '', raw: null };
  try {
    const crmSkills = require('./denizen-crm-skills');
    const brief = await crmSkills.pipelineBrief(orgId, {});
    const text = String(brief?.summary || '').trim();
    return { text, raw: brief };
  } catch (err) {
    return { text: '', raw: null, error: err?.message };
  }
}

async function loadLiveWorkspace(orgId) {
  const empty = { deals: [], goals: [] };
  if (!orgId) return empty;
  try {
    const crmMutations = require('./denizen-crm-mutations');
    const loaded = await crmMutations.loadOrgWorkspace(orgId);
    empty.deals = Array.isArray(loaded?.state?.deals) ? loaded.state.deals : [];
  } catch (_) { /* CRM optional */ }
  try {
    const studioStore = require('./denizen-business-studio-store');
    const row = await studioStore.getWorkspace(orgId);
    const holding = studioStore.readPrivateStudio(row?.state, 'angela');
    const source = studioStore.hasWorkspaceData(holding)
      ? holding
      : studioStore.stripPrivateStudios(row?.state);
    empty.goals = (source.goals || []).filter((goal) => !isLegacyTemplateGoal(goalTitle(goal)));
  } catch (_) { /* studio optional */ }
  return empty;
}

async function updateBusinessContext(orgId, patch = {}) {
  const denizenDb = require('./denizen-db');
  const existing = await denizenDb.getOrgBusinessModel(orgId);
  const model = {
    ...(existing?.business_model || loadBusinessModel() || {}),
    ...(patch.business_model && typeof patch.business_model === 'object' ? patch.business_model : {}),
  };
  if (Array.isArray(patch.active_opportunities)) model.active_opportunities = patch.active_opportunities;
  if (Array.isArray(patch.strategic_goals)) model.strategic_goals = patch.strategic_goals;
  if (patch.capture_sprint && typeof patch.capture_sprint === 'object') {
    model.capture_sprint = { ...(model.capture_sprint || {}), ...patch.capture_sprint };
  }
  const brief = {
    ...(existing?.company_brief || loadCompanyBrief() || {}),
    ...(patch.company_brief && typeof patch.company_brief === 'object' ? patch.company_brief : {}),
  };
  if (Array.isArray(patch.current_focus)) brief.current_focus = patch.current_focus;
  if (Array.isArray(patch.pain_points)) brief.pain_points = patch.pain_points;
  model.updated = new Date().toISOString().slice(0, 10);
  const saved = await denizenDb.upsertOrgBusinessModel({
    orgId,
    templatePack: existing?.template_pack || null,
    businessModel: model,
    companyBrief: brief,
  });
  return { model, brief, saved: !!saved };
}

async function detachLegacyHoldingRecords(orgId) {
  if (!orgId) return { removed_goals: 0, removed_milestones: 0 };
  const studioStore = require('./denizen-business-studio-store');
  const row = await studioStore.getWorkspace(orgId);
  if (!row?.state) return { removed_goals: 0, removed_milestones: 0 };
  const holding = studioStore.readPrivateStudio(row.state, 'angela');
  const goals = (holding.goals || []).filter((goal) => !isLegacyTemplateGoal(goalTitle(goal)));
  const milestones = (holding.milestones || []).filter((item) => !isLegacyTemplateMilestone(goalTitle(item)));
  const removedGoals = (holding.goals || []).length - goals.length;
  const removedMilestones = (holding.milestones || []).length - milestones.length;
  if (!removedGoals && !removedMilestones) return { removed_goals: 0, removed_milestones: 0 };
  holding.goals = goals;
  holding.milestones = milestones;
  await studioStore.upsertWorkspace(orgId, studioStore.writePrivateStudio(row.state, 'angela', holding), null);
  return { removed_goals: removedGoals, removed_milestones: removedMilestones };
}

async function syncBusinessContext(orgId) {
  await detachLegacyHoldingRecords(orgId);
  const fileModel = await loadBusinessModelForOrg(orgId);
  const live = await loadLiveWorkspace(orgId);
  const model = applyLivePriorities(fileModel, live);
  const focus = [
    ...(model.active_opportunities || []).slice(0, 5).map((opp) => `${opp.name} (${opp.status || 'active'})`),
    ...(model.strategic_goals || []).slice(0, 3),
  ];
  const scrubbed = scrubStaleNarrative({
    ...(await loadCompanyBriefForOrg(orgId) || {}),
    current_focus: focus,
  }, model);
  return updateBusinessContext(orgId, {
    business_model: model,
    active_opportunities: model.active_opportunities,
    strategic_goals: model.strategic_goals,
    company_brief: scrubbed,
    current_focus: scrubbed.current_focus,
    pain_points: scrubbed.pain_points,
    capture_sprint: {
      active: true,
      priority: focus,
      note: 'Synced from current CRM deals and Business Studio goals. Past-due opportunities are historical.',
    },
  });
}

async function buildSnapshot({ orgId = null, npcName = null } = {}) {
  const brief = { ...(await loadCompanyBriefForOrg(orgId) || {}) };
  const storedModel = await loadBusinessModelForOrg(orgId);
  const live = await loadLiveWorkspace(orgId);
  const model = applyLivePriorities(storedModel, live);
  const focus = [
    ...(model.active_opportunities || []).slice(0, 5).map((opp) => `${opp.name} (${opp.status || 'active'})`),
    ...currentGoalTitles(live.goals).slice(0, 3),
  ];
  if (focus.length) brief.current_focus = focus;
  const scrubbed = scrubStaleNarrative(brief, model);
  Object.assign(brief, scrubbed);
  const crm = orgId ? await fetchCrmSummary(orgId) : { text: '', raw: null };
  const signals = detectProactiveSignals(model, crm.text);
  const ent = model?.entity || {};

  return {
    company: ent.legal_name
      ? `${ent.legal_name}${ent.technology_dba ? ` (${ent.technology_dba_short || 'DDT'})` : ''}`
      : (brief?.company || 'Company'),
    product: brief?.product || model?.product?.name || 'Denizen',
    entity: ent,
    certifications: model?.certifications || [],
    ecosystem: (model?.ecosystem || []).map((e) => `${e.name}: ${e.role || e.status || ''}`.trim()),
    sprint: brief?.sprint || null,
    goals: model?.strategic_goals || [],
    opportunities: (model?.active_opportunities || []).map(formatOpportunity),
    relationships: (model?.key_relationships || [])
      .map((r) => `${r.name} (${r.type})${r.contact ? ` — ${r.contact}` : ''}: ${r.context || ''}`.trim()),
    joint_pursuits: model?.joint_pursuit_areas || [],
    current_focus: brief?.current_focus || [],
    pain_points: brief?.pain_points || [],
    crm_summary: crm.text,
    proactive_signals: signals,
    npcName,
  };
}

function buildPromptBlock(snapshot, maxChars = 1400) {
  if (!snapshot) return '';
  const lines = [
    '## Business context (canonical — all NPCs)',
    `Company: ${snapshot.company}${snapshot.product ? ` | Product: ${snapshot.product}` : ''}`,
  ];
  if (snapshot.entity?.uei) {
    lines.push(`UEI ${snapshot.entity.uei} | CAGE ${snapshot.entity.cage_code || ''} | ${snapshot.entity.location || ''}`.trim());
  }
  if (snapshot.entity?.leadership) {
    const l = snapshot.entity.leadership;
    lines.push(`Leadership: ${l.holding_ceo} (1921) · ${l.technology_ceo} (tech) · ${l.engineering_director} (engineering)`);
  }
  if (snapshot.certifications?.length) {
    lines.push('Certifications: ' + snapshot.certifications.join(', '));
  }
  if (snapshot.ecosystem?.length) {
    lines.push('Ecosystem: ' + snapshot.ecosystem.slice(0, 4).join('; '));
  }
  if (snapshot.sprint?.name) {
    lines.push(`Sprint: ${snapshot.sprint.name}${snapshot.sprint.goal ? ` — ${String(snapshot.sprint.goal).slice(0, 100)}` : ''}`);
  }
  if (snapshot.goals?.length) {
    lines.push('Goals: ' + snapshot.goals.slice(0, 3).join('; '));
  }
  if (snapshot.current_focus?.length) {
    lines.push('Current focus: ' + snapshot.current_focus.slice(0, 4).join('; '));
  }
  if (snapshot.pain_points?.length) {
    lines.push('Pain points (prioritize in decisions):');
    snapshot.pain_points.slice(0, 6).forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  }
  if (snapshot.opportunities?.length) {
    lines.push('Active opportunities:');
    snapshot.opportunities.slice(0, 4).forEach((o) => lines.push(`- ${o}`));
  }
  if (snapshot.relationships?.length) {
    lines.push('Key relationships: ' + snapshot.relationships.slice(0, 3).join('; '));
  }
  if (snapshot.crm_summary) {
    lines.push('CRM snapshot: ' + snapshot.crm_summary.slice(0, 400));
  }
  if (snapshot.proactive_signals?.length) {
    lines.push('Proactive flags (surface to CEO when relevant):');
    snapshot.proactive_signals.slice(0, 3).forEach((s) => {
      lines.push(`- [${s.priority}] ${s.message}`);
    });
  }
  const block = lines.join('\n');
  return block.length > maxChars ? `${block.slice(0, maxChars - 1)}…` : block;
}

function buildThinkNudge(snapshot, npcName) {
  if (!snapshot?.proactive_signals?.length) return '';
  const relevant = snapshot.proactive_signals.filter(
    (s) => !s.owner_npc || s.owner_npc === npcName,
  );
  if (!relevant.length) return '';
  const top = relevant[0];
  return `PROACTIVE: ${top.message} Consider run_skill ${top.suggested_skill || 'crm-pipeline-brief'} or report to CEO.`;
}

function isBusinessRelatedMessage(message) {
  const msg = String(message || '').toLowerCase();
  if (!msg || msg.length < 6) return false;
  return /\b(pipeline|deal|crm|omes|teaming|federal|bid|solicitation|customer|partner|business|company|goal|opportunity|rm cyber|ddt|1921|smartcontainer|i\.?w\.?i\.?n|dolonia|angela|hubzone|wosb)\b/i.test(msg);
}

function shouldInjectForNpc(npcName) {
  return CRM_NPCS.has(npcName);
}

async function businessContextBrief(orgId, params = {}) {
  const snapshot = await buildSnapshot({ orgId, npcName: params.npcName || null });
  const summary = [
    buildPromptBlock(snapshot, 2000),
    '',
    snapshot.proactive_signals.length
      ? `Proactive: ${snapshot.proactive_signals.map((s) => s.message).join(' ')}`
      : 'No critical proactive flags.',
  ].join('\n');
  return {
    summary,
    snapshot,
    proactive_count: snapshot.proactive_signals.length,
  };
}

module.exports = {
  loadCompanyBrief,
  loadBusinessModel,
  loadCompanyBriefForOrg,
  loadBusinessModelForOrg,
  formatOpportunity,
  buildSnapshot,
  buildPromptBlock,
  buildThinkNudge,
  opportunityIsCurrent,
  applyLivePriorities,
  isLegacyTemplateGoal,
  detachLegacyHoldingRecords,
  scrubStaleNarrative,
  detectProactiveSignals,
  updateBusinessContext,
  syncBusinessContext,
  isBusinessRelatedMessage,
  shouldInjectForNpc,
  businessContextBrief,
  CRM_NPCS,
};
