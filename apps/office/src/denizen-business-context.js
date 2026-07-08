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

const CRM_NPCS = new Set(['Lucy', 'Marcus', 'Sarah', 'Pier', 'Abby', 'Rob', 'Roki', 'Bob']);

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

function detectProactiveSignals(model, crmText = '') {
  const signals = [];
  const crmLower = String(crmText || '').toLowerCase();
  for (const opp of model?.active_opportunities || []) {
    for (const blocker of opp.blockers || []) {
      const keywords = opp.crm_keywords || [];
      const linkedInCrm = keywords.some((k) => crmLower.includes(String(k).toLowerCase()));
      const days = daysUntil(blocker.due || opp.deadline);
      const urgent = blocker.severity === 'critical' || (days != null && days <= 90);
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

async function buildSnapshot({ orgId = null, npcName = null } = {}) {
  const brief = await loadCompanyBriefForOrg(orgId);
  const model = await loadBusinessModelForOrg(orgId);
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
  detectProactiveSignals,
  isBusinessRelatedMessage,
  shouldInjectForNpc,
  businessContextBrief,
  CRM_NPCS,
};
