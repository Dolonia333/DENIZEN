'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.document = { dispatchEvent: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

require('../src/hud/player-chat.js');

const PlayerChat = global.PlayerChat;
PlayerChat.prototype._buildUI = function () {};
PlayerChat.prototype._bindDeferredVisitorUi = function () {};
PlayerChat.prototype.setWsConnected = function () {};

function makeChat() {
  const chat = new PlayerChat(null, {});
  chat._visible = true;
  chat._chatLog = [];
  chat._addToLog = (from, text) => chat._chatLog.push({ from, text });
  chat._showPlayerBubble = () => {};
  chat._findNamedNpc = () => null;
  return chat;
}

describe('player-chat grok fixes', () => {
  it('notifySkillResult skips web-search and research', () => {
    const chat = makeChat();
    chat._threads = new Map([['grok-dm', { type: 'dm', npcName: 'Grok', messages: [] }]]);
    chat._activeThreadId = 'grok-dm';
    chat.notifySkillResult('Marcus', 'web-search');
    chat.notifySkillResult('Grok', 'research');
    assert.equal(chat._chatLog.length, 0);
  });

  it('notifySkillResult does not inject other NPC skill lines into open DM', () => {
    const chat = makeChat();
    chat._threads = new Map([['grok-dm', { type: 'dm', npcName: 'Grok', messages: [] }]]);
    chat._activeThreadId = 'grok-dm';
    chat._ceoConvo = { npcName: 'Grok' };
    chat.notifySkillResult('Marcus', 'crm-list-tasks', true);
    assert.equal(chat._chatLog.length, 0);
  });

  it('sendMessage dedupes identical text within 700ms', async () => {
    const chat = makeChat();
    chat._lastSendAt = Date.now();
    chat._lastSendText = 'hey';
    await chat.sendMessage('hey');
    assert.equal(chat._chatLog.length, 0);
  });
});
