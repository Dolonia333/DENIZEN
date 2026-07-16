'use strict';

/**
 * P2.1 learning closed-loop metrics — unit tests with temp JSONL fixtures.
 * No GPU / LM Studio required.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  buildLearningScorecard,
  recordCiteEvent,
  looksLikeCitation,
} = require('../src/denizen-learning-metrics');

const FIXED_NOW = Date.parse('2026-07-16T12:00:00.000Z');

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
    'utf8',
  );
}

describe('denizen-learning-metrics (P2.1)', () => {
  let tmpDir;
  let dataDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-learning-metrics-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Lessons applied: 2 in window, 1 old
    writeJsonl(path.join(dataDir, 'mentor-lessons-applied.jsonl'), [
      {
        ts: '2026-07-14T10:00:00.000Z',
        npc: 'Bob',
        folder: 'bob',
        topic: 'old',
        source: 'consult-backfill',
        preview: '[CONSULT LESSON] old advice',
      },
      {
        ts: '2026-07-16T04:17:08.461Z',
        npc: 'Bob',
        folder: 'bob',
        topic: 'telemetry-driven self-improvement',
        source: 'consult-backfill',
        preview: '[CONSULT LESSON] compress memory',
      },
      {
        ts: '2026-07-16T05:35:39.962Z',
        npc: 'Marcus',
        folder: 'conference_man',
        topic: 'telemetry-driven self-improvement',
        source: 'grok-mentor-drainer',
        preview: '[GROK MENTOR] tight directive',
      },
    ]);

    // Consult improvement: 2 answered/injected
    writeJsonl(path.join(dataDir, 'consult-improvement-log.jsonl'), [
      {
        ts: '2026-07-16T05:35:39.962Z',
        npc: 'Marcus',
        question: 'How to cut latency?',
        answer_preview: 'Prune MEMORY',
        injected: true,
        source: 'grok-mentor-drainer',
      },
      {
        ts: '2026-07-16T05:44:51.161Z',
        npc: 'Roki',
        question: 'Telemetry shows latency',
        answer_preview: 'Debounce thinks',
        injected: true,
        source: 'mesh-telemetry-job',
      },
    ]);

    // Harness learning skill results (not lesson cites by default)
    writeJsonl(path.join(dataDir, 'harness-learning.jsonl'), [
      {
        at: '2026-07-16T06:12:46.475Z',
        type: 'skill_result',
        npc: 'Abby',
        skill: 'research',
        preview: 'found stuff',
      },
      {
        at: '2026-07-16T06:15:04.516Z',
        type: 'lesson',
        npc: 'Abby',
        ok: true,
        topic: 'harness-lesson',
        preview: '[HARNESS LESSON] stay at desk',
      },
    ]);

    // Consult queue: 2 pending, 1 answered without memory, 1 answered with memory
    writeJsonl(path.join(dataDir, 'grok-consult-queue.jsonl'), [
      {
        ts: '2026-07-16T08:00:00.000Z',
        npc: 'Jenny',
        status: 'pending',
        question: 'What should I do about friction?',
      },
      {
        ts: '2026-07-16T08:05:00.000Z',
        npc: 'Dan',
        status: 'pending',
        question: 'How to structure research?',
      },
      {
        ts: '2026-07-16T07:00:00.000Z',
        npc: 'Lucy',
        status: 'answered',
        answer: 'Use short saves',
        memory_injected: false,
      },
      {
        ts: '2026-07-16T05:49:50.000Z',
        npc: 'Grok',
        status: 'answered',
        answer: 'Prune context',
        memory_injected: true,
      },
    ]);

    // Cite events: 3 cited, 2 soft misses → rate 0.6
    writeJsonl(path.join(dataDir, 'lesson-cite-events.jsonl'), [
      {
        at: '2026-07-16T09:00:00.000Z',
        npc: 'Bob',
        cited: true,
        soft: false,
        outcome: 'cited',
        savePreview: 'Applying mentor lesson on token caps',
      },
      {
        at: '2026-07-16T09:10:00.000Z',
        npc: 'Marcus',
        cited: true,
        soft: false,
        outcome: 'cited',
        savePreview: '[LESSON] compress MEMORY before think',
      },
      {
        at: '2026-07-16T09:20:00.000Z',
        npc: 'Roki',
        cited: true,
        soft: false,
        outcome: 'cited',
        savePreview: 'trimmed context per grok mentor',
      },
      {
        at: '2026-07-16T09:30:00.000Z',
        npc: 'Jenny',
        cited: false,
        soft: true,
        outcome: 'soft_miss',
        savePreview: 'still coding [lesson: consider applying recent mentor guidance]',
      },
      {
        at: '2026-07-16T09:40:00.000Z',
        npc: 'Dan',
        cited: false,
        soft: true,
        outcome: 'soft_miss',
        savePreview: 'wander to desk [lesson: consider applying recent mentor guidance]',
      },
      // Outside window — ignored
      {
        at: '2026-07-10T09:00:00.000Z',
        npc: 'Old',
        cited: true,
        soft: false,
        outcome: 'cited',
        savePreview: 'ancient cite',
      },
    ]);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  });

  it('buildLearningScorecard returns core P2.1 fields from fixtures', () => {
    const s = buildLearningScorecard({ dataDir, now: FIXED_NOW });

    assert.equal(s.ok, true);
    assert.ok(s.at);
    assert.equal(s.lessonsApplied24h, 2, 'two mentor lessons in 24h');
    // 2 pending + 1 answered without memory
    assert.equal(s.lessonsPending, 3);
    assert.equal(s.consultPending, 2);
    assert.equal(s.consultAnswered, 2);
    assert.equal(s.citationHits, 3);
    assert.equal(s.citationAttempts, 5);
    assert.equal(s.citationRate, 0.6);
    assert.equal(s.targetMet, true);
    assert.equal(s.citationSource, 'cite_events');
    assert.ok(Array.isArray(s.notes));
  });

  it('scorecard is ok with empty data dir', () => {
    const empty = path.join(tmpDir, 'empty-data');
    fs.mkdirSync(empty, { recursive: true });
    const s = buildLearningScorecard({ dataDir: empty, now: FIXED_NOW });
    assert.equal(s.ok, true);
    assert.equal(s.lessonsApplied24h, 0);
    assert.equal(s.lessonsPending, 0);
    assert.equal(s.citationHits, 0);
    assert.equal(s.citationRate, null);
    assert.equal(s.consultAnswered, 0);
    assert.equal(s.consultPending, 0);
  });

  it('falls back to harness lesson count when mentor log empty', () => {
    const d = path.join(tmpDir, 'harness-only');
    fs.mkdirSync(d, { recursive: true });
    writeJsonl(path.join(d, 'harness-learning.jsonl'), [
      {
        at: '2026-07-16T06:00:00.000Z',
        type: 'lesson',
        npc: 'Abby',
        preview: '[HARNESS LESSON] desk work',
      },
    ]);
    const s = buildLearningScorecard({ dataDir: d, now: FIXED_NOW });
    assert.equal(s.lessonsApplied24h, 1);
    assert.ok(s.notes.includes('lessons_from_harness_learning'));
  });

  it('recordCiteEvent appends jsonl and feeds scorecard', () => {
    const d = path.join(tmpDir, 'cite-live');
    fs.mkdirSync(d, { recursive: true });
    const r1 = recordCiteEvent({
      npc: 'Bob',
      cited: true,
      soft: false,
      save: 'Applying mentor lesson on latency',
      at: '2026-07-16T11:00:00.000Z',
    }, { dataDir: d });
    assert.equal(r1.ok, true);

    const r2 = recordCiteEvent({
      npc: 'Abby',
      cited: false,
      soft: true,
      _lessonCiteSoft: true,
      save: 'coding [lesson: consider applying recent mentor guidance]',
      at: '2026-07-16T11:05:00.000Z',
    }, { dataDir: d });
    assert.equal(r2.ok, true);

    const s = buildLearningScorecard({ dataDir: d, now: FIXED_NOW });
    assert.equal(s.citationAttempts, 2);
    assert.equal(s.citationHits, 1);
    assert.equal(s.citationRate, 0.5);
    assert.equal(s.targetMet, false);
    assert.ok(s.notes.includes('citation_rate_below_0.6_target'));
  });

  it('looksLikeCitation detects lesson language and rejects pure soft miss', () => {
    assert.equal(looksLikeCitation('Applying mentor lesson on caps'), true);
    assert.equal(looksLikeCitation('[LESSON] prune context'), true);
    assert.equal(
      looksLikeCitation('still on feature [lesson: consider applying recent mentor guidance]'),
      false,
    );
    assert.equal(looksLikeCitation('wander to kitchen'), false);
  });

  it('harness status() includes learning scorecard when module present', async () => {
    const { createDenizenHarness } = require('../src/denizen-harness');
    const h = createDenizenHarness({
      denizenRoot: path.join(__dirname, '..'),
    });
    const st = await h.status();
    assert.equal(st.ok, true);
    assert.ok(st.learning, 'learning key present');
    assert.equal(typeof st.learning.ok, 'boolean');
    assert.ok('lessonsApplied24h' in st.learning);
    assert.ok('citationRate' in st.learning);
    assert.ok('consultAnswered' in st.learning);
    assert.ok('consultPending' in st.learning);
    assert.ok(Array.isArray(st.learning.notes));
  });
});
