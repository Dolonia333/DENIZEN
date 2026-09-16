'use strict';

/**
 * Dolonia / DENIZEN founder pack — fills Business Studio from the living E3 materials:
 * - Lean Canvas + Strategic Brief (education mesh / edge inference pitch)
 * - PAVE workbook (Dana founder-operator customer for DENIZEN product)
 * - Advisors, moat claims, document evidence pointers
 *
 * Narratives stay separate on purpose: Lean Canvas = campus mesh; PAVE = Dana + DENIZEN office.
 */

const e3 = require('./denizen-business-studio-e3-template');
const funding = require('./denizen-business-studio-funding');
const pave = require('./denizen-business-studio-pave');

const DOLONIA_BUSINESS = Object.freeze({
  name: 'Dolonia (product: DENIZEN)',
  founderName: 'Zion Van Zandt and Shawnaya Williams',
  cohort: 'i2E E3 Cohort 63',
  mentor: 'Srijita Ghosh (i2E) — Mentor Call A: Mon Aug 31, 1:00–1:45 PM CDT',
});

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function strategicBriefMoat() {
  return {
    primaryClaim:
      'Hardware sovereignty + opt-in campus mesh: local inference on idle lab hardware removes recurring cloud API cost and keeps student prompts on-campus (FERPA).',
    primaryWhy:
      'Public districts cannot sustain OpenAI/AWS token bills across hundreds of lab students; FERPA blocks unvetted prompts to public AI; esports/CAD labs sit idle 16+ hours/day.',
    primaryCopyDifficulty: 'hard',
    primaryMonthsToCopy: 18,
    sources: {
      hardware_sovereignty: {
        status: 'claimed',
        claim: 'Localized mesh clustering runs inference on customer-owned edge hardware with containerized nodes + mTLS (zero lateral traversal).',
        why: 'Removes external API fees while enforcing local compliance out of the box.',
        copyDifficulty: 'hard',
        monthsToCopy: 18,
      },
      saas_orchestration: {
        status: 'claimed',
        claim: 'Monetize annual per-seat / per-campus SaaS for orchestration + gamified learning — not compute time.',
        why: 'High gross margins (80%+) because infrastructure runs on customer hardware.',
        copyDifficulty: 'medium',
        monthsToCopy: 12,
      },
      grant_channel: {
        status: 'claimed',
        claim: 'Procurement via Perkins V (CTE) and federal STEM grant allocations.',
        why: 'Matches how districts already buy curriculum software.',
        copyDifficulty: 'medium',
        monthsToCopy: 9,
      },
    },
  };
}

function documentEvidence(title, notes, extra = {}) {
  return {
    id: uid('ev'),
    title,
    type: 'document',
    notes,
    description: notes,
    source: 'founder_pack',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: 'active',
    revoked: false,
    ...extra,
  };
}

/**
 * Mutate an in-memory Business Studio state with the full Dolonia founder pack.
 * Safe to re-run: replaces E3 program + lean canvas + moat; merges advisors/docs by title.
 */
function applyFounderPack(state, opts = {}) {
  if (!state || typeof state !== 'object') {
    throw new Error('state required');
  }
  const businessName = opts.businessName || DOLONIA_BUSINESS.name;
  const founderName = opts.founderName || DOLONIA_BUSINESS.founderName;
  const fillLean = opts.fillLeanCanvas !== false;
  const fillPave = opts.fillPave !== false;
  const fillMoat = opts.fillMoat !== false;
  const fillEvidence = opts.fillEvidence !== false;

  state.business = {
    id: (state.business && state.business.id) || uid('biz'),
    name: businessName,
    founderName,
    createdAt: (state.business && state.business.createdAt) || nowISO(),
    updatedAt: nowISO(),
  };

  const bundle = e3.applyProgramTemplate('i2e-e3-pave', {
    businessName,
    founderName,
  });

  // Drop prior E3 template program + re-attach filled PAVE
  state.programs = (state.programs || []).filter((p) => p.templateId !== 'i2e-e3-pave');
  let program = bundle.program;
  if (fillPave) {
    program = {
      ...program,
      pave: {
        ...pave.denizenPaveDraft(),
        updatedAt: nowISO(),
        reviews: (program.pave && program.pave.reviews) || [],
      },
    };
    program.pave.snapshot = {
      ...program.pave.snapshot,
      company: businessName,
      founders: founderName,
      i2eAdvisor: DOLONIA_BUSINESS.mentor,
      cohort: DOLONIA_BUSINESS.cohort,
    };
  } else {
    program = pave.ensureProgramPave(program, {
      businessName,
      founderName,
      cohort: DOLONIA_BUSINESS.cohort,
      advisor: DOLONIA_BUSINESS.mentor,
    });
  }
  state.programs.push(program);

  // Replace template-sourced rows for this program only
  state.milestones = [
    ...(state.milestones || []).filter((m) => m.programId !== program.id),
    ...bundle.milestones,
  ];
  state.tasks = [
    ...(state.tasks || []).filter((t) => t.programId !== program.id),
    ...bundle.tasks,
  ];
  state.assumptions = [
    ...(state.assumptions || []).filter((a) => a.programId !== program.id),
    ...bundle.assumptions,
  ];
  state.experiments = [
    ...(state.experiments || []).filter((e) => e.programId !== program.id),
    ...bundle.experiments,
  ];
  state.goals = [
    ...(state.goals || []).filter((g) => g.programId !== program.id),
    ...bundle.goals,
  ];
  (bundle.metrics || []).forEach((m) => {
    const existing = (state.metrics || []).find((x) => x.key === m.key);
    if (!existing) {
      state.metrics = state.metrics || [];
      state.metrics.push(m);
    }
  });
  if (!(state.strategyNodes || []).length) {
    state.strategyNodes = bundle.strategyNodes;
    state.strategyEdges = bundle.strategyEdges;
  }

  state.funding = state.funding || funding.emptyFundingState();
  if (fillLean) {
    state.funding.leanCanvas = {
      ...funding.denizenLeanCanvasDraft(),
      updatedAt: nowISO(),
    };
  }
  if (fillMoat) {
    state.funding.moat = {
      ...funding.emptyFundingState().moat,
      ...strategicBriefMoat(),
    };
    state.funding.capitalPlan = {
      ...state.funding.capitalPlan,
      stage: 'pre_revenue',
      pathwayStep: 'readiness',
      notes:
        'Education mesh: annual B2B SaaS (per-campus / per-seat) + Perkins V / STEM grants. '
        + 'DENIZEN E3 path: find ten Danas — $49/team or $199/lab card seats before contracts.',
    };
    state.funding.marketSizing = {
      ...state.funding.marketSizing,
      geography: 'Oklahoma / regional CareerTech + early CTE labs with GPU/esports hardware',
      buyerWho: 'Lean Canvas: CTE/IT directors. PAVE (E3): Dana founder-operator (do not mix).',
      sources: {
        tam: 'Strategic brief — decentralized edge orchestration for education',
        sam: 'State CareerTech & STEM consortiums + i2E/OCN introductions',
        som: 'Discovery pilots → multi-year SaaS conversion',
      },
    };
  }

  state.advisors = Array.isArray(state.advisors) ? state.advisors : [];
  if (!state.advisors.some((a) => /Srijita/i.test(a.name || ''))) {
    state.advisors.push({
      id: uid('adv'),
      name: 'Srijita Ghosh',
      role: 'i2E E3 Mentor',
      org: 'i2E',
      notes: 'Mentor Call A: Mon Aug 31, 1:00–1:45 PM CDT. Final PAVE advisor TBD.',
      createdAt: nowISO(),
    });
  }

  if (fillEvidence) {
    state.evidence = Array.isArray(state.evidence) ? state.evidence : [];
    const docs = [
      documentEvidence(
        'Dolonia E3 Strategic Brief — Edge orchestration for education',
        'Decentralized edge orchestration pitch: cost trap, FERPA, idle lab hardware → opt-in mesh, sandbox client, gamified learning hub. Moat: hardware sovereignty, 80%+ gross margins, Perkins V channel.',
        { fundingKeys: ['moat', 'lean_canvas'], linkedFundingKeys: ['moat', 'lean_canvas'] },
      ),
      documentEvidence(
        'Lean Canvas — campus mesh / CTE labs',
        funding.leanCanvasPlainText(funding.denizenLeanCanvasDraft()),
        { fundingKeys: ['lean_canvas'], linkedFundingKeys: ['lean_canvas'], requirementKey: 'lean_canvas' },
      ),
      documentEvidence(
        'PAVE E3 Working Document — Dolonia / DENIZEN (Dana)',
        'Living PAVE: company Dolonia (DENIZEN); founders Zion Van Zandt + Shawnaya Williams; customer Dana founder-operator; Workshop A complete; 0/10 discovery interviews. Do not mix CareerTech into E3 persona.',
        {
          programId: program.id,
          requirementKey: 'pave_part_b',
          linkedRequirementIds: (program.requirements || [])
            .filter((r) => r.key === 'pave_part_b')
            .map((r) => r.id),
        },
      ),
    ];
    for (const doc of docs) {
      const idx = state.evidence.findIndex((e) => e.title === doc.title && !e.revoked);
      if (idx >= 0) state.evidence[idx] = { ...state.evidence[idx], ...doc, id: state.evidence[idx].id };
      else state.evidence.unshift(doc);
    }

    // Sync PAVE Part B document evidence when substantial
    try {
      pave.syncPavePartBEvidence(state, program);
    } catch (_) { /* non-fatal */ }
  }

  state.activity = Array.isArray(state.activity) ? state.activity : [];
  state.activity.unshift({
    id: uid('act'),
    at: nowISO(),
    text: 'Applied Dolonia founder pack (Lean Canvas + PAVE + strategic moat)',
  });

  return {
    state,
    programId: program.id,
    business: state.business,
    leanFilled: fillLean ? funding.leanCanvasFilledCount(state.funding.leanCanvas) : 0,
    paveFilled: fillPave ? pave.paveFilledCount(program.pave) : 0,
  };
}

module.exports = {
  DOLONIA_BUSINESS,
  strategicBriefMoat,
  applyFounderPack,
};
