'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mcpScopes = require('../src/denizen-mcp-scopes.js');

describe('denizen-mcp-scopes', () => {
  it('defaults to full scopes when unset', () => {
    assert.deepEqual(mcpScopes.normalizeScopes(null), mcpScopes.ALL_SCOPES);
    assert.deepEqual(mcpScopes.scopesFromTokenScope({}), mcpScopes.ALL_SCOPES);
  });

  it('expands presets', () => {
    assert.deepEqual(mcpScopes.normalizeScopes('read'), ['read']);
    assert.deepEqual(mcpScopes.normalizeScopes('standard'), ['read', 'skills', 'handoff']);
  });

  it('maps tools to scopes', () => {
    assert.equal(mcpScopes.requiredScope('get_status'), 'read');
    assert.equal(mcpScopes.requiredScope('run_skill'), 'skills');
    assert.equal(mcpScopes.requiredScope('crm_draft_email'), 'crm_write');
    assert.equal(mcpScopes.requiredScope('send_handoff'), 'handoff');
    assert.equal(mcpScopes.requiredScope('delegate_task'), 'delegate');
  });

  it('filters tools by granted scopes', () => {
    const scope = { scopes: ['read'] };
    assert.equal(mcpScopes.toolAllowed(scope, 'get_status'), true);
    assert.equal(mcpScopes.toolAllowed(scope, 'run_skill'), false);
    const tools = mcpScopes.filterTools(scope, [
      { name: 'get_status' },
      { name: 'run_skill' },
    ]);
    assert.deepEqual(tools.map((t) => t.name), ['get_status']);
  });
});
