'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'studio-board', 'index.html');

describe('studio board table status + waiting notes', () => {
  it('lets table rows change status inline', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /function inlineStatus\s*\(/);
    assert.match(html, /function statusOpts\s*\(/);
    assert.match(html, /onchange="inlineStatus\('/);
    assert.match(html, /class="ssel"/);
  });

  it('shows a Notes column for Waiting / Blocked reasons', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /function notesCell\s*\(/);
    assert.match(html, /function inlineWaitNote\s*\(/);
    assert.match(html, /<th>Notes<\/th><th>Action<\/th>/);
    assert.match(html, /Why waiting/);
    assert.match(html, /colspan="10"/);
  });

  it('keeps waiting reasons on status change and shares action verbs', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /function actionVerb\s*\(/);
    assert.match(html, /isWaitingStage\(ns\)/);
    assert.match(html, /Waiting note updated/);
  });
});
