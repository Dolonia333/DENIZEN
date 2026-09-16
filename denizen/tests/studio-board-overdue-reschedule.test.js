'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'studio-board/index.html'), 'utf8');

describe('Studio Board overdue reschedule', () => {
  it('offers auto next-available and open-availability list from My Day', () => {
    assert.match(html, /id="rsOverlay"/);
    assert.match(html, /onclick="autoRescheduleNext\(\)"/);
    assert.match(html, /Open availabilities on your schedule/);
    assert.match(html, /onclick="openReschedule\(\)"/);
    assert.match(html, /function findOpenAvailabilities\(/);
    assert.match(html, /function nextAvailableSlot\(/);
    assert.match(html, /function openReschedule\(/);
    assert.match(html, /function autoRescheduleNext\(/);
    assert.match(html, /function pickRescheduleSlot\(/);
    assert.match(html, /mdresched/);
    assert.match(html, /dueTime/);
    assert.doesNotMatch(html, /Reschedule all to today/);
  });

  it('wires Escape and backdrop close for the reschedule modal', () => {
    assert.match(html, /closeReschedule\(\)/);
    assert.match(html, /'rsOverlay'/);
    assert.match(html, /if\(e\.key==='Escape'\)\{[^}]*closeReschedule\(\)/);
    assert.match(html, /getElementById\('rsOverlay'\)\.addEventListener\('click'/);
  });

  it('skips busy meeting slots and returns the next free workday time', () => {
    const start = html.indexOf('const SCHEDULE =');
    const end = html.indexOf('ui.rsTaskIds=null');
    assert.ok(start > 0 && end > start, 'schedule helpers block present');
    const helpers = html.slice(start, end);

    // "Today" is Sunday so past-time filtering (wall clock) never applies to
    // the Monday–Wednesday workdays we assert against.
    const events = [
      { kind: 'meeting', date: '2026-09-16', time: '09:00', duration: 60 },
      { kind: 'meeting', date: '2026-09-16', time: '10:00', duration: 30 },
    ];
    const sandbox = {
      state: { events },
      todayISO: () => '2026-09-13', // Sunday
      addDays: (iso, n) => {
        const [y, m, d] = iso.split('-').map(Number);
        const x = new Date(y, m - 1, d + n);
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      },
      eventsOn: (dateStr) => events.filter((e) => e.date === dateStr),
    };
    vm.createContext(sandbox);
    vm.runInContext(helpers, sandbox);

    const slots = sandbox.openSlotsOn('2026-09-16', []);
    assert.ok(!slots.includes('09:00'), '09:00 blocked by meeting');
    assert.ok(!slots.includes('09:30'), '09:30 still inside 60m meeting');
    assert.ok(!slots.includes('10:00'), '10:00 blocked by second meeting');
    assert.equal(slots[0], '10:30');

    const reserved = {};
    sandbox.reserveSlot(reserved, '2026-09-16', '10:30');
    const after = sandbox.openSlotsOn('2026-09-16', reserved['2026-09-16']);
    assert.equal(after[0], '11:00');

    const next = sandbox.nextAvailableSlot();
    assert.equal(next.date, '2026-09-14'); // Monday after Sunday "today"
    assert.equal(next.time, '09:00');

    // Weekend should yield no slots (compare length — vm realm arrays fail deepEqual)
    assert.equal(sandbox.openSlotsOn('2026-09-19', []).length, 0); // Saturday
  });
});
