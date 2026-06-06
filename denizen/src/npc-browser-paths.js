'use strict';

const path = require('node:path');
const jellyPaths = require('../jelly/paths');

function normalizeNpcKey(npc) {
  const raw = String(npc || 'lucy').toLowerCase().replace(/^xp_/, '');
  return raw.replace(/[^a-z0-9_-]/g, '') || 'lucy';
}

function getNpcBrowserPaths(npcKey) {
  const key = normalizeNpcKey(npcKey);
  const browserDir = jellyPaths.browserDir();
  const canvasDir = jellyPaths.canvasDir();
  return {
    npcKey: key,
    stateFile: path.join(browserDir, `${key}-mirror-state.json`),
    frameFile: path.join(canvasDir, `${key}-mirror-live.png`),
    streamFile: path.join(canvasDir, `${key}-mirror-live.jpg`),
  };
}

module.exports = { normalizeNpcKey, getNpcBrowserPaths };
