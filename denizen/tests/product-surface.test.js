'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Denizen customer product surface', () => {
  it('landing names the five offers and three product objects', () => {
    const html = read('landing.html');
    assert.match(html, /What you get/);
    assert.match(html, /The Floor/);
    assert.match(html, /The Workbench/);
    assert.match(html, />Buzz</);
    assert.match(html, /Your AIs/);
    assert.match(html, /Business tools/);
    assert.match(html, /Meet Buzz/);
    assert.match(html, /meet-layout/);
    assert.match(html, /provider-pill/);
    assert.match(html, /mb-orb/);
    assert.match(html, /The ring opens as in the office/);
    assert.match(html, /ti-screenshot/);
    assert.match(html, /You do the work only you can do/);
    assert.match(html, /Claude/);
    assert.match(html, /Cursor/);
    assert.match(html, /LM Studio/);
    assert.match(html, /less tab-hopping/i);
    assert.match(html, /Ready to buzz you in/);
    assert.doesNotMatch(html, /press B/);
    assert.match(html, /Ask before you walk in/);
    assert.match(html, /npc-portrait/);
    assert.match(html, /offer-act is-on/);
    assert.match(html, /offer-wb-card/);
    assert.match(html, /role="tablist"/);
    assert.match(html, /See who is working without opening Slack or logs/);
    assert.match(html, /assets\/brands\/anthropic\.svg/);
    assert.match(html, /assets\/brands\/openai\.svg/);
    assert.match(html, /assets\/brands\/lmstudio\.svg/);
    const brands = ['anthropic', 'openai', 'cursor', 'xai', 'gemini', 'kimi', 'lmstudio'];
    for (const slug of brands) {
      assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'brands', `${slug}.svg`)), slug);
    }
    assert.match(html, /function officeHref/);
    assert.match(html, /Try the tools in the live demo/);
    assert.match(html, /buy four times/i);
    assert.doesNotMatch(html, /The work is real\./);
    assert.match(html, /Lid-closed jobs/);
    assert.doesNotMatch(html, /Meeting record — Desktop soon/);
    assert.doesNotMatch(html, /disabled title="Meeting record/);
    assert.match(html, /\/office\?demo=1/);
    assert.match(html, /demo=1&buzz=/);
    assert.match(html, /Leave invisible/);
    assert.match(html, /office stores a copy/);
    assert.match(html, /Is Buzz free/);
    assert.match(html, /Does my code leave the laptop/);
    assert.match(html, /What Abby sees/);
    assert.match(html, /docs\/TELEMETRY\.md/);
    assert.match(html, /Seat an AI in the demo/);
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'TELEMETRY.md')));
  });

  it('office chrome loads Buzz capture and the workbench rail', () => {
    const index = read('index.html');
    assert.match(index, /buzz-capture\.js/);
    assert.match(index, /work-rail\.js/);
    const lazy = read('src/denizen-lazy-scripts.js');
    assert.match(lazy, /seat-ai\.js/);
    const phone = read('src/denizen-phone-ui.js');
    assert.match(phone, /id: 'workbench'/);
    assert.match(phone, /bindBuzzFab/);
    const buzz = read('src/buzz-capture.js');
    assert.match(buzz, /\/api\/context-drop/);
    assert.match(buzz, /getDisplayMedia/);
    assert.match(buzz, /startMeeting/);
    assert.match(buzz, /params.get\('buzz'\)/);
    assert.match(buzz, /class="bz-ico"/);
    assert.match(buzz, /-90 \+ \(360 \* i\)/);
    assert.doesNotMatch(buzz, /Meeting record — Desktop soon/);
    const rail = read('src/work-rail.js');
    assert.match(rail, /Orchestrator|Abby/);
    assert.match(rail, /Seat an AI/);
    assert.match(rail, /data-wr="seat"/);
  });

  it('server exposes context-drop and workbench routes', () => {
    const server = read('server.js');
    assert.match(server, /\/api\/context-drop/);
    assert.match(server, /\/api\/workbench/);
    assert.match(server, /require\('\.\/src\/context-drop'\)/);
    assert.match(server, /\/api\/seat-ai/);
    const overlay = read('desktop/buzz-overlay.js');
    assert.match(overlay, /alwaysOnTop/);
    assert.match(overlay, /buzz-overlay\.html/);
    assert.match(overlay, /setInvisible/);
  });
});
