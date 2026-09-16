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

  it('landing conversion doors: hero, how, seat, team, buyer FAQ', () => {
    const html = read('landing.html');
    assert.match(html, /class="hero-actions"/);
    assert.match(html, /Open live demo/);
    assert.match(html, /Download Desktop/);
    assert.match(html, /No new subscriptions\. Named staff/);
    assert.match(html, /id="how-you-start"/);
    assert.match(html, /Walk in\. Seat an AI\. Buzz Abby/);
    assert.match(html, /id="seat-ais"/);
    assert.match(html, /Import never auto-runs/);
    assert.match(html, /Talk to Zion on Discord/);
    assert.match(html, /What does it cost\?/);
    assert.match(html, /Do I need Desktop\?/);
    assert.match(html, /Does the laptop have to stay on\?/);
    assert.match(html, /Do I pay for new models\?/);
    assert.match(html, /Brief Abby in the office/);
    assert.match(html, /class="hud-actions"/);
    assert.match(html, /id="tour-step-how-you-start"/);
    assert.match(html, /id="tour-step-seat-ais"/);
    assert.match(html, /id="tour-step-meet-buzz"/);
    assert.match(html, /function tourShouldFade/);
    assert.match(html, /TOUR_STEPS = \['how-you-start', 'seat-ais', 'meet-buzz'\]/);
    assert.doesNotMatch(html, /id="tour-step-compare"/);
    assert.match(html, /translate\(-50%, -50%\) rotate\(calc\(var\(--i\) \* 60deg - 90deg\)\)/);
    assert.doesNotMatch(html, /id="your-ais"/);
    assert.doesNotMatch(html, /Michael/);
    assert.doesNotMatch(html, /Stapler/);
    assert.doesNotMatch(html, /\bclones?\b/i);
    assert.doesNotMatch(html, /\$\d/);
    const faqIdx = html.indexOf('id="faq"');
    const privacyIdx = html.indexOf('id="privacy"');
    const comingIdx = html.indexOf('id="coming"');
    assert.ok(privacyIdx > 0 && faqIdx > privacyIdx && faqIdx < comingIdx, 'FAQ after privacy, before coming');
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
    assert.match(buzz, /startMicOnlyMeeting/);
    assert.match(buzz, /isPhoneUi/);
    assert.match(buzz, /useHoverDismiss/);
    assert.match(buzz, /pointer-events: none !important/);
    assert.match(buzz, /pointerdown/);
    assert.match(buzz, /pickImageFile\(\{ crop: true \}\)/);
    assert.match(buzz, /params.get\('buzz'\)/);
    assert.match(buzz, /class="bz-ico"/);
    assert.match(buzz, /-90 \+ \(360 \* i\)/);
    assert.doesNotMatch(buzz, /Meeting record — Desktop soon/);
    assert.match(buzz, /id: 'phone'/);
    assert.match(buzz, /DenizenPhoneUi\?\.open/);
    assert.match(buzz, /OPEN_GUARD_MS/);
    assert.match(buzz, /recentlyOpened/);
    assert.match(buzz, /if \(!isPhoneUi\(\)\)/);
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

  it('landing boots once per session and does not auto-start Lucy', () => {
    const html = read('landing.html');
    assert.match(html, /sessionStorage\.getItem\(BOOT_KEY\)/);
    assert.match(html, /sessionStorage\.setItem\(BOOT_KEY/);
    assert.doesNotMatch(html, /sessionStorage\.removeItem\('denizen-landing-boot'\)/);
    assert.match(html, /CLICK TO SKIP/);
    assert.match(html, /Click to talk — Lucy is at the desk/);
    assert.match(html, /Lucy talks only after the visitor clicks reception/);
    assert.match(html, /howInView/);
    assert.match(html, /max-width: 960px\) \{\s*\.tour-bar \{ display: none/);
    assert.match(html, /max-width: 900px\) \{\s*\.how-beats \{ grid-template-columns: 1fr/);
    assert.match(html, /Lid-closed jobs/);
    assert.match(html, /id="coming"[\s\S]*Talk to Zion on Discord →[\s\S]*Remote office/);
    assert.match(html, /provider=cursor/);
    assert.match(html, /provider=claude/);
    assert.match(html, /provider=grok/);
    assert.match(html, /provider=lmstudio/);
  });

  it('download page falls back to Discord when installers 404', () => {
    const html = read('desktop/download.html');
    assert.match(html, /method:\s*['"]HEAD['"]/);
    assert.match(html, /Talk to Zion on Discord/);
    assert.match(html, /discord\.gg\/999pPp6yMu/);
    assert.match(html, /desktop\//);
    assert.match(html, /aria-disabled/);
    assert.match(html, /--lime/);
    assert.match(html, /Syne/);
    assert.match(html, /download-fallback/);
  });

  it('desktop first launch can open Seat an AI for detected providers', () => {
    const main = read('desktop/main.js');
    assert.match(main, /consumeSeatPrompt/);
    assert.match(main, /anySeatAiDetected/);
    assert.match(main, /searchParams\.set\(['"]seat['"], ['"]1['"]\)/);
    const seat = read('src/seat-ai.js');
    assert.match(seat, /params\.get\('provider'\)/);
    assert.match(seat, /is-found/);
    assert.match(seat, /Found on this machine/);
    assert.match(seat, /is-highlight/);
  });
});
