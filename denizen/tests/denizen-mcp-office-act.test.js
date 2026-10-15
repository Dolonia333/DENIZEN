'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const officeAct = require('../src/denizen-mcp-office-act');

describe('denizen-mcp-office-act', () => {
  beforeEach(() => {
    officeAct.resetForTests();
  });

  it('sends a seated NPC to the room that matches the tool', () => {
    const beat = officeAct.buildBeat({ npc_key: 'abby' }, 'crm_working_set');
    assert.equal(beat.displayName, 'Abby');
    assert.equal(beat.npcKey, 'xp_abby');
    assert.equal(beat.guest, false);
    assert.equal(beat.room, 'reception');
    assert.match(beat.line, /pipeline/);
  });

  it('embodies a team ChatGPT connection as its own walker', () => {
    const beat = officeAct.buildBeat(
      { npc_key: '_team', label: 'team-operator' },
      'business-studio-working-set',
    );
    assert.equal(beat.guest, true);
    assert.equal(beat.displayName, 'ChatGPT');
    assert.equal(beat.npcKey, 'xp_plugin_chatgpt');
    assert.equal(beat.room, 'manager_office');
  });

  it('uses a Cursor body when the token says cursor', () => {
    const beat = officeAct.buildBeat(
      { npc_key: '_team', label: 'cursor' },
      'studio_board_brief',
    );
    assert.equal(beat.displayName, 'Cursor');
    assert.equal(beat.npcKey, 'xp_plugin_cursor');
    assert.equal(beat.room, 'conference');
  });

  it('does not announce twice', () => {
    assert.equal(officeAct.buildBeat({ npc_key: 'lucy' }, 'announce_in_office'), null);
  });

  it('throttles repeat calls to the same room', () => {
    const sent = [];
    officeAct.configure({ broadcast: (msg) => sent.push(msg) });
    const first = officeAct.noteToolCall({ npc_key: '_team', label: 'chatgpt' }, 'crm_list', 1000);
    const second = officeAct.noteToolCall({ npc_key: '_team', label: 'chatgpt' }, 'crm_list', 2000);
    const later = officeAct.noteToolCall({ npc_key: '_team', label: 'chatgpt' }, 'run_skill', 3000);
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(later.room, 'desk');
    assert.equal(sent.length, 2);
  });
});
