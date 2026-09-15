'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('CRM calendar & chart detail upgrades', () => {
  it('calendar supports layer toggles and this-week snapshot', () => {
    const src = read('crm/vendor/src/components/crm/CalendarTab.tsx');
    assert.match(src, /const \[layers, setLayers\]/);
    assert.match(src, /toggleLayer/);
    assert.match(src, /Busy days \(2\+ mtgs\)/);
    assert.match(src, /layers\.meetings/);
    assert.match(src, /layers\.tasks/);
    assert.match(src, /layers\.deals/);
    assert.match(src, /layers\.overdue/);
    assert.match(src, /meta:/);
  });

  it('analytics funnel includes step conversion and drop-off table', () => {
    const src = read('crm/vendor/src/components/crm/AnalyticsTab.tsx');
    assert.match(src, /stepRate/);
    assert.match(src, /dropOff/);
    assert.match(src, /Conversion Funnel/);
    assert.match(src, /from prior/);
    assert.match(src, /Step conv/);
  });

  it('dashboard charts tooltip shows deal counts', () => {
    const src = read('crm/vendor/src/components/crm/DashboardCharts.tsx');
    assert.match(src, /in stage/);
    assert.match(src, /row\.count/);
    assert.match(src, /open deals/);
    assert.match(src, /hover for value \+ count/);
  });

  it('pipeline velocity shows stage occupancy ladder', () => {
    const src = read('crm/vendor/src/components/crm/PipelineVelocity.tsx');
    assert.match(src, /Stage occupancy ladder/);
    assert.match(src, /live snapshot/);
    assert.match(src, /% of open/);
  });

  it('calendar stacks month grid on mobile', () => {
    const src = read('crm/vendor/src/components/crm/CalendarTab.tsx');
    assert.match(src, /useIsMobile/);
    assert.match(src, /mobilePanel/);
    assert.match(src, /isMobile \? "block" : "grid"/);
    assert.match(src, /isMobile \? "1fr" : "1fr 1fr"/);
  });

  it('analytics shows empty states and compact KPI rings', () => {
    const src = read('crm/vendor/src/components/crm/AnalyticsTab.tsx');
    assert.match(src, /DashboardEmptyState/);
    assert.match(src, /MiniRing/);
    assert.match(src, /No contacts yet/);
    assert.match(src, /No trend history yet/);
  });

  it('lead scoring uses colored distribution and accuracy rings', () => {
    const src = read('crm/vendor/src/components/crm/LeadGenTab.tsx');
    assert.match(src, /MiniRing/);
    assert.match(src, /No scored leads yet/);
    assert.match(src, /b\.color/);
  });

  it('schedule month view uses dots on mobile', () => {
    const src = read('crm/vendor/src/components/crm/ScheduleTab.tsx');
    assert.match(src, /useIsMobile/);
    assert.match(src, /isMobile \? \(/);
    assert.match(src, /events\.slice\(0, 4\)/);
  });

});
