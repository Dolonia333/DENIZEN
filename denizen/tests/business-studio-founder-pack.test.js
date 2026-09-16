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
    assert.equal(result.business.name, 'Dolonia (product: DENIZEN)');
    assert.match(result.business.founderName, /Shawnaya/);
    assert.equal(result.leanFilled, 9);
    assert.ok(result.paveFilled > 20);
    assert.match(state.funding.leanCanvas.problem, /API Cost Trap/);
    assert.match(state.funding.moat.primaryClaim, /Hardware sovereignty|mesh/i);
    const prog = state.programs.find((p) => p.templateId === 'i2e-e3-pave');
    assert.ok(prog);
    assert.match(prog.pave.partA.customer, /Dana/);
    assert.match(prog.pave.snapshot.founders, /Zion/);
    assert.ok(state.advisors.some((a) => /Srijita/i.test(a.name)));
    assert.ok(state.evidence.some((e) => /Strategic Brief/i.test(e.title)));
  });

  it('keeps lean canvas (education) separate from PAVE Dana persona', () => {
    const state = store.emptyState();
    founderPack.applyFounderPack(state);
    assert.match(state.funding.leanCanvas.customerSegments, /CTE Directors/);
    const prog = state.programs[0];
    assert.match(prog.pave.partA.customer, /Dana/);
    assert.doesNotMatch(prog.pave.partA.customer, /CTE Director/);
  });

  it('MCP tool is registered and skill is advertised', () => {
    assert.ok(tools.isBusinessStudioTool('business_studio_apply_founder_pack'));
    assert.ok(mcpActions.assertSkillAllowed('jenny', 'business-studio-apply-founder-pack').ok);
  });

  it('draft helpers still match uploaded materials', () => {
    const canvas = funding.denizenLeanCanvasDraft();
    assert.ok(funding.leanCanvasIsSubstantial(canvas));
    assert.match(canvas.unfairAdvantage, /80%\+/);
    const draft = pave.denizenPaveDraft();
    assert.match(draft.partD.pitch90, /ten Danas/);
  });
});
