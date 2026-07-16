'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseMemoryLines,
  scoreLine,
  retrieveMemory,
  retrieveMemoryOrFallback,
  selectTopLines,
  buildQueryFromContext,
  tokenize,
} = require('../src/denizen-memory-retrieve');

const SYNTHETIC_MEMORY = `
# Lucy Memory

- [2026-07-01T10:00] Met the CEO for the first time at reception.
- [2026-07-02T11:00] [OUTCOME:ok] Scheduled a standup with Alex and Josh.
- [2026-07-03T09:00] [FACT:email_triage] Flagged three urgent investor emails for CEO review.
- [2026-07-04T14:00] Visited the breakroom. (spoke to Molly)
- [2026-07-05T08:00] [LESSON] When context overflows, compress recentMemory and prune SOUL-adjacent fluff.
- [2026-07-06T16:00] [OUTCOME:ok] Booked conference room for Marcus product demo.
- [2026-07-07T12:00] [SKILL:research] Summarized LLM latency paper for Pier.
- [2026-07-08T15:00] Small talk with Bob about coffee machine.
- [2026-07-09T10:00] [FACT:calendar] Sprint 5 planning is Thursday 2pm.
- [2026-07-10T11:00] [COMMIT] Promised CEO a daily inbox digest by 9am.
- [2026-07-11T13:00] Wandered near plants. Nothing notable.
- [2026-07-12T09:00] [OUTCOME:ok] Visited Dan's desk. (spoke to Dan, my peer)
`.trim();

describe('denizen-memory-retrieve', () => {
  it('parseMemoryLines drops blanks and trims', () => {
    const lines = parseMemoryLines('  a\n\n\nb  \n\n');
    assert.deepEqual(lines, ['a', 'b']);
  });

  it('tokenize drops stopwords', () => {
    const toks = tokenize('the CEO asked about investor emails and the calendar');
    assert.ok(toks.includes('ceo'));
    assert.ok(toks.includes('investor'));
    assert.ok(toks.includes('emails'));
    assert.ok(!toks.includes('the'));
    assert.ok(!toks.includes('and'));
  });

  it('scoreLine ranks keyword overlap higher than unrelated lines', () => {
    const q = 'investor emails triage for CEO';
    const hit = scoreLine(q, '- [FACT:email_triage] Flagged three urgent investor emails for CEO review.');
    const miss = scoreLine(q, '- Wandered near plants. Nothing notable.');
    assert.ok(hit > miss);
    assert.ok(hit > 1);
    assert.equal(scoreLine('', 'anything'), 0);
  });

  it('selectTopLines returns top-k relevant lines within maxChars', () => {
    const lines = parseMemoryLines(SYNTHETIC_MEMORY);
    const out = selectTopLines(lines, 'investor email triage digest CEO', { k: 3, maxChars: 500 });
    assert.ok(out.lines.length >= 1 && out.lines.length <= 3);
    assert.ok(out.text.length <= 500);
    const blob = out.text.toLowerCase();
    assert.ok(
      blob.includes('investor') || blob.includes('email') || blob.includes('digest') || blob.includes('ceo'),
      `expected retrieval to mention query terms, got: ${out.text}`,
    );
  });

  it('selectTopLines falls back to recent lines when query empty', () => {
    const lines = parseMemoryLines(SYNTHETIC_MEMORY);
    const out = selectTopLines(lines, '', { k: 2, maxChars: 800 });
    assert.equal(out.lines.length, 2);
    assert.ok(out.lines[out.lines.length - 1].includes("Dan's desk"));
  });

  it('retrieveMemory uses opts.text (no GPU, no disk required)', () => {
    const result = retrieveMemory('lucy', 'Sprint 5 planning calendar Thursday', {
      text: SYNTHETIC_MEMORY,
      k: 4,
      maxChars: 600,
    });
    assert.equal(result.source, 'text');
    assert.equal(result.method, 'keyword');
    assert.ok(result.count >= 1);
    assert.match(result.text, /Sprint 5|calendar|Thursday/i);
    assert.ok(result.text.length <= 600);
  });

  it('retrieveMemory prefers research skill line for research query', () => {
    const result = retrieveMemory('Lucy', 'research paper latency for Pier', {
      text: SYNTHETIC_MEMORY,
      k: 3,
      maxChars: 500,
    });
    assert.match(result.text, /research|latency|Pier/i);
  });

  it('retrieveMemoryOrFallback returns last-N when query has no overlap', () => {
    const result = retrieveMemoryOrFallback('lucy', 'zzzznotatokenzzzz', {
      text: SYNTHETIC_MEMORY,
      maxChars: 180,
    });
    // No keyword hits → fallback path may still return recency selection from retrieveMemory
    // or explicit last-N; either way we get non-empty bounded text.
    assert.ok(result.length > 0);
    assert.ok(result.length <= 180);
  });

  it('buildQueryFromContext joins useful fields', () => {
    const q = buildQueryFromContext({
      message: 'What about the inbox?',
      fromName: 'CEO',
      task: 'email triage',
      location: 'reception',
    });
    assert.match(q, /inbox/);
    assert.match(q, /CEO/);
    assert.match(q, /email triage/);
    assert.match(q, /reception/);
  });

  it('retrieveMemory reads MEMORY.md from a temp npcs folder', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-mem-'));
    const npcDir = path.join(tmp, 'lucy');
    fs.mkdirSync(npcDir, { recursive: true });
    fs.writeFileSync(path.join(npcDir, 'MEMORY.md'), SYNTHETIC_MEMORY, 'utf8');

    const result = retrieveMemory('lucy', 'conference room product demo Marcus', {
      npcsDir: tmp,
      k: 3,
      maxChars: 400,
    });
    assert.equal(result.source, 'file');
    assert.match(result.text, /conference|Marcus|demo/i);

    // cleanup
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('retrieveMemory returns empty for missing file without throwing', () => {
    const result = retrieveMemory('no_such_npc_xyz', 'anything', {
      npcsDir: path.join(os.tmpdir(), 'denizen-missing-npcs-dir'),
    });
    assert.equal(result.text, '');
    assert.equal(result.source, 'missing');
  });
});
