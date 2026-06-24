'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const pull = require('../llama-brain-pull');

describe('llama-brain-pull', () => {
  it('resolveCatalogEntry finds llamacpp model', () => {
    const catalog = {
      models: [{ id: 'test-q4', backend: 'llamacpp', gguf_url: 'https://x/y.gguf', filename: 'y.gguf' }],
    };
    const entry = pull.resolveCatalogEntry(catalog, 'test-q4');
    assert.equal(entry.backend, 'llamacpp');
  });
});
