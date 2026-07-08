'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const position = require('../src/auth/denizen-user-position.js');

describe('denizen-user-position', () => {
  it('normalizes and trims titles', () => {
    assert.equal(position.normalizeTitle('  Product   Manager  '), 'Product Manager');
  });

  it('fallback resolves product manager profile', async () => {
    const profile = position.fallbackResolvePosition('Product Manager');
    assert.equal(profile.title, 'Product Manager');
    assert.equal(profile.canonical_role, 'product_manager');
    assert.ok(profile.responsibilities.length >= 3);
    assert.ok(profile.summary.length > 20);
    assert.equal(profile.source, 'fallback');
  });

  it('fallback resolves custom title with generic profile', () => {
    const profile = position.fallbackResolvePosition('Chief Happiness Officer');
    assert.equal(profile.title, 'Chief Happiness Officer');
    assert.ok(profile.summary.includes('Chief Happiness Officer'));
    assert.equal(profile.source, 'fallback');
  });

  it('reads position from identity metadata', () => {
    const pos = position.getPositionFromIdentity({
      metadata: {
        position: {
          title: 'Intern',
          summary: 'Learning role',
          responsibilities: ['Support the team'],
          how_to_help: 'Give clear tasks',
          source: 'fallback',
        },
      },
    });
    assert.equal(pos.title, 'Intern');
    assert.deepEqual(pos.responsibilities, ['Support the team']);
  });

  it('formatPositionPromptBlock includes title and help guidance', () => {
    const block = position.formatPositionPromptBlock({
      title: 'CEO',
      summary: 'Runs the company',
      responsibilities: ['Set vision'],
      how_to_help: 'Bring options',
      source: 'fallback',
    });
    assert.match(block, /Title: CEO/);
    assert.match(block, /How NPCs should help/);
  });

  it('resolvePositionProfile uses fallback when LLM disabled', async () => {
    const profile = await position.resolvePositionProfile('Executive Assistant', { useLlm: false });
    assert.equal(profile.canonical_role, 'assistant');
  });
});
