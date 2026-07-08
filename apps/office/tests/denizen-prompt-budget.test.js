'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractThinkIdentity,
  buildAnthropicSystem,
  compactThinkUserPrompt,
  compactChatHistory,
} = require('../src/denizen-prompt-budget');

describe('denizen-prompt-budget', () => {
  it('extractThinkIdentity keeps core sections only', () => {
    const soul = `## Core Identity\nYou are Lucy.\n\n## Personality\n${'x'.repeat(4000)}\n\n## Role\nReceptionist\n\n## Values\nWarmth`;
    const out = extractThinkIdentity(soul, 'Receptionist', 500);
    assert.match(out, /Lucy/);
    assert.match(out, /Receptionist/);
    assert.match(out, /Warmth/);
    assert.ok(!out.includes('xxxx') || out.length <= 520);
    assert.ok(out.length < 2000);
  });

  it('buildAnthropicSystem adds cache_control on static block', () => {
    const sys = buildAnthropicSystem('STATIC SOUL', 'dynamic inbox', { enableCache: true });
    assert.equal(Array.isArray(sys), true);
    assert.equal(sys[0].cache_control.type, 'ephemeral');
    assert.equal(sys[1].text, 'dynamic inbox');
  });

  it('compactThinkUserPrompt is shorter than legacy action manifest', () => {
    const compact = compactThinkUserPrompt('Do something', '');
    assert.ok(compact.length < 600);
    assert.match(compact, /JSON/);
  });

  it('compactChatHistory summarizes older turns and keeps recent verbatim', () => {
    const memories = [];
    for (let i = 0; i < 14; i++) {
      memories.push({
        from: i % 2 === 0 ? 'CEO' : 'Lucy',
        text: `Message number ${i} with some padding text to simulate real chat.`,
      });
    }
    const out = compactChatHistory(memories, 'Lucy', {
      recentCount: 4,
      compactAfter: 8,
      maxSummaryChars: 400,
    });
    assert.ok(out.messages.length >= 3 && out.messages.length <= 4);
    assert.equal(out.compactedTurns, 10);
    assert.match(out.contextSummary, /Earlier in this thread/);
    assert.ok(out.messages[0].role === 'user');
  });
});
