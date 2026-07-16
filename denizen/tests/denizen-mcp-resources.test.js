'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const mcpResources = require('../src/denizen-mcp-resources.js');

describe('denizen-mcp-resources', () => {
  it('filters facts for bouncer npcId', () => {
    const sample = {
      generatedAt: '2026-07-01T05:00:00Z',
      facts: [
        '[FACT:high_activity_bouncer] Bouncer: 109 ev',
        '[FACT:context_bloat_bob] Bob high avg tokens',
      ],
      npcs: { Bouncer: { count: 109 }, Bob: { count: 77 } },
    };
    const filtered = mcpResources.filterTelemetryForNpc(sample, 'bouncer');
    assert.equal(filtered.filtered, true);
    assert.equal(filtered.facts.length, 1);
    assert.ok(filtered.facts[0].includes('Bouncer'));
    assert.ok(filtered.npcs.Bouncer);
    assert.equal(filtered.npcs.Bob, undefined);
  });

  it('readTelemetryResource resolves URIs without requiring a runtime snapshot', () => {
    const full = JSON.parse(mcpResources.readTelemetryResource('telemetry://fleet/latest'));
    assert.ok(Array.isArray(full.facts));
    const bouncer = JSON.parse(mcpResources.readTelemetryResource('telemetry://grok/latest/bouncer'));
    assert.equal(bouncer.npcId, 'bouncer');
    assert.ok(Array.isArray(bouncer.facts));
  });

  it('canReadTelemetry scopes grok full vs filtered', () => {
    assert.equal(
      mcpResources.canReadGrokTelemetry({ npc_key: 'grok' }, 'telemetry://grok/latest'),
      true,
    );
    assert.equal(
      mcpResources.canReadGrokTelemetry({ npc_key: 'bob' }, 'telemetry://grok/latest'),
      false,
    );
    assert.equal(
      mcpResources.canReadGrokTelemetry({ npc_key: 'bob' }, 'telemetry://grok/latest/bouncer'),
      true,
    );
  });

  it('canReadFleetTelemetry requires team scope', () => {
    assert.equal(
      mcpResources.canReadFleetTelemetry({ npc_key: '_team', scope_mode: 'team' }, 'telemetry://fleet/latest/bob'),
      true,
    );
    assert.equal(
      mcpResources.canReadFleetTelemetry({ npc_key: 'grok' }, 'telemetry://fleet/latest'),
      false,
    );
  });
});
