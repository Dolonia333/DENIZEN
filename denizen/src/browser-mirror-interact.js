'use strict';
/**
 * Pure helpers for interactive Lucy browser-mirror (Watch / Drive / Point).
 * Shared by browser panel + Node tests.
 */

const INTERACT_MODES = ['watch', 'drive', 'point'];

function normalizeInteractMode(mode) {
  const m = String(mode || 'watch').toLowerCase();
  return INTERACT_MODES.includes(m) ? m : 'watch';
}

/**
 * Build a computer-use instruction when the CEO points at the mirror.
 * @param {{ x: number, y: number, text: string, url?: string|null, title?: string|null, query?: string|null }} opts
 */
function buildPointInstruction(opts = {}) {
  const x = Math.round(Number(opts.x) || 0);
  const y = Math.round(Number(opts.y) || 0);
  const text = String(opts.text || '').trim();
  if (!text) return '';
  return [
    `The CEO pointed at approximately (${x}, ${y}) on your live browser page.`,
    opts.url ? `Page URL: ${opts.url}` : '',
    opts.title ? `Page title: ${opts.title}` : '',
    opts.query ? `Research context: ${opts.query}` : '',
    '',
    `They want you to: ${text}`,
    '',
    'Focus on the UI near those coordinates. Screenshot first, then click/read/type only as needed for that request.',
    'When finished, summarize what you found or did.',
  ].filter((line) => line !== undefined && line !== null).join('\n');
}

/**
 * Human label for interact mode.
 * @param {string} mode
 */
function interactModeHint(mode) {
  switch (normalizeInteractMode(mode)) {
    case 'drive':
      return 'Drive — tap to click · drag/wheel to scroll · type below or focus the screen';
    case 'point':
      return 'Point — tap something, then tell Lucy what to do with it';
    default:
      return 'Watch — live research feed (switch to Drive or Point to interact)';
  }
}

const api = {
  INTERACT_MODES,
  normalizeInteractMode,
  buildPointInstruction,
  interactModeHint,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.DenizenBrowserMirrorInteract = api;
}
