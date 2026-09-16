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
    assert.match(chat, /padding-top:\s*0/);
    assert.match(chat, /pc-floor-kicker/);
  });

  it('touch header stays a single thin row with horizontal actions', () => {
    const chat = read('src/player-chat.js');
    assert.match(
      chat,
      /html\.denizen-touch #player-chat-header \{[\s\S]*?grid-template-areas:\s*"avatar main actions"/
    );
    const actionBlocks = [...chat.matchAll(
      /html\.denizen-touch #player-chat-header-actions \{([^}]+)\}/g
    )].map((m) => m[1]);
    assert.ok(actionBlocks.length >= 1, 'expected touch header-actions rules');
    assert.ok(
      actionBlocks.some((block) => /flex-direction:\s*row/.test(block)),
      'touch header-actions should use a horizontal row'
    );
    assert.ok(
      actionBlocks.every((block) => !/flex-direction:\s*column/.test(block)),
      'touch header-actions must not stack buttons in a column'
    );
    assert.match(chat, /denizen-visitor-assistant-chip[\s\S]*?display:\s*none !important/);
    assert.match(chat, /padding:\s*12px/);
    assert.match(chat, /border-radius:\s*999px/);
    assert.match(chat, /#4ade80,\s*#16a34a/);
  });

  it('Projects, Connect AI, Hand off, and Briefing mount into header-actions', () => {
    const projects = read('src/visitor-projects-ui.js');
    const mcp = read('src/visitor-mcp-connect-ui.js');
    const handoff = read('src/visitor-handoff-ui.js');
    const briefing = read('src/visitor-briefing-ui.js');
    assert.match(projects, /player-chat-header-actions/);
    assert.match(mcp, /player-chat-header-actions/);
    assert.match(handoff, /player-chat-header-actions/);
    assert.match(briefing, /player-chat-header-actions/);
  });

  it('removes the green Your assistant chip from Floor Line', () => {
    const claim = read('src/visitor-claim-ui.js');
    const chat = read('src/player-chat.js');
    assert.match(claim, /Floor Line no longer shows the green/);
    assert.match(chat, /pc-floor-kicker/);
    assert.match(chat, /#player-chat-panel::before \{ content: none/);
    assert.doesNotMatch(chat, /"chip chip chip"/);
    assert.match(chat, /display: none !important/);
  });

  it('HQ PASS login avoids transform on touch so Safari autofill stays anchored', () => {
    const session = read('src/visitor-session.js');
    assert.match(session, /denizen-keyboard-open/);
    assert.match(session, /--denizen-keyboard-inset/);
    assert.match(session, /transform: none !important/);
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

  it('portrait phones center the HQ map box, then pin top when chat opens', () => {
    const mobile = read('src/mobile-controls.js');
    assert.match(
      mobile,
      /html\.denizen-touch\.denizen-portrait body \{[\s\S]*?align-items:\s*center/
    );
    assert.match(
      mobile,
      /html\.denizen-touch\.denizen-portrait\.denizen-chat-open body \{[\s\S]*?align-items:\s*flex-start/
    );
    const html = read('index.html');
    assert.match(html, /mobile-controls\.js\?v=hqMid1/);
  });

  it('speech bubbles nudge away from neighbors', () => {
    const actions = read('src/agent-actions.js');
    assert.match(actions, /Nudge up when another live bubble/);
  });
});
