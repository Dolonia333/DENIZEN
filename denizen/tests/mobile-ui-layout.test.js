'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('mobile UI layout fixes', () => {
  it('chat header hosts actions in a dedicated row', () => {
    const chat = read('src/player-chat.js');
    assert.match(chat, /id="player-chat-header-actions"/);
    assert.match(chat, /_ensureChatHeaderActions/);
    assert.match(chat, /overflow:\s*hidden/);
    assert.match(chat, /padding-top:\s*0/);
    assert.match(chat, /pc-floor-kicker/);
  });

  it('touch header stays a single thin row with horizontal actions', () => {
    const chat = read('src/player-chat.js');
    assert.match(
      chat,
      /html\.denizen-touch #player-chat-header \{[\s\S]*?grid-template-areas:\s*"avatar main actions"/
    );
    const actionBlocks = [...chat.matchAll(
      /html\.denizen-touch #player-chat-header-actions \{([^}]+)\}/g
    )].map((m) => m[1]);
    assert.ok(actionBlocks.length >= 1, 'expected touch header-actions rules');
    assert.ok(
      actionBlocks.some((block) => /flex-direction:\s*row/.test(block)),
      'touch header-actions should use a horizontal row'
    );
    assert.ok(
      actionBlocks.every((block) => !/flex-direction:\s*column/.test(block)),
      'touch header-actions must not stack buttons in a column'
    );
    assert.match(chat, /denizen-visitor-assistant-chip[\s\S]*?display:\s*none !important/);
    assert.match(chat, /padding:\s*12px/);
    assert.match(chat, /border-radius:\s*999px/);
    assert.match(chat, /#4ade80,\s*#16a34a/);
  });

  it('Projects, Connect AI, Hand off, and Briefing mount into header-actions', () => {
    const projects = read('src/visitor-projects-ui.js');
    const mcp = read('src/visitor-mcp-connect-ui.js');
    const handoff = read('src/visitor-handoff-ui.js');
    const briefing = read('src/visitor-briefing-ui.js');
    assert.match(projects, /player-chat-header-actions/);
    assert.match(mcp, /player-chat-header-actions/);
    assert.match(handoff, /player-chat-header-actions/);
    assert.match(briefing, /player-chat-header-actions/);
  });

  it('removes the green Your assistant chip from Floor Line', () => {
    const claim = read('src/visitor-claim-ui.js');
    const chat = read('src/player-chat.js');
    assert.match(claim, /Floor Line no longer shows the green/);
    assert.match(chat, /pc-floor-kicker/);
    assert.match(chat, /#player-chat-panel::before \{ content: none/);
    assert.doesNotMatch(chat, /"chip chip chip"/);
    assert.match(chat, /display: none !important/);
  });

  it('HQ PASS login avoids transform on touch so Safari autofill stays anchored', () => {
    const session = read('src/visitor-session.js');
    assert.match(session, /denizen-keyboard-open/);
    assert.match(session, /--denizen-keyboard-inset/);
    assert.match(session, /transform: none !important/);
  });

  it('HQ PASS login card is the sticky-button scroll container', () => {
    const session = read('src/visitor-session.js');
    assert.match(session, /Card scrolls so sticky Log in stays inside the amber ring/);
    assert.match(session, /max-height: calc\(100dvh - 56px/);
    assert.match(session, /0 -14px 20px rgba\(2, 6, 23, 0\.92\)/);
  });

  it('game canvas is absolutely pinned to kill letterbox gaps', () => {
    const html = read('index.html');
    assert.match(html, /#game-container canvas \{[^}]*position:\s*absolute;/s);
    assert.match(html, /#game-container canvas \{[^}]*display:\s*block;/s);
  });

  it('portrait phones keep HQ centered mid-screen even when chat is open', () => {
    const mobile = read('src/mobile-controls.js');
    assert.match(
      mobile,
      /html\.denizen-touch\.denizen-portrait body \{[\s\S]*?align-items:\s*center/
    );
    assert.match(
      mobile,
      /denizen-portrait\.denizen-chat-open body \{[\s\S]*?align-items:\s*center/
    );
    assert.match(
      mobile,
      /denizen-portrait\.denizen-chat-open body \{[\s\S]*?padding-bottom:\s*calc\(/
    );
    assert.match(mobile, /--denizen-vv-h/);
    assert.match(mobile, /syncVisualViewport/);
    const html = read('index.html');
    assert.match(html, /mobile-controls\.js\?v=mapFill10/);
  });

  it('landscape Floor Line is a compact left floating card so Buzz stays visible', () => {
    const chat = read('src/player-chat.js');
    const mobile = read('src/mobile-controls.js');
    assert.match(chat, /Landscape Floor Line: compact floating card on the LEFT/);
    assert.match(chat, /height:\s*min\(48dvh,\s*168px\)/);
    assert.match(chat, /width:\s*min\(300px/);
    assert.match(
      chat,
      /denizen-landscape\.denizen-chat-open #player-chat-panel:not\(\[data-phone-chat="1"\]\)\s*\{[\s\S]*?top:\s*auto !important/
    );
    assert.match(
      chat,
      /denizen-landscape\.denizen-chat-open #player-chat-panel:not\(\[data-phone-chat="1"\]\)\s*\{[\s\S]*?left:\s*max\(8px/
    );
    assert.match(
      chat,
      /denizen-landscape\.denizen-chat-open #player-chat-panel:not\(\[data-phone-chat="1"\]\)\s*\{[\s\S]*?right:\s*auto !important/
    );
    assert.match(mobile, /Landscape Floor Line: compact floating card on the LEFT/);
    assert.match(mobile, /html\.denizen-touch\.denizen-landscape \{[\s\S]*?--denizen-frame-chrome:\s*18px/);
    assert.match(
      chat,
      /denizen-chat-open:not\(\.denizen-phone-mode\):not\(\.denizen-landscape\)/
    );
    // Close btn must stay in actions — never a loose 4th header grid child
    assert.match(chat, /Close must live in the actions grid cell/);
    assert.match(chat, /actions\.appendChild\(closeBtn\)/);
    assert.doesNotMatch(
      chat,
      /if \(closeBtn\) header\.appendChild\(closeBtn\)/
    );
    assert.match(chat, /#player-chat-header > #player-chat-close-btn/);
  });

  it('landscape Floor Line keeps a tappable close on the floating card', () => {
    const chat = read('src/player-chat.js');
    const mobile = read('src/mobile-controls.js');
    assert.match(chat, /Landscape close: always tappable/);
    assert.match(
      chat,
      /denizen-landscape #player-chat-header-actions #player-chat-close-btn \{[\s\S]*?position:\s*absolute !important/
    );
    assert.match(
      chat,
      /denizen-landscape #player-chat-header-actions #player-chat-close-btn \{[\s\S]*?width:\s*36px !important/
    );
    assert.match(
      chat,
      /denizen-landscape #player-chat-header-actions \{[\s\S]*?max-width:\s*none !important/
    );
    assert.match(
      chat,
      /denizen-landscape\.denizen-chat-open #player-chat-panel:not\(\[data-phone-chat="1"\]\)\s*\{[\s\S]*?pointer-events:\s*auto !important/
    );
    assert.match(mobile, /Landscape close/);
    assert.match(
      mobile,
      /denizen-landscape #player-chat-header-actions #player-chat-close-btn \{[\s\S]*?36px/
    );
  });

  it('cache-busts Floor Line landscape fix scripts', () => {
    const html = read('index.html');
    assert.match(html, /player-chat\.js\?v=kbdFill3/);
    assert.match(html, /mobile-controls\.js\?v=mapFill10/);
  });

  it('Floor Line expands to the visual viewport when the soft keyboard opens', () => {
    const chat = read('src/player-chat.js');
    const mobile = read('src/mobile-controls.js');
    assert.match(chat, /Soft keyboard open: fill the visual viewport/);
    assert.match(
      chat,
      /denizen-keyboard-open\.denizen-chat-open #player-chat-panel:not\(\[data-phone-chat="1"\]\)\s*\{[\s\S]*?--denizen-vv-offset-top/
    );
    assert.match(
      chat,
      /denizen-keyboard-open\.denizen-chat-open #player-chat-panel:not\(\[data-phone-chat="1"\]\) #player-chat-log \{[\s\S]*?min-height:\s*140px/
    );
    assert.match(mobile, /classList\.toggle\('denizen-keyboard-open'/);
    assert.match(mobile, /--denizen-vv-offset-top/);
    assert.match(
      mobile,
      /denizen-keyboard-open\.denizen-chat-open #game-frame \{[\s\S]*?visibility:\s*hidden/
    );
  });

  it('phones reclaim map real estate; portrait Abby strip sits outside the HQ box', () => {
    const mobile = read('src/mobile-controls.js');
    const strip = read('src/floor-strip.js');
    const html = read('index.html');
    assert.match(mobile, /html\.denizen-touch\.denizen-phone \{[\s\S]*?--denizen-frame-chrome:\s*0px/);
    assert.match(mobile, /denizen-portrait body \{[\s\S]*?flex-direction:\s*column/);
    assert.match(mobile, /denizen-floor-strip/);
    assert.match(html, /--dz-floor-strip-h:\s*28px/);
    assert.match(strip, /frame\.insertAdjacentElement\('afterend'/);
    assert.match(strip, /map\.insertAdjacentElement\('afterend'/);
    assert.match(strip, /html\.denizen-touch #\$\{STRIP_ID\} \.dz-floor-line:nth-child\(n\+2\)/);
    assert.match(strip, /:not\(\.has-lines\) \{ display: none !important/);
    assert.match(strip, /kind-quiet \{ display: none !important/);
    assert.match(strip, /speech bubbles .* are separate/i);
    assert.match(strip, /raw\.from \|\| raw\.name/);
    assert.match(strip, /denizen-portrait #\$\{STRIP_ID\} \{[\s\S]*?position:\s*static/);
    assert.doesNotMatch(
      strip,
      /denizen-portrait #\$\{STRIP_ID\} \{[\s\S]*?position:\s*absolute/
    );
    assert.match(html, /denizen-touch\.denizen-phone #game-frame \.dz-frame-label/);
    assert.match(html, /floor-strip\.js\?v=mapFill10/);
  });

  it('HQ frame keeps its badge, clock, and level chip in a chrome row', () => {
    const html = read('index.html');
    assert.match(html, /id="denizen-frame-clock-slot"/);
    assert.match(html, /id="denizen-frame-level-slot"/);
    assert.match(html, /class="dz-frame-chrome"/);
    assert.match(html, /--dz-workbench-gutter:\s*44px/);
    assert.match(html, /--dz-banner-h:\s*0px/);
    assert.match(html, /#game-frame \.dz-frame-label \{[^}]*position:\s*static/s);
    assert.doesNotMatch(html, /dz-frame-label \{[^}]*top:\s*-1\dpx/s);
    assert.match(html, /DenizenFitOfficeFrame/);
    const chip = read('src/office-hq/office-level-chip.js');
    assert.match(chip, /denizen-frame-level-slot/);
    assert.match(chip, /position:\s*relative/);
    const rail = read('src/work-rail.js');
    assert.match(rail, /translate\(calc\(100% \+ 8px\), -50%\)/);
    assert.match(rail, /getElementById\('game-frame'\)/);
    const tod = read('src/city-tod.js');
    assert.match(tod, /denizen-frame-clock-slot/);
  });

  it('speech bubbles nudge away from neighbors', () => {
    const actions = read('src/agent-actions.js');
    assert.match(actions, /Nudge up when another live bubble/);
  });

  it('landscape cover-fills HQ; portrait keeps a compact 16:9 box that the canvas fills', () => {
    const html = read('index.html');
    const mobile = read('src/mobile-controls.js');
    const profile = read('src/device-profile.js');
    const scene = read('office-scene.js');
    // Landscape: chrome overlays + cover-scaled canvas into the full play rect
    assert.match(html, /map fills to the blue corner brackets/);
    assert.match(html, /html\.denizen-touch #game-frame \.dz-frame-chrome \{[\s\S]*?position:\s*absolute/);
    assert.match(html, /html\.denizen-touch #game-frame \{[\s\S]*?padding:\s*0/);
    assert.match(html, /html\.denizen-touch #game-container \{[\s\S]*?border:\s*none/);
    assert.match(html, /Apply touch layout classes before first paint/);
    assert.match(mobile, /coverPlayCanvas/);
    assert.match(mobile, /denizen-landscape #game-container \{[\s\S]*?width: var\(--denizen-play-w\) !important/);
    assert.match(mobile, /denizen-landscape #game-container \{[\s\S]*?height: var\(--denizen-play-h\) !important/);
    assert.match(mobile, /object-fit:cover/);
    // Portrait: compact 16:9 HQ card; cover-scale canvas to the corner brackets
    assert.match(
      mobile,
      /denizen-phone\.denizen-portrait #game-container \{[\s\S]*?16\s*\/\s*9/
    );
    assert.match(
      mobile,
      /denizen-touch:not\(\.denizen-landscape\) #game-container canvas \{[\s\S]*?width:\s*auto\s*!important/
    );
    assert.match(html, /denizen-portrait #game-frame \{[\s\S]*?padding:\s*0\s*!important/);
    // device-profile owns live zoom (whole numbers so walk sheets stay crisp);
    // office-scene keeps a fallback only when DenizenDeviceProfile is missing.
    assert.match(profile, /if \(prof\.isLandscape\) return 2/);
    assert.match(profile, /return 3/);
    assert.match(profile, /prof\.isTablet\) return prof\.isLandscape \? 3 : 2/);
    assert.match(scene, /isLandscape \? 2\.55/);
    assert.match(scene, /isCompactPhone \? 2\.65 : 2\.5/);
    assert.match(html, /device-profile\.js\?v=walkFix1/);
    assert.match(html, /office-scene\.js\?v=playSmooth1/);
    assert.match(html, /mobile-controls\.js\?v=mapFill10/);
  });

  it('portrait Floor Line starts below the HQ frame so it never overlaps the map', () => {
    const chat = read('src/player-chat.js');
    const mobile = read('src/mobile-controls.js');
    assert.match(
      chat,
      /denizen-phone-mode\.denizen-chat-open\.denizen-portrait #player-chat-panel:not\(\[data-phone-chat="1"\]\)\s*\{[\s\S]*?--denizen-game-frame-bottom/
    );
    assert.match(
      chat,
      /denizen-phone-mode\.denizen-chat-open\.denizen-portrait #player-chat-panel:not\(\[data-phone-chat="1"\]\)\s*\{[\s\S]*?max-height:\s*min\(34dvh,\s*260px\)/
    );
    assert.match(
      mobile,
      /denizen-portrait\.denizen-chat-open body \{[\s\S]*?padding-bottom:\s*calc\(/
    );
  });
});
