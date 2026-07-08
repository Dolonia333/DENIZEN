'use strict';

/**
 * consult-mentors — local NPC asks Grok + Claude mentor panel.
 * Creates a shared dialogue session; peers reply via MCP; synthesis injects into memory.
 */

const mentorDialogue = require('../../../src/denizen-mentor-dialogue.js');

module.exports = {
  meta: {
    name: 'consult-mentors',
    description: 'Ask the Grok + Claude mentor panel (cloud peers) how to improve — they discuss together and teach the local model to be smarter and more human.',
    mode: 'sync',
    aliases: ['ask-mentors', 'mentor-panel'],
  },
  async run({ npcName, params, broadcast, deps }) {
    const question = (params?.question || params?.query || '').trim();
    const topic = (params?.topic || 'mentor-panel').trim();
    const context = (params?.context || '').trim();

    if (!question) {
      return {
        ok: false,
        output: 'Provide a clear question for the Grok + Claude mentor panel.',
        skill: 'consult-mentors',
      };
    }

    const session = mentorDialogue.createSession({
      npcName,
      topic,
      question,
      context,
    });

    broadcast({
      type: 'npc_skill_start',
      npcName,
      skill: 'consult-mentors',
      skillParams: { question: question.slice(0, 100), session_id: session.id },
      ts: Date.now(),
    });

    deps.pcActivity?.record?.({
      npc: npcName,
      kind: 'consult',
      task: `mentor panel (Grok+Claude): ${question.slice(0, 70)}`,
      mode: 'sync',
      status: 'awaiting_peers',
    });

    deps.log?.info?.(
      deps.jelly?.logTag || 'Jelly',
      `${npcName} opened mentor panel ${session.id} — Grok + Claude will discuss`,
    );

    return {
      ok: true,
      skill: 'consult-mentors',
      session_id: session.id,
      broadcastResult: true,
      inject: true,
      pending: true,
      output: [
        `Mentor panel opened (Grok + Claude will discuss together): "${question}"`,
        `Session: ${session.id}`,
        `Topic: ${topic}`,
        '',
        'Real Grok (CLI) and Claude (Desktop/Team MCP) will each reply, then synthesize lessons into my memory.',
        'Goal: smarter research, faster reasoning, more human conversation — like real teammates.',
      ].join('\n'),
    };
  },
};
