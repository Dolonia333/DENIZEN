'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const businessContext = require('../src/denizen-business-context');

describe('denizen-business-context', () => {
  before(() => {
    businessContext.loadCompanyBrief();
    businessContext.loadBusinessModel();
  });

  it('loads business model with OMES opportunity', () => {
    const model = businessContext.loadBusinessModel();
    assert.ok(model);
    assert.equal(model.entity?.cage_code, '9T6Y5');
    assert.equal(model.entity?.uei, 'YMP7Z9T1WVX5');
    assert.match(model.entity?.legal_name || '', /1921 Holding/i);
    const omes = (model.active_opportunities || []).find((o) => o.id === 'omes-ev00000919');
    assert.ok(omes);
    assert.match(omes.name, /OMES/i);
  });

  it('does not treat a past-due opportunity as the current priority', () => {
    const model = businessContext.loadBusinessModel();
    const signals = businessContext.detectProactiveSignals(model, '');
    assert.equal(signals.some((s) => /teaming agreement/i.test(s.message)), false);
    const live = businessContext.applyLivePriorities(model, {
      deals: [
        { id: 1, title: 'FAA NEST', stage: 'Qualified', status: 'active', value: 0 },
        { id: 2, title: 'OMES EV00000919', stage: 'Closed Lost', status: 'historical', deadline: '2026-10-01' },
      ],
      goals: [{ title: '10 qualifying school/government discovery interviews' }],
    });
    assert.equal(live.active_opportunities[0].name, 'FAA NEST');
    assert.ok(live.historical_opportunities.some((opp) => /OMES/i.test(opp.name)));
    assert.match(live.strategic_goals[0], /qualifying/i);
  });

  it('does not resurrect legacy DENIZEN template goals', () => {
    const live = businessContext.applyLivePriorities({
      strategic_goals: [
        '30-Day Revenue Conversion Sprint',
        'Validate DENIZEN problem-solution fit for Dana buyers',
      ],
    }, {
      goals: [
        { title: 'Build 1921 revenue operating system' },
        { title: 'Validate DENIZEN problem-solution fit for Dana buyers' },
        { title: 'Validate DENIZEN problem-solution fit for Dana (founder-operator) buyers' },
      ],
    });
    assert.deepEqual(live.strategic_goals, ['Build 1921 revenue operating system']);
    const storedOnly = businessContext.applyLivePriorities({
      strategic_goals: ['Validate DENIZEN problem-solution fit for Dana buyers'],
    }, { goals: [] });
    assert.deepEqual(storedOnly.strategic_goals, []);
    const brief = businessContext.scrubStaleNarrative({
      current_focus: [
        'NISC Enterprise Support Tasking (NEST) (RFP Released)',
        'Validate DENIZEN problem-solution fit for Dana buyers',
      ],
    }, live);
    assert.deepEqual(brief.current_focus, ['NISC Enterprise Support Tasking (NEST) (RFP Released)']);
  });

  it('removes an expired opportunity from the narrative agents see', () => {
    const model = businessContext.applyLivePriorities(businessContext.loadBusinessModel(), {});
    const brief = businessContext.scrubStaleNarrative(businessContext.loadCompanyBrief(), model);
    const block = businessContext.buildPromptBlock({
      company: '1921',
      current_focus: brief.current_focus,
      pain_points: brief.pain_points,
      opportunities: (model.active_opportunities || []).map(businessContext.formatOpportunity),
      proactive_signals: [],
    });
    assert.equal(/OMES EV00000919/.test(block), false);
    assert.equal(/before October 2026/.test(block), false);
  });

  it('still flags a future critical blocker', () => {
    const signals = businessContext.detectProactiveSignals({
      active_opportunities: [{
        id: 'future',
        name: 'Future bid',
        deadline: '2027-04-01',
        status: 'pursuing',
        blockers: [{ label: 'Execute teaming agreement', severity: 'critical', owner_npc: 'Marcus', due: '2027-04-01' }],
      }],
    }, '');
    assert.equal(signals[0].priority, 'high');
    assert.match(signals[0].message, /teaming agreement/i);
  });

  it('builds prompt block with opportunities and flags', () => {
    const model = businessContext.loadBusinessModel();
    const brief = businessContext.loadCompanyBrief();
    const snapshot = {
      company: 'DDT',
      product: 'Denizen',
      goals: model.strategic_goals,
      current_focus: brief.current_focus,
      pain_points: brief.pain_points,
      opportunities: (model.active_opportunities || []).map(businessContext.formatOpportunity),
      relationships: [],
      crm_summary: '',
      proactive_signals: businessContext.detectProactiveSignals(model, ''),
    };
    const block = businessContext.buildPromptBlock(snapshot);
    assert.match(block, /Business context/i);
    assert.match(block, /OMES/i);
    assert.match(block, /teaming agreement/i);
    assert.match(block, /Pain points/i);
    assert.match(block, /Current focus/i);
  });

  it('buildThinkNudge targets Marcus for a current blocker', () => {
    const snapshot = {
      proactive_signals: businessContext.detectProactiveSignals({
        active_opportunities: [{
          id: 'future',
          name: 'Future bid',
          deadline: '2027-04-01',
          status: 'pursuing',
          blockers: [{ label: 'Execute teaming agreement', severity: 'critical', owner_npc: 'Marcus', due: '2027-04-01' }],
        }],
      }, ''),
    };
    const nudge = businessContext.buildThinkNudge(snapshot, 'Marcus');
    assert.match(nudge, /PROACTIVE/i);
    assert.match(nudge, /teaming/i);
  });

  it('shouldInjectForNpc includes Marcus', () => {
    assert.equal(businessContext.shouldInjectForNpc('Marcus'), true);
    assert.equal(businessContext.shouldInjectForNpc('Molly'), true);
  });

  it('isBusinessRelatedMessage matches pipeline and OMES', () => {
    assert.equal(businessContext.isBusinessRelatedMessage('How is the OMES pipeline?'), true);
    assert.equal(businessContext.isBusinessRelatedMessage('hello'), false);
  });
});
