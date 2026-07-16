'use strict';

/**
 * Loop façade — think / chat / director.
 * Delegates to existing brains & cofounder so we don't fork behavior,
 * while every path is addressable through the harness.
 */

function createLoopsFacade(deps = {}) {
  function getBrains() {
    return deps.getNpcBrains?.() || deps.npcBrains || null;
  }

  function getCofounder() {
    return deps.getCofounder?.() || deps.cofounderAgent || null;
  }

  /**
   * NPC decision tick (structured JSON think).
   */
  async function think(npcName, officeContext = {}) {
    const brains = getBrains();
    if (!brains?.think) {
      return { ok: false, error: 'npc_brains_not_bound' };
    }
    const decision = await brains.think(npcName, officeContext);
    return { ok: true, loop: 'think', npc: npcName, decision };
  }

  /**
   * Conversational reply for an NPC.
   * Uses brains.getResponse when available; else inference gate.
   */
  async function chat(npcName, messages, opts = {}) {
    const brains = getBrains();
    const kind = opts.kind || 'chat';

    if (brains?.getResponse && typeof messages === 'string') {
      // Legacy signature: getResponse(npc, text, context)
      const text = await brains.getResponse(npcName, messages, opts.context || opts);
      return { ok: true, loop: 'chat', npc: npcName, text, path: 'brains.getResponse' };
    }

    if (brains?.getResponse && Array.isArray(messages) && messages.length === 1) {
      const last = messages[messages.length - 1];
      const text = await brains.getResponse(npcName, last.content || last, opts.context || opts);
      return { ok: true, loop: 'chat', npc: npcName, text, path: 'brains.getResponse' };
    }

    if (!deps.inference?.complete) {
      return { ok: false, error: 'no_chat_path' };
    }

    const identity = deps.identity;
    const soul = identity?.getSoul?.(npcName);
    const mem = identity?.getMemory?.(npcName, 1200);
    const systemParts = [];
    if (soul?.text) systemParts.push(soul.text.slice(0, 6000));
    if (mem?.text) systemParts.push(`## Recent memory\n${mem.text}`);
    if (opts.systemPrompt) systemParts.push(opts.systemPrompt);

    const oaiMessages = Array.isArray(messages)
      ? messages
      : [{ role: 'user', content: String(messages || '') }];

    const result = await deps.inference.complete({
      tier: opts.tier || (kind === 'presence' ? 'fast' : 'main'),
      kind,
      npc: npcName,
      systemPrompt: systemParts.join('\n\n'),
      messages: oaiMessages,
      max_tokens: opts.max_tokens || 400,
    });
    return {
      ok: true,
      loop: 'chat',
      npc: npcName,
      text: result.text,
      model: result.model,
      path: 'harness.inference',
    };
  }

  /**
   * Office director / cofounder tick (if agent exposes a public step).
   */
  async function director(opts = {}) {
    const cf = getCofounder();
    if (!cf) return { ok: false, error: 'cofounder_not_bound' };

    if (typeof cf.tick === 'function') {
      const out = await cf.tick(opts);
      return { ok: true, loop: 'director', result: out, path: 'cofounder.tick' };
    }
    if (typeof cf.step === 'function') {
      const out = await cf.step(opts);
      return { ok: true, loop: 'director', result: out, path: 'cofounder.step' };
    }
    if (typeof cf.runOnce === 'function') {
      const out = await cf.runOnce(opts);
      return { ok: true, loop: 'director', result: out, path: 'cofounder.runOnce' };
    }
    // Read-only status if no public tick
    return {
      ok: true,
      loop: 'director',
      path: 'status_only',
      running: !!cf._timer || !!cf.running,
      note: 'Cofounder has no public tick(); harness bound for status/wiring only',
    };
  }

  return {
    think,
    chat,
    director,
  };
}

module.exports = { createLoopsFacade };
