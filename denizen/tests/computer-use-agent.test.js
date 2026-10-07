'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemPrompt } = require('../src/computer-use-agent');

describe('computer-use buildSystemPrompt', () => {
  it('general mode mentions Muse/Grok-style browser agent', () => {
    const prompt = buildSystemPrompt({
      instruction: 'Open example.com and summarize the heading',
      taskMode: 'general',
    });
    assert.match(prompt, /Muse \/ Grok/i);
    assert.match(prompt, /browser mirror/i);
    assert.match(prompt, /Open example.com and summarize the heading/);
    assert.doesNotMatch(prompt, /Do NOT click Submit or Apply — fill everything, then signal task_done/);
  });

  it('job-apply mode keeps the no-submit rule', () => {
    const prompt = buildSystemPrompt({
      instruction: 'Fill the Acme application',
      taskMode: 'job-apply',
      profile: { name: 'Zion', email: 'zion@example.com' },
    });
    assert.match(prompt, /Do NOT click Submit or Apply/);
    assert.match(prompt, /Zion/);
    assert.doesNotMatch(prompt, /Muse \/ Grok/);
  });

  it('defaults unknown taskMode to general', () => {
    const prompt = buildSystemPrompt({ instruction: 'Browse docs', taskMode: 'weird' });
    assert.match(prompt, /Muse \/ Grok/i);
  });
});
