'use strict';

/**
 * Identity façade — SOUL / MEMORY / roster / capabilities.
 */

const fs = require('node:fs');
const path = require('node:path');

function createIdentityFacade(deps = {}) {
  const npcsDir = deps.npcsDir
    || path.join(deps.denizenRoot || path.join(__dirname, '..', '..'), 'npcs');

  function getBrains() {
    return deps.getNpcBrains?.() || deps.npcBrains || null;
  }

  function listNpcs() {
    const brains = getBrains();
    if (brains?.brains) return Object.keys(brains.brains);
    try {
      return fs.readdirSync(npcsDir).filter((d) => {
        try {
          return fs.statSync(path.join(npcsDir, d)).isDirectory()
            && fs.existsSync(path.join(npcsDir, d, 'SOUL.md'));
        } catch (_) {
          return false;
        }
      });
    } catch (_) {
      return [];
    }
  }

  function getSoul(npcName) {
    const brains = getBrains();
    const b = brains?.brains?.[npcName];
    if (b?.personality) return { ok: true, source: 'brains', text: b.personality, role: b.role || null };
    const folder = _folder(npcName);
    if (!folder) return { ok: false, error: 'unknown_npc' };
    try {
      const text = fs.readFileSync(path.join(npcsDir, folder, 'SOUL.md'), 'utf8');
      return { ok: true, source: 'disk', text, role: null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function getMemory(npcName, maxChars = 4000) {
    const brains = getBrains();
    const b = brains?.brains?.[npcName];
    if (b?.longTermMemory) {
      const t = String(b.longTermMemory);
      return { ok: true, source: 'brains', text: t.slice(-maxChars) };
    }
    const folder = _folder(npcName);
    if (!folder) return { ok: false, error: 'unknown_npc' };
    try {
      const text = fs.readFileSync(path.join(npcsDir, folder, 'MEMORY.md'), 'utf8');
      return { ok: true, source: 'disk', text: text.slice(-maxChars) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function getProvider(npcName) {
    const brains = getBrains();
    const b = brains?.brains?.[npcName];
    if (!b) return null;
    return {
      provider: b.provider || null,
      model: b.providerConfig?.model || null,
      role: b.role || null,
    };
  }

  function _folder(npcName) {
    const raw = String(npcName || '').trim();
    if (!raw) return null;
    const low = raw.toLowerCase().replace(/^xp_/, '');
    if (fs.existsSync(path.join(npcsDir, low, 'SOUL.md'))) return low;
    try {
      const roster = require('../npc-roster');
      const hit = (roster.entries || []).find(
        (e) => e.folder === low
          || e.display?.toLowerCase() === low
          || e.display === raw,
      );
      return hit?.folder || null;
    } catch (_) {
      return null;
    }
  }

  return {
    listNpcs,
    getSoul,
    getMemory,
    getProvider,
  };
}

module.exports = { createIdentityFacade };
