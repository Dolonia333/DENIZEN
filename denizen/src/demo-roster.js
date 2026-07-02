'use strict';

/**
 * Public hosted demo (?mode=demo) — reduced NPC set, read-only spectator mode.
 * @see docs/ROADMAP.md §4.1
 */

const DEFAULT_PUBLIC_DEMO_FOLDERS = ['abby', 'alex', 'lucy', 'bouncer'];

function parseFolderList(raw) {
  if (!raw || !String(raw).trim()) return [...DEFAULT_PUBLIC_DEMO_FOLDERS];
  return String(raw)
    .split(/[,;|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Trim loaded brains to demo roster only when explicitly opted in (CEO office keeps full team). */
function publicDemoNpcFolders(env = process.env) {
  if (!envBool(env.DENIZEN_PUBLIC_DEMO)) return null;
  if (!envBool(env.DENIZEN_PUBLIC_DEMO_TRIM_BRAINS)) return null;
  return parseFolderList(env.DENIZEN_PUBLIC_DEMO_NPCS);
}

function envBool(v) {
  if (v == null || v === '') return false;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function filterRosterEntries(entries, folders) {
  const allow = new Set(folders || DEFAULT_PUBLIC_DEMO_FOLDERS);
  return (entries || []).filter((e) => allow.has(e.folder));
}

function rebuildRosterMaps(entries) {
  const nameToKey = Object.fromEntries(entries.map((e) => [e.display.toLowerCase(), e.textureKey]));
  const keyToDisplay = Object.fromEntries(entries.map((e) => [e.textureKey, e.display]));
  return {
    entries,
    nameToKey,
    keyToDisplay,
    displayNames: entries.map((e) => e.display),
    assetNames: entries.map((e) => e.assetName),
    displayToGender: Object.fromEntries(entries.map((e) => [e.display, e.gender || null])),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_PUBLIC_DEMO_FOLDERS,
    parseFolderList,
    publicDemoNpcFolders,
    filterRosterEntries,
    rebuildRosterMaps,
  };
}
