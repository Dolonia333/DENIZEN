'use strict';

/**
 * Founder pack seeds an empty Business Studio.
 * A filled PAVE, Lean Canvas, moat, capital plan, or evidence locker is left as saved.
 * Seeds do not assert a buyer, a price, FERPA, cloud cost, or a margin.
 */

const e3 = require('./denizen-business-studio-e3-template');
const funding = require('./denizen-business-studio-funding');
const pave = require('./denizen-business-studio-pave');

const DOLONIA_BUSINESS = Object.freeze({
  name: 'DENIZEN / Dolonia Data Tech Solutions',
  founderName: 'Zion Alexander Van Zandt',
  cohort: 'i2E E3 Cohort 63',
  mentor: 'Srijita Ghosh, i2E E3 mentor',
});

const CAPITAL_NOTES =
  'Pre-revenue and pre-validation. No fundraising amount. Next evidence is 10 qualifying school or district buyer interviews, and contradictory evidence counts.';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function hasText(value) {
  return String(value || '').trim().length >= 8;
}

function moatHasClaim(moat) {
  if (!moat || typeof moat !== 'object') return false;
  if (hasText(moat.primaryClaim)) return true;
  const sources = moat.sources || {};
  return Object.keys(sources).some((key) => hasText(sources[key] && sources[key].claim));
}

function strategicBriefMoat() {
  const empty = funding.emptyFundingState().moat;
  return {
    ...empty,
    primaryClaim: '',
    primaryWhy: 'No defensibility claim until linked evidence supports it.',
    primaryCopyDifficulty: '',
    primaryMonthsToCopy: null,
    sources: empty.sources,
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
 * Seed an empty studio. Re-running does not replace a PAVE, moat, capital plan,
 * lean canvas, goal, experiment, or evidence item that already has text.
 * opts.force replaces the E3 program and empty-only sections still stay unless force.
 */
function applyFounderPack(state, opts = {}) {
  if (!state || typeof state !== 'object') {
    throw new Error('state required');
  }
  const force = opts.force === true;
  const fillLean = opts.fillLeanCanvas !== false && opts.fill_lean_canvas !== false;
  const fillPave = opts.fillPave !== false && opts.fill_pave !== false;
  const fillMoat = opts.fillMoat !== false && opts.fill_moat !== false;
  const fillEvidence = opts.fillEvidence !== false && opts.fill_evidence !== false;
  const existingProgram = (state.programs || []).find((p) => p.templateId === 'i2e-e3-pave') || null;
  const namedBusiness = opts.businessName || opts.business_name;
  const namedFounder = opts.founderName || opts.founder_name;
  const businessName = (!force && hasText(state.business && state.business.name))
    ? state.business.name
    : (namedBusiness || DOLONIA_BUSINESS.name);
  const founderName = (!force && hasText(state.business && state.business.founderName))
    ? state.business.founderName
    : (namedFounder || DOLONIA_BUSINESS.founderName);

  state.business = {
    id: (state.business && state.business.id) || uid('biz'),
    name: businessName,
    founderName,
    createdAt: (state.business && state.business.createdAt) || nowISO(),
    updatedAt: nowISO(),
  };

  const preserved = {
    program: false,
    pave: false,
    lean: false,
    moat: false,
    capital: false,
    evidence: false,
  };

  let program = existingProgram;
  if (!existingProgram || force) {
    const bundle = e3.applyProgramTemplate('i2e-e3-pave', { businessName, founderName });
    program = bundle.program;
    if (fillPave) {
      program = {
        ...program,
        pave: {
          ...pave.denizenPaveDraft(),
          updatedAt: nowISO(),
          reviews: (existingProgram && existingProgram.pave && existingProgram.pave.reviews) || [],
        },
      };
      program.pave.snapshot = {
        ...program.pave.snapshot,
        company: businessName,
        founders: founderName,
        i2eAdvisor: program.pave.snapshot.i2eAdvisor || DOLONIA_BUSINESS.mentor,
        cohort: program.pave.snapshot.cohort || DOLONIA_BUSINESS.cohort,
      };
    } else {
      program = pave.ensureProgramPave(program, {
        businessName,
        founderName,
        cohort: DOLONIA_BUSINESS.cohort,
        advisor: DOLONIA_BUSINESS.mentor,
      });
    }
    state.programs = (state.programs || []).filter((p) => p.templateId !== 'i2e-e3-pave');
    state.programs.push(program);
    const priorId = existingProgram && existingProgram.id;
    state.milestones = [
      ...(state.milestones || []).filter((m) => m.programId !== program.id && m.programId !== priorId),
      ...bundle.milestones,
    ];
    state.tasks = [
      ...(state.tasks || []).filter((t) => t.programId !== program.id && t.programId !== priorId),
      ...bundle.tasks,
    ];
    state.assumptions = [
      ...(state.assumptions || []).filter((a) => a.programId !== program.id && a.programId !== priorId),
      ...bundle.assumptions,
    ];
    state.experiments = [
      ...(state.experiments || []).filter((e) => e.programId !== program.id && e.programId !== priorId),
      ...bundle.experiments,
    ];
    state.goals = [
      ...(state.goals || []).filter((g) => g.programId !== program.id && g.programId !== priorId),
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
  } else {
    preserved.program = true;
    if (fillPave && pave.paveFilledCount(program.pave) === 0) {
      program.pave = {
        ...pave.denizenPaveDraft(),
        updatedAt: nowISO(),
        reviews: (program.pave && program.pave.reviews) || [],
      };
      program.pave.snapshot = {
        ...program.pave.snapshot,
        company: businessName,
        founders: founderName,
      };
    } else {
      preserved.pave = true;
    }
  }

  state.funding = state.funding || funding.emptyFundingState();
  const canvasCount = funding.leanCanvasFilledCount(state.funding.leanCanvas);
  if (fillLean && (force || canvasCount === 0)) {
    state.funding.leanCanvas = {
      ...funding.denizenLeanCanvasDraft(),
      updatedAt: nowISO(),
    };
  } else if (canvasCount > 0) {
    preserved.lean = true;
  }
  if (fillMoat && (force || !moatHasClaim(state.funding.moat))) {
    state.funding.moat = {
      ...funding.emptyFundingState().moat,
      ...strategicBriefMoat(),
    };
  } else if (moatHasClaim(state.funding.moat)) {
    preserved.moat = true;
  }
  const capitalNotes = state.funding.capitalPlan && state.funding.capitalPlan.notes;
  if (fillMoat && (force || !hasText(capitalNotes))) {
    state.funding.capitalPlan = {
      ...(state.funding.capitalPlan || funding.emptyFundingState().capitalPlan),
      stage: (state.funding.capitalPlan && state.funding.capitalPlan.stage) || 'pre_revenue',
      pathwayStep: (state.funding.capitalPlan && state.funding.capitalPlan.pathwayStep) || 'readiness',
      notes: CAPITAL_NOTES,
    };
  } else if (hasText(capitalNotes)) {
    preserved.capital = true;
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
    const hasEvidence = state.evidence.some((e) => e && !e.revoked);
    if (hasEvidence && !force) {
      preserved.evidence = true;
    } else {
      const docs = [
        documentEvidence(
          'Education Strategic Brief — on file',
          'The education strategic brief is a source document. Compliance, margins, cloud cost, and infrastructure savings are not established.',
        ),
      ];
      for (const doc of docs) {
        const idx = state.evidence.findIndex((e) => e.title === doc.title && !e.revoked);
        if (idx >= 0 && !force) continue;
        if (idx >= 0) state.evidence[idx] = { ...state.evidence[idx], ...doc, id: state.evidence[idx].id };
        else state.evidence.unshift(doc);
      }
    }
  }

  state.activity = Array.isArray(state.activity) ? state.activity : [];
  state.activity.unshift({
    id: uid('act'),
    at: nowISO(),
    text: preserved.pave || preserved.moat || preserved.capital
      ? 'Founder pack kept saved PAVE, moat, and capital text'
      : 'Seeded empty Business Studio sections without a buyer, price, or margin claim',
  });

  return {
    state,
    programId: program.id,
    business: state.business,
    leanFilled: funding.leanCanvasFilledCount(state.funding.leanCanvas),
    paveFilled: pave.paveFilledCount(program.pave),
    preserved,
  };
}

module.exports = {
  DOLONIA_BUSINESS,
  strategicBriefMoat,
  applyFounderPack,
};
