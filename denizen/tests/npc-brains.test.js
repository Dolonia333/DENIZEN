'use strict';
/**
 * Tests for NpcBrainManager — covers demo mode detection, canned responses,
 * and smart fallback action-tag generation. All tests run without real API keys.
 * Uses Node.js built-in test runner (node:test) — no extra dependencies.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Isolate tests from the developer's real ~/.openclaw/openclaw.json.
// NpcBrainManager reads USERPROFILE/HOME to find the config file; pointing
// those at an empty temp dir forces the "no config" code path and keeps the
// test deterministic across machines.
const origHome = process.env.HOME;
const origUser = process.env.USERPROFILE;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-test-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const NpcBrainManager = require('../src/npc-brains.js');

// ---------------------------------------------------------------------------
// Test fixture: shared manager instance (expensive to construct due to file I/O)
// ---------------------------------------------------------------------------

let mgr;

before(() => {
  // Constructor reads openclaw.json (absent in our temp HOME → demo mode)
  // and SOUL.md files. Both failures are handled silently, so this is safe
  // to call unconditionally.
  mgr = new NpcBrainManager();
});

after(() => {
  // Restore env + clean up temp dir so nothing leaks into other suites.
  if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
  if (origUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUser;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

describe('demo mode', () => {
  it('_demoMode is true when no config file is present', () => {
    // In a clean test environment there is no ~/.openclaw/openclaw.json
    // The constructor falls through to demo provider only → _demoMode must be true
    assert.equal(mgr._demoMode, true);
  });

  it('demo provider is always registered', () => {
    assert.ok('demo' in mgr.providers);
    assert.equal(mgr.providers.demo.type, 'demo');
  });
});

// ---------------------------------------------------------------------------
// _cannedResponse — keyword-based role responses
// ---------------------------------------------------------------------------

describe('_cannedResponse', () => {
  it('developer NPC returns code-action response for bug message', () => {
    // Alex is a Senior Developer
    const reply = mgr._cannedResponse('Alex', 'Player', 'there is a bug in the login flow');
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });

  it('QA NPC returns test-related response for bug message', () => {
    // Molly is QA Engineer
    const reply = mgr._cannedResponse('Molly', 'Player', 'we found a bug');
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });

  it('DevOps NPC returns log/pipeline response for deploy message', () => {
    // Oscar is DevOps Engineer
    const reply = mgr._cannedResponse('Oscar', 'Player', 'deploy the new version');
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });

  it('any NPC acknowledges a meeting request', () => {
    const reply = mgr._cannedResponse('Lucy', 'Player', 'can we have a standup meeting?');
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });

  it('designer NPC returns sketch/design response for UI message', () => {
    // Rob is UI/UX Designer
    const reply = mgr._cannedResponse('Rob', 'Player', 'we need a new mockup for the UI');
    assert.match(reply, /sketch|ideas|design/i);
  });

  it('returns a string for an unknown/generic message', () => {
    const reply = mgr._cannedResponse('Bob', 'Player', 'what are you working on?');
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });
});

// ---------------------------------------------------------------------------
// _parseDelegateTag
// ---------------------------------------------------------------------------

describe('_parseDelegateTag', () => {
  it('splits name and reason on first colon only', () => {
    const p = mgr._parseDelegateTag('OK [DELEGATE:Alex:see doc: section 2]');
    assert.equal(p.delegateTo, 'Alex');
    assert.equal(p.reason, 'see doc: section 2');
    assert.equal(p.fullMatch, '[DELEGATE:Alex:see doc: section 2]');
  });

  it('allows colons in reason (Molly / QA)', () => {
    const t = mgr._parseDelegateTag('OK [DELEGATE:Molly:ask QA: use case A]');
    assert.ok(t);
    assert.equal(t.delegateTo, 'Molly');
    assert.equal(t.reason, 'ask QA: use case A');
  });

  it('allows empty reason', () => {
    const p = mgr._parseDelegateTag('[DELEGATE:Molly:]');
    assert.equal(p.delegateTo, 'Molly');
    assert.equal(p.reason, '');
  });

  it('returns null when malformed', () => {
    assert.equal(mgr._parseDelegateTag('[DELEGATE:Molly]'), null);
    assert.equal(mgr._parseDelegateTag('no tag'), null);
  });
});

// ---------------------------------------------------------------------------
// _smartFallback — action tag generation
// ---------------------------------------------------------------------------

describe('_isGreetingOnly / _greetingReply', () => {
  it('detects bare greetings and NPC-addressed hellos', () => {
    assert.equal(mgr._isGreetingOnly('hi', 'Lucy'), true);
    assert.equal(mgr._isGreetingOnly('hey lucy', 'Lucy'), true);
    assert.equal(mgr._isGreetingOnly('yo lucy', 'Lucy'), true);
    assert.equal(mgr._isGreetingOnly('play Lucy', 'Lucy'), true);
    assert.equal(mgr._isGreetingOnly('hey Lucy open the web', 'Lucy'), false);
    assert.equal(mgr._isGreetingOnly('play Lucy open the web', 'Lucy'), false);
    assert.equal(mgr._isGreetingOnly('hello Lucy!', 'Lucy'), true);
    assert.equal(mgr._isGreetingOnly('search remote jobs', 'Lucy'), false);
  });

  it('returns instant Lucy greeting without LLM', () => {
    const reply = mgr._greetingReply('Lucy', mgr._hierarchy.Lucy);
    assert.match(reply, /search|browser|dig/i);
  });
});

describe('_smartFallback', () => {
  function h(npcName) {
    return mgr._hierarchy[npcName];
  }

  it('developer NPC + code task → [ACTION:useComputer]', () => {
    const reply = mgr._smartFallback('Alex', 'fix the authentication bug', h('Alex'));
    assert.ok(reply.includes('[ACTION:useComputer]'), `Expected [ACTION:useComputer] in: ${reply}`);
  });

  it('meeting request for team → [ACTION:callMeeting:...]', () => {
    const reply = mgr._smartFallback('Abby', 'call a meeting with everyone', h('Abby'));
    assert.ok(reply.includes('[ACTION:callMeeting:'), `Expected [ACTION:callMeeting: in: ${reply}`);
  });

  it('meeting with named person → includes that person in action', () => {
    const reply = mgr._smartFallback('Abby', 'set up a meeting with Alex', h('Abby'));
    assert.ok(reply.includes('[ACTION:callMeeting:Alex]'), `Expected [ACTION:callMeeting:Alex] in: ${reply}`);
  });

  it('"talk to X" → [ACTION:speakTo:X:...]', () => {
    const reply = mgr._smartFallback('Abby', 'talk to Alex about the sprint', h('Abby'));
    assert.ok(reply.includes('[ACTION:speakTo:Alex:'), `Expected [ACTION:speakTo:Alex: in: ${reply}`);
  });

  it('reply is always a non-empty string', () => {
    const reply = mgr._smartFallback('Lucy', 'what is going on?', h('Lucy'));
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Reasoning-model leak stripping (Ministral / DeepSeek-R1 style)
// ---------------------------------------------------------------------------

describe('reasoning leak stripping', () => {
  it('_isReasoningLeak detects Thinking Process meta', () => {
    assert.equal(
      mgr._isReasoningLeak('Thinking Process: 1. **Analyze the Request**'),
      true
    );
    assert.equal(
      mgr._isReasoningLeak('Analyze the Request: The user is roleplaying as the CEO asking Bouncer'),
      true
    );
    assert.equal(mgr._isReasoningLeak('Mm. Brute force at the door. Handled it.'), false);
  });

  it('_bouncerIncidentFallback builds a spoken report from incident context', () => {
    const msg = [
      'You just caught a HIGH brute_force threat.',
      'Detail: 12 failed logins from 192.168.1.232.',
      'Countermeasure you set up: added a 3-strike lockout on that door.',
    ].join(' ');
    const out = mgr._bouncerIncidentFallback(msg);
    assert.match(out, /brute force/i);
    assert.match(out, /lockout/i);
    assert.equal(mgr._isReasoningLeak(out), false);
  });

  it('_cleanDisplayText strips Thinking Process for Bouncer', () => {
    const raw = 'Thinking Process: 1. **Analyze** * **Role:** Bouncer. Mm. Brute force at reception — handled it. Eyes open.';
    const out = mgr._cleanDisplayText(raw, 'Bouncer');
    assert.ok(!/Thinking\s*Process/i.test(out), `still leaked: ${out}`);
    assert.match(out, /brute force|handled|eyes open/i);
  });

  it('getResponse fast-paths Bouncer incident reports without LLM', async () => {
    const msg = [
      'You just caught a high brute_force threat.',
      'Detail: Rate limit exceeded: 101 req/min from ::ffff:192.168.1.232.',
      'When you confronted them: they held their ground — threat is still active, keep your eyes open.',
      'Countermeasure you set up: added a 3-strike lockout on that door and flagged the access logs.',
    ].join(' ');
    const out = await mgr.getResponse('Bouncer', 'CEO', msg, { kind: 'incident-report' });
    assert.equal(mgr._isReasoningLeak(out), false);
    assert.match(out, /brute force/i);
    assert.match(out, /lockout|flagged/i);
    assert.match(out, /eyes open|all clear/i);
  });
});

// ---------------------------------------------------------------------------
// Visitor-scoped autonomous skills
// ---------------------------------------------------------------------------

describe('allowAutonomousSkillRun visitor tier', () => {
  it('blocks real skills for demo visitor-scoped think cycles', () => {
    const gate = mgr.allowAutonomousSkillRun('Alex', {
      skill: 'web-search',
      officeContext: { visitorScoped: true, canUseRealWork: false },
    });
    assert.equal(gate.allowed, false);
    assert.match(gate.reason, /demo/i);
  });

  it('allows real skills for team visitor-scoped think cycles', () => {
    mgr._lastRunSkillAt.set('Alex', 0);
    const gate = mgr.allowAutonomousSkillRun('Alex', {
      skill: 'web-search',
      officeContext: { visitorScoped: true, canUseRealWork: true },
    });
    assert.equal(gate.allowed, true);
  });

  it('_resolveAutonomousRealWork respects visitor scope', () => {
    assert.equal(
      mgr._resolveAutonomousRealWork('Alex', { visitorScoped: true, canUseRealWork: false }),
      false,
    );
    assert.equal(
      mgr._resolveAutonomousRealWork('Alex', { visitorScoped: true, canUseRealWork: true }),
      true,
    );
    const promptTuning = require('../src/prompt-tuning.js');
    assert.equal(
      mgr._resolveAutonomousRealWork('Alex', { visitorScoped: false }),
      promptTuning?.realWorkMode !== false,
    );
  });
});

// ---------------------------------------------------------------------------
// Hierarchy sanity
// ---------------------------------------------------------------------------

describe('_hierarchy', () => {
  it('all 16 expected NPCs are present', () => {
    const expected = [
      'Abby', 'Marcus', 'Sarah', 'Alex', 'Josh', 'Edward',
      'Roki', 'Jenny', 'Molly', 'Rob', 'Oscar', 'Pier',
      'Bob', 'Dan', 'Lucy', 'Bouncer',
    ];
    for (const name of expected) {
      assert.ok(name in mgr._hierarchy, `Missing NPC: ${name}`);
    }
  });

  it('each hierarchy entry has required fields', () => {
    for (const [name, entry] of Object.entries(mgr._hierarchy)) {
      assert.ok('title'     in entry, `${name} missing title`);
      assert.ok('manages'   in entry, `${name} missing manages`);
      assert.ok('reportsTo' in entry, `${name} missing reportsTo`);
      assert.ok(Array.isArray(entry.manages), `${name}.manages not an array`);
    }
  });
});
