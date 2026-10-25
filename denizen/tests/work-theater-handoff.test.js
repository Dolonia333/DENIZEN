'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Work theater + research handoff', () => {
  it('office can carry a research brief and run the demo showcase', () => {
    const actions = read('src/agent-actions.js');
    assert.match(actions, /runResearchHandoff\(/);
    assert.match(actions, /_holdBriefFolder\(/);
    assert.match(actions, /deliverHandoffBrief\(/);
    assert.match(actions, /setDeskStatus\(/);

    const mgr = read('src/agent-office-manager.js');
    assert.match(mgr, /_seedWorkTheaterShowcase\(/);
    assert.match(mgr, /runWorkTheaterDemo\(/);
    assert.match(mgr, /_playResearchingTheater\(/);
    assert.match(mgr, /_playResearchHandoffTheater\(/);
    assert.match(mgr, /_forceCoffeeFavor\(/);
    assert.match(mgr, /__DenizenRunWorkTheaterDemo/);
  });

  it('MCP send_handoff accepts a research document', () => {
    const tools = read('src/denizen-mcp-team-tools.js');
    assert.match(tools, /document:/);
    assert.match(tools, /brief_id/);
    assert.match(tools, /assistant_handoff/);

    const schema = JSON.parse(read('mcps/denizen-team/tools/send_handoff.json'));
    assert.equal(schema.name, 'send_handoff');
    assert.ok(schema.inputSchema.properties.document);
    assert.ok(schema.inputSchema.properties.document.properties.title);
  });

  it('cache busters bumped for work theater', () => {
    const html = read('index.html');
    assert.match(html, /agent-actions\.js\?v=floorBounds1/);
    assert.match(html, /agent-office-manager\.js\?v=engineTools1/);
  });
});
