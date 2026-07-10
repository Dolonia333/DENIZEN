/**
 * Browser: ?mode=demo or ?demo=1 — 4-NPC read-only spectator (Phase 4.1 scaffold).
 * Load immediately after npc-roster.js.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const active = params.get('mode') === 'demo' || params.get('demo') === '1';
  if (!active) {
    globalThis.DenizenPublicDemo = { active: false };
    return;
  }

  const defaultFolders = ['abby', 'alex', 'lucy', 'bouncer'];
  const raw = params.get('demo_npcs') || params.get('npcs') || '';
  const folders = raw
    ? raw.split(/[,;|]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    : defaultFolders;

  function applyRosterFilter() {
    const base = globalThis.DenizenNpcRoster;
    if (!base || !Array.isArray(base.entries)) return;
    const allow = new Set(folders);
    const entries = base.entries.filter((e) => allow.has(e.folder));
    if (!entries.length) return;
    const nameToKey = Object.fromEntries(entries.map((e) => [e.display.toLowerCase(), e.textureKey]));
    const keyToDisplay = Object.fromEntries(entries.map((e) => [e.textureKey, e.display]));
    base.entries = entries;
    base.nameToKey = nameToKey;
    base.keyToDisplay = keyToDisplay;
    base.displayNames = entries.map((e) => e.display);
    base.assetNames = entries.map((e) => e.assetName);
    base.displayToGender = Object.fromEntries(entries.map((e) => [e.display, e.gender || null]));
  }

  applyRosterFilter();

  globalThis.DenizenPublicDemo = {
    active: true,
    readOnly: true,
    npcFolders: folders,
    label: 'Public demo — watch the office (chat disabled). Team login for full access.',
  };

  document.documentElement.classList.add('denizen-public-demo');
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.id = 'denizen-public-demo-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:100800',
      'padding:6px 12px', 'text-align:center', 'font:11px ui-monospace,monospace',
      'background:rgba(30,58,138,0.92)', 'color:#bfdbfe', 'border-bottom:1px solid #3b82f6',
    ].join(';');
    banner.innerHTML = `${globalThis.DenizenPublicDemo.label} `
      + `<a href="/office?login=1" style="color:#fff;margin-left:10px;font-weight:700;text-decoration:underline;">Sign in for full office →</a>`;
    document.body.prepend(banner);
  });
})();
