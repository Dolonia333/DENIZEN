'use strict';

/**
 * Server-side NPC think wake — runs LM Studio cycles when users or peers
 * need an NPC to act (directives, skills, bus messages), not only on the
 * slow client stagger loop.
 */
class NpcThinkRunner {
  constructor() {
    this._debounce = new Map();
    this._inFlight = new Set();
    this._deps = null;
  }

  configure(deps) {
    this._deps = deps;
  }

  _broadcast(msg) {
    if (typeof this._deps?.broadcast === 'function') {
      this._deps.broadcast(msg);
    }
  }

  wake(npcName, reason = 'interaction', opts = {}) {
    const name = String(npcName || '').trim();
    if (!name || !this._deps?.npcBrains) return;

    if (this._deps.npcBrains.isPlayerChatBusy?.(name) && !opts._deferredForChat) {
      const prev = this._debounce.get(name);
      if (prev) clearTimeout(prev);
      this._debounce.set(name, setTimeout(() => {
        this._debounce.delete(name);
        this.wake(name, reason, { ...opts, _deferredForChat: true });
      }, 45000));
      return;
    }

    const delay = Number(opts.delayMs) || 400;
    const prev = this._debounce.get(name);
    if (prev) clearTimeout(prev);

    this._debounce.set(name, setTimeout(() => {
      this._debounce.delete(name);
      this.runCycle(name, { urgentWake: true, wakeReason: reason, ...opts }).catch((err) => {
        console.warn(`[ThinkRunner] ${name}: ${err?.message || err}`);
      });
    }, delay));

    this._broadcast({
      type: 'npc_think_wake',
      npcName: name,
      reason,
      office_id: opts.officeId || null,
      ts: Date.now(),
    });
  }

  applyDecision(npcName, decision, officeId = null) {
    const msg = { npcName, decision, office_id: officeId || decision?._officeContext?.officeId || null };
    const workNote = (decision.save || decision.message || decision.thought || '').trim();

    this._broadcast({
      type: 'npc_decision',
      npcName,
      decision,
      office_id: officeId || decision?._officeContext?.officeId || null,
    });

    if (workNote && decision.taskPhase && decision.taskPhase !== 'none') {
      const phaseEmoji = { starting: '▶', continuing: '⟳', finished: '✓' }[decision.taskPhase] || '•';
      this._broadcast({
        type: 'npc_work_output',
        npcName,
        phase: decision.taskPhase,
        phaseEmoji,
        note: workNote.slice(0, 120),
        action: decision.action || 'work',
        artifactPath: decision._artifactPath || null,
        office_id: officeId || decision?._officeContext?.officeId || null,
        ts: Date.now(),
      });
      this._deps?.denizenDb?.recordWorkOutput?.({
        npcName,
        phase: decision.taskPhase,
        action: decision.action || 'work',
        note: workNote,
        artifactPath: decision._artifactPath || null,
        role: decision.role || null,
      });
      if (decision._artifactPath) {
        console.log(`[WorkOutput] ${npcName} saved artifact → ${decision._artifactPath}`);
      }
    }

    const cascades = decision._cascades || [];
    cascades.forEach((cascade, idx) => {
      setTimeout(() => {
        this._broadcast({
          type: 'npc_cascade',
          npcName: cascade.npcName,
          fromName: cascade.fromName,
          message: cascade.message,
        });
      }, (idx + 1) * 3000);
    });

    if (decision.action === 'run_skill' && decision.skill) {
      const gate = this._deps.npcBrains.allowAutonomousSkillRun(npcName, {
        skill: decision.skill,
        officeContext: decision._officeContext,
      });
      if (!gate.allowed) {
        console.log(`[SkillBridge] Blocked ${npcName} → ${decision.skill}: ${gate.reason}`);
      } else if (typeof this._deps.runNpcSkill === 'function') {
        const officeCtx = decision._officeContext || {};
        this._deps.runNpcSkill(npcName, decision.skill, decision.skillParams || {}, {
          identityId: officeCtx.identityId || null,
          officeContext: officeCtx,
        }).catch((err) => console.warn('[SkillBridge]', err.message));
      }
    }

    return msg;
  }

  _cycleKey(npcName, context = {}) {
    const officeId = context.officeId || context.identityId || 'global';
    return `${officeId}:${npcName}`;
  }

  async runCycle(npcName, context = {}) {
    if (!this._deps?.npcBrains) return null;
    const cycleKey = this._cycleKey(npcName, context);
    if (this._inFlight.has(cycleKey)) return null;

    this._inFlight.add(cycleKey);
    try {
      let enriched = context;
      if (typeof this._deps.enrichThinkContext === 'function') {
        enriched = await this._deps.enrichThinkContext(npcName, context);
      }
      const decision = await this._deps.npcBrains.think(npcName, enriched);
      this.applyDecision(npcName, decision, enriched.officeId);
      return decision;
    } finally {
      this._inFlight.delete(cycleKey);
    }
  }
}

module.exports = new NpcThinkRunner();
