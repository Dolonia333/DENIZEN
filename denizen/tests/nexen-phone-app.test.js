'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('NEXEN phone app', () => {
  it('ships as its own full-page app at /nexen/', () => {
    const html = read('nexen/index.html');
    assert.match(html, /NEXEN/);
    assert.match(html, /Command Center/);
    assert.match(html, /dz-app-chrome/);
    assert.match(html, /Back to office/);
    assert.match(html, /dz_sid/);
    assert.match(html, /body\.classList\.add\('standalone'\)/);
    assert.match(html, /\/api\/nexen\/hub/);
    assert.match(html, /\/api\/nexen\/request/);
    assert.match(html, /\/api\/nexen\/tasks/);
  });

  it('registers NEXEN as a navigate app like CRM + Studio Board', () => {
    const src = read('src/denizen-phone-ui.js');
    assert.match(src, /id: 'nexen'/);
    assert.match(src, /type: 'navigate'/);
    assert.match(src, /url: '\/nexen\/'/);
    assert.match(src, /PRIORITY_GRID_IDS = \[[^\]]*nexen/);
    assert.match(src, /SESSION_HANDOFF_NAV_IDS = new Set\(\[[^\]]*nexen/);
    assert.match(src, /LAYOUT_VERSION = 9/);
  });

  it('serves /nexen/ and /api/nexen/ from the Denizen server', () => {
    const srv = read('server.js');
    assert.match(srv, /mountNexenRoutes/);
    assert.match(srv, /urlPath\.startsWith\('\/api\/nexen\/'\)/);
    assert.match(srv, /urlPath === '\/nexen'/);
    assert.match(srv, /nexen/);
    assert.match(srv, /Location: '\/nexen\/'/);
    assert.match(srv, /Phone app navigates here like CRM \+ Studio Board \+ Business Studio/);
  });

  it('bumps the phone UI cache buster for NEXEN', () => {
    const idx = read('index.html');
    assert.match(idx, /denizen-phone-ui\.js\?v=phone42nexen/);
  });

  it('exposes org-scoped store helpers', () => {
    const store = require('../src/denizen-nexen-store');
    const empty = store.emptyState();
    assert.ok(Array.isArray(empty.requests));
    assert.ok(Array.isArray(empty.tasks));
    assert.ok(Array.isArray(empty.config.workspaces));
    const cleaned = store.sanitizeState({
      requests: [{ id: 'r1', text: 'Ship NEXEN', status: 'planned' }],
      tasks: [{ id: 't1', title: 'Wire phone tile', priority: 'urgent' }],
      junk: true,
    });
    assert.equal(cleaned.requests.length, 1);
    assert.equal(cleaned.tasks[0].priority, 'urgent');
    assert.equal(cleaned.junk, undefined);
  });

  it('builds hub summaries from workspace state', () => {
    const { hubSummary } = require('../src/denizen-nexen-routes');
    const store = require('../src/denizen-nexen-store');
    const state = store.sanitizeState({
      tasks: [
        { id: 't1', title: 'A', status: 'open', priority: 'urgent' },
        { id: 't2', title: 'B', status: 'done', priority: 'normal' },
      ],
      requests: [{ id: 'r1', text: 'Plan', status: 'planned' }],
    });
    const hub = hubSummary(state, 'cloud', 'org_demo');
    assert.equal(hub.ok, true);
    assert.equal(hub.status.open_tasks, 1);
    assert.equal(hub.status.urgent_tasks, 1);
    assert.equal(hub.status.planned_requests, 1);
    assert.equal(hub.org_id, 'org_demo');
  });
});
