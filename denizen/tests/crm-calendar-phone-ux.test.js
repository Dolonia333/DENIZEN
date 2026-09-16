'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calendarTab = fs.readFileSync(
  path.join(__dirname, '../crm/vendor/src/components/crm/CalendarTab.tsx'),
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
  });

  it('makes booking and meeting modals single-column on phone', () => {
    assert.match(calendarTab, /isMobile \? "1fr" : "1fr 1fr"/);
    assert.match(calendarTab, /min\(520px, calc\(100vw - 24px\)\)/);
  });

  it('keeps schedule sub-nav horizontally scrollable on narrow screens', () => {
    assert.match(subTabNav, /overflowX: "auto"/);
    assert.match(subTabNav, /whiteSpace: "nowrap"/);
  });
});
