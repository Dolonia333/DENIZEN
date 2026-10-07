'use strict';

/**
 * Living PAVE (Planning & Venture Evaluation) workbook for Business Studio.
 * Founders fill sections through workshops; mentors review, ask WHY, and suggest
 * pivots anytime in the cohort. Part B stays living as interviews continue.
 */

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRiskRow() {
  return { risk: '', why: '', mitigate: '' };
}

function emptyMarketRow() {
  return { customers: '', acv: '', size: '' };
}

const SALES_CYCLE_ROLES = Object.freeze([
  { id: 'uses', label: 'USES', tone: 'sage' },
  { id: 'recommends', label: 'RECOMMENDS', tone: 'blue' },
  { id: 'influences', label: 'INFLUENCES', tone: 'tan' },
  { id: 'decides', label: 'DECIDES & PAYS', tone: 'teal' },
  { id: 'saboteur', label: 'SABOTEUR', tone: 'red' },
]);

const SALES_CYCLE_STEPS = Object.freeze([
  { id: 'demo', label: 'Demo office' },
  { id: 'account', label: 'One real account on My Board' },
  { id: 'receipt', label: 'Weekly receipt (outcomes ledger)' },
  { id: 'paid', label: 'Paid seat' },
]);

function emptySalesCycleDiagram() {
  return {
    title: 'Sales cycle',
    subtitle: 'Buying center around the product.',
    productTitle: 'Product',
    productSubtitle: '',
    roles: SALES_CYCLE_ROLES.map((r) => ({ id: r.id, label: r.label, tone: r.tone, text: '' })),
    cycle: SALES_CYCLE_STEPS.map((s) => ({ id: s.id, label: s.label })),
    cycleNote: 'HOW A DEAL MOVES (honest cycle — no invented close dates)',
  };
}

function denizenSalesCycleDiagram() {
  return {
    title: 'DENIZEN sales cycle',
    subtitle: 'School or district buying center. Unvalidated until qualifying interviews exist.',
    productTitle: 'DENIZEN',
    productSubtitle: 'visual AI office',
    roles: [
      { id: 'uses', label: 'USES', tone: 'sage', text: 'Teachers and operators\nwho would use the office\nNot confirmed by interviews' },
      { id: 'recommends', label: 'RECOMMENDS', tone: 'blue', text: 'Curriculum or CTE staff\nwho might champion a pilot\nUnvalidated' },
      { id: 'influences', label: 'INFLUENCES', tone: 'tan', text: 'IT and compliance\ncan block or shape a purchase\nNo compliance claim yet' },
      { id: 'decides', label: 'DECIDES & PAYS', tone: 'teal', text: 'Economic buyer at the\nschool or district\nPrice is not validated' },
      { id: 'saboteur', label: 'SABOTEUR', tone: 'red', text: 'Status quo tools\nor a security veto\nCount this if interviews say so' },
    ],
    cycle: SALES_CYCLE_STEPS.map((s) => ({ id: s.id, label: s.label })),
    cycleNote: 'HOW A DEAL MOVES (honest cycle — no invented close dates or prices)',
  };
}

function sanitizeSalesCycleDiagram(raw) {
  const out = emptySalesCycleDiagram();
  if (!raw || typeof raw !== 'object') return out;
  out.title = coerceString(raw.title) || out.title;
  out.subtitle = coerceString(raw.subtitle) || out.subtitle;
  out.productTitle = coerceString(raw.productTitle || raw.centerTitle) || out.productTitle;
  out.productSubtitle = coerceString(raw.productSubtitle || raw.centerSubtitle);
  out.cycleNote = coerceString(raw.cycleNote) || out.cycleNote;
  const byId = {};
  if (Array.isArray(raw.roles)) {
    raw.roles.forEach((r) => {
      if (r && r.id) byId[r.id] = r;
    });
  }
  out.roles = SALES_CYCLE_ROLES.map((meta) => {
    const hit = byId[meta.id] || {};
    return {
      id: meta.id,
      label: coerceString(hit.label) || meta.label,
      tone: meta.tone,
      text: coerceString(hit.text),
    };
  });
  const stepById = {};
  if (Array.isArray(raw.cycle)) {
    raw.cycle.forEach((s) => {
      if (s && s.id) stepById[s.id] = s;
    });
  }
  out.cycle = SALES_CYCLE_STEPS.map((meta) => ({
    id: meta.id,
    label: coerceString((stepById[meta.id] || {}).label) || meta.label,
  }));
  return out;
}

function emptyPave() {
  return {
    snapshot: {
      company: '',
      founders: '',
      i2eAdvisor: '',
      cohort: '',
      productDescription: '',
    },
    partA: {
      customer: '',
      problem: '',
      currentAlternative: '',
      solution: '',
      valueProposition: '',
      salesCycle: '',
      salesCycleDiagram: emptySalesCycleDiagram(),
    },
    partB: {
      targetPersona: '',
      interviewGoal: '10+',
      interviewsCompletedNote: '',
      summaryOfCalls: '',
      expectedFindings: '',
      unexpectedFindings: '',
      personaDecision: '',
      // legacy aliases kept for older workspaces
      customerDiscovery: '',
      interviewRecords: [],
    },
    partC: {
      directCompetitors: '',
      indirectCompetitors: '',
      potentialCompetitors: '',
      statusQuo: '',
      competitiveMatrix: '',
      shortTermAdvantages: '',
      longTermAdvantages: '',
      competitorAdvantages: '',
      competitiveResponse: '',
      distributionAccess: '',
      risks: [emptyRiskRow(), emptyRiskRow(), emptyRiskRow()],
      marketSizing: {
        tam: emptyMarketRow(),
        sam: emptyMarketRow(),
        som: emptyMarketRow(),
      },
      revenueYear1: '',
      revenueYear2: '',
      revenueYear3: '',
      futureSegments: '',
      // legacy string risks still accepted via sanitize
      risksText: '',
    },
    partD: {
      foundingTeam: '',
      teamGaps: '',
      gapStrategy: '',
      pitch90: '',
    },
    final: {
      discoveredRisks: '',
      recommendedNextSteps: '',
      advisorOutcome: '',
    },
    reviews: [],
    updatedAt: null,
    living: true,
  };
}

/** Field catalog for the workbook UI + mentor targeting */
const PAVE_SECTIONS = Object.freeze([
  {
    id: 'snapshot',
    title: 'Company Snapshot',
    when: 'Complete at the start of the cohort',
    living: false,
    fields: [
      { key: 'snapshot.company', label: 'Company name', kind: 'text' },
      { key: 'snapshot.founders', label: 'Founder(s)', kind: 'text' },
      { key: 'snapshot.i2eAdvisor', label: 'i2E advisor / E3 mentor', kind: 'text' },
      { key: 'snapshot.cohort', label: 'Cohort / dates', kind: 'textarea' },
      { key: 'snapshot.productDescription', label: 'Product description (1–2 sentences)', kind: 'textarea' },
    ],
  },
  {
    id: 'partA',
    title: 'Part A — After Workshop A',
    when: 'Complete before Mentor Call A · Customer, value proposition, sales cycle',
    living: false,
    fields: [
      { key: 'partA.customer', label: 'Our customer (the person who pays) is', kind: 'textarea' },
      { key: 'partA.problem', label: 'Their problem is', kind: 'textarea' },
      { key: 'partA.currentAlternative', label: 'They currently solve it by', kind: 'textarea' },
      { key: 'partA.solution', label: 'Our product solves it by', kind: 'textarea' },
      { key: 'partA.valueProposition', label: 'Value proposition — With [company], [customer] can…', kind: 'textarea' },
      { key: 'partA.salesCycle', label: 'Sales cycle (diagram or text map)', kind: 'textarea' },
    ],
  },
  {
    id: 'partB',
    title: 'Part B — After Workshop B',
    when: 'Living section — keep updating as you finish more interviews',
    living: true,
    fields: [
      { key: 'partB.targetPersona', label: 'Target persona / segment (one at a time — don’t mix)', kind: 'textarea' },
      { key: 'partB.interviewGoal', label: 'Interview goal', kind: 'text' },
      { key: 'partB.interviewsCompletedNote', label: 'Interviews completed so far (notes)', kind: 'textarea' },
      { key: 'partB.summaryOfCalls', label: 'Summary of calls', kind: 'textarea' },
      { key: 'partB.expectedFindings', label: 'Expected — what matched your assumptions', kind: 'textarea' },
      { key: 'partB.unexpectedFindings', label: 'Unexpected — what surprised you', kind: 'textarea' },
      { key: 'partB.personaDecision', label: 'So what? Does the persona still hold, or do you need to pivot?', kind: 'textarea' },
    ],
  },
  {
    id: 'partC',
    title: 'Part C — After Workshop C',
    when: 'Complete before Mentor Call C · Competition, risks, market size',
    living: false,
    fields: [
      { key: 'partC.directCompetitors', label: 'Direct competitors', kind: 'textarea' },
      { key: 'partC.indirectCompetitors', label: 'Indirect competitors', kind: 'textarea' },
      { key: 'partC.potentialCompetitors', label: 'Potential competitors', kind: 'textarea' },
      { key: 'partC.statusQuo', label: 'Status quo (what most customers use today)', kind: 'textarea' },
      { key: 'partC.competitiveMatrix', label: 'Competitive matrix', kind: 'textarea' },
      { key: 'partC.shortTermAdvantages', label: 'Short-term competitive advantages', kind: 'textarea' },
      { key: 'partC.longTermAdvantages', label: 'Long-term competitive advantages (moat — “first mover” doesn’t count)', kind: 'textarea' },
      { key: 'partC.competitorAdvantages', label: 'Advantages your competitors will keep', kind: 'textarea' },
      { key: 'partC.competitiveResponse', label: 'Likely competitive response — and how you’ll handle it', kind: 'textarea' },
      { key: 'partC.distributionAccess', label: 'Do you have access to the existing distribution channel? How?', kind: 'textarea' },
      { key: 'partC.revenueYear1', label: 'Year 1 expected revenue', kind: 'text' },
      { key: 'partC.revenueYear2', label: 'Year 2 expected revenue', kind: 'text' },
      { key: 'partC.revenueYear3', label: 'Year 3 expected revenue', kind: 'text' },
      { key: 'partC.futureSegments', label: 'Future verticals / segments', kind: 'textarea' },
    ],
  },
  {
    id: 'partD',
    title: 'Part D — After Workshop D',
    when: 'Complete before Mentor Call D · Founding team and 90-second pitch',
    living: false,
    fields: [
      { key: 'partD.foundingTeam', label: 'Current team & roles', kind: 'textarea' },
      { key: 'partD.teamGaps', label: 'Biggest gap (capability you can’t cover yourself)', kind: 'textarea' },
      { key: 'partD.gapStrategy', label: 'How you’ll fill it', kind: 'textarea' },
      { key: 'partD.pitch90', label: 'Your 90-second pitch', kind: 'textarea' },
    ],
  },
  {
    id: 'final',
    title: 'Final PAVE Meeting',
    when: 'Completed with your i2E advisor at the final PAVE meeting',
    living: false,
    fields: [
      { key: 'final.discoveredRisks', label: 'Discovered risks', kind: 'textarea' },
      { key: 'final.recommendedNextSteps', label: 'Recommended next steps (capital / advisory path)', kind: 'textarea' },
      { key: 'final.advisorOutcome', label: 'Advisor outcome / notes', kind: 'textarea' },
    ],
  },
]);

function getNested(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

function setNested(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function normPaveKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const PAVE_STRUCTURED_PATHS = new Set([
  'partA.salesCycleDiagram',
  'partC.risks',
  'partC.marketSizing',
]);

let paveFieldIndexCache = null;

function paveFieldIndex() {
  if (paveFieldIndexCache) return paveFieldIndexCache;
  const fields = new Map();
  const sections = new Map();
  const addField = (alias, path) => {
    const key = normPaveKey(alias);
    if (key && !fields.has(key)) fields.set(key, path);
  };
  const addSection = (alias, id) => {
    const key = normPaveKey(alias);
    if (key && !sections.has(key)) sections.set(key, id);
  };
  for (const sec of PAVE_SECTIONS) {
    addSection(sec.id, sec.id);
    addSection(sec.title, sec.id);
    addSection(sec.id.replace(/([A-Z])/g, '_$1'), sec.id);
    for (const field of sec.fields) {
      const leaf = field.key.slice(field.key.indexOf('.') + 1);
      addField(field.key, field.key);
      addField(leaf, field.key);
      addField(field.label, field.key);
      addField(`${sec.id}.${leaf}`, field.key);
      addField(`${sec.id}_${leaf}`, field.key);
    }
  }
  addSection('parta', 'partA');
  addSection('partb', 'partB');
  addSection('partc', 'partC');
  addSection('partd', 'partD');
  addSection('part_a', 'partA');
  addSection('part_b', 'partB');
  addSection('part_c', 'partC');
  addSection('part_d', 'partD');
  addField('founder', 'snapshot.founders');
  addField('founderName', 'snapshot.founders');
  addField('founder_name', 'snapshot.founders');
  addField('companyName', 'snapshot.company');
  addField('company_name', 'snapshot.company');
  addField('salesCycleDiagram', 'partA.salesCycleDiagram');
  addField('sales_cycle_diagram', 'partA.salesCycleDiagram');
  addField('sales_cycle', 'partA.salesCycle');
  addField('founding_team', 'partD.foundingTeam');
  addField('pitch', 'partD.pitch90');
  paveFieldIndexCache = { fields, sections };
  return paveFieldIndexCache;
}

function paveFieldText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(paveFieldText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    const inner = value.value ?? value.text ?? value.content ?? value.body ?? value.notes ?? value.description ?? value.label;
    if (inner != null && inner !== value) return paveFieldText(inner);
  }
  return '';
}

const PAVE_SECTION_PROSE = Object.freeze({
  snapshot: 'snapshot.productDescription',
  partA: 'partA.problem',
  partB: 'partB.summaryOfCalls',
  partC: 'partC.statusQuo',
  partD: 'partD.pitch90',
  final: 'final.advisorOutcome',
});

const PAVE_SKIP_KEYS = new Set([
  'program_id', 'programId', 'fields', 'pave', 'workbook', 'updates', 'sections', 'updatedAt', 'updated_at',
]);

function paveValueIsSubstantive(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function paveAssignmentsFrom(input, prefixSection, ignored) {
  const out = [];
  const missed = ignored || [];
  if (input == null) return out;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return paveAssignmentsFrom(JSON.parse(trimmed), prefixSection, missed);
      } catch (_) { /* a plain string is not a field map */ }
    }
    return out;
  }
  if (Array.isArray(input)) {
    for (const row of input) {
      if (!row || typeof row !== 'object') continue;
      const path = row.path || row.field || row.key || row.name || row.label;
      const value = row.value ?? row.text ?? row.content ?? row.body;
      if (path != null && value !== undefined) {
        const found = paveResolveAssignment(path, value, prefixSection, missed);
        if (!found.length && paveValueIsSubstantive(value) && (typeof value !== 'object' || Array.isArray(value))) {
          missed.push(String(path));
        }
        out.push(...found);
      }
    }
    return out;
  }
  if (typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    if (PAVE_SKIP_KEYS.has(key)) continue;
    const found = paveResolveAssignment(key, value, prefixSection, missed);
    if (!found.length && paveValueIsSubstantive(value) && (typeof value !== 'object' || Array.isArray(value))) {
      missed.push(key);
    }
    out.push(...found);
  }
  return out;
}

function paveResolveAssignment(key, value, prefixSection, ignored) {
  const index = paveFieldIndex();
  const norm = normPaveKey(key);
  const prefixed = normPaveKey(`${prefixSection || ''}${key}`);
  const sectionId = index.sections.get(norm) || index.sections.get(prefixed);
  if (sectionId && value && typeof value === 'object' && !Array.isArray(value)) {
    return paveAssignmentsFrom(value, sectionId, ignored);
  }
  if (sectionId && typeof value === 'string' && value.trim() && PAVE_SECTION_PROSE[sectionId]) {
    return [{ path: PAVE_SECTION_PROSE[sectionId], value: value.trim() }];
  }
  let path = index.fields.get(norm) || index.fields.get(prefixed);
  if (!path && String(key).includes('.')) {
    const parts = String(key).split('.');
    const section = index.sections.get(normPaveKey(parts[0]));
    const leaf = index.fields.get(normPaveKey(parts.slice(1).join('.')))
      || index.fields.get(normPaveKey(parts[parts.length - 1]));
    if (section && leaf && leaf.startsWith(`${section}.`)) path = leaf;
    else if (leaf) path = leaf;
  }
  if (!path) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return paveAssignmentsFrom(value, prefixSection, ignored);
    }
    return [];
  }
  if (PAVE_STRUCTURED_PATHS.has(path) && value && typeof value === 'object') {
    return [{ path, value }];
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const wrapperKeys = new Set(['text', 'body', 'content', 'value', 'notes', 'description', 'label']);
    const extras = {};
    for (const [child, childValue] of Object.entries(value)) {
      if (!wrapperKeys.has(child)) extras[child] = childValue;
    }
    const nested = Object.keys(extras).length
      ? paveAssignmentsFrom(extras, path.split('.')[0], ignored)
      : [];
    const text = paveFieldText(value);
    if (nested.length && text) return [{ path, value: text }, ...nested];
    if (nested.length) return nested;
    if (!text) return [];
    return [{ path, value: text }];
  }
  return [{ path, value: paveFieldText(value) }];
}

function applyPaveFields(pave, args = {}) {
  const base = sanitizePave(pave);
  const applied = [];
  const ignored = [];
  const chunks = [];
  const top = args && typeof args === 'object' ? { ...args } : {};
  for (const key of ['program_id', 'programId', 'fields', 'pave', 'workbook', 'updates', 'sections']) {
    delete top[key];
  }
  chunks.push(top);
  for (const key of ['fields', 'updates', 'sections', 'pave', 'workbook']) {
    if (args && args[key] != null) chunks.push(args[key]);
  }
  for (const chunk of chunks) {
    for (const assignment of paveAssignmentsFrom(chunk, null, ignored)) {
      setNested(base, assignment.path, assignment.value);
      applied.push(assignment.path);
    }
  }
  return {
    pave: sanitizePave({ ...base, updatedAt: new Date().toISOString() }),
    applied: [...new Set(applied)],
    ignored: [...new Set(ignored)],
    fields: PAVE_SECTIONS.map((section) => ({
      section: section.id,
      keys: section.fields.map((field) => field.key),
    })),
  };
}

function coerceString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => coerceString(x)).filter(Boolean).join('\n');
  if (typeof v === 'object') {
    const inner = v.text ?? v.body ?? v.content ?? v.value ?? v.notes ?? v.description ?? v.label;
    if (inner != null && inner !== v) return coerceString(inner);
    return '';
  }
  return String(v);
}

function sanitizeRisks(raw, legacyText) {
  let rows = [];
  if (Array.isArray(raw)) {
    rows = raw.map((r) => ({
      risk: coerceString(r && r.risk),
      why: coerceString(r && (r.why || r.whyRisk)),
      mitigate: coerceString(r && (r.mitigate || r.mitigation)),
    }));
  }
  while (rows.length < 3) rows.push(emptyRiskRow());
  if (!rows.some((r) => r.risk || r.why || r.mitigate) && legacyText) {
    rows[0] = { risk: coerceString(legacyText), why: '', mitigate: '' };
  }
  return rows.slice(0, 8);
}

function sanitizeMarketRow(raw, legacy) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      customers: coerceString(raw.customers || raw.count),
      acv: coerceString(raw.acv || raw.annual),
      size: coerceString(raw.size || raw.marketSize),
    };
  }
  if (typeof raw === 'string' || typeof legacy === 'string') {
    return { customers: '', acv: '', size: coerceString(raw || legacy) };
  }
  return emptyMarketRow();
}

function sanitizePave(raw) {
  const out = emptyPave();
  if (!raw || typeof raw !== 'object') return out;

  const snap = raw.snapshot || {};
  out.snapshot.company = coerceString(snap.company);
  out.snapshot.founders = coerceString(snap.founders || snap.founder);
  out.snapshot.i2eAdvisor = coerceString(snap.i2eAdvisor || snap.advisor);
  out.snapshot.cohort = coerceString(snap.cohort || snap.program);
  out.snapshot.productDescription = coerceString(snap.productDescription || snap.product);

  const a = raw.partA || {};
  out.partA.customer = coerceString(a.customer);
  out.partA.problem = coerceString(a.problem);
  out.partA.currentAlternative = coerceString(a.currentAlternative);
  out.partA.solution = coerceString(a.solution);
  out.partA.valueProposition = coerceString(a.valueProposition);
  out.partA.salesCycle = coerceString(a.salesCycle);
  out.partA.salesCycleDiagram = sanitizeSalesCycleDiagram(a.salesCycleDiagram);

  const b = raw.partB || {};
  out.partB.targetPersona = coerceString(b.targetPersona);
  out.partB.interviewGoal = coerceString(b.interviewGoal) || '10+';
  out.partB.interviewsCompletedNote = coerceString(b.interviewsCompletedNote || b.interviewsCompleted);
  out.partB.summaryOfCalls = coerceString(b.summaryOfCalls || b.customerDiscovery);
  out.partB.expectedFindings = coerceString(b.expectedFindings);
  out.partB.unexpectedFindings = coerceString(b.unexpectedFindings);
  out.partB.personaDecision = coerceString(b.personaDecision);
  out.partB.customerDiscovery = coerceString(b.customerDiscovery);
  out.partB.interviewRecords = Array.isArray(b.interviewRecords) ? b.interviewRecords : [];

  const c = raw.partC || {};
  const competition = c.competition && typeof c.competition === 'object' ? c.competition : {};
  out.partC.directCompetitors = coerceString(c.directCompetitors || competition.direct);
  out.partC.indirectCompetitors = coerceString(c.indirectCompetitors || competition.indirect);
  out.partC.potentialCompetitors = coerceString(c.potentialCompetitors || competition.potential);
  out.partC.statusQuo = coerceString(c.statusQuo || competition.statusQuo);
  out.partC.competitiveMatrix = coerceString(c.competitiveMatrix);
  out.partC.shortTermAdvantages = coerceString(c.shortTermAdvantages);
  out.partC.longTermAdvantages = coerceString(c.longTermAdvantages);
  out.partC.competitorAdvantages = coerceString(c.competitorAdvantages);
  out.partC.competitiveResponse = coerceString(c.competitiveResponse);
  out.partC.distributionAccess = coerceString(c.distributionAccess);
  out.partC.risks = sanitizeRisks(c.risks, c.risksText || (typeof c.risks === 'string' ? c.risks : ''));
  out.partC.risksText = coerceString(typeof c.risks === 'string' ? c.risks : c.risksText);
  const ms = c.marketSizing || {};
  out.partC.marketSizing = {
    tam: sanitizeMarketRow(ms.tam, typeof ms.tam === 'string' ? ms.tam : ''),
    sam: sanitizeMarketRow(ms.sam, typeof ms.sam === 'string' ? ms.sam : ''),
    som: sanitizeMarketRow(ms.som, typeof ms.som === 'string' ? ms.som : ''),
  };
  const rev = c.revenueProjections;
  if (rev && typeof rev === 'object') {
    out.partC.revenueYear1 = coerceString(rev.year1 || rev.y1);
    out.partC.revenueYear2 = coerceString(rev.year2 || rev.y2);
    out.partC.revenueYear3 = coerceString(rev.year3 || rev.y3);
  } else {
    out.partC.revenueYear1 = coerceString(c.revenueYear1);
    out.partC.revenueYear2 = coerceString(c.revenueYear2);
    out.partC.revenueYear3 = coerceString(c.revenueYear3);
    if (!out.partC.revenueYear1 && typeof rev === 'string') out.partC.revenueYear1 = rev;
  }
  out.partC.futureSegments = coerceString(c.futureSegments);

  const d = raw.partD || {};
  out.partD.foundingTeam = coerceString(d.foundingTeam);
  out.partD.teamGaps = coerceString(d.teamGaps);
  out.partD.gapStrategy = coerceString(d.gapStrategy);
  out.partD.pitch90 = coerceString(d.pitch90);

  const f = raw.final || {};
  out.final.discoveredRisks = coerceString(f.discoveredRisks);
  out.final.recommendedNextSteps = coerceString(f.recommendedNextSteps);
  out.final.advisorOutcome = coerceString(f.advisorOutcome);

  out.reviews = Array.isArray(raw.reviews)
    ? raw.reviews.map((r) => ({
      id: r.id || uid('prv'),
      fieldPath: coerceString(r.fieldPath || r.path),
      kind: ['why', 'suggest', 'note'].includes(r.kind) ? r.kind : 'note',
      text: coerceString(r.text || r.body),
      authorName: coerceString(r.authorName || r.advisorName || 'Mentor'),
      authorRole: coerceString(r.authorRole || r.role || 'mentor'),
      createdAt: r.createdAt || null,
      resolved: !!r.resolved,
      founderReply: coerceString(r.founderReply),
    })).filter((r) => r.fieldPath && r.text)
    : [];

  out.updatedAt = raw.updatedAt || null;
  out.living = raw.living !== false;
  return out;
}

function mergePavePatch(base, patch) {
  const merged = { ...(base || {}), ...(patch || {}) };
  for (const key of ['snapshot', 'partA', 'partB', 'partC', 'partD', 'final']) {
    if (patch && patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      merged[key] = { ...((base && base[key]) || {}), ...patch[key] };
    }
  }
  if (patch && patch.partA && patch.partA.salesCycleDiagram && typeof patch.partA.salesCycleDiagram === 'object') {
    merged.partA = merged.partA || {};
    merged.partA.salesCycleDiagram = {
      ...((base && base.partA && base.partA.salesCycleDiagram) || {}),
      ...patch.partA.salesCycleDiagram,
    };
  }
  if (patch && patch.partC && patch.partC.marketSizing && typeof patch.partC.marketSizing === 'object') {
    merged.partC = merged.partC || {};
    merged.partC.marketSizing = {
      ...((base && base.partC && base.partC.marketSizing) || {}),
      ...patch.partC.marketSizing,
    };
  }
  return merged;
}

function denizenPaveDraft() {
  return sanitizePave({
    snapshot: {
      company: 'DENIZEN / Dolonia Data Tech Solutions',
      founders: 'Zion Alexander Van Zandt',
      i2eAdvisor: 'Srijita Ghosh, i2E E3 mentor. Final PAVE advisor is not assigned.',
      cohort: 'i2E E3 Cohort 63. Workshops and the mentor call are historical context, not customer evidence.',
      productDescription:
        'DENIZEN is a visual AI operating environment: a persistent office where named agents keep memory, use allowed tools, and leave receipts when work finishes.',
    },
    partA: {
      customer:
        'School and district buyers — CTE, curriculum, and IT decision-makers. The economic buyer is not confirmed. CRM contacts and meetings are not qualifying interviews.',
      problem:
        'Hypothesis to test: AI work dies in chat tabs, and a school or district cannot tell whether an agent did real work. Do not treat cost savings or compliance as proven.',
      currentAlternative:
        'Chat tools, campus software, and manual follow-up. What buyers actually use is unknown until interviews say so.',
      solution:
        'DENIZEN gives a small team a visible office, durable agents, and receipts. A campus deployment is a separate hypothesis, not a finished product claim.',
      valueProposition:
        'With DENIZEN, a buyer could see which agent finished work and keep a record of it. Pricing, privacy compliance, and infrastructure savings are not claimed here.',
      salesCycle:
        'Unvalidated. Likely users are teachers or operators. The economic buyer is a school or district role. Price is not set. Count a security or status-quo veto if interviews say so.',
      salesCycleDiagram: denizenSalesCycleDiagram(),
    },
    partB: {
      targetPersona:
        'One school or district buyer at a time. Do not mix government capture, a small-business persona, or CRM contacts into this list.',
      interviewGoal: '10+',
      interviewsCompletedNote: '0 of 10 qualifying school or district interviews. Contradictory evidence counts. Meetings are not interviews.',
      summaryOfCalls: 'None yet. No qualifying interviews are on file.',
      expectedFindings: 'Not written until interviews exist.',
      unexpectedFindings: 'Not written until interviews exist. Contradictory evidence is recorded here.',
      personaDecision: 'Persona is unvalidated. Hold or change it only after qualifying interviews, including interviews that disagree.',
    },
    partC: {
      directCompetitors: 'Existing chat and campus software the buyer already pays for. Name them from interviews, not from a template.',
      indirectCompetitors: 'Status quo process: staff, spreadsheets, and tools already in the building.',
      potentialCompetitors: 'Any vendor that can show the same work with receipts. Not listed as a fact.',
      statusQuo: 'Whatever the buyer uses today. Unknown until interviews.',
      competitiveMatrix: 'Not filled. A matrix needs sources.',
      shortTermAdvantages: 'A visible office and receipts. This is a product description, not a proven advantage.',
      longTermAdvantages: 'No moat is claimed. First-mover, compliance, and cost claims need evidence.',
      competitorAdvantages: 'Incumbent tools already have distribution and trust. Specific names come from interviews.',
      competitiveResponse: 'Unknown until a buyer describes how they would switch or refuse.',
      distributionAccess: 'Not established. Founder-led discovery is the current path.',
      risks: [
        { risk: 'Wrong buyer', why: 'A persona without interviews wastes the cohort', mitigate: 'Ten qualifying interviews, contradictions included' },
        { risk: 'Unproven pricing', why: 'A list price would be invented', mitigate: 'Leave price blank until a buyer discusses it' },
        { risk: 'Unsupported compliance or cost claim', why: 'Mentors and buyers will challenge it', mitigate: 'Do not state FERPA, cloud cost, or margin as fact' },
      ],
      marketSizing: {
        tam: { customers: '', acv: '', size: '' },
        sam: { customers: '', acv: '', size: '' },
        som: { customers: '', acv: '', size: '' },
      },
      revenueYear1: 'Not modeled',
      revenueYear2: 'Not modeled',
      revenueYear3: 'Not modeled',
      futureSegments: 'Other public-sector buyers only after the school or district persona is supported or rejected by interviews.',
    },
    partD: {
      foundingTeam: 'Zion Alexander Van Zandt — founder. Other teammates are recorded only when the workspace already names them.',
      teamGaps: 'Qualifying customer discovery: 10 school or district interviews, with contradictory evidence counted.',
      gapStrategy: 'Run the interviews with the i2E E3 mentor, Srijita Ghosh. Do not hire ahead of a validated buyer.',
      pitch90:
        'DENIZEN is a visual office where named agents keep memory, use allowed tools, and leave receipts. It is pre-revenue and pre-validation. The next proof is 10 qualifying school or district buyer interviews.',
    },
    final: {
      discoveredRisks: 'Pricing, compliance, margins, and infrastructure savings are not established.',
      recommendedNextSteps: 'Keep the 10-interview goal. Do not fill Funding Readiness without evidence.',
      advisorOutcome: '',
    },
    living: true,
  });
}

function paveFieldPaths() {
  const paths = [];
  for (const sec of PAVE_SECTIONS) {
    for (const f of sec.fields) paths.push(f.key);
  }
  return paths;
}

function paveFilledCount(pave) {
  const p = sanitizePave(pave);
  let n = 0;
  for (const path of paveFieldPaths()) {
    if (String(getNested(p, path) || '').trim().length >= 8) n += 1;
  }
  // Count risk / market rows that have content
  for (const row of p.partC.risks || []) {
    if (String(row.risk || '').trim().length >= 4) n += 1;
  }
  for (const layer of ['tam', 'sam', 'som']) {
    const row = p.partC.marketSizing[layer] || {};
    if ([row.customers, row.acv, row.size].some((x) => String(x || '').trim().length >= 2)) n += 1;
  }
  return n;
}

function paveSectionProgress(pave, sectionId) {
  const p = sanitizePave(pave);
  const sec = PAVE_SECTIONS.find((s) => s.id === sectionId);
  if (!sec) return { filled: 0, total: 0, complete: false };
  let filled = 0;
  for (const f of sec.fields) {
    if (String(getNested(p, f.key) || '').trim().length >= 8) filled += 1;
  }
  let total = sec.fields.length;
  if (sectionId === 'partC') {
    total += 3 + 3; // risks + TAM/SAM/SOM
    for (const row of p.partC.risks || []) {
      if (String(row.risk || '').trim().length >= 4) filled += 1;
    }
    for (const layer of ['tam', 'sam', 'som']) {
      const row = p.partC.marketSizing[layer] || {};
      if ([row.customers, row.acv, row.size].some((x) => String(x || '').trim().length >= 2)) filled += 1;
    }
  }
  return {
    filled,
    total,
    complete: filled >= Math.max(1, Math.ceil(total * 0.6)),
    why: `${filled}/${total} fields with substance in ${sec.title}.`,
  };
}

function pavePartBIsSubstantial(pave) {
  const p = sanitizePave(pave);
  return (
    String(p.partB.targetPersona || '').trim().length >= 12
    && (
      String(p.partB.summaryOfCalls || '').trim().length >= 12
      || String(p.partB.expectedFindings || '').trim().length >= 12
      || String(p.partB.personaDecision || '').trim().length >= 12
    )
  );
}

function countDiscoveryInterviews(state) {
  const evidence = Array.isArray(state?.evidence) ? state.evidence : [];
  return evidence.filter((e) => {
    if (!e || e.revoked || e.status === 'revoked') return false;
    const type = String(e.type || e.evidenceType || '').toLowerCase();
    if (type === 'interview') return true;
    if (e.requirementKey === 'discovery_interviews') return true;
    if (Array.isArray(e.linkedRequirementKeys) && e.linkedRequirementKeys.includes('discovery_interviews')) return true;
    return false;
  }).length;
}

/**
 * Keep Part B living: sync interview count note + optional summary from evidence.
 * Does not overwrite founder narrative fields unless they are empty placeholders.
 */
function syncPartBFromDiscovery(pave, state, opts = {}) {
  const p = sanitizePave(pave);
  const count = countDiscoveryInterviews(state);
  const goal = Number(String(p.partB.interviewGoal || '10').replace(/[^\d]/g, '')) || 10;
  const autoNote = `${count} of ${goal}. Interviews are discovery calls, not CRM deals.`;
  const note = String(p.partB.interviewsCompletedNote || '');
  if (!note || /^0 of \d+/i.test(note.trim()) || /TBD|None yet|Start after/i.test(note) || opts.force) {
    p.partB.interviewsCompletedNote = autoNote;
  } else if (!/\d+\s*of\s*\d+/i.test(note)) {
    p.partB.interviewsCompletedNote = `${autoNote}\n${note}`.trim();
  }

  if (opts.refreshSummary) {
    const interviews = (state.evidence || []).filter((e) => {
      if (!e || e.revoked || e.status === 'revoked') return false;
      return String(e.type || '').toLowerCase() === 'interview';
    });
    if (interviews.length) {
      p.partB.summaryOfCalls = interviews.slice(0, 20).map((e, i) => {
        const title = e.title || `Interview ${i + 1}`;
        const notes = String(e.notes || e.description || e.summary || '').trim();
        return `${i + 1}. ${title}${notes ? ` — ${notes.slice(0, 220)}` : ''}`;
      }).join('\n');
    }
  }

  // Keep legacy alias for older UI
  if (!p.partB.customerDiscovery && p.partB.summaryOfCalls) {
    p.partB.customerDiscovery = p.partB.summaryOfCalls;
  }
  p.updatedAt = new Date().toISOString();
  return p;
}

function addPaveReview(pave, review) {
  const p = sanitizePave(pave);
  const entry = {
    id: review.id || uid('prv'),
    fieldPath: coerceString(review.fieldPath || review.path),
    kind: ['why', 'suggest', 'note'].includes(review.kind) ? review.kind : 'why',
    text: coerceString(review.text || review.body),
    authorName: coerceString(review.authorName || 'Mentor'),
    authorRole: coerceString(review.authorRole || 'mentor'),
    createdAt: review.createdAt || new Date().toISOString(),
    resolved: false,
    founderReply: '',
  };
  if (!entry.fieldPath || !entry.text) {
    const err = new Error('fieldPath and text required for PAVE review');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  p.reviews = [entry, ...(p.reviews || [])];
  p.updatedAt = new Date().toISOString();
  return { pave: p, review: entry };
}

function resolvePaveReview(pave, reviewId, founderReply) {
  const p = sanitizePave(pave);
  const r = (p.reviews || []).find((x) => x.id === reviewId);
  if (!r) {
    const err = new Error('PAVE review not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  r.resolved = true;
  if (founderReply != null) r.founderReply = coerceString(founderReply);
  p.updatedAt = new Date().toISOString();
  return p;
}

function reviewsForField(pave, fieldPath) {
  const p = sanitizePave(pave);
  return (p.reviews || []).filter((r) => r.fieldPath === fieldPath);
}

function openPaveReviews(pave) {
  return (sanitizePave(pave).reviews || []).filter((r) => !r.resolved);
}

/**
 * Sync PAVE Part B document evidence when substantial (does not auto-validate assumptions).
 */
function syncPavePartBEvidence(state, program) {
  if (!state || !program?.pave) return state;
  const pave = sanitizePave(program.pave);
  const substantial = pavePartBIsSubstantial(pave);
  state.evidence = Array.isArray(state.evidence) ? state.evidence : [];
  let ev = state.evidence.find((e) => e && e.source === 'pave_part_b' && e.programId === program.id && !e.revoked);
  const text = [
    'PAVE Part B — Customer Discovery',
    `Persona: ${pave.partB.targetPersona}`,
    `Interviews: ${pave.partB.interviewsCompletedNote}`,
    `Summary: ${pave.partB.summaryOfCalls}`,
    `Expected: ${pave.partB.expectedFindings}`,
    `Unexpected: ${pave.partB.unexpectedFindings}`,
    `Decision: ${pave.partB.personaDecision}`,
  ].join('\n');

  const req = (program.requirements || []).find((r) => r.key === 'pave_part_b');

  if (!substantial) {
    if (ev) {
      ev.revoked = true;
      ev.status = 'revoked';
      ev.revokedAt = new Date().toISOString();
      ev.revokeReason = 'PAVE Part B no longer substantial';
    }
    return state;
  }

  if (ev) {
    ev.title = 'PAVE Part B — Discovery findings';
    ev.notes = text;
    ev.description = text;
    ev.requirementKey = 'pave_part_b';
    ev.linkedRequirementIds = req ? [req.id] : (ev.linkedRequirementIds || []);
    ev.programId = program.id;
    ev.type = 'document';
    ev.updatedAt = new Date().toISOString();
  } else {
    state.evidence.unshift({
      id: uid('ev'),
      title: 'PAVE Part B — Discovery findings',
      type: 'document',
      notes: text,
      description: text,
      requirementKey: 'pave_part_b',
      linkedRequirementIds: req ? [req.id] : [],
      programId: program.id,
      source: 'pave_part_b',
      createdAt: new Date().toISOString(),
      status: 'active',
      revoked: false,
    });
  }
  return state;
}

function ensureProgramPave(program, opts = {}) {
  const p = program && typeof program === 'object' ? program : {};
  p.pave = sanitizePave(p.pave || emptyPave());
  if (opts.businessName && !p.pave.snapshot.company) p.pave.snapshot.company = opts.businessName;
  if (opts.founderName && !p.pave.snapshot.founders) p.pave.snapshot.founders = opts.founderName;
  if (opts.cohort && !p.pave.snapshot.cohort) p.pave.snapshot.cohort = opts.cohort;
  if (opts.advisor && !p.pave.snapshot.i2eAdvisor) p.pave.snapshot.i2eAdvisor = opts.advisor;
  return p;
}

module.exports = {
  uid,
  emptyPave,
  emptyRiskRow,
  emptyMarketRow,
  emptySalesCycleDiagram,
  denizenSalesCycleDiagram,
  sanitizeSalesCycleDiagram,
  SALES_CYCLE_ROLES,
  SALES_CYCLE_STEPS,
  PAVE_SECTIONS,
  sanitizePave,
  mergePavePatch,
  denizenPaveDraft,
  paveFieldPaths,
  paveFilledCount,
  paveSectionProgress,
  pavePartBIsSubstantial,
  countDiscoveryInterviews,
  syncPartBFromDiscovery,
  addPaveReview,
  resolvePaveReview,
  reviewsForField,
  openPaveReviews,
  syncPavePartBEvidence,
  ensureProgramPave,
  getNested,
  setNested,
  applyPaveFields,
};
