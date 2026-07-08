'use strict';

/**
 * MCP tools — Grok + Claude mentor panel for local LLM NPCs.
 */

const denizenDb = require('../intelligence/denizen-db');
const mentorDialogue = require('../intelligence/denizen-mentor-dialogue');

let _deps = {};

const MENTOR_TOOL_DEFINITIONS = [
  {
    name: 'mentor_list_pending',
    description: 'List mentor dialogue sessions awaiting Grok or Claude peer replies (local NPC questions).',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Filter: grok | claude | omit for all open' },
        limit: { type: 'number', description: 'Max rows (default 15)' },
      },
    },
  },
  {
    name: 'mentor_get_session',
    description: 'Fetch one mentor dialogue session by id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session UUID' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'mentor_peer_reply',
    description: 'Post Grok or Claude peer reply to a mentor session (they talk to each other about how to help the local NPC).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        agent: { type: 'string', description: 'grok or claude' },
        reply: { type: 'string', description: 'Peer mentor answer in conversational CLI style' },
      },
      required: ['session_id', 'agent', 'reply'],
    },
  },
  {
    name: 'mentor_finalize',
    description: 'Synthesize Grok+Claude replies and inject into the asking NPC memory + office feed.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        synthesis: { type: 'string', description: 'Optional override synthesis text' },
        announce: { type: 'boolean', description: 'Announce in office (default true)' },
      },
      required: ['session_id'],
    },
  },
];

function configure(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function isMentorTool(name) {
  return MENTOR_TOOL_DEFINITIONS.some((t) => t.name === name);
}

function toolsForGateway() {
  return [...MENTOR_TOOL_DEFINITIONS];
}

async function toolListPending(_scope, args) {
  const agent = args?.agent ? String(args.agent).toLowerCase().trim() : null;
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 15));
  const pending = mentorDialogue.listPending({ agent, limit });
  return {
    ok: true,
    count: pending.length,
    sessions: pending.map((s) => ({
      id: s.id,
      ts: s.ts,
      npc: s.npc,
      npc_key: s.npc_key,
      topic: s.topic,
      question: s.question,
      has_grok: !!s.grok_reply,
      has_claude: !!s.claude_reply,
      status: s.status,
    })),
  };
}

async function toolGetSession(_scope, args) {
  const session = mentorDialogue.getSession(String(args?.session_id || '').trim());
  if (!session) return { ok: false, error: 'session_not_found' };
  return { ok: true, session };
}

async function toolPeerReply(_scope, args) {
  const agent = String(args?.agent || '').toLowerCase().trim();
  if (agent !== 'grok' && agent !== 'claude') {
    return { ok: false, error: 'agent must be grok or claude' };
  }
  const result = mentorDialogue.addPeerReply(
    String(args?.session_id || '').trim(),
    agent,
    args?.reply,
  );
  if (!result.ok) return result;

  if (typeof _deps.announceInOffice === 'function') {
    const s = result.session;
    _deps.announceInOffice({
      npcName: agent === 'grok' ? 'Grok' : 'Claude',
      message: `Mentor panel → ${s.npc}: ${agent} replied on "${s.question.slice(0, 60)}…"`,
    });
  }

  const ready = !!(result.session.grok_reply && result.session.claude_reply);
  return {
    ok: true,
    session_id: result.session.id,
    agent,
    ready_to_finalize: ready,
    session: result.session,
  };
}

async function toolFinalize(scope, args) {
  const sessionId = String(args?.session_id || '').trim();
  const fin = mentorDialogue.finalizeSession(sessionId, args?.synthesis);
  if (!fin.ok) return fin;

  const session = fin.session;
  const npcKey = session.npc_key;
  const body = session.synthesis;

  let memory_id = null;
  if (denizenDb.enabled && scope?.org_id && npcKey && body) {
    try {
      const row = await denizenDb.insertNpcMemory({
        orgId: scope.org_id,
        npcKey,
        body,
        topic: 'mentor-panel-grok-claude',
        outcome: 'mentor-lesson',
        source: 'mcp',
        memberId: scope.member_id || null,
      });
      memory_id = row?.id || null;
      await denizenDb.recordFact({
        orgId: scope.org_id,
        factType: 'npc.memory.updated',
        actorType: 'system',
        actorId: npcKey,
        payload: {
          body: body.slice(0, 200),
          topic: 'mentor-panel-grok-claude',
          source: 'mentor_finalize',
          memory_id,
          session_id: sessionId,
        },
        tags: ['npc', 'memory', 'mentor'],
      }).catch(() => {});
    } catch (_) {
      /* memory write best-effort */
    }
  }

  const announce = args?.announce !== false;
  if (announce && typeof _deps.announceInOffice === 'function') {
    _deps.announceInOffice({
      npcName: session.npc,
      message: `Learned from Grok + Claude mentors: ${session.question.slice(0, 80)}…`,
    });
  }

  if (typeof _deps.refreshNpcMemories === 'function' && session.npc) {
    try { _deps.refreshNpcMemories(session.npc); } catch (_) {}
  }

  return {
    ok: true,
    session_id: sessionId,
    npc_key: npcKey,
    memory_id,
    synthesis: body,
    grok_reply: !!session.grok_reply,
    claude_reply: !!session.claude_reply,
  };
}

async function callTool(scope, name, args) {
  switch (name) {
    case 'mentor_list_pending': return toolListPending(scope, args);
    case 'mentor_get_session': return toolGetSession(scope, args);
    case 'mentor_peer_reply': return toolPeerReply(scope, args);
    case 'mentor_finalize': return toolFinalize(scope, args);
    default: return { ok: false, error: `unknown mentor tool: ${name}` };
  }
}

module.exports = {
  MENTOR_TOOL_DEFINITIONS,
  configure,
  isMentorTool,
  toolsForGateway,
  callTool,
};
