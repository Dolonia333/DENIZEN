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
    title: 'DENIZEN sales cycle · E3 Workshop A',
    subtitle: 'Buying center around the product. One paying persona: Dana.',
    productTitle: 'DENIZEN',
    productSubtitle: 'visual AI office',
    roles: [
      { id: 'uses', label: 'USES', tone: 'sage', text: 'Dana + one operator\nlives in Cursor / Grok\nworks in the office daily' },
      { id: 'recommends', label: 'RECOMMENDS', tone: 'blue', text: 'Shawnaya (co-founder)\nor a peer founder\nwho already uses agents' },
      { id: 'influences', label: 'INFLUENCES', tone: 'tan', text: '1921 / Angela — only if the\nseat is bought through 1921\nRM Cyber — if joint ops' },
      { id: 'decides', label: 'DECIDES & PAYS', tone: 'teal', text: 'Dana on a card\n$49 / team or $199 / lab\nnot E3, not a federal vehicle' },
      { id: 'saboteur', label: 'SABOTEUR', tone: 'red', text: "IT / security:\n'agents cannot send mail'\nor 'we already have ChatGPT'" },
    ],
    cycle: SALES_CYCLE_STEPS.map((s) => ({ id: s.id, label: s.label })),
    cycleNote: 'HOW A DEAL MOVES (honest cycle — no invented close dates)',
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

function coerceString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x?.name || x?.title || x || ''))).filter(Boolean).join('\n');
  if (typeof v === 'object') return String(v.text || v.label || '');
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

function denizenPaveDraft() {
  return sanitizePave({
    snapshot: {
      company: 'Dolonia (product: DENIZEN)',
      founders: 'Zion Van Zandt and Shawnaya Williams',
      i2eAdvisor: 'Final PAVE advisor TBD. E3 mentor: Srijita Ghosh (Mentor Call A: Mon Aug 31, 1:00–1:45 PM CDT).',
      cohort: 'i2E E3 Cohort 63. Workshop A completed Thu Aug 27, 2026. Feedback session Fri Aug 28. Mentor Call A Mon Aug 31.',
      productDescription:
        'DENIZEN is a visual AI operating environment: a persistent pixel-art office where named agents keep memory, use real tools (CRM, mail drafts, GitHub/Cursor, MCP), and leave receipts when work finishes. It is built so a small team can see whether agents did real work — not just chat.',
    },
    partA: {
      customer:
        'Dana — founder-operator of a 3–8 person technical shop (Oklahoma / similar) who already pays for ChatGPT, Claude, or Cursor. Title: founder / head of ops. B2B. Dana writes the card; Dana is not a school district and not i2E.',
      problem:
        'Every AI session dies. Work lives in chat tabs. There is no shared memory, no audit of what an agent actually did, and no working set of real accounts — so the team cannot tell chatbots from operators.',
      currentAlternative:
        'Stacked chat tabs + a CRM nobody trusts + Slack/Notion notes + hoping a VA or intern follows up. Status quo is ChatGPT/Claude/Cursor with no office, no outcomes ledger, and no durable agent when the window closes.',
      solution:
        'Putting persistent agents in one office Dana can watch. Agents keep memory, run allowed tools, park junk off the sales board, and write outcomes. Faster than hiring a coordinator; clearer than another chatbot; cheaper than a full ops hire. Mail stays gated until Dana says send.',
      valueProposition:
        'With DENIZEN, Dana can: (1) See which agent is on and what it last finished. (2) Keep a sales board that only shows live humans and next verbs. (3) Leave an agent on overnight without this chat staying open. (4) Draft follow-ups without auto-sending mail. (5) Hand a coding fix to Cursor and get a closed ticket. (6) Prove to a partner or mentor what ran, with receipts — not vibes.',
      salesCycle:
        'Text map until we draw it. DENIZEN in the center. USER: Dana plus one technical operator in Cursor or Grok. RECOMMENDS: co-founder Shawnaya or a peer founder who already uses agents. INFLUENCES: 1921 / Angela only if the seat is bought through the holding company; RM Cyber if the story is joint ops. DECIDES AND PAYS: Dana on a card ($49/team or $199/lab). SABOTEUR: IT or security (agents cannot send mail) or “we already have ChatGPT.” CYCLE TODAY: demo office → one real account → weekly receipt → paid seat.',
      salesCycleDiagram: denizenSalesCycleDiagram(),
    },
    partB: {
      targetPersona:
        'Same as Part A: Dana, founder-operator of a 3–8 person technical shop. Do not mix CareerTech, OMES, and E3 into this list.',
      interviewGoal: '10+',
      interviewsCompletedNote: '0 of 10. Start after Mentor Call A. Interviews are discovery calls, not CRM deals.',
      summaryOfCalls: 'None yet. Workshop A only.',
      expectedFindings: 'TBD after first interviews.',
      unexpectedFindings: 'TBD after first interviews.',
      personaDecision:
        'Hold Dana as the paying persona until 5 interviews say otherwise. 1921 / OMES / RM Cyber is a separate capture motion under the parent company — not this E3 customer.',
    },
    partC: {
      directCompetitors: 'ChatGPT / Claude Teams / Cursor background agents. (Workshop C — refine.)',
      indirectCompetitors: 'Notion AI, HubSpot + a VA, Slack bots, n8n dashboards with no office.',
      potentialCompetitors: 'Any lab that wraps MCP + a game skin. Open-source agent dashboards.',
      statusQuo: 'A pile of chat tabs and a CRM they ignore.',
      competitiveMatrix: 'Paste your competitive matrix here.',
      shortTermAdvantages:
        'Working office + durable NPC + outcomes ledger + mail default-deny + a CRM that parks scrape junk. We use the product to run the company.',
      longTermAdvantages:
        'Persistent identity + tool policy + visual audit trail on a stack we operate. First-mover is not the moat.',
      competitorAdvantages: 'Model quality, distribution, and brand of OpenAI / Anthropic / Cursor.',
      competitiveResponse:
        'They ship “agents” inside the chat product. We stay the visible office + policy + receipts layer, not another model.',
      distributionAccess:
        'Not yet. Channel today is founder-led demo. 1921 gov channel is a different product motion — do not mix into E3 distribution.',
      risks: [
        { risk: 'Wrong buyer (district / gov vs Dana)', why: 'Burns cohort weeks on non-payers', mitigate: 'One persona at a time; park 1921 under parent' },
        { risk: 'Chatbots “good enough”', why: 'No urgency to switch', mitigate: 'Lead with receipts + overnight agent, not chat quality' },
        { risk: 'Mail / security veto', why: 'IT blocks agents', mitigate: 'Default-deny mail; human gate on send' },
      ],
      marketSizing: {
        tam: { customers: '', acv: '', size: 'TBD — Workshop C' },
        sam: { customers: '', acv: '', size: 'TBD — Workshop C' },
        som: { customers: '', acv: '', size: 'TBD — Workshop C' },
      },
      futureSegments:
        'After Dana: multi-seat shops, then 1921 capture visibility (OMES / RM Cyber) as a separate line — not Year-1 E3 TAM.',
    },
    partD: {
      foundingTeam:
        'Zion Van Zandt — founder, systems / product / infrastructure (DENIZEN, home lab, MCP).\nShawnaya Williams — co-founder, software / product.\nAngela Van Zandt — 1921 Holding Co. (parent / gov-contracting vehicle; not the E3 product owner).\nDr. Ed Van Zandt — engineering advisor in the family ecosystem.',
      teamGaps:
        'Repeatable sales motion and customer-discovery interviews (10+). Also: a durable runner that does useful work, not just presence ticks.',
      gapStrategy:
        'Lean on E3 mentor (Srijita) + do the 10 interviews ourselves this cohort. Do not hire a salesperson before Dana exists as a real buyer.',
      pitch90:
        'Founders of small technical teams already pay for chatbots that forget everything when the tab closes. DENIZEN is a visual office where named agents keep memory, use real tools, and leave receipts. Zion and Shawnaya built it on their own stack in Oklahoma City — local models, MCP, a CRM that refuses fake pipeline. We are not selling i2E a product. We are finding ten Danas.',
    },
    final: {
      discoveredRisks: '[completed in the meeting]',
      recommendedNextSteps: '[completed in the meeting]',
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
};
