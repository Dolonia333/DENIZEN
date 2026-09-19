'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'studio-board', 'index.html'), 'utf8');

describe('studio-board table priority + notes', () => {
  it('Priority column is an inline dropdown like Status', () => {
    assert.match(html, /function prioOpts\(/);
    assert.match(html, /function inlinePrio\(/);
    assert.match(html, /class="psel prio-/);
    assert.match(html, /onchange="inlinePrio\('/);
    assert.match(html, /\.psel\{/);
  });

  it('Notes column shows emoji and opens a view/edit modal', () => {
    assert.match(html, /function notesCell\(/);
    assert.match(html, /notes-ico/);
    assert.match(html, /openTableNotes\('/);
    assert.match(html, /id="notesOverlay"/);
    assert.match(html, /function saveTableNotes\(/);
    assert.match(html, /<th>Notes<\/th>/);
    assert.match(html, /t-notes/);
  });

  it('Status can be changed from table view', () => {
    assert.match(html, /function inlineStatus\(/);
    assert.match(html, /function statusOpts\(/);
    assert.match(html, /class="ssel"/);
  });
});
