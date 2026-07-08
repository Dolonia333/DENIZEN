'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { samplingFor, applySampling, SAMPLING_PROFILES } = require('../src/inference-sampling');

describe('inference-sampling', () => {
  it('every profile has the four core params in sane ranges', () => {
    for (const [name, p] of Object.entries(SAMPLING_PROFILES)) {
      assert.ok(p.temperature >= 0 && p.temperature <= 2, `${name} temperature`);
      assert.ok(p.top_p > 0 && p.top_p <= 1, `${name} top_p`);
      assert.ok(p.min_p >= 0 && p.min_p < 0.5, `${name} min_p`);
      assert.ok(p.repeat_penalty >= 1 && p.repeat_penalty <= 1.3, `${name} repeat_penalty`);
    }
  });

  it('maps kind → profile', () => {
    assert.equal(samplingFor({ kind: 'think' }).temperature, SAMPLING_PROFILES.reasoning.temperature);
    assert.equal(samplingFor({ kind: 'coding-agent' }).repeat_penalty, 1.0);
    assert.equal(samplingFor({ kind: 'idle' }).repeat_penalty, SAMPLING_PROFILES.presence.repeat_penalty);
  });

  it('explicit profile beats kind; reasoning flag works', () => {
    assert.equal(samplingFor({ kind: 'chat', profile: 'code' }).temperature, 0.2);
    assert.equal(samplingFor({ reasoning: true }).temperature, SAMPLING_PROFILES.reasoning.temperature);
  });

  it('unknown kind falls back to chat', () => {
    assert.deepEqual(samplingFor({ kind: 'nonsense' }), SAMPLING_PROFILES.chat);
    assert.deepEqual(samplingFor({}), SAMPLING_PROFILES.chat);
  });

  it('caller temperature override is respected, other params from profile', () => {
    const s = samplingFor({ kind: 'chat', temperature: 0.1 });
    assert.equal(s.temperature, 0.1);
    assert.equal(s.min_p, SAMPLING_PROFILES.chat.min_p);
  });

  it('presence is the most loop-resistant profile (highest repeat_penalty)', () => {
    const maxRp = Math.max(...Object.values(SAMPLING_PROFILES).map((p) => p.repeat_penalty));
    assert.equal(SAMPLING_PROFILES.presence.repeat_penalty, maxRp);
  });

  it('applySampling does not clobber an already-set field unless forced', () => {
    const merged = applySampling({ temperature: 0.99 }, { kind: 'chat' });
    assert.equal(merged.temperature, 0.99); // preserved
    assert.equal(merged.min_p, SAMPLING_PROFILES.chat.min_p); // added
    const forced = applySampling({ temperature: 0.99 }, { kind: 'chat' }, { force: true });
    assert.equal(forced.temperature, SAMPLING_PROFILES.chat.temperature); // overwritten
  });
});
