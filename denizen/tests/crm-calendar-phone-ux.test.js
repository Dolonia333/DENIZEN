'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calendarTab = fs.readFileSync(
  path.join(__dirname, '../crm/vendor/src/components/crm/CalendarTab.tsx'),
  'utf8',
);
const scheduleTab = fs.readFileSync(
  path.join(__dirname, '../crm/vendor/src/components/crm/ScheduleTab.tsx'),
  'utf8',
);
const subTabNav = fs.readFileSync(
  path.join(__dirname, '../crm/vendor/src/components/crm/shared/SubTabNav.tsx'),
  'utf8',
);

describe('CRM calendar phone UX', () => {
  it('uses resize-aware mobile detection', () => {
    assert.match(calendarTab, /useIsMobile/);
    assert.match(calendarTab, /mobilePanel/);
    assert.match(scheduleTab, /useIsMobile/);
    assert.match(scheduleTab, /mobilePanel/);
  });

  it('stacks month calendar and day detail on phone', () => {
    assert.match(calendarTab, /mobilePanel === "calendar"/);
    assert.match(calendarTab, /mobilePanel === "day"/);
    assert.match(calendarTab, /Day detail/);
  });

  it('renders a phone-friendly week list instead of only a 7-column grid', () => {
    assert.match(calendarTab, /isMobile \? \(/);
    assert.match(calendarTab, /Open →/);
    assert.match(calendarTab, /No meetings/);
    assert.match(scheduleTab, /Open →/);
    assert.match(scheduleTab, /No meetings/);
  });

  it('makes booking and meeting modals single-column on phone', () => {
    assert.match(calendarTab, /isMobile \? "1fr" : "1fr 1fr"/);
    assert.match(calendarTab, /min\(520px, calc\(100vw - 24px\)\)|width: isMobile \? "100%"/);
  });

  it('keeps meeting template chips on their own wrapping row', () => {
    assert.match(calendarTab, /Meeting templates — own row/);
    assert.match(calendarTab, /flexWrap: "wrap"/);
    assert.match(calendarTab, /zIndex: 10050/);
    assert.match(scheduleTab, /flexWrap: "wrap"/);
    assert.match(scheduleTab, /zIndex: 10050/);
  });

  it('uses short weekday headers and bottom-sheet modals on phone', () => {
    assert.match(calendarTab, /\(\["S", "M", "T", "W", "T", "F", "S"\]/);
    assert.match(scheduleTab, /\(\["S", "M", "T", "W", "T", "F", "S"\]/);
    assert.match(scheduleTab, /borderRadius: "16px 16px 0 0"/);
    assert.match(scheduleTab, /safe-area-inset-bottom/);
  });

  it('keeps schedule sub-nav horizontally scrollable on narrow screens', () => {
    assert.match(subTabNav, /overflowX: "auto"/);
    assert.match(subTabNav, /whiteSpace: "nowrap"/);
  });
});
