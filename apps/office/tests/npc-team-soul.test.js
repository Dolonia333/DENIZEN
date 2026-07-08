'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const npcTeamSoul = require('../src/npc/npc-team-soul');

describe('npc-team-soul', () => {
  it('mergeMemberSettings tracks user baseline evolution', () => {
    const merged = npcTeamSoul.mergeMemberSettings(
      { job: 'old job', user_baseline: { role: 'assistant', saved_at: '2026-01-01' } },
      { job: 'new job' },
      {
        npc_key: 'bob',
        display_name: 'Bob',
        role: 'Researcher',
        focus: 'trends',
        instructions: 'Be brief',
      },
    );
    assert.equal(merged.job, 'new job');
    assert.equal(merged.user_baseline.role, 'Researcher');
    assert.ok(Array.isArray(merged.evolution_log));
    assert.ok(merged.evolution_log.length >= 1);
  });

  it('portraitMeta returns sprite sheet info for bob', () => {
    const p = npcTeamSoul.portraitMeta('bob');
    assert.equal(p.npc_key, 'bob');
    assert.match(p.sprite_url, /Bob\.png$/);
    assert.equal(p.frame, 1);
  });

  it('buildMemberSoulView includes soul and memory excerpts', () => {
    const view = npcTeamSoul.buildMemberSoulView('bob', {
      npc_key: 'bob',
      display_name: 'Bob',
      role: 'Researcher',
      settings: { job: 'Scan trends' },
    });
    assert.equal(view.npc_key, 'bob');
    assert.ok(view.soul.excerpt.length > 20);
    assert.ok(view.user_baseline.job === 'Scan trends');
  });

  it('buildMemberSoulView merges effective overlay from org+identity', () => {
    const view = npcTeamSoul.buildMemberSoulView(
      'bob',
      {
        npc_key: 'bob',
        display_name: 'Bob',
        role: 'Researcher',
        settings: { soul_snippet: 'Identity snippet' },
      },
      {
        npc_key: 'bob',
        display_name: 'Bob',
        role: 'Researcher',
        settings: {
          soul_snippet: 'Identity snippet',
          personality: { formality: 25, verbosity: 50, proactivity: 50 },
          extra_skills: ['research'],
        },
      },
    );
    assert.match(view.effective_overlay, /Identity snippet/);
    assert.equal(view.personality.formality, 25);
    assert.deepEqual(view.extra_skills, ['research']);
  });
});
