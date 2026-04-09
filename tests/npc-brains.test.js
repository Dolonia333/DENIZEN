/**
 * Tests for NpcBrainManager fallback logic (src/npc-brains.js)
 *
 * The constructor reads files from disk (openclaw.json, SOUL.md files),
 * so we mock `fs` to avoid real file I/O and isolate the logic under test.
 */

const fs = require('fs');
const path = require('path');

// Mock fs so the constructor doesn't try to read real config files
jest.mock('fs', () => ({
  readFileSync: jest.fn(() => { throw new Error('mock: file not found'); }),
  appendFileSync: jest.fn(),
  existsSync: jest.fn(() => false),
}));

const NpcBrainManager = require('../src/npc-brains.js');

describe('NpcBrainManager', () => {
  let manager;

  beforeEach(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    manager = new NpcBrainManager();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── _cannedResponse ───────────────────────────────────────────────

  describe('_cannedResponse', () => {
    test('returns a string', () => {
      const result = manager._cannedResponse('Alex', 'Abby', 'hello');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('returns bug-related response for developer when message mentions bugs', () => {
      // Alex has title "Senior Developer — team lead"
      const result = manager._cannedResponse('Alex', 'Abby', 'There is a bug in the login page');
      expect(result).toBe('On it, checking the code now.');
    });

    test('returns QA-specific response for QA engineer on bug messages', () => {
      const result = manager._cannedResponse('Molly', 'Abby', 'We found a critical error');
      expect(result).toBe("I'll write a test for that.");
    });

    test('returns DevOps-specific response for DevOps engineer on bug messages', () => {
      const result = manager._cannedResponse('Oscar', 'Abby', 'Something crashed in production');
      expect(result).toBe('Let me check the logs.');
    });

    test('returns deploy-related response for DevOps engineer', () => {
      const result = manager._cannedResponse('Oscar', 'Abby', 'Can you deploy the latest build?');
      expect(result).toBe('Running the pipeline now.');
    });

    test('returns meeting response for any NPC', () => {
      const result = manager._cannedResponse('Bob', 'Abby', 'We have a standup in 5 minutes');
      expect(result).toBe("I'll be there. Let me wrap this up.");
    });

    test('returns review response for developer', () => {
      const result = manager._cannedResponse('Josh', 'Alex', 'Can you review my PR?');
      expect(result).toBe("I'll review it this afternoon.");
    });

    test('returns design response for designer', () => {
      const result = manager._cannedResponse('Rob', 'Sarah', 'We need a new mockup for the dashboard');
      expect(result).toBe('I have some ideas. Let me sketch it.');
    });

    test('returns research response for researcher', () => {
      const result = manager._cannedResponse('Bob', 'Abby', 'Can you research competitive analysis?');
      expect(result).toBe("I'll dig into the data.");
    });

    test('returns manager response when manager asks subordinate for help', () => {
      // Alex manages Josh, so if Josh says "help" to Alex:
      const result = manager._cannedResponse('Alex', 'Josh', 'I need help with this feature');
      expect(result).toBe("Show me what you've got so far.");
    });

    test('returns generic role-based response for unmatched messages', () => {
      // Give it a message that doesn't match any keyword patterns
      const result = manager._cannedResponse('Lucy', 'Abby', 'lorem ipsum xyz');
      // Lucy's full title includes extra text so it falls to the default generic array
      const possibleResponses = ['Got it.', 'Sure thing.', 'Working on it.', 'Sounds good.'];
      expect(possibleResponses).toContain(result);
    });
  });

  // ── _smartFallback ────────────────────────────────────────────────

  describe('_smartFallback', () => {
    test('returns a string containing an ACTION tag', () => {
      const h = manager._hierarchy['Alex'];
      const result = manager._smartFallback('Alex', 'Fix the login bug', h);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/\[ACTION:/);
    });

    test('returns callMeeting action for meeting requests with everyone', () => {
      const h = manager._hierarchy['Abby'];
      const result = manager._smartFallback('Abby', 'Call a meeting with everyone', h);
      expect(result).toMatch(/\[ACTION:callMeeting:/);
    });

    test('returns callMeeting action mentioning a specific person', () => {
      const h = manager._hierarchy['Abby'];
      const result = manager._smartFallback('Abby', 'Set up a meeting with Alex', h);
      expect(result).toMatch(/\[ACTION:callMeeting:Alex\]/);
    });

    test('returns speakTo action when asked to talk to someone', () => {
      const h = manager._hierarchy['Abby'];
      const result = manager._smartFallback('Abby', 'Go tell Josh to fix the navbar', h);
      expect(result).toMatch(/\[ACTION:speakTo:Josh:/);
    });

    test('developer goes to desk for coding tasks', () => {
      const h = manager._hierarchy['Alex'];
      const result = manager._smartFallback('Alex', 'Fix the authentication module', h);
      expect(result).toMatch(/\[ACTION:useComputer\]/);
    });

    test('non-developer delegates coding tasks to a developer', () => {
      const h = manager._hierarchy['Marcus'];
      const result = manager._smartFallback('Marcus', 'Build a new dashboard feature', h);
      expect(result).toMatch(/\[ACTION:speakTo:/);
      expect(result).toMatch(/\[DELEGATE:/);
    });

    test('researcher checks bookshelf for research tasks', () => {
      const h = manager._hierarchy['Bob'];
      const result = manager._smartFallback('Bob', 'Research the latest market trends', h);
      expect(result).toMatch(/\[ACTION:checkBookshelf\]/);
    });

    test('QA engineer handles testing tasks', () => {
      const h = manager._hierarchy['Molly'];
      const result = manager._smartFallback('Molly', 'Test the checkout flow', h);
      expect(result).toMatch(/\[ACTION:useComputer\]/);
    });

    test('returns goToBreakroom for break room requests', () => {
      const h = manager._hierarchy['Alex'];
      const result = manager._smartFallback('Alex', 'Go to the break room for coffee', h);
      expect(result).toMatch(/\[ACTION:goToBreakroom\]/);
    });

    test('returns goToRoom for conference room requests', () => {
      const h = manager._hierarchy['Alex'];
      const result = manager._smartFallback('Alex', 'Go to the conference room', h);
      expect(result).toMatch(/\[ACTION:goToRoom:conference\]/);
    });

    test('returns generic useComputer action for unrecognized messages', () => {
      const h = manager._hierarchy['Alex'];
      const result = manager._smartFallback('Alex', 'lorem ipsum', h);
      expect(result).toMatch(/\[ACTION:useComputer\]/);
    });

    test('delegates to mentioned person for unrecognized messages', () => {
      const h = manager._hierarchy['Abby'];
      const result = manager._smartFallback('Abby', 'something random about Josh', h);
      expect(result).toMatch(/\[ACTION:speakTo:Josh:/);
    });
  });
});
