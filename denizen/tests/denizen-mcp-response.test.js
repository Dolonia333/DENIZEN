'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const resp = require('../src/denizen-mcp-response');
const mcpActions = require('../src/denizen-mcp-actions');
const mcpCrmTools = require('../src/denizen-mcp-crm-tools');
const mcpTeamTools = require('../src/denizen-mcp-team-tools');
const fs = require('node:fs');
const path = require('node:path');

describe('denizen-mcp-response helpers', () => {
  it('marks healthy empty lists', () => {
    const e = resp.emptyHealthy({ kind: 'contacts', create_with: 'crm_upsert_contact' });
    assert.equal(e.empty, true);
    assert.equal(e.empty_state, 'healthy');
    assert.match(e.message, /crm_upsert_contact/);
  });

  it('paginates with next_offset', () => {
    const page = resp.paginate(['a', 'b', 'c', 'd'], { offset: 1, limit: 2 });
    assert.deepEqual(page.items, ['b', 'c']);
    assert.equal(page.total, 4);
    assert.equal(page.next_offset, 3);
    assert.equal(page.has_more, true);
  });

  it('dry_run fails validation then succeeds preview', () => {
    const bad = resp.dryRunResult({ tool: 'send_handoff', missing: ['message'] });
    assert.equal(bad.ok, false);
    assert.equal(bad.dry_run, true);
    const ok = resp.dryRunResult({ tool: 'send_handoff', plan: { message: 'hi' } });
    assert.equal(ok.ok, true);
    assert.equal(ok.dry_run, true);
    assert.match(ok.message, /No changes committed/);
  });

  it('softCap truncates oversized payloads', () => {
    const huge = { ok: true, skill_details: Array.from({ length: 200 }, (_, i) => ({
      name: `skill-${i}`,
      fluff: 'x'.repeat(200),
    })) };
    const capped = resp.softCap(huge, { budget: 2000, dropKeys: ['skill_details'] });
    assert.equal(capped.truncated, true);
    assert.equal(capped.skill_details, undefined);
  });
});

describe('list_skills modes', () => {
  it('summary omits null-hint skill_details bloat', async () => {
    const scope = { npc_key: 'josh', org_id: 'org', org_slug: 'zion' };
    const full = await mcpActions.toolListSkills(scope, { mode: 'full', limit: 20 });
    const summary = await mcpActions.toolListSkills(scope, { mode: 'summary' });
    const names = await mcpActions.toolListSkills(scope, { mode: 'names' });
    assert.equal(summary.ok, true);
    assert.equal(names.skill_details, undefined);
    assert.ok(Array.isArray(summary.skills));
    assert.ok(summary.count >= summary.skills.length);
    assert.ok((full.skill_details || []).length >= (summary.skill_details || []).length);
  });
});

describe('CRM dry_run', () => {
  it('validates upsert_contact without writing', async () => {
    const scope = { npc_key: 'lucy', org_id: 'org', org_slug: 'zion', scope_mode: 'team' };
    const missing = await mcpCrmTools.callTool(scope, 'crm_upsert_contact', { dry_run: true });
    assert.equal(missing.ok, false);
    assert.equal(missing.dry_run, true);
    assert.ok(missing.missing.includes('name|id'));

    const ok = await mcpCrmTools.callTool(scope, 'crm_upsert_contact', {
      dry_run: true,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.dry_run, true);
    assert.equal(ok.would_execute, 'crm_upsert_contact');
  });
});

describe('send_handoff dry_run', () => {
  it('previews without session-linked send', async () => {
    const scope = { npc_key: 'jenny', org_id: 'org', session_id: 'sess-1' };
    const r = await mcpTeamTools.callTool(scope, 'send_handoff', {
      dry_run: true,
      message: 'Ping',
      to_display_name: 'Zion',
    });
    assert.equal(r.ok, true);
    assert.equal(r.dry_run, true);
    assert.equal(r.plan.message, 'Ping');
  });
});

describe('CRM packaging regression', () => {
  it('ships denizen-crm-agent-records and mutation requires resolve', () => {
    const srcRoot = path.join(__dirname, '..', 'src');
    const required = [
      'denizen-crm-agent-records.js',
      'denizen-crm-mutations.js',
      'denizen-mcp-crm-tools.js',
      'denizen-npc-mcp-gateway.js',
    ];
    for (const file of required) {
      assert.ok(fs.existsSync(path.join(srcRoot, file)), `missing ${file}`);
    }
    // Require path used by deployed stack must resolve from mutations.
    const agentRecords = require('../src/denizen-crm-agent-records');
    assert.equal(typeof agentRecords.listRecords, 'function');
    const mutations = require('../src/denizen-crm-mutations');
    assert.equal(typeof mutations.listPipeline, 'function');
  });
});
