'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('mobile UI layout fixes', () => {
  it('chat header hosts actions in a dedicated row', () => {
    const chat = read('src/player-chat.js');
    assert.match(chat, /id="player-chat-header-actions"/);
    assert.match(chat, /_ensureChatHeaderActions/);
    assert.match(chat, /overflow:\s*hidden/);
    assert.match(chat, /padding-top:\s*10px/);
  });

  it('Projects and Connect AI mount into header-actions', () => {
    const projects = read('src/visitor-projects-ui.js');
    const mcp = read('src/visitor-mcp-connect-ui.js');
    assert.match(projects, /player-chat-header-actions/);
    assert.match(mcp, /player-chat-header-actions/);
  });

  it('HQ PASS login card is the sticky-button scroll container', () => {
    const session = read('src/visitor-session.js');
    assert.match(session, /Card scrolls so sticky Log in stays inside the amber ring/);
    assert.match(session, /max-height: calc\(100dvh - 56px/);
    assert.match(session, /0 -14px 20px rgba\(2, 6, 23, 0\.92\)/);
  });

  it('game canvas is absolutely pinned to kill letterbox gaps', () => {
    const html = read('index.html');
    assert.match(html, /#game-container canvas \{[^}]*position:\s*absolute;/s);
    assert.match(html, /#game-container canvas \{[^}]*display:\s*block;/s);
  });

  it('speech bubbles nudge away from neighbors', () => {
    const actions = read('src/agent-actions.js');
    assert.match(actions, /Nudge up when another live bubble/);
  });
});
