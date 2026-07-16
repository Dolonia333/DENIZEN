'use strict';

/**
 * Server-side CRM audit — attribute who changed what (Angela, Zion, NPCs…).
 * Appended on workspace save so govcon capture work is accountable.
 */

const TRACKED_COLLECTIONS = [
  'contacts',
  'deals',
  'tasks',
  'companies',
  'notes',
  'meetings',
  'quotes',
  'submissions',
  'packages',
];

const TRACKED_FIELDS = [
  'name', 'title', 'stage', 'status', 'value', 'email', 'company', 'phone',
  'ownerId', 'owner', 'agency', 'solicitation', 'naics', 'contract_vehicle',
  'set_aside', 'clearance', 'contract_type', 'incumbent', 'closeDate',
  'awardDate', 'priority', 'dueDate', 'notes', 'description',
];

function nextId(list) {
  let max = 0;
  for (const row of list || []) {
    const n = Number(row?.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function entityLabel(item) {
  if (!item || typeof item !== 'object') return 'item';
  return String(
    item.name
    || item.title
    || item.company
    || item.subject
    || item.email
    || (item.id != null ? `#${item.id}` : 'item'),
  ).slice(0, 120);
}

function actorFields(actor = {}) {
  return {
    user: String(actor.user || actor.displayName || actor.email || 'Unknown').slice(0, 120),
    email: actor.email ? String(actor.email).slice(0, 160) : null,
    role: actor.role ? String(actor.role).slice(0, 40) : null,
    identityId: actor.identityId || null,
    accountId: actor.accountId || null,
    source: actor.source || 'workspace_save',
  };
}

function fieldChanged(a, b, field) {
  const av = a?.[field];
  const bv = b?.[field];
  if (av === undefined && bv === undefined) return false;
  if (av === bv) return false;
  try {
    return JSON.stringify(av) !== JSON.stringify(bv);
  } catch (_) {
    return String(av) !== String(bv);
  }
}

/**
 * Diff two workspace states → audit entries (newest first for unshift later).
 * @returns {object[]}
 */
function diffWorkspaceAudit(prevState, nextState, actor = {}) {
  const prev = prevState && typeof prevState === 'object' ? prevState : {};
  const next = nextState && typeof nextState === 'object' ? nextState : {};
  const base = actorFields(actor);
  const at = new Date().toISOString();
  const entries = [];

  // Industry switch (critical for govcon)
  const pInd = prev.industryConfig?.id || prev.industryConfig?.name;
  const nInd = next.industryConfig?.id || next.industryConfig?.name;
  if (nInd && pInd !== nInd) {
    entries.push({
      ...base,
      action: 'updated',
      entity: 'industry',
      entityName: String(nInd),
      field: 'industryConfig',
      from: pInd || null,
      to: nInd,
      at,
    });
  }

  for (const entity of TRACKED_COLLECTIONS) {
    const pArr = Array.isArray(prev[entity]) ? prev[entity] : [];
    const nArr = Array.isArray(next[entity]) ? next[entity] : [];
    const pMap = new Map(pArr.map((x) => [String(x?.id ?? ''), x]).filter(([k]) => k));
    const nMap = new Map(nArr.map((x) => [String(x?.id ?? ''), x]).filter(([k]) => k));

    for (const [id, item] of nMap) {
      if (!pMap.has(id)) {
        entries.push({
          ...base,
          action: 'created',
          entity,
          entityName: entityLabel(item),
          entityId: id,
          at,
        });
        continue;
      }
      const before = pMap.get(id);
      for (const field of TRACKED_FIELDS) {
        if (!fieldChanged(before, item, field)) continue;
        // also customFields bag
        entries.push({
          ...base,
          action: 'updated',
          entity,
          entityName: entityLabel(item),
          entityId: id,
          field,
          from: before?.[field] != null ? String(before[field]).slice(0, 200) : null,
          to: item?.[field] != null ? String(item[field]).slice(0, 200) : null,
          at,
        });
      }
      // custom field bag on deals/contacts
      if (before?.customFields || item?.customFields) {
        const bf = before?.customFields || {};
        const nf = item?.customFields || {};
        const keys = new Set([...Object.keys(bf), ...Object.keys(nf)]);
        for (const k of keys) {
          if (JSON.stringify(bf[k]) === JSON.stringify(nf[k])) continue;
          entries.push({
            ...base,
            action: 'updated',
            entity,
            entityName: entityLabel(item),
            entityId: id,
            field: `custom.${k}`,
            from: bf[k] != null ? String(bf[k]).slice(0, 200) : null,
            to: nf[k] != null ? String(nf[k]).slice(0, 200) : null,
            at,
          });
        }
      }
    }

    for (const [id, item] of pMap) {
      if (nMap.has(id)) continue;
      entries.push({
        ...base,
        action: 'deleted',
        entity,
        entityName: entityLabel(item),
        entityId: id,
        at,
      });
    }
  }

  return entries;
}

/**
 * Merge audit + usage into next state. Mutates a copy.
 */
function applyAuditToState(prevState, nextState, actor = {}, opts = {}) {
  const maxAudit = Number(opts.maxAudit) || 500;
  const maxUsage = Number(opts.maxUsage) || 300;
  const out = { ...(nextState || {}) };
  const existing = Array.isArray(out.auditLog) ? [...out.auditLog] : [];
  const diffs = diffWorkspaceAudit(prevState, nextState, actor);

  // Always record a save pulse when there were real diffs
  if (diffs.length) {
    let id = nextId(existing);
    const stamped = diffs.map((e) => {
      id += 1;
      return { id: id - 1, ...e };
    });
    // one summary first (newest)
    const summary = {
      id: id,
      ...actorFields(actor),
      action: 'saved',
      entity: 'workspace',
      entityName: 'CRM workspace',
      detail: `${stamped.length} change(s)`,
      changeCount: stamped.length,
      at: new Date().toISOString(),
    };
    out.auditLog = [summary, ...stamped, ...existing].slice(0, maxAudit);

    const usage = Array.isArray(out.usageLog) ? [...out.usageLog] : [];
    usage.unshift({
      id: nextId(usage),
      user: actorFields(actor).user,
      email: actorFields(actor).email,
      action: 'workspace_save',
      entity: 'workspace',
      at: new Date().toISOString(),
      changeCount: stamped.length,
    });
    out.usageLog = usage.slice(0, maxUsage);
  }

  return { state: out, changeCount: diffs.length, entries: diffs };
}

/**
 * Government Contracting industry preset (Meridian CRM).
 */
function govconIndustryConfig() {
  return {
    id: 'govcon',
    name: 'Government Contracting',
    icon: '🏛️',
    industry: 'govcon',
    terminology: {
      contact: 'Stakeholder',
      contacts: 'Stakeholders',
      deal: 'Opportunity',
      deals: 'Opportunities',
      pipeline: 'Capture Pipeline',
      account: 'Agency',
      accounts: 'Agencies',
      customers: 'Contracting Officers',
      salesHub: 'Capture Hub',
      pipelineValue: 'Pipeline Value',
      value: 'Contract Value',
      closeDate: 'Award Date',
      stage: 'Phase',
      company: 'Prime / Sub',
      note: 'Note',
      notes: 'Notes',
      task: 'Task',
      tasks: 'Tasks',
    },
    pipelineStages: [
      'Market Research',
      'Capture',
      'Pre-RFP',
      'RFP Released',
      'Proposal',
      'Submitted',
      'Awarded',
      'Lost',
      'Protest',
    ],
    customFields: [
      { id: 'naics', label: 'NAICS Code', type: 'text', entity: 'deal' },
      {
        id: 'contract_vehicle',
        label: 'Contract Vehicle',
        type: 'select',
        entity: 'deal',
        options: ['GSA Schedule', 'SEWP', 'CIO-SP3', 'OASIS', 'Alliant', 'SBIR', 'IDIQ', 'BPA', 'Direct Award'],
      },
      {
        id: 'set_aside',
        label: 'Set-Aside',
        type: 'select',
        entity: 'deal',
        options: ['Full & Open', '8(a)', 'HUBZone', 'SDVOSB', 'WOSB', 'Small Business'],
      },
      {
        id: 'clearance',
        label: 'Clearance Required',
        type: 'select',
        entity: 'deal',
        options: ['None', 'Public Trust', 'Secret', 'Top Secret', 'TS/SCI'],
      },
      { id: 'pop_start', label: 'Period of Performance Start', type: 'date', entity: 'deal' },
      { id: 'pop_end', label: 'Period of Performance End', type: 'date', entity: 'deal' },
      {
        id: 'contract_type',
        label: 'Contract Type',
        type: 'select',
        entity: 'deal',
        options: ['FFP', 'T&M', 'Cost-Plus', 'CPFF', 'CPAF', 'IDIQ Task Order'],
      },
      { id: 'solicitation', label: 'Solicitation #', type: 'text', entity: 'deal' },
      { id: 'incumbent', label: 'Incumbent', type: 'text', entity: 'deal' },
    ],
    contactStatuses: ['Prospect', 'Capture Team', 'Proposal Team', 'Past Performance', 'Inactive'],
    noteTypes: ['Capture Meeting', 'Industry Day', 'Call', 'Email', 'Proposal Review', 'Debrief'],
  };
}

function govconTeamPolicy() {
  return {
    nudgeInactiveDays: 3,
    requireOwnerOnDeal: true,
    // Keep required fields light so capture work isn't blocked mid-entry
    requiredDealFields: ['ownerId', 'stage', 'value'],
    requiredContactFields: ['email'],
  };
}

/**
 * Soft-map common stage names → govcon capture phases.
 */
function mapDealStagesToGovcon(deals) {
  if (!Array.isArray(deals)) return deals;
  const map = {
    lead: 'Market Research',
    inquiry: 'Market Research',
    'market research': 'Market Research',
    qualified: 'Capture',
    capture: 'Capture',
    discovery: 'Capture',
    'pre-rfp': 'Pre-RFP',
    prerfp: 'Pre-RFP',
    'rfp released': 'RFP Released',
    rfp: 'RFP Released',
    proposal: 'Proposal',
    quoted: 'Proposal',
    negotiation: 'Proposal',
    submitted: 'Submitted',
    awarded: 'Awarded',
    won: 'Awarded',
    closed: 'Awarded',
    lost: 'Lost',
    cancelled: 'Lost',
    protest: 'Protest',
  };
  return deals.map((d) => {
    if (!d || typeof d !== 'object') return d;
    const key = String(d.stage || '').trim().toLowerCase();
    const mapped = map[key];
    if (!mapped || mapped === d.stage) return d;
    return { ...d, stage: mapped, stageMappedFrom: d.stage };
  });
}

function applyGovconPreset(state, actor = {}) {
  const prev = state && typeof state === 'object' ? state : {};
  const next = {
    ...prev,
    industryConfig: govconIndustryConfig(),
    teamPolicy: {
      ...(prev.teamPolicy || {}),
      ...govconTeamPolicy(),
    },
    deals: mapDealStagesToGovcon(prev.deals),
  };
  const audited = applyAuditToState(prev, next, {
    user: actor.user || 'System',
    email: actor.email || null,
    role: actor.role || 'system',
    source: actor.source || 'govcon_preset',
  });
  // force industry audit even if only config changed and diff caught it
  if (!audited.changeCount) {
    const log = Array.isArray(audited.state.auditLog) ? [...audited.state.auditLog] : [];
    log.unshift({
      id: nextId(log),
      ...actorFields(actor),
      user: actor.user || 'System',
      action: 'updated',
      entity: 'industry',
      entityName: 'govcon',
      field: 'industryConfig',
      from: prev.industryConfig?.id || null,
      to: 'govcon',
      at: new Date().toISOString(),
      source: 'govcon_preset',
    });
    audited.state.auditLog = log.slice(0, 500);
  }
  return audited.state;
}

module.exports = {
  TRACKED_COLLECTIONS,
  diffWorkspaceAudit,
  applyAuditToState,
  govconIndustryConfig,
  govconTeamPolicy,
  applyGovconPreset,
  mapDealStagesToGovcon,
  entityLabel,
  nextId,
};
