'use strict';

/**
 * Context façade — world state + company brief slices for prompt assembly.
 * Does not own prompt templates; brains/loops still compose full prompts.
 */

function createContextFacade(deps = {}) {
  function getWorldState() {
    return deps.getWorldState?.() || deps.worldState || null;
  }

  function renderNpcBlock(npcName) {
    const ws = getWorldState();
    if (ws?.renderContextBlock) {
      try {
        return ws.renderContextBlock(npcName);
      } catch (_) {
        return '';
      }
    }
    return '';
  }

  function businessBrief(npcName) {
    try {
      const bc = require('../denizen-business-context');
      if (typeof bc.buildBusinessContextBrief === 'function') {
        return bc.buildBusinessContextBrief({ npcName });
      }
      if (typeof bc.getProactiveLine === 'function') {
        return bc.getProactiveLine(npcName);
      }
    } catch (_) {}
    return null;
  }

  function officeSnapshot() {
    const ws = getWorldState();
    if (!ws) return null;
    try {
      if (typeof ws.snapshot === 'function') return ws.snapshot();
      if (typeof ws.getSnapshot === 'function') return ws.getSnapshot();
      return {
        npcCount: ws.npcs ? Object.keys(ws.npcs).length : null,
        hasThreats: !!(ws.threats && (Array.isArray(ws.threats) ? ws.threats.length : Object.keys(ws.threats).length)),
      };
    } catch (_) {
      return null;
    }
  }

  return {
    renderNpcBlock,
    businessBrief,
    officeSnapshot,
  };
}

module.exports = { createContextFacade };
