'use strict';

/**
 * A+ Plan P1.1 — structured chat parseChatReply coverage.
 * Run: node --test tests/denizen-chat-schema.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CHAT_REPLY_SCHEMA,
  parseChatReply,
  extractRecentLessons,
  lessonsPromptBlock,
  softCheckLessonCitation,
  isChatKind,
  REPLY_MAX,
} = require('../src/denizen-chat-schema');

describe('CHAT_REPLY_SCHEMA', () => {
  it('requires reply and allows tone / next_action', () => {
    assert.equal(CHAT_REPLY_SCHEMA.type, 'object');
    assert.ok(CHAT_REPLY_SCHEMA.properties.reply);
    assert.ok(CHAT_REPLY_SCHEMA.properties.tone);
    assert.ok(CHAT_REPLY_SCHEMA.properties.next_action);
    assert.deepEqual(CHAT_REPLY_SCHEMA.required, ['reply']);
  });

  it('isChatKind matches chat / player_chat / peer_chat', () => {
    assert.equal(isChatKind('chat'), true);
    assert.equal(isChatKind('player_chat'), true);
    assert.equal(isChatKind('peer_chat'), true);
    assert.equal(isChatKind('think'), false);
    assert.equal(isChatKind('incident-report'), false);
  });
});

describe('parseChatReply', () => {
  it('parses clean JSON object', () => {
    const raw = JSON.stringify({
      reply: 'On it — checking the desk queue.',
      tone: 'focused',
      next_action: 'work',
    });
    const out = parseChatReply(raw);
    assert.equal(out.reply, 'On it — checking the desk queue.');
    assert.equal(out.tone, 'focused');
    assert.equal(out.next_action, 'work');
  });

  it('parses fenced ```json blocks', () => {
    const raw = '```json\n{"reply":"Hey boss, all clear.","tone":"calm"}\n```';
    const out = parseChatReply(raw);
    assert.equal(out.reply, 'Hey boss, all clear.');
    assert.equal(out.tone, 'calm');
    assert.equal(out.next_action, null);
  });

  it('accepts plain dialogue without JSON', () => {
    const out = parseChatReply('Sure — I will talk to Josh about the PR.');
    assert.equal(out.reply, 'Sure — I will talk to Josh about the PR.');
    assert.equal(out.tone, null);
    assert.equal(out.next_action, null);
  });

  it('preserves action tags inside reply field', () => {
    const raw = '{"reply":"Heading over. [ACTION:visitCoworker:Josh:check PR]","tone":"busy"}';
    const out = parseChatReply(raw);
    assert.match(out.reply, /Heading over/);
    assert.match(out.reply, /\[ACTION:visitCoworker:Josh:check PR\]/);
  });

  it('falls back from junk / partial JSON without leaking braces as speech', () => {
    const junk = 'Thinking...\n{"reply": "Status looks good.", "tone":';
    const out = parseChatReply(junk);
    // Either recovered reply or stripped plain text — never empty if content exists
    assert.ok(out.reply.length > 0);
    assert.ok(!out.reply.startsWith('{') || !out.reply.includes('"tone"'));
  });

  it('handles message/text aliases when reply missing', () => {
    const out = parseChatReply('{"message":"From message field"}');
    assert.equal(out.reply, 'From message field');
  });

  it('caps reply at REPLY_MAX (500)', () => {
    const long = 'x'.repeat(600);
    const out = parseChatReply(JSON.stringify({ reply: long }));
    assert.ok(out.reply.length <= REPLY_MAX);
    assert.equal(out.reply.length, 500);
  });

  it('empty / null inputs return empty reply', () => {
    assert.equal(parseChatReply('').reply, '');
    assert.equal(parseChatReply(null).reply, '');
    assert.equal(parseChatReply(undefined).reply, '');
  });

  it('extracts reply from surrounding prose + JSON', () => {
    const raw = 'Here you go:\n{"reply":"Got it.","next_action":"wait"}\nThanks.';
    const out = parseChatReply(raw);
    assert.equal(out.reply, 'Got it.');
    assert.equal(out.next_action, 'wait');
  });
});

describe('lesson citation helpers (P2.1)', () => {
  it('extractRecentLessons pulls HARNESS / GROK MENTOR lines (last 5)', () => {
    const mem = [
      '- [2026-07-01T10:00] unrelated note',
      '- [2026-07-01T11:00] [GROK MENTOR] Cut context before retrying overflow',
      '- [2026-07-01T12:00] [HARNESS LESSON] Prefer work at desk over wander',
      '- [2026-07-01T13:00] random chat with Bob',
      '- [2026-07-01T14:00] [CONSULT LESSON] Log friction before consulting again',
    ].join('\n');
    const lessons = extractRecentLessons(mem, 5);
    assert.equal(lessons.length, 3);
    assert.ok(lessons.some((l) => /HARNESS LESSON/.test(l)));
    assert.ok(lessons.some((l) => /GROK MENTOR/.test(l)));
  });

  it('lessonsPromptBlock includes required citation heading', () => {
    const block = lessonsPromptBlock(['[HARNESS LESSON] stay at desk']);
    assert.match(block, /## Lessons to apply — you MUST reference at least one if relevant in reasoning or save/);
    assert.match(block, /HARNESS LESSON/);
  });

  it('softCheckLessonCitation appends save note when not cited', () => {
    const decision = { thought: 'keep coding', save: 'still on feature', action: 'work' };
    softCheckLessonCitation(decision, ['[GROK MENTOR] Cap prompt tokens under 2k']);
    assert.match(decision.save, /lesson: consider applying recent mentor guidance/i);
    assert.equal(decision._lessonCiteSoft, true);
  });

  it('softCheckLessonCitation does not append when lesson is cited', () => {
    const decision = {
      thought: 'Applying the mentor lesson on token caps',
      save: 'trimmed MEMORY per grok mentor',
      action: 'work',
    };
    softCheckLessonCitation(decision, ['[GROK MENTOR] Cap prompt tokens under 2k']);
    assert.ok(!decision._lessonCiteSoft);
    assert.ok(!/consider applying recent mentor guidance/i.test(decision.save));
  });
});
