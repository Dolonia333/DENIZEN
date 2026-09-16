'use strict';

/**
 * Single source of truth for office NPCs: soul folder, display name, Phaser texture key, asset filename.
 * Loaded in Node (npc-brains) and in the browser before agent-office-manager, player-chat, office-scene.
 */

const NPC_ROSTER_ENTRIES = [
  { folder: 'abby', display: 'Abby', textureKey: 'xp_abby', assetName: 'Abby', gender: 'female' },
  { folder: 'alex', display: 'Alex', textureKey: 'xp_alex', assetName: 'Alex', gender: 'male' },
  { folder: 'bob', display: 'Bob', textureKey: 'xp_bob', assetName: 'Bob', gender: 'male' },
  { folder: 'jenny', display: 'Jenny', textureKey: 'xp_jenny', assetName: 'Jenny', gender: 'female' },
  { folder: 'dan', display: 'Dan', textureKey: 'xp_dan', assetName: 'Dan', gender: 'male' },
  { folder: 'lucy', display: 'Lucy', textureKey: 'xp_lucy', assetName: 'Lucy', gender: 'female' },
  { folder: 'bouncer', display: 'Bouncer', textureKey: 'xp_bouncer', assetName: 'Bouncer', gender: 'male' },
  { folder: 'conference_man', display: 'Marcus', textureKey: 'xp_conference_man', assetName: 'Conference_man', gender: 'male' },
  { folder: 'conference_woman', display: 'Sarah', textureKey: 'xp_conference_woman', assetName: 'Conference_woman', gender: 'female' },
  { folder: 'edward', display: 'Edward', textureKey: 'xp_edward', assetName: 'Edward', gender: 'male' },
  { folder: 'josh', display: 'Josh', textureKey: 'xp_josh', assetName: 'Josh', gender: 'male' },
  { folder: 'molly', display: 'Molly', textureKey: 'xp_molly', assetName: 'Molly', gender: 'female' },
  { folder: 'oscar', display: 'Oscar', textureKey: 'xp_oscar', assetName: 'Oscar', gender: 'male' },
  { folder: 'pier', display: 'Pier', textureKey: 'xp_pier', assetName: 'Pier', gender: 'male' },
  { folder: 'rob', display: 'Rob', textureKey: 'xp_rob', assetName: 'Rob', gender: 'male' },
  { folder: 'roki', display: 'Roki', textureKey: 'xp_roki', assetName: 'Roki', gender: 'male' },
  { folder: 'grok', display: 'Grok', textureKey: 'xp_grok', assetName: 'Grok', gender: 'male' },
  { folder: 'claude', display: 'Claude', textureKey: 'xp_claude', assetName: 'Claude', gender: 'neutral' },
];

const nameToKey = Object.fromEntries(
  NPC_ROSTER_ENTRIES.map((e) => [e.display.toLowerCase(), e.textureKey])
);
const keyToDisplay = Object.fromEntries(
  NPC_ROSTER_ENTRIES.map((e) => [e.textureKey, e.display])
);
const displayNames = NPC_ROSTER_ENTRIES.map((e) => e.display);
const assetNames = NPC_ROSTER_ENTRIES.map((e) => e.assetName);
const displayToGender = Object.fromEntries(
  NPC_ROSTER_ENTRIES.map((e) => [e.display, e.gender || null])
);

/** Common ChatGPT / paste typos for folder keys (consent UI shows these as "Joshl"). */
const NPC_KEY_ALIASES = Object.freeze({
  joshl: 'josh',
  joshi: 'josh',
  joshua: 'josh',
});

const KNOWN_NPC_FOLDERS = new Set(NPC_ROSTER_ENTRIES.map((e) => e.folder));

/**
 * Normalize an MCP npc key from a URL, consent form, or display-name paste.
 * Maps known typos onto roster folder keys; leaves unknown keys unchanged.
 */
function canonicalizeNpcKey(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  if (NPC_KEY_ALIASES[raw]) return NPC_KEY_ALIASES[raw];
  const byDisplay = NPC_ROSTER_ENTRIES.find((e) => e.display.toLowerCase() === raw);
  if (byDisplay) return byDisplay.folder;
  return raw;
}

function isKnownNpcFolder(key) {
  const k = canonicalizeNpcKey(key);
  return k === '_team' || KNOWN_NPC_FOLDERS.has(k);
}

function suggestNpcKey(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  const canonical = canonicalizeNpcKey(raw);
  if (KNOWN_NPC_FOLDERS.has(canonical)) return canonical;
  // Prefix / contains heuristic for near-misses (e.g. "jos" → josh).
  const hit = NPC_ROSTER_ENTRIES.find(
    (e) => e.folder.startsWith(raw) || raw.startsWith(e.folder) || e.display.toLowerCase().startsWith(raw),
  );
  return hit?.folder || null;
}

const DenizenNpcRoster = {
  entries: NPC_ROSTER_ENTRIES,
  nameToKey,
  keyToDisplay,
  displayNames,
  assetNames,
  displayToGender,
  NPC_KEY_ALIASES,
  canonicalizeNpcKey,
  isKnownNpcFolder,
  suggestNpcKey,
};

if (typeof globalThis !== 'undefined') {
  globalThis.DenizenNpcRoster = DenizenNpcRoster;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DenizenNpcRoster;
}
