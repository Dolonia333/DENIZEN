'use strict';
/**
 * Tests for the OpenClaw dispatch classifier.
 *
 * Pure: text in, classification out. The browser-side dispatcher (which
 * actually POSTs / opens WebSockets) is not tested here — it's a thin
 * runner over this classifier and is tested manually in the browser.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classify,
  extractSearchQuery,
  extractBareSearchTopic,
  extractScreenObserveIntent,
  extractScreenControlIntent,
  extractComputerUseIntent,
  extractJobBoardSearchIntent,
  extractBrowserStatusIntent,
  extractOpenBrowserIntent,
  extractBrowserRetryIntent,
  extractBrowserReadIntent,
  isCancelUtterance,
  wantsLucyBrowserOpen,
  extractOpenBraveIntent,
  extractCloseBrowserIntent,
  extractResearchQueueIntent,
  extractResearchBriefIntent,
  isGreetingUtterance,
  isLucySearchIntent,
  isLucyStaffIntent,
  resolveStaffIntentNpc,
  isDenizenNativeIntent,
  evaluateActionPolicy,
  normalizePlayerUtterance,
} = require('../src/openclaw-dispatch.js');

describe('classify — empty / trivial', () => {
  it('empty → chat with confidence 0', () => {
    const c = classify('');
    assert.equal(c.kind, 'chat');
    assert.equal(c.confidence, 0);
  });
  it('whitespace only → chat', () => {
    assert.equal(classify('   ').kind, 'chat');
  });
  it('null / undefined → chat without throwing', () => {
    assert.equal(classify(null).kind, 'chat');
    assert.equal(classify(undefined).kind, 'chat');
  });
});

describe('classify — explicit prefixes', () => {
  it('/do prefix forces action', () => {
    const c = classify('/do refresh the cache');
    assert.equal(c.kind, 'action');
    assert.equal(c.confidence, 1);
    assert.equal(c.stripped, 'refresh the cache');
  });
  it('/run prefix forces action', () => {
    assert.equal(classify('/run github_create_pr').kind, 'action');
  });
  it('/say prefix forces chat', () => {
    const c = classify('/say deploy is the most fun');
    assert.equal(c.kind, 'chat');
    assert.equal(c.stripped, 'deploy is the most fun');
  });
});

describe('classify — chat markers', () => {
  it('greeting → chat', () => {
    assert.equal(classify('hello Abby').kind, 'chat');
    assert.equal(classify('hi everyone').kind, 'chat');
  });
  it('thanks → chat', () => {
    assert.equal(classify('thanks for the help').kind, 'chat');
    assert.equal(classify('thank you so much').kind, 'chat');
  });
  it('"how are you" → chat even when an action verb appears', () => {
    assert.equal(classify("how are you, ready to deploy?").kind, 'chat');
  });
});

describe('classify — imperative verbs', () => {
  it('"deploy v2 to staging" → action', () => {
    const c = classify('deploy v2 to staging');
    assert.equal(c.kind, 'action');
    assert.match(c.reason, /imperative/);
  });
  it('"build the project" → action', () => {
    assert.equal(classify('build the project').kind, 'action');
  });
  it('"run the tests" → action', () => {
    assert.equal(classify('run the tests').kind, 'action');
  });
  it('"check the logs" → action', () => {
    assert.equal(classify('check the logs').kind, 'action');
  });
});

describe('classify — polite imperatives', () => {
  it('"please deploy v2" → action', () => {
    const c = classify('please deploy v2');
    assert.equal(c.kind, 'action');
    assert.match(c.reason, /polite/);
  });
  it('"can you run the tests" → action (despite question form)', () => {
    const c = classify('can you run the tests?');
    assert.equal(c.kind, 'action');
  });
  it('"could you fix the auth bug" → action', () => {
    assert.equal(classify('could you fix the auth bug').kind, 'action');
  });
});

describe('classify — tool keyword presence', () => {
  it('two tool keywords → action even without imperative verb', () => {
    const c = classify('the github pull request needs another reviewer');
    assert.equal(c.kind, 'action');
    assert.match(c.reason, /tool keywords/);
  });
  it('one tool keyword + statement → action', () => {
    assert.equal(classify('this needs a database migration').kind, 'action');
  });
  it('one tool keyword + question → chat', () => {
    assert.equal(classify('does this need a database migration?').kind, 'chat');
  });
});

describe('classify — questions', () => {
  it('plain question → chat', () => {
    assert.equal(classify('what should we do next?').kind, 'chat');
  });
  it('"what is X" question → chat', () => {
    assert.equal(classify('what is the deploy schedule?').kind, 'chat');
  });
});

describe('classify — urgency', () => {
  it('"deploy now" sets urgent', () => {
    const c = classify('deploy v2 to staging right now');
    assert.equal(c.kind, 'action');
    assert.equal(c.urgent, true);
  });
  it('"deploy v2 asap" sets urgent', () => {
    assert.equal(classify('deploy v2 asap').urgent, true);
  });
  it('non-urgent action does not set urgent', () => {
    assert.equal(classify('deploy v2 to staging').urgent, false);
  });
});

describe('classify — stripped output', () => {
  it('stripped equals input when no prefix', () => {
    const c = classify('deploy v2');
    assert.equal(c.stripped, 'deploy v2');
  });
  it('stripped removes /do prefix and trims', () => {
    const c = classify('/do   deploy v2');
    assert.equal(c.stripped, 'deploy v2');
  });
});

describe('classify — confidence shape', () => {
  it('returns a number between 0 and 1', () => {
    for (const s of ['hi', 'deploy v2', 'thanks', '/run x', 'whatever']) {
      const c = classify(s);
      assert.ok(typeof c.confidence === 'number');
      assert.ok(c.confidence >= 0 && c.confidence <= 1, `${s} → ${c.confidence}`);
    }
  });
});

describe('extractSearchQuery', () => {
  it('pulls query from imperative search', () => {
    assert.equal(extractSearchQuery('search best mechanical keyboards 2024'), 'best mechanical keyboards 2024');
  });
  it('pulls query from Lucy-prefixed search', () => {
    assert.equal(extractSearchQuery('Lucy, search for remote dev jobs'), 'remote dev jobs');
  });
  it('pulls query from polite search', () => {
    assert.equal(extractSearchQuery('can you search AI agent frameworks'), 'AI agent frameworks');
  });
  it('handles serch typo and hey lucy prefix', () => {
    assert.equal(extractSearchQuery('hey lucy serch the web for dog types'), 'dog types');
  });
  it('does not treat dog types as a search when no search verb', () => {
    assert.equal(extractSearchQuery('tell me about dog types'), 'dog types');
  });
  it('handles natural lookup phrasing', () => {
    assert.equal(extractSearchQuery('what is LangSmith'), 'LangSmith');
    assert.equal(extractSearchQuery('find out about remote AI jobs'), 'remote AI jobs');
    assert.equal(extractSearchQuery('can you find info on LangSmith pricing'), 'LangSmith pricing');
    assert.equal(extractSearchQuery('look into competitor agent frameworks'), 'competitor agent frameworks');
    assert.equal(extractSearchQuery('look something up about goldendoodles'), 'goldendoodles');
  });
  it('rejects lookup about Lucy herself', () => {
    assert.equal(extractSearchQuery('what is your name'), null);
    assert.equal(extractSearchQuery('tell me about yourself'), null);
  });
  it('returns null for non-search chat', () => {
    assert.equal(extractSearchQuery('hello Lucy'), null);
    assert.equal(extractSearchQuery('deploy v2 to staging'), null);
  });
  it('does not search bare hostnames or screen-check phrases', () => {
    assert.equal(extractSearchQuery('n8n.dolonia.cloud'), null);
    assert.equal(extractSearchQuery('lucy i typed it for you now do you see it'), null);
    assert.equal(extractSearchQuery('find n8n.dolonia.cloud'), null);
  });
  it('still searches when user explicitly asks to search a hostname', () => {
    assert.equal(extractSearchQuery('search n8n.dolonia.cloud'), 'n8n.dolonia.cloud');
  });
  it('handles search up phrasing and strips on-the-browser suffix', () => {
    assert.equal(
      extractSearchQuery('hey Lucy search up Government Contracting on the browser'),
      'Government Contracting',
    );
    assert.equal(extractSearchQuery('play Lucy search up remote AI jobs'), 'remote AI jobs');
  });
  it('rejects bare "search the web" without a real topic', () => {
    assert.equal(extractSearchQuery('play Lucy can you search the web'), null);
    assert.equal(extractSearchQuery('search the web'), null);
    assert.equal(extractSearchQuery('hey Lucy search on the web'), null);
    assert.equal(extractSearchQuery('search'), null);
    assert.equal(extractSearchQuery('Lucy search the web for Goldendoodles'), 'Goldendoodles');
    assert.equal(extractSearchQuery('play Lucy key search the web for Goldendoodles'), 'Goldendoodles');
    assert.equal(extractSearchQuery('search on the web Goldendoodle'), 'Goldendoodle');
    assert.equal(extractSearchQuery('search on the web Goldendoodles'), 'Goldendoodles');
  });
});

describe('extractBareSearchTopic', () => {
  it('pulls bare topics for search continuation', () => {
    assert.equal(extractBareSearchTopic('Takis'), 'Takis');
    assert.equal(extractBareSearchTopic('Goldendoodles'), 'Goldendoodles');
    assert.equal(extractBareSearchTopic('search Takis'), null);
    assert.equal(extractBareSearchTopic('open the browser'), null);
  });
});

describe('extractComputerUseIntent', () => {
  it('routes browser form fills to Lucy computer-use', () => {
    const r = extractComputerUseIntent('help me complete this application');
    assert.ok(r);
    assert.match(r.instruction, /complete this application/i);
  });
  it('detects explicit computer-use / muse phrasing', () => {
    const r = extractComputerUseIntent('lucy use your browser and fill the form like muse would');
    assert.ok(r);
  });
  it('captures URL for start navigation', () => {
    const r = extractComputerUseIntent('go to https://example.com/apply and fill the form');
    assert.ok(r);
    assert.equal(r.url, 'https://example.com/apply');
  });
  it('does not steal CEO desktop / my-screen requests', () => {
    assert.equal(extractComputerUseIntent('lucy fill out this form on my screen'), null);
    assert.equal(extractComputerUseIntent('take over my computer and click submit'), null);
  });
});

describe('extractScreenControlIntent', () => {
  it('detects fill-out-on-screen requests', () => {
    assert.equal(extractScreenControlIntent('lucy fill out this form on my screen'), true);
    assert.equal(extractScreenControlIntent('bob type this for me on my computer'), true);
    // Bare form-fill without "my screen" goes to computer-use, not desktop-agent.
    assert.equal(extractScreenControlIntent('help me complete this application'), false);
  });
  it('does not steal read-only observe', () => {
    assert.equal(extractScreenControlIntent('do you see it'), false);
    assert.equal(extractScreenControlIntent('watch what im doing'), false);
    assert.equal(extractScreenControlIntent('enter John Smith into the CRM'), false);
    assert.equal(extractOpenBrowserIntent('open the CRM and add John Smith'), false);
  });
});

describe('extractScreenObserveIntent', () => {
  it('detects screen-check phrasing', () => {
    assert.equal(extractScreenObserveIntent('lucy i typed it for you now do you see it'), true);
    assert.equal(extractScreenObserveIntent('can you see what I opened'), true);
    assert.equal(extractScreenObserveIntent('hey lucy im on https://www.linkedin.com/feed/'), true);
    assert.equal(extractScreenObserveIntent('look for jobs on there'), true);
    assert.equal(extractScreenObserveIntent('bob watch what im doing in brave'), true);
    assert.equal(extractScreenObserveIntent('take a screenshot of my screen'), true);
  });
  it('returns false for web search phrasing', () => {
    assert.equal(extractScreenObserveIntent('search dog breeds'), false);
  });
});

describe('extractJobBoardSearchIntent', () => {
  it('routes indeed job searches to direct URL', () => {
    const r = extractJobBoardSearchIntent('hey lucy look up jobs on indeed');
    assert.ok(r);
    assert.equal(r.site, 'indeed');
    assert.match(r.url, /^https:\/\/www\.indeed\.com\/jobs/);
  });
  it('does not steal generic web search', () => {
    assert.equal(extractSearchQuery('search dog breeds'), 'dog breeds');
    assert.equal(extractSearchQuery('look up jobs on indeed'), null);
  });
});

describe('extractBrowserStatusIntent', () => {
  it('detects browser status questions', () => {
    assert.equal(extractBrowserStatusIntent('what browser are you using'), true);
  });
});

describe('extractOpenBraveIntent', () => {
  it('detects open brave requests', () => {
    assert.equal(extractOpenBraveIntent('open my brave browser'), true);
    assert.equal(extractOpenBraveIntent('hey lucy launch brave'), true);
    assert.equal(extractOpenBraveIntent('open the browser'), false);
  });
});

describe('fixVoiceMishearings', () => {
  const { fixVoiceMishearings } = require('../src/openclaw-dispatch');

  it('rewrites play Lucy STT mishearing to hey Lucy', () => {
    assert.equal(fixVoiceMishearings('play Lucy'), 'hey Lucy');
    assert.equal(fixVoiceMishearings('play Lucy open the web'), 'hey Lucy open the web');
    assert.equal(fixVoiceMishearings('Hey, Lucy. Open the web'), 'Hey, Lucy. Open the web');
    assert.equal(fixVoiceMishearings('your suck in the room'), "you're stuck in the room");
    assert.equal(fixVoiceMishearings('are you being bowerd by cloud'), 'are you being powered by cloud');
  });
});

describe('normalizePlayerUtterance', () => {
  it('strips play Lucy and hey Lucy prefixes', () => {
    assert.equal(normalizePlayerUtterance('play Lucy open the browser'), 'open the browser');
    assert.equal(normalizePlayerUtterance('hey Lucy search up jobs'), 'search up jobs');
    assert.equal(normalizePlayerUtterance('hey Lucy open the web'), 'open the web');
  });
});

describe('extractOpenBrowserIntent', () => {
  it('detects open browser requests', () => {
    assert.equal(extractOpenBrowserIntent('hey lucy open the browser'), true);
    assert.equal(extractOpenBrowserIntent('hey lucy open a browser'), true);
    assert.equal(extractOpenBrowserIntent('hey Lucy open the web'), true);
    assert.equal(extractOpenBrowserIntent('play Lucy open the web'), true);
    assert.equal(extractOpenBrowserIntent('hey Lucy can you open the web'), true);
    assert.equal(wantsLucyBrowserOpen('play Lucy can you open the web'), true);
    assert.equal(extractOpenBrowserIntent('play Lucy open a browser on the web'), true);
    assert.equal(extractOpenBrowserIntent('play Lucy culture browser'), true);
    assert.equal(extractOpenBrowserIntent('launch your browser'), true);
    assert.equal(extractOpenBrowserIntent('hey lucy open the broser'), true);
    assert.equal(extractOpenBrowserIntent('Lucy open up a browser'), true);
    assert.equal(extractOpenBrowserIntent('open up the browser'), true);
    assert.equal(wantsLucyBrowserOpen('Lucy open up a browser and do it again'), true);
  });
  it('does not steal search or desktop app opens', () => {
    assert.equal(extractOpenBrowserIntent('open notepad'), false);
    assert.equal(extractOpenBrowserIntent('search jobs on indeed'), false);
  });
});

describe('isCancelUtterance / extractBareSearchTopic cancel', () => {
  it('detects voice cut-off cancel phrases', () => {
    assert.equal(isCancelUtterance('no Luc'), true);
    assert.equal(isCancelUtterance('no Lucy'), true);
    assert.equal(isCancelUtterance('stop'), true);
    assert.equal(isCancelUtterance('cancel that'), true);
  });
  it('does not treat cancel as a bare search topic', () => {
    assert.equal(extractBareSearchTopic('no Luc'), null);
    assert.equal(extractBareSearchTopic('stop'), null);
  });
});

describe('extractBrowserReadIntent', () => {
  it('detects read doc in browser phrasing', () => {
    assert.equal(extractBrowserReadIntent('lucy, read over this doc in browser'), true);
    assert.equal(extractBrowserReadIntent('read over this doc in browswer'), true);
    assert.equal(extractBrowserReadIntent('summarize this page in the browser'), true);
  });
  it('ignores unrelated chat', () => {
    assert.equal(extractBrowserReadIntent('read my email'), false);
    assert.equal(extractBrowserReadIntent('search Goldendoodles'), false);
  });
});

describe('extractBrowserRetryIntent', () => {
  it('detects open browser and retry phrasing', () => {
    const r = extractBrowserRetryIntent('Lucy open up a browser and do it again');
    assert.ok(r);
    assert.equal(r.openBrowser, true);
    assert.equal(r.retrySearch, true);
    const r2 = extractBrowserRetryIntent('open up the browser and search it again');
    assert.ok(r2);
    assert.equal(r2.openBrowser, true);
    assert.equal(r2.retrySearch, true);
  });
  it('detects bare try again after a failed search', () => {
    const r = extractBrowserRetryIntent('try again');
    assert.ok(r);
    assert.equal(r.retrySearch, true);
    assert.equal(r.openBrowser, false);
  });
});

describe('resolveStaffIntentNpc / search query cleanup', () => {
  it('routes bare web search to Lucy even when proximity picked another NPC', () => {
    assert.equal(
      resolveStaffIntentNpc('hey can you search the web for anything regarding AI workflows', 'Rob'),
      'Lucy',
    );
    assert.equal(isLucyStaffIntent('search the web for AI workloads'), true);
  });
  it('strips filler from search topics', () => {
    assert.equal(
      extractSearchQuery('hey can you search the web for anything regarding AI workflows'),
      'AI workflows',
    );
    assert.equal(
      extractSearchQuery('Lucy do you look up anything regarding AI workloads'),
      'AI workloads',
    );
  });
  it('keeps plain chat with a named NPC on that NPC', () => {
    assert.equal(resolveStaffIntentNpc('hey Rob how is the mood indicator', 'Rob'), 'Rob');
  });
});

describe('isGreetingUtterance / isLucySearchIntent', () => {
  it('detects greetings without LM Studio', () => {
    assert.equal(isGreetingUtterance('hey Lucy'), true);
    assert.equal(isGreetingUtterance('hi'), true);
    assert.equal(isGreetingUtterance('search jobs'), false);
  });
  it('detects incomplete search phrasing', () => {
    assert.equal(isLucySearchIntent('can you search the web for'), true);
    assert.equal(isLucySearchIntent('search Goldendoodles'), true);
    assert.equal(isLucySearchIntent('deploy to staging'), false);
  });
});

describe('isDenizenNativeIntent / evaluateActionPolicy', () => {
  it('incomplete search bypasses confirm policy', () => {
    const text = 'can you search the web for';
    assert.equal(isDenizenNativeIntent(text), true);
    const gate = evaluateActionPolicy(text, classify(text));
    assert.equal(gate.allowed, true);
  });
  it('browser open bypasses confirm policy', () => {
    const text = 'play Lucy open a browser on the web';
    assert.equal(isDenizenNativeIntent(text), true);
    const gate = evaluateActionPolicy(text, classify(text));
    assert.equal(gate.allowed, true);
    assert.match(gate.reason, /denizen-native/);
  });
});

describe('extractCloseBrowserIntent', () => {
  it('detects close browser commands', () => {
    assert.equal(extractCloseBrowserIntent('close the browser now'), true);
    assert.equal(extractCloseBrowserIntent('lucy close the broser'), true);
  });
});

describe('extractResearchQueueIntent', () => {
  it('pulls topic from add-to-list phrasing', () => {
    assert.deepEqual(
      extractResearchQueueIntent('add LangSmith pricing to my research list'),
      { topic: 'LangSmith pricing' },
    );
  });
  it('pulls topic from queue research phrasing', () => {
    assert.deepEqual(
      extractResearchQueueIntent('queue research on competitor agent frameworks'),
      { topic: 'competitor agent frameworks' },
    );
  });
  it('handles Lucy prefix and optional priority', () => {
    assert.deepEqual(
      extractResearchQueueIntent('Lucy, add Phoenix eval tools to research queue priority high'),
      { topic: 'Phoenix eval tools', priority: 'high' },
    );
  });
  it('returns null for list-status questions', () => {
    assert.equal(extractResearchQueueIntent("what's on my research list"), null);
    assert.equal(extractResearchQueueIntent('show my research queue'), null);
  });
  it('returns null for unrelated chat', () => {
    assert.equal(extractResearchQueueIntent('hello Lucy'), null);
    assert.equal(extractResearchQueueIntent('search dog breeds'), null);
  });
});

describe('extractResearchBriefIntent', () => {
  it('pulls topic from research-and-brief phrasing', () => {
    assert.equal(
      extractResearchBriefIntent('research Phoenix eval tooling and write a brief'),
      'Phoenix eval tooling',
    );
  });
  it('pulls topic from deep research phrasing', () => {
    assert.equal(
      extractResearchBriefIntent('deep research on Langfuse vs Arize'),
      'Langfuse vs Arize',
    );
  });
  it('handles polite Lucy-prefixed brief request', () => {
    assert.equal(
      extractResearchBriefIntent('Lucy, can you write a brief on agent memory patterns'),
      'agent memory patterns',
    );
  });
  it('returns null for queue-add phrasing', () => {
    assert.equal(extractResearchBriefIntent('add dog types to research list'), null);
  });
  it('returns null for quick search phrasing', () => {
    assert.equal(extractResearchBriefIntent('search best mechanical keyboards'), null);
  });
});
