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

  it('detects teaming agreement proactive signal', () => {
    const model = businessContext.loadBusinessModel();
    const signals = businessContext.detectProactiveSignals(model, '');
    assert.ok(signals.length >= 1);
    const top = signals[0];
    assert.equal(top.priority, 'high');
    assert.match(top.message, /teaming agreement/i);
    assert.match(top.message, /OMES/i);
    assert.equal(top.owner_npc, 'Marcus');
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

  it('buildThinkNudge targets Marcus for OMES blocker', () => {
    const model = businessContext.loadBusinessModel();
    const snapshot = {
      proactive_signals: businessContext.detectProactiveSignals(model, ''),
    };
    const nudge = businessContext.buildThinkNudge(snapshot, 'Marcus');
    assert.match(nudge, /PROACTIVE/i);
    assert.match(nudge, /teaming/i);
  });

  it('shouldInjectForNpc includes Marcus', () => {
    assert.equal(businessContext.shouldInjectForNpc('Marcus'), true);
    assert.equal(businessContext.shouldInjectForNpc('Molly'), false);
  });

  it('isBusinessRelatedMessage matches pipeline and OMES', () => {
    assert.equal(businessContext.isBusinessRelatedMessage('How is the OMES pipeline?'), true);
    assert.equal(businessContext.isBusinessRelatedMessage('hello'), false);
  });
});
