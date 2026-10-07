'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const sections = require('../src/denizen-business-studio-sections');
const tools = require('../src/denizen-mcp-business-studio-tools');
const scopes = require('../src/denizen-mcp-scopes');
const studioSkills = require('../src/denizen-studio-skills');
const map = require('../src/denizen-mcp-product-map');
const funding = require('../src/denizen-business-studio-funding');
const studioStore = require('../src/denizen-business-studio-store');

const SCOPE = {
  npc_key: 'jenny',
  org_id: '11111111-1111-1111-1111-111111111111',
  scopes: ['read', 'skills', 'crm_write'],
};

describe('Business Studio section catalog for MCP/ChatGPT', () => {
  it('mirrors UI NAV apps including Phase 2 stubs', () => {
    const cat = sections.catalogForAgent();
    assert.equal(cat.ok, true);
    const ids = cat.sections.map((s) => s.id);
    for (const id of [
      'funding', 'leancanvas', 'pave', 'strategy', 'roadmap', 'goals', 'tasks',
      'evidence', 'experiments', 'discovery', 'market', 'moat', 'capital',
      'dataroom', 'investorsim', 'mentors', 'crm', 'calendar', 'templates',
      'financials', 'diagrams', 'documents', 'reports', 'settings',
    ]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    const phase2 = cat.sections.filter((s) => s.phase2);
    assert.ok(phase2.length >= 5);
    assert.ok(phase2.every((s) => s.write_tools.includes('business_studio_upsert_section')));
  });

  it('resolves menu labels and aliases', () => {
    assert.equal(sections.normalizeSectionId('Lean Canvas'), 'leancanvas');
    assert.equal(sections.normalizeSectionId('Capital Pathway'), 'capital');
    assert.equal(sections.normalizeSectionId('Investor Stress-Test'), 'investorsim');
    assert.equal(sections.getSectionMeta('Moat Builder').id, 'moat');
  });

  it('exposes catalog + section tools with scopes and kebab skills', () => {
    assert.ok(tools.isBusinessStudioTool('business_studio_catalog'));
    assert.ok(tools.isBusinessStudioTool('business_studio_section'));
    assert.ok(tools.isBusinessStudioTool('business_studio_get_lean_canvas'));
    assert.ok(tools.isBusinessStudioTool('business_studio_upsert_lean_canvas'));
    assert.ok(tools.isBusinessStudioTool('business_studio_capital_pathway'));
    assert.ok(tools.isBusinessStudioTool('business_studio_data_room'));
    assert.equal(scopes.requiredScope('business_studio_catalog'), 'read');
    assert.equal(scopes.requiredScope('business_studio_section'), 'read');
    assert.equal(scopes.requiredScope('business_studio_upsert_lean_canvas'), 'crm_write');
    assert.equal(scopes.requiredScope('business_studio_answer_investor_question'), 'crm_write');
    assert.ok(studioSkills.isStudioSkill('business-studio-catalog'));
    assert.ok(studioSkills.isStudioSkill('business-studio-section'));
    assert.ok(studioSkills.isStudioSkill('business-studio-get-pave'));
    assert.ok(studioSkills.isWriteStudioSkill('business-studio-upsert-pave'));
    assert.equal(
      studioSkills.toolNameForSkill('business-studio-get-lean-canvas'),
      'business_studio_get_lean_canvas',
    );
  });

  it('product map includes section catalog + resource', () => {
    const json = map.productMapJson();
    assert.ok(Array.isArray(json.business_studio_sections));
    assert.ok(json.business_studio_sections.some((s) => s.id === 'leancanvas'));
    assert.ok(json.playbook.some((p) => /business_studio_section/i.test(p)));
    const res = map.readProductResource('docs://business-studio-sections');
    assert.ok(res);
    assert.match(res, /Lean Canvas/);
    assert.match(map.chatgptProductInstructions({ npcLabel: 'Abby' }), /business-studio-section/);
    assert.match(map.mcpInitializeInstructions({ mode: 'team' }), /business_studio_catalog/);
  });

  it('section tool returns what/used_for and Phase 2 guidance', async () => {
    const cat = await tools.callTool(SCOPE, 'business_studio_catalog', {});
    assert.equal(cat.ok, true);
    assert.ok(cat.sections.length > 10);

    const lean = await tools.callTool(SCOPE, 'business_studio_section', { section: 'Lean Canvas' });
    assert.equal(lean.ok, true);
    assert.equal(lean.section.id, 'leancanvas');
    assert.match(lean.section.what, /canvas/i);
    assert.ok(lean.section.read_tools.includes('business_studio_get_lean_canvas'));
    assert.equal(lean.snapshot.status, 'live');

    const p2 = await tools.callTool(SCOPE, 'business_studio_section', { section: 'Financials' });
    assert.equal(p2.ok, true);
    assert.equal(p2.snapshot.status, 'live');
    assert.ok(p2.section.write_tools.includes('business_studio_upsert_section'));
  });

  it('funding readiness includes capital + data room; lean canvas helpers stay consistent', async () => {
    const fundRes = await tools.callTool(SCOPE, 'business_studio_funding_readiness', {});
    assert.equal(fundRes.ok, true);
    assert.ok(fundRes.dataRoom);
    assert.ok(fundRes.capital);
    assert.ok(fundRes.leanCanvas);

    const state = studioStore.emptyState();
    state.funding.leanCanvas = funding.sanitizeLeanCanvas({
      problem: 'Founders lose context across AI tools every day.',
      uniqueValueProposition: 'An office you can watch your agents work in.',
      customerSegments: 'Founder-operators running agent teams.',
    });
    assert.equal(funding.leanCanvasFilledCount(state.funding.leanCanvas), 3);
    assert.equal(funding.leanCanvasIsSubstantial(state.funding.leanCanvas), true);

    const getLean = await tools.callTool(SCOPE, 'business_studio_get_lean_canvas', {});
    assert.equal(getLean.ok, true);
    assert.ok(getLean.fields.length >= 9);

    const capital = await tools.callTool(SCOPE, 'business_studio_capital_pathway', {});
    assert.equal(capital.ok, true);
    assert.ok(capital.capital);
    const room = await tools.callTool(SCOPE, 'business_studio_data_room', {});
    assert.equal(room.ok, true);
    assert.ok(room.dataRoom);
  });

  it('working_set accepts section focus', async () => {
    const res = await tools.callTool(SCOPE, 'business_studio_working_set', { section: 'moat' });
    assert.equal(res.ok, true);
    assert.equal(res.section.id, 'moat');
    assert.ok(res.section.read_tools.includes('business_studio_get_moat'));
  });
});
