'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const studioSkills = require('../src/denizen-studio-skills');
const mcpActions = require('../src/denizen-mcp-actions');
const npcCapabilities = require('../src/npc-capabilities');

describe('denizen-studio-skills bridge', () => {
  it('maps kebab skills to snake MCP tools', () => {
    assert.equal(
      studioSkills.toolNameForSkill('studio-board-working-set'),
      'studio_board_working_set',
    );
    assert.equal(
      studioSkills.toolNameForSkill('business_studio_brief'),
      'business_studio_brief',
    );
    assert.ok(studioSkills.isStudioSkill('studio-board-upsert-task'));
    assert.ok(studioSkills.isWriteStudioSkill('business-studio-add-evidence'));
    assert.equal(studioSkills.isWriteStudioSkill('studio-board-brief'), false);
  });

  it('skillsForNpc includes reads and writes by default', () => {
    const skills = studioSkills.skillsForNpc('jenny');
    assert.ok(skills.includes('studio-board-working-set'));
    assert.ok(skills.includes('studio-board-upsert-task'));
    assert.ok(skills.includes('business-studio-working-set'));
    assert.ok(skills.includes('business-studio-add-evidence'));
  });

  it('listSkillsForNpc advertises studio skills for Jenny', () => {
    const skills = mcpActions.listSkillsForNpc('jenny');
    assert.ok(skills.includes('studio-board-working-set'));
    assert.ok(skills.includes('business-studio-brief'));
    assert.ok(skills.includes('studio-board-advance-task'));
  });

  it('assertSkillAllowed accepts studio board and business studio', () => {
    assert.equal(mcpActions.assertSkillAllowed('jenny', 'studio-board-brief').ok, true);
    assert.equal(mcpActions.assertSkillAllowed('jenny', 'business_studio_working_set').ok, true);
    assert.equal(mcpActions.assertSkillAllowed('jenny', 'studio-board-upsert-task').ok, true);
    assert.ok(studioSkills.isStudioSkill('studio-board-brief'));
  });

  it('npc capabilities advertise studio canDo lines', () => {
    const cap = npcCapabilities.getCapabilities('Jenny');
    assert.ok(cap.canDo.some((line) => /Studio Board/i.test(line)));
    assert.ok(cap.canDo.some((line) => /Business Studio/i.test(line)));
    assert.ok(cap.skills.includes('studio-board-working-set'));
    assert.ok(cap.skills.includes('business-studio-brief'));
  });

  it('runStudioSkill enforces crm_write for mutations', async () => {
    const denied = await studioSkills.runStudioSkill(
      { org_id: 'org', npc_key: 'jenny', scopes: ['read', 'skills'] },
      'studio-board-upsert-task',
      { title: 'Test' },
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'scope_denied');
    assert.equal(denied.required_scope, 'crm_write');
  });

  it('runStudioSkill routes brief through MCP tool (no org still returns structured fail or empty)', async () => {
    const result = await studioSkills.runStudioSkill(
      { org_id: null, npc_key: 'jenny', scopes: ['read', 'skills', 'crm_write'] },
      'studio-board-brief',
      {},
    );
    assert.equal(result.routed, 'studio_skill_bridge');
    assert.equal(result.tool, 'studio_board_brief');
    // Without org_id the board tool fails cleanly — still a bridged skill response
    assert.equal(typeof result.output, 'string');
  });
});

describe('chatgpt onboarding mentions studios', () => {
  it('gpt_instructions cover Studio Board and Business Studio', () => {
    const gateway = require('../src/denizen-npc-mcp-gateway');
    const payload = gateway.buildOnboardingPayload({
      baseUrl: 'https://example.test',
      npcKey: 'jenny',
      token: 'tok',
    });
    assert.match(payload.chatgpt.gpt_instructions, /Studio Board/i);
    assert.match(payload.chatgpt.gpt_instructions, /Business Studio/i);
    assert.match(payload.chatgpt.gpt_instructions, /studio-board-working-set/);
    assert.match(payload.chatgpt.gpt_instructions, /business-studio-working-set/);
  });

  it('OpenAPI describes studio skills', () => {
    const gateway = require('../src/denizen-npc-mcp-gateway');
    const spec = gateway.buildOpenApiSpec('https://example.test');
    assert.match(spec.info.description, /Studio Board/);
    assert.match(spec.info.description, /Business Studio/);
    const skillDesc = spec.paths['/api/npc-sync/run-skill'].post.requestBody
      .content['application/json'].schema.properties.skill.description;
    assert.match(skillDesc, /studio-board-working-set/);
    assert.match(skillDesc, /business-studio-brief/);
  });
});
