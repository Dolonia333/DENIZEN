'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const mgr = require('../src/lm-studio-model-manager');

describe('lm-studio-model-manager', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env.LM_STUDIO_MODEL = 'meta-llama-3.1-8b-instruct';
    process.env.LM_STUDIO_FAST_MODEL = 'google/gemma-4-e2b';
    process.env.LM_STUDIO_HEAVY_MODEL = 'qwen2.5-14b-instruct-1m';
    process.env.LM_STUDIO_HEAVY_TTL_SEC = '600';
    process.env.LM_STUDIO_PRELOAD_RESIDENT = '1';
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  });

  it('ttlForTier only sets TTL on heavy', () => {
    assert.equal(mgr.ttlForTier('main'), null);
    assert.equal(mgr.ttlForTier('fast'), null);
    assert.equal(mgr.ttlForTier('heavy'), 600);
    assert.equal(mgr.ttlForTier('reasoning'), 600);
  });

  it('envPins reads three tier pins', () => {
    const pins = mgr.envPins();
    assert.equal(pins.main, 'meta-llama-3.1-8b-instruct');
    assert.equal(pins.fast, 'google/gemma-4-e2b');
    assert.equal(pins.heavy, 'qwen2.5-14b-instruct-1m');
  });

  it('isLoaded matches pin substrings', () => {
    const models = [
      { id: 'meta-llama-3.1-8b-instruct', state: 'loaded' },
      { id: 'google/gemma-4-e2b', state: 'not-loaded' },
    ];
    assert.equal(mgr.isLoaded(models, 'meta-llama-3.1-8b-instruct'), true);
    assert.equal(mgr.isLoaded(models, 'google/gemma-4-e2b'), false);
  });

  it('ensureResidentModels skips when preload disabled', async () => {
    process.env.LM_STUDIO_PRELOAD_RESIDENT = '0';
    const r = await mgr.ensureResidentModels();
    assert.equal(r.skipped, true);
  });
});
