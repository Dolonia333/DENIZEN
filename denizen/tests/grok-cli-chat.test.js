'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const grokCli = require('../src/grok-cli-chat');

describe('grok-cli-chat', () => {
  it('buildPlayerChatPrompt includes CEO latest line and history', () => {
    const prompt = grokCli.buildPlayerChatPrompt(
      'You are Grok.',
      [
        { role: 'user', content: 'hey' },
        { role: 'assistant', content: 'yo' },
        { role: 'user', content: 'status?' },
      ],
      'status?',
    );
    assert.match(prompt, /You are Grok/);
    assert.match(prompt, /CEO: hey/);
    assert.match(prompt, /Grok: yo/);
    assert.match(prompt, /status\?/);
    assert.match(prompt, /denizen-grok MCP/);
  });
});
