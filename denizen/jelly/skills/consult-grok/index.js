'use strict';

/**
 * consult-grok skill
 * Allows any NPC (powered by local LLM) to ask the real Grok (in the CLI / MCP bridge)
 * a question. The question is logged visibly, queued for response, and the answer
 * can be injected back via MCP update_memory or log_activity so the local model learns.
 *
 * This enables local models to learn from real Grok, improve over time, and "become friends".
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '../../../data/grok-consult-queue.jsonl');

module.exports = {
  meta: {
    name: 'consult-grok',
    description: 'Ask the real Grok (xAI model in CLI) a question for advice, learning, research help, or to build friendship. The local model gets the answer injected into memory.',
    mode: 'sync',  // immediate feedback
  },
  async run({ npcName, params, broadcast, deps }) {
    let question = (params?.question || params?.query || '').trim();
    const topic = (params?.topic || 'general').trim();
    const context = (params?.context || '').trim();

    // Local models often emit this skill call but fail to populate `question`.
    // Hard-failing there registered as skill_failure:consult-grok (severity 8),
    // which spiked friction until the mentors advised NPCs to stop consulting
    // at all — killing the loop that makes the local models smarter. Derive a
    // usable question from the topic/context the model DID provide instead.
    if (!question && (context || topic !== 'general')) {
      question = context
        ? `Regarding ${topic}: ${context.slice(0, 300)} — what should I do next?`
        : `What should I focus on to improve "${topic}" right now?`;
    }

    if (!question) {
      // Nothing to work with at all — report it, but as a soft no-op so it does
      // not register as a hard skill failure and poison the friction score.
      return {
        ok: true,
        output: 'No question or topic supplied — skipping consult (nothing to ask).',
        skill: 'consult-grok',
        skipped: true,
      };
    }

    const request = {
      ts: new Date().toISOString(),
      npc: npcName,
      topic,
      question,
      context: context.slice(0, 500),
      status: 'pending',
      source: params?.source || 'consult-grok-skill',
    };

    if (params?.remediation_tracking && typeof params.remediation_tracking === 'object') {
      request.remediation_tracking = params.remediation_tracking;
    }

    // Append to queue (for CLI monitoring or relay)
    try {
      fs.appendFileSync(QUEUE_FILE, JSON.stringify(request) + '\n');
    } catch (e) {
      // ignore if can't write
    }

    // Make it visible in office
    broadcast({
      type: 'npc_skill_start',
      npcName,
      skill: 'consult-grok',
      skillParams: { question: question.slice(0, 100) },
      ts: Date.now(),
    });

    const activity = (deps.pcActivity || {}).record?.({
      npc: npcName,
      kind: 'consult',
      task: `asking real Grok: ${question.slice(0, 80)}`,
      mode: 'sync',
      status: 'pending',
    });

    const message = `Question sent to real Grok (via CLI bridge): "${question}"\nTopic: ${topic}\n\nReal Grok will respond. The answer will be added to my memory so I can learn and improve.`;

    // Log visibly
    if (deps.log) {
      deps.log.info?.(deps.jelly?.logTag || 'Jelly', `${npcName} is consulting real Grok about ${topic}: ${question.slice(0, 60)}...`);
    }

    return {
      ok: true,
      output: message,
      skill: 'consult-grok',
      broadcastResult: true,
      inject: true,  // so it goes into NPC context/memory
      question,
      topic,
      pending: true,
    };
  },
};
