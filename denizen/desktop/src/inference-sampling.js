'use strict';

/**
 * Single source of truth for local-model sampling parameters.
 *
 * Denizen previously sent only `temperature` (fixed 0.75) to LM Studio. Small
 * local models loop and drift without min_p / repeat_penalty (see the Bouncer
 * "Friend. I require a specific…" repetition). This module maps a task `kind`
 * to a validated sampling profile. LM Studio / llama.cpp ignore params they
 * don't support, so applying these is additive and safe.
 *
 * Profiles are tuned for the LM Studio (llama.cpp) backend specifically —
 * sampler order differs across backends, so do not port these verbatim to vLLM
 * etc. without re-tuning. See docs/LOCAL_HARNESS_UPGRADE.md §5.
 */

const SAMPLING_PROFILES = {
  // General player/peer chat.
  chat: { temperature: 0.8, top_p: 0.95, min_p: 0.05, repeat_penalty: 1.1 },
  // Idle ambient chatter / presence — most loop-prone, strongest anti-repeat.
  presence: { temperature: 0.9, top_p: 0.95, min_p: 0.05, repeat_penalty: 1.15 },
  // Reasoning models (DeepSeek-R1, Ministral-reasoning) — lower temp, light penalty.
  reasoning: { temperature: 0.6, top_p: 0.95, min_p: 0.03, repeat_penalty: 1.05 },
  // Code / structured generation — repetition is legitimate, minimal penalty.
  code: { temperature: 0.2, top_p: 0.9, min_p: 0.02, repeat_penalty: 1.0 },
  // Decision JSON (paired with response_format json_schema).
  decision: { temperature: 0.4, top_p: 0.9, min_p: 0.05, repeat_penalty: 1.05 },
};

const DEFAULT_PROFILE = 'chat';

// Map the `kind` values already threaded through the codebase to a profile.
const KIND_TO_PROFILE = {
  chat: 'chat',
  'response': 'chat',
  'response-fallback': 'chat',
  player_chat: 'chat',
  peer_chat: 'chat',
  idle: 'presence',
  ambient: 'presence',
  think: 'reasoning',
  decision: 'decision',
  'coding-agent': 'code',
  code: 'code',
  'incident-report': 'chat',
  'linux-investigation-report': 'reasoning',
};

/**
 * Resolve a sampling profile for a call.
 * @param {object} opts
 * @param {string} [opts.kind]        - task kind (chat/think/code/…)
 * @param {string} [opts.profile]     - explicit profile name (wins over kind)
 * @param {boolean} [opts.reasoning]  - force reasoning profile
 * @param {number}  [opts.temperature]- caller override for temperature only
 * @returns {{temperature:number, top_p:number, min_p:number, repeat_penalty:number}}
 */
function samplingFor(opts = {}) {
  let name = opts.profile;
  if (!name && opts.reasoning) name = 'reasoning';
  if (!name && opts.kind) name = KIND_TO_PROFILE[String(opts.kind).toLowerCase()];
  if (!name || !SAMPLING_PROFILES[name]) name = DEFAULT_PROFILE;

  const base = { ...SAMPLING_PROFILES[name] };
  // Respect an explicit caller temperature (some paths set it deliberately).
  if (typeof opts.temperature === 'number' && Number.isFinite(opts.temperature)) {
    base.temperature = opts.temperature;
  }
  return base;
}

/**
 * Merge sampling params into an OpenAI-compatible request body in place-safe
 * fashion (returns a new object; never overwrites an already-set field unless
 * `force` is true). Use at the body-build sites in the inference paths.
 */
function applySampling(body = {}, opts = {}, { force = false } = {}) {
  const s = samplingFor(opts);
  const out = { ...body };
  for (const [k, v] of Object.entries(s)) {
    if (force || out[k] === undefined || out[k] === null) out[k] = v;
  }
  return out;
}

module.exports = {
  SAMPLING_PROFILES,
  KIND_TO_PROFILE,
  DEFAULT_PROFILE,
  samplingFor,
  applySampling,
};
