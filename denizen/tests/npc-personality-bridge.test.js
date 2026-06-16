'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const bridge = require('../src/npc-personality-bridge');

describe('npc-personality-bridge', () => {
  it('mergeMemberProfiles prefers identity overrides over org defaults', () => {
    const merged = bridge.mergeMemberProfiles(
      {
        npc_key: 'bob',
        display_name: 'Org Bob',
        role: 'researcher',
        focus: 'org focus',
        instructions: 'org instructions',
        settings: {
          job: 'org job',
          soul_snippet: 'Org soul line',
          personality: { formality: 80, verbosity: 40, proactivity: 50 },
          extra_skills: ['research'],
        },
      },
      {
        npc_key: 'bob',
        display_name: 'My Bob',
        role: 'assistant',
        focus: null,
        instructions: 'my instructions',
        settings: {
          job: 'my job',
          soul_snippet: 'My soul line',
          personality: { formality: 30 },
          extra_skills: ['crm-summary'],
        },
      },
    );
    assert.equal(merged.display_name, 'My Bob');
    assert.equal(merged.role, 'assistant');
    assert.equal(merged.focus, 'org focus');
    assert.equal(merged.instructions, 'my instructions');
    assert.equal(merged.settings.job, 'my job');
    assert.equal(merged.settings.soul_snippet, 'My soul line');
    assert.equal(merged.settings.personality.formality, 30);
    assert.equal(merged.settings.personality.verbosity, 40);
    assert.deepEqual(merged.settings.extra_skills, ['research', 'crm-summary']);
  });

  it('buildTeamMemberPromptOverlay includes sliders snippet and skills', () => {
    const overlay = bridge.buildTeamMemberPromptOverlay({
      display_name: 'Bob',
      role: 'Researcher',
      focus: 'trends',
      instructions: 'Be brief',
      settings: {
        job: 'Scan Reddit',
        personality: { formality: 20, verbosity: 80, proactivity: 70 },
        soul_snippet: 'Always cite sources.',
        extra_skills: ['research'],
      },
    });
    assert.match(overlay, /Teammate NPC profile/);
    assert.match(overlay, /Personality sliders/);
    assert.match(overlay, /Always cite sources/);
    assert.match(overlay, /research/);
  });

  it('sanitizeSoulSnippet caps length', () => {
    const long = 'x'.repeat(3000);
    assert.equal(bridge.sanitizeSoulSnippet(long).length, bridge.MAX_SOUL_SNIPPET);
  });

  it('normalizeExtraSkills dedupes and limits', () => {
    const list = bridge.normalizeExtraSkills('Research, crm-summary, research, foo');
    assert.deepEqual(list.slice(0, 2), ['research', 'crm-summary']);
  });
});
