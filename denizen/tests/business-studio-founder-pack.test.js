'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/denizen-business-studio-store');
const founderPack = require('../src/denizen-business-studio-founder-pack');
const funding = require('../src/denizen-business-studio-funding');
const pave = require('../src/denizen-business-studio-pave');
const tools = require('../src/denizen-mcp-business-studio-tools');
const mcpActions = require('../src/denizen-mcp-actions');

describe('Dolonia founder pack', () => {
  it('fills business, lean canvas, PAVE, moat, and mentor', () => {
    const state = store.emptyState();
    const result = founderPack.applyFounderPack(state);
    assert.equal(result.business.name, 'DENIZEN / Dolonia Data Tech Solutions');
    assert.equal(result.business.founderName, 'Zion Alexander Van Zandt');
    assert.equal(result.leanFilled, 9);
    assert.ok(result.paveFilled > 20);
    assert.match(state.funding.leanCanvas.customerSegments, /school and district/i);
    assert.doesNotMatch(state.funding.leanCanvas.unfairAdvantage, /80%\+|zero marginal/i);
    assert.equal(state.funding.moat.primaryClaim, '');
    assert.doesNotMatch(state.funding.moat.primaryWhy, /FERPA|80%\+/i);
    assert.doesNotMatch(state.funding.capitalPlan.notes, /ten Danas|\$49|\$199/i);
    const prog = state.programs.find((p) => p.templateId === 'i2e-e3-pave');
    assert.ok(prog);
    assert.match(prog.pave.partA.customer, /school and district/i);
    assert.doesNotMatch(prog.pave.partA.customer, /Dana/);
    assert.match(prog.pave.snapshot.founders, /Zion Alexander Van Zandt/);
    assert.ok(state.advisors.some((a) => /Srijita/i.test(a.name)));
    assert.ok(state.evidence.some((e) => /Strategic Brief/i.test(e.title)));
  });

  it('does not restore template text over a saved PAVE, moat, or capital plan', () => {
    const state = store.emptyState();
    founderPack.applyFounderPack(state);
    const prog = state.programs[0];
    prog.pave.partA.customer = 'KEEP THIS BUYER TEXT PLEASE';
    state.funding.moat.primaryClaim = 'KEEP THIS MOAT CLAIM PLEASE';
    state.funding.capitalPlan.notes = 'KEEP THESE CAPITAL NOTES PLEASE';
    state.funding.leanCanvas.problem = 'KEEP THIS LEAN PROBLEM PLEASE';
    state.business.name = 'DENIZEN / Dolonia Data Tech Solutions';
    state.business.founderName = 'Zion Alexander Van Zandt';
    const goalCount = state.goals.length;
    founderPack.applyFounderPack(state, {
      businessName: 'Dolonia (product: DENIZEN)',
      founderName: 'Dolonia',
    });
    assert.equal(prog.pave.partA.customer, 'KEEP THIS BUYER TEXT PLEASE');
    assert.equal(state.funding.moat.primaryClaim, 'KEEP THIS MOAT CLAIM PLEASE');
    assert.equal(state.funding.capitalPlan.notes, 'KEEP THESE CAPITAL NOTES PLEASE');
    assert.equal(state.funding.leanCanvas.problem, 'KEEP THIS LEAN PROBLEM PLEASE');
    assert.equal(state.business.founderName, 'Zion Alexander Van Zandt');
    assert.equal(state.business.name, 'DENIZEN / Dolonia Data Tech Solutions');
    assert.equal(state.goals.length, goalCount);
    assert.equal(state.programs.length, 1);
  });

  it('MCP tool is registered and skill is advertised', () => {
    assert.ok(tools.isBusinessStudioTool('business_studio_apply_founder_pack'));
    assert.ok(mcpActions.assertSkillAllowed('jenny', 'business-studio-apply-founder-pack').ok);
  });

  it('draft helpers still match uploaded materials', () => {
    const canvas = funding.denizenLeanCanvasDraft();
    assert.ok(funding.leanCanvasIsSubstantial(canvas));
    assert.doesNotMatch(canvas.unfairAdvantage, /80%\+/);
    assert.doesNotMatch(canvas.uniqueValueProposition, /guaranteeing/i);
    const draft = pave.denizenPaveDraft();
    assert.doesNotMatch(draft.partD.pitch90, /ten Danas/i);
    assert.doesNotMatch(JSON.stringify(draft), /\$49|\$199/);
  });
});
