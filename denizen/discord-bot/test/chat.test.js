'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  stripMention,
  resolveLmBases,
  buildSystemPrompt,
  isOpenChatChannel,
  formatRooms,
} = require('../src/chat');

describe('discord chat', () => {
  it('stripMention removes bot ping', () => {
    assert.equal(stripMention('<@123> hello there', '123'), 'hello there');
    assert.equal(stripMention('<@!123> yo', '123'), 'yo');
  });

  it('resolveLmBases prefers LM_STUDIO_URL then remotes', () => {
    const prevUrl = process.env.LM_STUDIO_URL;
    const prevRemote = process.env.LM_STUDIO_REMOTE_URLS;
    try {
      process.env.LM_STUDIO_URL = '';
      process.env.LM_STUDIO_REMOTE_URLS = 'http://192.168.50.20:1234, http://other:1234';
      const bases = resolveLmBases();
      assert.equal(bases[0], 'http://192.168.50.20:1234');
      assert.ok(bases.includes('http://other:1234'));
    } finally {
      if (prevUrl === undefined) delete process.env.LM_STUDIO_URL;
      else process.env.LM_STUDIO_URL = prevUrl;
      if (prevRemote === undefined) delete process.env.LM_STUDIO_REMOTE_URLS;
      else process.env.LM_STUDIO_REMOTE_URLS = prevRemote;
    }
  });

  it('buildSystemPrompt includes farm block when provided', () => {
    const p = buildSystemPrompt({ farmBlock: 'Hot topics: deploy×9' });
    assert.match(p, /Denizen/);
    assert.match(p, /Hot topics: deploy/);
  });

  it('isOpenChatChannel reads config', () => {
    const config = {
      get: () => ({ chat: { openChannels: ['c1', 'c2'] } }),
    };
    assert.equal(isOpenChatChannel(config, 'g1', 'c1'), true);
    assert.equal(isOpenChatChannel(config, 'g1', 'c9'), false);
    assert.equal(isOpenChatChannel(null, 'g1', 'c1'), false);
  });

  it('formatRooms handles empty', () => {
    assert.match(formatRooms({ rooms: [] }), /No rooms|empty/i);
  });
});
