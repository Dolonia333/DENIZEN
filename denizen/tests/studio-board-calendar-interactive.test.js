'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'studio-board', 'index.html'), 'utf8');

describe('Studio Board calendar interactivity', () => {
  it('supports drag-to-reschedule on calendar days', () => {
    assert.match(html, /function calDragStart/);
    assert.match(html, /function calMoveTask/);
    assert.match(html, /function wireCalInteractions/);
    assert.match(html, /draggable="true"/);
    assert.match(html, /data-date=/);
  });

  it('carries overdue onto Today with a reschedule strip', () => {
    assert.match(html, /function overdueOpenTasks/);
    assert.match(html, /function calCarryHTML/);
    assert.match(html, /cal-carry/);
    assert.match(html, /carry\?'carry'/);
    assert.match(html, /calTaskPill\(t,\s*\{\s*carry:\s*true\s*\}\)/);
  });

  it('places timed tasks on the week grid', () => {
    assert.match(html, /wk-evt wk-task/);
    assert.match(html, /t\.dueTime/);
    assert.match(html, /timedTasks/);
  });

  it('shows day load / conflict heat cues', () => {
    assert.match(html, /function dayLoadMeta/);
    assert.match(html, /cal-cell\.load3/);
    assert.match(html, /cal-cell\.conflict/);
    assert.match(html, /cal-legend-heat/);
  });

  it('adds day-panel advance, reschedule, and client filter', () => {
    assert.match(html, /function filterClient/);
    assert.match(html, /openReschedule\('\$\{t\.id\}'\)/);
    assert.match(html, /advance\('\$\{t\.id\}'\)/);
    assert.match(html, /Filter \$\{esc\(c\)\}/);
  });

  it('supports richer meeting edit (time, client, duration, repeat)', () => {
    assert.match(html, /function openMeetingEdit/);
    assert.match(html, /function saveMeetingEdit/);
    assert.match(html, /id="mtOverlay"/);
    assert.match(html, /id="me-duration"/);
    assert.match(html, /id="me-client"/);
    assert.match(html, /id="me-rep"/);
  });
});
