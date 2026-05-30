'use strict';
/**
 * meeting-runner.js — dynamic, multi-turn team meetings.
 *
 * Turns "go to the conference room" into an actual working session: a
 * facilitator frames the problem, participants take turns asking/answering
 * each other and proposing concrete steps, and the facilitator closes with a
 * DECISION + action items. Action items become directives (so the meeting
 * produces real follow-up work, which the commitment/follow-through system
 * then holds people to). The whole thing is written to reports/meetings/.
 *
 * Each turn is broadcast so the NPC visibly speaks in the conference room,
 * paced so it reads like a conversation rather than a wall of bubbles.
 *
 * Wiring (server.js injects these so this module stays decoupled):
 *   meetingTurnFn(npcName, { topic, transcript, asFacilitator, closing }) → text
 *   broadcastFn(msg)
 *   assignDirectiveFn(to, from, task, urgent)
 */

const fs   = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MEETINGS_DIR = path.join(ROOT, 'reports', 'meetings');

const DEFAULTS = { rounds: 2, maxParticipants: 4, turnDelayMs: 2600 };

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function slug(s) { return String(s || 'meeting').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40); }

class MeetingRunner {
  constructor() {
    this._active = null;     // current meeting (only one at a time)
    this._history = [];      // recent finished meetings (summaries)
  }

  isActive() { return !!this._active; }
  getActive() { return this._active; }

  /**
   * Run a meeting end-to-end. Resolves when adjourned.
   * @param {object} o
   *   topic, facilitator, participants:[names], rounds?,
   *   meetingTurnFn, broadcastFn, assignDirectiveFn
   */
  async run({ topic, facilitator, participants = [], rounds, meetingTurnFn, broadcastFn, assignDirectiveFn } = {}) {
    if (this._active) return { ok: false, error: 'A meeting is already in progress.' };
    if (typeof meetingTurnFn !== 'function') return { ok: false, error: 'meetingTurnFn required' };
    if (!topic) return { ok: false, error: 'topic required' };

    const broadcast = typeof broadcastFn === 'function' ? broadcastFn : () => {};
    const roundCount = Math.max(1, Math.min(4, rounds || DEFAULTS.rounds));
    // De-dupe + cap participants; ensure the facilitator is listed first.
    let people = [...new Set([facilitator, ...participants].filter(Boolean))].slice(0, DEFAULTS.maxParticipants);
    if (!people.length) return { ok: false, error: 'no participants' };
    const lead = facilitator && people.includes(facilitator) ? facilitator : people[0];

    const transcript = [];
    const id = `mtg_${Date.now()}`;
    this._active = { id, topic, facilitator: lead, participants: people, startedAt: new Date().toISOString(), transcript };

    broadcast({ type: 'meeting_convene', id, topic, facilitator: lead, participants: people, ts: Date.now() });

    const say = async (speaker, opts) => {
      const text = (await meetingTurnFn(speaker, { topic, transcript, ...opts })) || '';
      if (!text) return;
      transcript.push({ speaker, text, at: Date.now() });
      broadcast({ type: 'npc_meeting_turn', id, npcName: speaker, text, topic, ts: Date.now() });
      await delay(DEFAULTS.turnDelayMs);
    };

    try {
      // 1. Facilitator opens.
      await say(lead, { asFacilitator: true });
      // 2. Discussion rounds — everyone except, on round 1, the facilitator (who just opened).
      for (let r = 0; r < roundCount; r++) {
        for (const p of people) {
          if (r === 0 && p === lead) continue;
          if (!this._active) return { ok: false, error: 'aborted' }; // cancelled
          await say(p, {});
        }
      }
      // 3. Facilitator closes with a decision + action items.
      await say(lead, { closing: true });
    } catch (e) {
      // fall through to wrap-up even on error
    }

    // Parse action items from the closing statement and turn them into directives.
    const closing = transcript.length ? transcript[transcript.length - 1].text : '';
    const actionItems = this._parseActionItems(closing);
    if (typeof assignDirectiveFn === 'function') {
      for (const ai of actionItems) {
        try { assignDirectiveFn(ai.to, lead, `[From meeting: ${topic}] ${ai.task}`, false); } catch (_) {}
      }
    }

    const artifactPath = this._writeArtifact({ id, topic, lead, people, transcript, actionItems });

    broadcast({ type: 'meeting_adjourn', id, topic, participants: people, actionItems, artifactPath, ts: Date.now() });

    const summary = {
      id, topic, facilitator: lead, participants: people,
      turns: transcript.length, actionItems, artifactPath,
      decision: closing.slice(0, 300), at: new Date().toISOString(),
    };
    this._history.unshift(summary);
    if (this._history.length > 20) this._history.length = 20;
    this._active = null;
    return { ok: true, ...summary };
  }

  /** Cancel the active meeting (best-effort). */
  cancel() { if (this._active) { this._active = null; return true; } return false; }

  getHistory() { return this._history; }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Pull "ACTION: <Name> — <task>" items out of the closing statement.
   *  Splits on each ACTION: token so it works whether they're on separate
   *  lines or run together on one line. */
  _parseActionItems(text) {
    const items = [];
    for (const seg of String(text).split(/ACTION:/i).slice(1)) {
      const m = seg.match(/\s*([A-Z][a-zA-Z]+)\s*[—:\-]\s*([^\n\r]+)/);
      if (m) items.push({ to: m[1].trim(), task: m[2].trim().slice(0, 200) });
      if (items.length >= 8) break;
    }
    return items;
  }

  _writeArtifact({ id, topic, lead, people, transcript, actionItems }) {
    try {
      fs.mkdirSync(MEETINGS_DIR, { recursive: true });
      const file = path.join(MEETINGS_DIR, `${slug(topic)}_${new Date().toISOString().slice(0, 10)}.md`);
      const body = [
        `# Meeting: ${topic}`,
        ``,
        `- **When:** ${new Date().toISOString()}`,
        `- **Facilitator:** ${lead}`,
        `- **Participants:** ${people.join(', ')}`,
        ``,
        `## Discussion`,
        ...transcript.map(t => `**${t.speaker}:** ${t.text}`),
        ``,
        `## Action Items`,
        ...(actionItems.length ? actionItems.map(a => `- **${a.to}:** ${a.task}`) : ['- (none captured)']),
        ``,
      ].join('\n');
      fs.writeFileSync(file, body, 'utf8');
      return path.relative(ROOT, file);
    } catch (_) {
      return null;
    }
  }
}

module.exports = new MeetingRunner();
