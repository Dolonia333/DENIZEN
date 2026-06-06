'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const denizenDb = require('../src/denizen-db.js');
const citedResearch = require('../src/visitor-cited-research.js');
const mcpConnector = require('../src/denizen-mcp-connector.js');
const {
  extractCommitmentsFromText,
  extractPreferencesFromText,
  buildMorningBriefing,
  getProfile,
  upsertProfile,
  addCommitment,
  listCommitments,
  IntelligenceError,
  intelligenceErrorStatus,
  buildBriefingBroadcast,
  buildProactiveBroadcast,
} = require('../src/denizen-visitor-intelligence.js');

const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_ID = '11111111-1111-1111-1111-111111111111';

describe('visitor-cited-research', () => {
  it('detects research intent', () => {
    assert.equal(citedResearch.looksLikeResearchQuery('research competitor pricing'), true);
    assert.equal(citedResearch.looksLikeResearchQuery('hello there'), false);
  });

  it('extracts query from natural language', () => {
    const q = citedResearch.extractResearchQuery('please look up Acme Corp revenue');
    assert.match(q, /Acme Corp revenue/i);
  });
});

describe('denizen-mcp-connector', () => {
  it('lists configured servers', () => {
    const servers = mcpConnector.listServers();
    assert.ok(Array.isArray(servers));
  });
});

describe('denizen-visitor-intelligence', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    denizenDb.enabled = true;
    denizenDb.orgId = ORG_ID;
    denizenDb.url = 'http://127.0.0.1:54321';
    denizenDb.key = 'test-key';

    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method, body });

      if (url.includes('denizen_visitor_profiles') && method === 'GET') {
        return { ok: true, json: async () => [] };
      }
      if (url.includes('denizen_visitor_profiles') && method === 'POST') {
        return {
          ok: true,
          json: async () => [{ session_id: SESSION_ID, preferences: body.preferences || [], vips: [] }],
        };
      }
      if (url.includes('denizen_visitor_sessions') && url.includes('denizen_user_assistants')) {
        return {
          ok: true,
          json: async () => [{ id: SESSION_ID, display_name: 'Alex' }],
        };
      }
      if (url.includes('denizen_visitor_sessions?id=')) {
        return {
          ok: true,
          json: async () => [{ id: SESSION_ID, display_name: 'Alex' }],
        };
      }
      if (url.includes('denizen_user_assistants')) {
        return {
          ok: true,
          json: async () => [{
            npc_key: 'bob',
            assistant_name: 'Bob',
            denizen_npcs: { display_name: 'Bob' },
          }],
        };
      }
      if (url.includes('denizen_user_projects')) {
        return { ok: true, json: async () => [{ name: 'RFP Alpha', status: 'active' }] };
      }
      if (url.includes('denizen_assistant_messages')) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes('denizen_visitor_commitments')) {
        if (method === 'POST') {
          return {
            ok: true,
            json: async () => [{ id: 'c1', text: body.text, status: 'open', session_id: SESSION_ID }],
          };
        }
        return { ok: true, json: async () => [] };
      }
      if (url.includes('denizen_predictions')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => [] };
    };

    denizenDb._get = async (path) => {
      calls.push({ path, method: 'GET' });
      if (path.includes('denizen_visitor_profiles')) return [];
      if (path.includes('denizen_visitor_sessions') && path.includes('denizen_user_assistants')) {
        return [{ id: SESSION_ID, display_name: 'Alex' }];
      }
      if (path.includes('denizen_visitor_sessions') && path.includes('id=eq.')) {
        return [{ id: SESSION_ID, display_name: 'Alex' }];
      }
      if (path.includes('denizen_user_assistants')) {
        return [{
          npc_key: 'bob',
          assistant_name: 'Bob',
          denizen_npcs: { display_name: 'Bob' },
        }];
      }
      if (path.includes('denizen_user_projects')) {
        return [{ name: 'RFP Alpha', status: 'active' }];
      }
      if (path.includes('denizen_assistant_messages')) return [];
      if (path.includes('denizen_visitor_commitments')) return [];
      if (path.includes('denizen_predictions')) return [];
      return [];
    };

    denizenDb._post = async (table, body) => {
      calls.push({ table, method: 'POST', body });
      if (table === 'denizen_visitor_profiles') {
        return [{ session_id: SESSION_ID, ...body }];
      }
      if (table === 'denizen_visitor_commitments') {
        return [{ id: 'c1', ...body, status: 'open' }];
      }
      return [{ id: 'x1', ...body }];
    };

    denizenDb._patch = async () => [{ session_id: SESSION_ID }];
  });

  it('extracts commitments from NPC text', () => {
    const items = extractCommitmentsFromText("I'll send you the RFP brief by Friday.");
    assert.ok(items.length >= 1);
    assert.match(items[0].text, /send you the RFP brief/i);
  });

  it('extracts preferences from user text', () => {
    const prefs = extractPreferencesFromText('Please prefer short bullet updates.');
    assert.ok(prefs.length >= 1);
  });

  it('builds morning briefing content', async () => {
    const origGet = denizenDb._get;
    denizenDb._get = async (path) => {
      if (path.startsWith('rfps?')) {
        return [{
          id: 'rfp-1',
          title: 'USAF Data Platform',
          status: 'in_review',
          proposal_due_date: '2099-06-20T00:00:00.000Z',
          estimated_value_max: 900000,
        }];
      }
      return origGet(path);
    };
    const briefing = await buildMorningBriefing(SESSION_ID);
    denizenDb._get = origGet;
    assert.equal(briefing.sessionId, SESSION_ID);
    assert.ok(briefing.content.text.includes('Alex'));
    assert.ok(briefing.content.text.includes('RFP Alpha'));
    assert.ok(briefing.content.federal_pipeline);
  });

  it('includes prediction summary and forecast cards in briefing payload', async () => {
    denizenDb._get = async (path) => {
      if (path.includes('denizen_visitor_profiles')) return [];
      if (path.includes('denizen_visitor_sessions') && path.includes('id=eq.')) {
        return [{ id: SESSION_ID, display_name: 'Alex' }];
      }
      if (path.includes('denizen_user_assistants')) {
        return [{ npc_key: 'bob', assistant_name: 'Bob', denizen_npcs: { display_name: 'Bob' } }];
      }
      if (path.includes('denizen_user_projects')) return [{ name: 'RFP Alpha', status: 'active' }];
      if (path.includes('denizen_assistant_messages')) return [];
      if (path.includes('denizen_visitor_commitments')) return [];
      if (path.includes('denizen_predictions') && path.includes('prediction_type,accuracy_score,validated_at')) {
        return [
          {
            prediction_type: 'lead.close_probability',
            accuracy_score: 0.8,
            validated_at: '2026-06-01T00:00:00.000Z',
          },
          {
            prediction_type: 'lead.close_probability',
            accuracy_score: null,
            validated_at: null,
          },
        ];
      }
      if (path.includes('denizen_predictions') && path.includes('entity_type,entity_id,entity_key')) {
        return [{
          entity_type: 'lead',
          entity_id: 'lead-1',
          entity_key: null,
          prediction_type: 'lead.close_probability',
          prediction: { close_probability: 0.76 },
          confidence: 0.76,
          validated_at: null,
          created_at: '2026-06-06T00:00:00.000Z',
        }];
      }
      return [];
    };

    const briefing = await buildMorningBriefing(SESSION_ID);
    assert.equal(briefing.content.predictionSummary.total, 2);
    assert.equal(briefing.content.predictionSummary.validated, 1);
    assert.equal(briefing.content.predictionSummary.topForecasts.length, 1);
    assert.match(briefing.content.predictionNote, /Prediction accuracy/i);
  });

  it('upserts visitor profile', async () => {
    const profile = await upsertProfile(SESSION_ID, {
      preferences: ['concise updates'],
      writing_style: 'direct',
    });
    assert.equal(profile.session_id, SESSION_ID);
    assert.deepEqual(profile.preferences, ['concise updates']);
  });

  it('adds and lists commitments', async () => {
    await addCommitment(SESSION_ID, { text: "I'll follow up with legal", npcKey: 'bob' });
    const list = await listCommitments(SESSION_ID);
    assert.ok(Array.isArray(list));
  });

  it('maps intelligence errors to HTTP status', () => {
    assert.equal(intelligenceErrorStatus(new IntelligenceError('x', 'BAD_INPUT')), 400);
    assert.equal(intelligenceErrorStatus(new IntelligenceError('x', 'DB_DISABLED')), 503);
  });

  it('builds WS broadcast payloads', () => {
    const b = buildBriefingBroadcast({ content: { text: 'hi' } });
    assert.equal(b.type, 'visitor_briefing');
    const p = buildProactiveBroadcast({ title: 'Alert', body: 'body' });
    assert.equal(p.type, 'visitor_proactive');
  });
});
