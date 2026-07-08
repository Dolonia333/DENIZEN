'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'content-pipeline-state.json');

const AUDIENCE_DEFAULT = 'our core readers — practitioners who want signal, not hype';

const STEP_LABELS = {
  trends: 'Bob researches trends',
  pitch: 'Sarah reviews the pitch',
  'draft-article': 'Alex writes the article',
  'draft-social': 'Josh drafts social posts',
  'copy-jenny': 'Jenny copy-edits',
  'fact-molly': 'Molly fact-checks',
  design: 'Rob designs visuals',
  brand: 'Bouncer brand-safety scan',
  publish: 'Lucy publishes',
};

const PIPELINE_EXPLAINER = [
  'The newsroom runs a 9-step demo in the background:',
  'research → pitch → article + social drafts → copy edit → fact-check → design → brand safety → publish.',
  'NPCs work through tasks and save artifacts under reports/. Watch them in the office while it runs.',
].join(' ');

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function buildSteps(topic, opts = {}) {
  const subject = String(topic || 'breaking industry trends').trim();
  const audience = String(opts.audience || AUDIENCE_DEFAULT).trim();
  const feeds = Array.isArray(opts.feeds) && opts.feeds.length
    ? opts.feeds
    : ['https://news.ycombinator.com/rss', 'https://www.reddit.com/r/technology/.rss'];

  return [
    {
      id: 'trends',
      npc: 'Bob',
      artifactCategory: 'content-trends',
      skill: 'trend-scraper',
      task: [
        `Trend scrape for content pipeline: "${subject}".`,
        `Run skill trend-scraper with sources: ${feeds.join(', ')}.`,
        'Summarize 3–5 timely angles with links. Save artifact with headline candidates.',
        'End artifact with: VERDICT: READY',
      ].join('\n'),
    },
    {
      id: 'pitch',
      npc: 'Sarah',
      artifactCategory: 'content-pitches',
      gate: 'pitch',
      task: [
        `Pitch gate for: "${subject}".`,
        `Core question: Does ${audience} actually care about this?`,
        'Read Bob\'s trend artifact. Kill weak ideas. For survivors, write a one-paragraph pitch.',
        'End artifact with exactly one line: VERDICT: APPROVED  OR  VERDICT: REJECTED',
      ].join('\n'),
    },
    {
      id: 'draft-article',
      npc: 'Alex',
      artifactCategory: 'content-drafts',
      reviseTarget: true,
      task: [
        `Draft the main article for approved pitch: "${subject}".`,
        'Use Sarah\'s approved pitch and Bob\'s research. Write publish-ready markdown.',
        'Include headline, dek, body, and suggested pull quotes.',
      ].join('\n'),
    },
    {
      id: 'draft-social',
      npc: 'Josh',
      artifactCategory: 'content-drafts',
      task: [
        `Draft social/newsletter companion for: "${subject}".`,
        'Thread outline (5–8 posts) plus short newsletter intro linking to the article.',
        'Match Alex\'s article tone.',
      ].join('\n'),
    },
    {
      id: 'copy-jenny',
      npc: 'Jenny',
      artifactCategory: 'content-edits',
      gate: 'copy',
      reviseGoto: 'draft-article',
      task: [
        'Copy edit Alex and Josh drafts. Check grammar, tone, clarity.',
        'If edits are required, list them and end with: VERDICT: REVISE',
        'If ready for fact-check, end with: VERDICT: PASSED',
      ].join('\n'),
    },
    {
      id: 'fact-molly',
      npc: 'Molly',
      artifactCategory: 'content-edits',
      gate: 'copy',
      reviseGoto: 'draft-article',
      task: [
        'Fact-check the drafts. Flag hallucinations, unsourced claims, or tone drift.',
        'If fixes needed: VERDICT: REVISE with bullet list.',
        'If clean: VERDICT: PASSED',
      ].join('\n'),
    },
    {
      id: 'design',
      npc: 'Rob',
      artifactCategory: 'content-design',
      skill: 'canvas-render',
      task: [
        'Design thumbnail art and newsletter layout for this package.',
        'Use canvas-render on an HTML mockup or pdf-generator for a one-page newsletter PDF.',
        'Save paths to generated assets in your artifact.',
      ].join('\n'),
    },
    {
      id: 'brand',
      npc: 'Bouncer',
      artifactCategory: 'content-legal',
      gate: 'brand',
      skill: 'content-moderation',
      task: [
        'Brand safety / legal scan on all drafts (not network security).',
        'Run content-moderation on draft artifacts. Check libel, copyright, brand-unsafe language.',
        'End artifact with: VERDICT: CLEAR  OR  VERDICT: BLOCKED',
      ].join('\n'),
    },
    {
      id: 'publish',
      npc: 'Lucy',
      artifactCategory: 'content-published',
      skill: 'platform-publish',
      task: [
        'Publish the approved package to the Dolonia platform.',
        'Run platform-publish with title and markdown body (Supabase CMS table or Lovable export dir).',
        'Log URLs/paths and scheduled posts in your artifact.',
      ].join('\n'),
    },
  ];
}

function buildChainDefinition(topic, opts = {}) {
  const steps = buildSteps(topic, opts);
  return {
    kind: 'content',
    name: opts.name || `Content: ${String(topic).slice(0, 60)}`,
    triggeredBy: opts.triggeredBy || 'System',
    topic: String(topic || '').trim(),
    audience: opts.audience || AUDIENCE_DEFAULT,
    maxRevisions: Number(opts.maxRevisions) || 3,
    steps,
  };
}

function recordPipelineStart(chain, topic) {
  const state = loadState();
  const runs = Array.isArray(state.runs) ? state.runs : [];
  runs.unshift({
    chainId: chain.id,
    topic,
    name: chain.name,
    status: chain.status,
    startedAt: new Date().toISOString(),
    steps: chain.steps.map((s) => ({ id: s.id, npc: s.npc, gate: s.gate || null })),
  });
  state.runs = runs.slice(0, 100);
  state.lastStartedAt = new Date().toISOString();
  saveState(state);
}

function updatePipelineStatus(chainId, patch) {
  const state = loadState();
  const runs = Array.isArray(state.runs) ? state.runs : [];
  const idx = runs.findIndex((r) => r.chainId === chainId);
  if (idx >= 0) {
    runs[idx] = { ...runs[idx], ...patch, updatedAt: new Date().toISOString() };
  }
  state.runs = runs;
  saveState(state);
}

function formatRunningChain(chain) {
  const step = chain.steps[chain.currentStep];
  const stepId = step?.id || 'unknown';
  return {
    chainId: chain.id,
    name: chain.name,
    topic: chain.topic,
    status: chain.status,
    currentStep: chain.currentStep + 1,
    totalSteps: chain.steps.length,
    stepId,
    stepNpc: step?.npc || null,
    stepLabel: STEP_LABELS[stepId] || `${step?.npc || 'NPC'} working`,
    revisionCount: chain.revisionCount || 0,
  };
}

function getPipelineSummary(taskChain) {
  const chains = taskChain.getAllChains ? taskChain.getAllChains() : [];
  const content = chains.filter((c) => c.kind === 'content');
  const runningChains = content.filter((c) => c.status === 'running');
  const byStage = {};
  for (const c of runningChains) {
    const step = c.steps[c.currentStep];
    const key = step?.id || step?.npc || 'unknown';
    byStage[key] = (byStage[key] || 0) + 1;
  }
  const state = loadState();
  const stepOrder = buildSteps('demo').map((s) => ({
    id: s.id,
    npc: s.npc,
    label: STEP_LABELS[s.id] || s.npc,
    gate: s.gate || null,
  }));
  return {
    active: runningChains.length,
    blocked: content.filter((c) => c.status === 'blocked').length,
    rejected: content.filter((c) => c.status === 'rejected').length,
    complete: content.filter((c) => c.status === 'complete').length,
    cancelled: content.filter((c) => c.status === 'cancelled').length,
    bottlenecks: byStage,
    running: runningChains.map(formatRunningChain),
    recent: (state.runs || []).slice(0, 12),
    scheduler: state.scheduler || {},
    explainer: PIPELINE_EXPLAINER,
    stepOrder,
  };
}

function cancelRunningPipelines(taskChain, broadcastFn, chainId = null) {
  if (!taskChain?.cancelChain && !taskChain?.cancelAllRunning) return [];
  const filter = (c) => c.kind === 'content' && (!chainId || c.id === chainId);
  let ids = [];
  if (chainId) {
    const chain = taskChain.getChainStatus?.(chainId);
    if (chain && chain.kind === 'content' && chain.status === 'running') {
      taskChain.cancelChain(chainId, broadcastFn);
      ids = [chainId];
    }
  } else if (taskChain.cancelAllRunning) {
    ids = taskChain.cancelAllRunning(broadcastFn, filter);
  } else {
    for (const chain of (taskChain.getAllChains?.() || []).filter(filter)) {
      if (chain.status === 'running') {
        taskChain.cancelChain(chain.id, broadcastFn);
        ids.push(chain.id);
      }
    }
  }
  for (const id of ids) {
    updatePipelineStatus(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
  }
  return ids;
}

function startContentPipeline(taskChain, topic, deps, opts = {}) {
  const definition = buildChainDefinition(topic, opts);
  let chainId = null;
  const upstreamBroadcast = typeof deps.broadcastFn === 'function' ? deps.broadcastFn : null;
  const onBrandBlocked = typeof opts.onBrandBlocked === 'function' ? opts.onBrandBlocked : null;
  const wrappedBroadcast = (msg) => {
    const halted = msg && typeof msg === 'object'
      && msg.type === 'npc_chain_halted'
      && msg.status === 'blocked'
      && (!chainId || msg.chainId === chainId);
    if (halted) {
      const verdict = String(msg.verdict || '').trim();
      if (!verdict || /blocked/i.test(verdict)) {
        const hookPayload = {
          chainId: msg.chainId || chainId || null,
          topic: definition.topic || topic || null,
          name: definition.name || null,
          verdict: verdict || 'BLOCKED',
          ts: Date.now(),
          detail: 'brand moderation blocked',
        };
        updatePipelineStatus(hookPayload.chainId, {
          status: 'blocked',
          blockedAt: new Date().toISOString(),
          blockReason: hookPayload.detail,
          blockVerdict: hookPayload.verdict,
        });
        if (onBrandBlocked) {
          try { onBrandBlocked(hookPayload); } catch (_) { /* non-fatal */ }
        }
      }
    }
    if (upstreamBroadcast) upstreamBroadcast(msg);
  };
  const chain = taskChain.startChain(
    definition,
    deps.assignDirectiveFn,
    wrappedBroadcast,
  );
  chainId = chain.id;
  recordPipelineStart(chain, topic);
  return chain;
}

module.exports = {
  buildSteps,
  buildChainDefinition,
  startContentPipeline,
  getPipelineSummary,
  cancelRunningPipelines,
  updatePipelineStatus,
  STEP_LABELS,
  PIPELINE_EXPLAINER,
  loadState,
  saveState,
  STATE_FILE,
};
