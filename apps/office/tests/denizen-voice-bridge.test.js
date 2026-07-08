'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const voiceBridge = require('../src/voice/denizen-voice-bridge.js');

describe('denizen-voice-bridge', () => {
  it('emitVoiceInstant sends sentence and done events', () => {
    const sent = [];
    const ws = {
      readyState: 1,
      send: (raw) => sent.push(JSON.parse(raw)),
    };
    voiceBridge.emitVoiceInstant(ws, 'Lucy', 'Hello there');
    assert.equal(sent.length, 2);
    assert.equal(sent[0].type, 'voice_chat_sentence');
    assert.equal(sent[0].text, 'Hello there');
    assert.equal(sent[1].type, 'voice_chat_done');
    assert.equal(sent[1].text, 'Hello there');
  });

  it('emitVoiceFiller includes turn_id when provided', () => {
    const sent = [];
    const ws = {
      readyState: 1,
      send: (raw) => sent.push(JSON.parse(raw)),
    };
    voiceBridge.emitVoiceFiller(ws, 'Lucy', { turn_id: 'vt_1' });
    assert.equal(sent[0].type, 'voice_chat_filler');
    assert.equal(sent[0].turn_id, 'vt_1');
    assert.ok(sent[0].text);
  });
});
