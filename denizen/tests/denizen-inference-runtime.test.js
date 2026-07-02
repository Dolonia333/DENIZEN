'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../src/denizen-inference-runtime');

describe('denizen-inference-runtime', () => {
  it('buildChatMessages adds system prompt and default user turn', () => {
    const msgs = runtime.buildChatMessages('Be brief.', []);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[0].content, 'Be brief.');
    assert.equal(msgs[1].role, 'user');
  });

  it('buildInferenceBlockFromProbe marks rpc_capable when reachable', () => {
    const block = runtime.buildInferenceBlockFromProbe({
      backend: 'ollama',
      url: 'http://127.0.0.1:11434',
      reachable: true,
      models: ['llama3.2'],
      main_model: 'llama3.2',
      probed_at: new Date().toISOString(),
    });
    assert.equal(block.backend, 'ollama');
    assert.equal(block.rpc_capable, true);
    assert.equal(block.reachable_local, true);
  });

  it('resolveBackendPreference honors env', () => {
    const prev = process.env.DENIZEN_INFERENCE_BACKEND;
    process.env.DENIZEN_INFERENCE_BACKEND = 'ollama';
    assert.equal(runtime.resolveBackendPreference(), 'ollama');
    process.env.DENIZEN_INFERENCE_BACKEND = 'llamacpp';
    assert.equal(runtime.resolveBackendPreference(), 'llamacpp');
    delete process.env.DENIZEN_INFERENCE_BACKEND;
    assert.equal(runtime.resolveBackendPreference(), 'auto');
    if (prev != null) process.env.DENIZEN_INFERENCE_BACKEND = prev;
  });

  it('extractChatText reads message content', () => {
    const text = runtime.extractChatText({
      choices: [{ message: { content: ' hello ' } }],
    });
    assert.equal(text, 'hello');
  });
});
