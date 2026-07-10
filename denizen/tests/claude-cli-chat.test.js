'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const claudeCli = require('../src/claude-cli-chat');

describe('claude-cli-chat', () => {
  it('buildPlayerChatPrompt includes CEO latest line and history', () => {
    const prompt = claudeCli.buildPlayerChatPrompt(
      'You are Claude.',
      [
        { role: 'user', content: 'hey' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'local or cloud?' },
      ],
      'local or cloud?',
    );
    assert.match(prompt, /You are Claude/);
    assert.match(prompt, /CEO: hey/);
    assert.match(prompt, /Claude: hello/);
    assert.match(prompt, /local or cloud\?/);
    assert.match(prompt, /denizen-claude MCP/);
  });
});
