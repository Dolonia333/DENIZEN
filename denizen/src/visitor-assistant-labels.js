/**
 * Phaser labels above personal assistants — CEO's Lucy + each visitor's claimed NPC.
 * Attaches to globalThis.DenizenVisitorAssistantLabels (no imports).
 */
(function () {
  'use strict';

  const TICK_MS = 500;
  const Y_OFFSET = 58;
  const LUCY_TEXTURE_KEY = 'xp_lucy';

  let scene = null;
  let agentManager = null;
  let tickTimer = null;
  const labels = new Map();

  function clearAllLabels() {
    for (const entry of labels.values()) {
      try { entry.text?.destroy(); } catch (_) {}
    }
    labels.clear();
  }

  function clearLabel(npcKey) {
    const entry = labels.get(npcKey);
    if (entry?.text) {
      try { entry.text.destroy(); } catch (_) {}
    }
    labels.delete(npcKey);
  }

  function getAssistantTextureKey() {
    const sess = globalThis.DenizenVisitorSession;
    const asst = sess?.getAssistant?.();
    if (!asst?.npc_key) return null;
    return sess.npcKeyToTextureKey?.(asst.npc_key) || null;
  }

  function getNpc(npcKey) {
    if (agentManager?.actions?._getNpc) {
      return agentManager.actions._getNpc(npcKey);
    }
    return scene?.npcs?.find((n) => n.texture?.key === npcKey) || null;
  }

  function ownerDisplayName() {
    const sess = globalThis.DenizenVisitorSession;
    return sess?.getDisplayName?.() || 'Guest';
  }

  function isCeoMode() {
    return globalThis.__DenizenCeoMode === true
      || globalThis.DenizenVisitorSession?.isCeoMode?.() === true;
  }

  function ensureLabel(npcKey, labelText, color) {
    if (!scene?.add || !npcKey) {
      clearLabel(npcKey);
      return;
    }
    const npc = getNpc(npcKey);
    if (!npc) {
      clearLabel(npcKey);
      return;
    }

    let entry = labels.get(npcKey);
    if (entry?.text?.scene) {
      entry.text.setText(labelText);
      entry.npc = npc;
      return;
    }

    clearLabel(npcKey);
    const text = scene.add.text(npc.x, npc.y - Y_OFFSET, labelText, {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#0f172a',
      backgroundColor: color === '#fbbf24' ? '#fef08cee' : '#bbf7d0ee',
      padding: { x: 3, y: 2 },
      align: 'center',
    });
    text.setOrigin(0.5, 1);
    text.setDepth(9997);
    if (typeof text.setResolution === 'function') text.setResolution(1);
    labels.set(npcKey, { text, npc, npcKey });
  }

  function tick() {
    const sess = globalThis.DenizenVisitorSession;
    if (!sess || !scene) return;

    const ceo = isCeoMode();
    const lucyLabel = ceo ? "★ CEO's" : "★ CEO's assistant";
    ensureLabel(LUCY_TEXTURE_KEY, lucyLabel, '#fbbf24');

    if (ceo) {
      const visitorKey = getAssistantTextureKey();
      for (const key of [...labels.keys()]) {
        if (key !== LUCY_TEXTURE_KEY) clearLabel(key);
      }
    } else {
      const npcKey = getAssistantTextureKey();
      if (npcKey && npcKey !== LUCY_TEXTURE_KEY) {
        ensureLabel(npcKey, `★ ${ownerDisplayName()}'s`, '#4ade80');
      }
      for (const key of [...labels.keys()]) {
        if (key !== LUCY_TEXTURE_KEY && key !== npcKey) clearLabel(key);
      }
    }

    for (const entry of labels.values()) {
      if (entry.text && entry.npc) {
        entry.text.x = entry.npc.x;
        entry.text.y = entry.npc.y - Y_OFFSET;
      }
    }
  }

  const DenizenVisitorAssistantLabels = {
    attach(sc, mgr) {
      scene = sc;
      agentManager = mgr;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(tick, TICK_MS);
      globalThis.DenizenVisitorSession?.init?.().then(() => {
        DenizenVisitorAssistantLabels.refresh();
      }).catch(() => {});
      tick();
      console.log('[DenizenVisitorAssistantLabels] attached');
    },

    refresh() {
      clearAllLabels();
      tick();
    },

    detach() {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      clearAllLabels();
      scene = null;
      agentManager = null;
    },
  };

  globalThis.DenizenVisitorAssistantLabels = DenizenVisitorAssistantLabels;
})();
