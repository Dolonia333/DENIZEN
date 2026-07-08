'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contentPipeline = require('./content-pipeline');

const ROOT = path.resolve(__dirname, '..');
const TOPICS_FILE = path.join(ROOT, 'data', 'content-pipeline-topics.json');
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

function loadTopics() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
    return Array.isArray(parsed?.topics) ? parsed.topics : [];
  } catch (_) {
    return [
      'AI agent observability trends',
      'Remote work and async team culture',
      'Open-source LLM tooling this week',
    ];
  }
}

function nextTopic(state) {
  const topics = loadTopics();
  if (!topics.length) return 'industry news roundup';
  const idx = Number(state.scheduler?.topicIndex || 0) % topics.length;
  return topics[idx];
}

function startContentPipelineScheduler(deps = {}, opts = {}) {
  const enabled = String(process.env.CONTENT_PIPELINE_SCHEDULE || opts.enabled || '').toLowerCase();
  if (enabled !== 'true' && enabled !== '1') {
    return { timer: null, enabled: false, stop() {} };
  }

  const intervalMs = Number(process.env.CONTENT_PIPELINE_INTERVAL_MS || opts.intervalMs) || DEFAULT_INTERVAL_MS;
  const taskChain = deps.taskChain;
  if (!taskChain || !deps.assignDirectiveFn) {
    return { timer: null, enabled: false, stop() {} };
  }

  const tick = () => {
    const state = contentPipeline.loadState();
    const running = taskChain.getActiveChains().filter((c) => c.kind === 'content');
    if (running.length > 0) return;

    const topic = nextTopic(state);
    const chain = contentPipeline.startContentPipeline(taskChain, topic, {
      assignDirectiveFn: deps.assignDirectiveFn,
      broadcastFn: deps.broadcastFn,
    }, {
      triggeredBy: 'Scheduler',
      onBrandBlocked: deps.onBrandBlocked,
    });

    const topicIndex = (Number(state.scheduler?.topicIndex || 0) + 1);
    state.scheduler = {
      ...(state.scheduler || {}),
      topicIndex,
      lastTopic: topic,
      lastChainId: chain.id,
      lastRunAt: new Date().toISOString(),
    };
    contentPipeline.saveState(state);

    if (typeof deps.broadcastFn === 'function') {
      deps.broadcastFn({
        type: 'content_pipeline_scheduled',
        chainId: chain.id,
        topic,
        ts: Date.now(),
      });
    }
  };

  if (opts.immediate !== false) {
    setTimeout(tick, 15000);
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return {
    enabled: true,
    intervalMs,
    timer,
    stop() { clearInterval(timer); },
  };
}

module.exports = {
  startContentPipelineScheduler,
  loadTopics,
  TOPICS_FILE,
};
