'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'studio-board', 'index.html');

describe('studio board calendar click + activity detail', () => {
  it('uses local calendar dates instead of UTC toISOString', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /function dateToISO\s*\(/);
    assert.match(html, /function ymdISO\s*\(/);
    assert.match(html, /function todayISO\(\)\{\s*return dateToISO\(new Date\(\)\);/);
    assert.match(html, /dateStr=ymdISO\(ui\.calY,ui\.calM,dnum\)/);
    assert.doesNotMatch(
      html,
      /dateStr=new Date\(ui\.calY,ui\.calM,dnum\)\.toISOString\(\)\.slice\(0,10\)/
    );
  });

  it('makes overflow and meeting pills reliably clickable', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /class="more" onclick="event\.stopPropagation\(\);selectDay\(/);
    assert.match(html, /\.evt\{[^}]*cursor:pointer/);
    assert.match(html, /onclick="openMeetingEdit\('\$\{e\.id\}'\)"/);
  });

  it('categorizes Activity and opens meetings from the feed', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /function activityCategory\s*\(/);
    assert.match(html, /function openActivityItem\s*\(/);
    assert.match(html, /function logBoard\s*\(/);
    assert.match(html, /Meeting scheduled/);
    assert.match(html, /setActivityCat/);
    assert.match(html, /fdcatbtn/);
  });
});
