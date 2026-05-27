'use strict';
/**
 * Job Application Handler
 *
 * Two paths:
 *   email  — Lucy composes a cover letter + resume summary and sends it
 *            directly via gmail-client (same pipeline as inbound replies).
 *   webform — Lucy uses computer-use-agent (Playwright + Claude API) to
 *             visually navigate and fill the job form in a real browser,
 *             exactly like Claude Code does with its computer-use tools.
 *
 * Trigger via POST /api/job-apply:
 *   { applyEmail?, applyUrl?, jobTitle, company, description?, requirements? }
 *
 * Or tell Lucy in the chat: "Apply to [company] [role] at [email or URL]"
 *
 * Cover letter modes (opts.fullAI):
 *   false (default) — template + single AI opener via LLaMA 8B (~3-8s)
 *   true            — full AI-written letter via Ministral 14B (~60-120s)
 */

const fs   = require('node:fs');
const path = require('node:path');
const http  = require('node:http');
const https = require('node:https');
const computerUseAgent = require('./computer-use-agent');

const PROFILE_FILE = path.join(__dirname, '..', 'data', 'user-profile.json');
const LOG_FILE     = path.join(__dirname, '..', 'data', 'job-application-log.json');

// ---------- profile helpers --------------------------------------------------

function loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function _readLog() {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.entries) ? j : { entries: [] };
  } catch (_) {
    return { entries: [] };
  }
}

function _appendLog(entry) {
  const store = _readLog();
  store.entries.unshift({ ...entry, at: new Date().toISOString() });
  if (store.entries.length > 200) store.entries.length = 200;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// ---------- cover letter helpers ---------------------------------------------

/**
 * Fire a minimal chat request directly to LM Studio.
 * No NPC personality, no memory, no context overhead — pure inference.
 */
function _lmRequest({ baseUrl, model, apiKey, systemPrompt, userPrompt, maxTokens = 80 }) {
  return new Promise((resolve, reject) => {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ];
    const body = JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.3 });
    const url  = new URL('/v1/chat/completions', baseUrl || 'http://localhost:1234');
    const lib  = url.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${apiKey || 'lm-studio'}`,
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const msg = j.choices?.[0]?.message || {};
          resolve((msg.content || msg.reasoning_content || '').trim());
        } catch (e) {
          reject(new Error('Bad JSON from LM Studio: ' + data.slice(0, 120)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('LM Studio timeout (opener)')));
    req.write(body);
    req.end();
  });
}

/**
 * Fast cover letter: template built from profile + one AI-generated opener.
 *
 * Strategy:
 *   1. Call lmstudio-fast (LLaMA 8B) directly with max_tokens=80 for a single
 *      punchy opening sentence that ties the candidate's best credential to role.
 *   2. Assemble the rest from structured profile data — no AI needed.
 *
 * Total time: ~3-8 seconds vs 60-120 seconds for a full Ministral generation.
 */
async function buildFastCoverLetter(npcBrains, profile, job) {
  // Pull the most relevant experience entry for context
  const topExp = (profile.experience || [])[0];
  const topExpStr = topExp
    ? `${topExp.title} at ${topExp.company}: ${(topExp.bullets || []).slice(0, 2).join('; ')}`
    : '';
  const relevantSkills = (profile.skills || []).slice(0, 6).join(', ');

  // Resolve LM Studio fast-model config
  const fastCfg = npcBrains?.providers?.['lmstudio-fast'] || npcBrains?.providers?.lmstudio || null;
  const baseUrl  = fastCfg?.baseUrl  || process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234';
  const model    = fastCfg?.model    || process.env.LM_STUDIO_FAST_MODEL || 'meta-llama-3.1-8b-instruct';
  const apiKey   = fastCfg?.apiKey   || process.env.LM_STUDIO_API_KEY   || 'lm-studio';

  const openerSystemPrompt = [
    `You write job application opening sentences. Output EXACTLY ONE sentence — no more, no less.`,
    `Style: ${profile.coverLetterStyle || 'confident and direct — lead with what I built'}`,
    `Do NOT start with "I am excited", "I hope", "My name is", "I wanted to", or any filler.`,
    `Lead with the candidate's most impressive, relevant credential for this specific role.`,
    `Output ONLY the sentence. No quotes, no newlines, no commentary.`,
  ].join('\n');

  const openerPrompt = [
    `Role: ${job.jobTitle} at ${job.company}`,
    job.description ? `Job focus: ${job.description.slice(0, 300)}` : '',
    `Candidate: ${profile.name}, ${profile.title || 'Software Engineer'}`,
    topExpStr ? `Top credential: ${topExpStr}` : '',
    `Key skills: ${relevantSkills}`,
    `Write ONE punchy opening sentence for their cover letter.`,
  ].filter(Boolean).join('\n');

  let opener = '';
  try {
    const raw = await _lmRequest({ baseUrl, model, apiKey, systemPrompt: openerSystemPrompt, userPrompt: openerPrompt, maxTokens: 80 });
    // Keep only the first sentence and strip accidental quotes
    opener = raw.replace(/^["']|["']$/g, '').split(/[.\n]/)[0].trim();
    if (opener && !opener.endsWith('.')) opener += '.';
  } catch (err) {
    console.warn('[job-application] fast opener failed:', err?.message);
  }

  // Fallback opener if model fails
  if (!opener) {
    opener = topExp
      ? `As the ${topExp.title} behind ${topExp.company}, I've built exactly the kind of work ${job.company} is looking for.`
      : (profile.summary || `I'm a ${profile.title || 'software engineer'} focused on building things that matter.`);
  }

  // Build the rest of the letter from structured profile data (instant, no AI)
  const expLines = (profile.experience || [])
    .slice(0, 3)
    .map(e => {
      const bullets = (e.bullets || []).slice(0, 2).map(b => `  • ${b}`).join('\n');
      return `${e.title} — ${e.company} (${e.start}–${e.end})${bullets ? '\n' + bullets : ''}`;
    })
    .join('\n\n');

  const skillsLine = (profile.skills || []).join(', ');

  const matchLine = job.description
    ? `The ${job.jobTitle} role at ${job.company} maps directly to what I've been building: ${job.description.slice(0, 120).replace(/\n/g, ' ').trim().replace(/[.!?]*$/, '')}...`
    : `The ${job.jobTitle} role at ${job.company} is a strong match for the work I do.`;

  return [
    opener,
    '',
    matchLine,
    '',
    expLines ? `Background:\n${expLines}` : '',
    '',
    skillsLine ? `Skills: ${skillsLine}` : '',
  ].filter(l => l !== null && l !== '').join('\n').trim();
}

// ---------- full AI cover letter prompt (fallback / opt-in) ------------------

function buildCoverLetterPrompt(profile, job) {
  const expBlock = (profile.experience || [])
    .map(e => `${e.title} at ${e.company} (${e.start}–${e.end}):\n` +
              (e.bullets || []).map(b => `  - ${b}`).join('\n'))
    .join('\n\n');

  const skillsBlock = (profile.skills || []).join(', ');

  return {
    systemHint: [
      `You are Lucy, drafting a job application cover letter for ${profile.name}.`,
      `Style: ${profile.coverLetterStyle || 'confident and concise, under 200 words'}.`,
      `Do NOT use filler openers like "I am excited to apply" or "I hope this finds you well".`,
      `Lead with the most impressive, relevant thing about the candidate.`,
      `Do NOT include a signature, name, or date — those are appended automatically.`,
    ].join('\n'),
    userPrompt: [
      `Write a cover letter for this role:`,
      `Company: ${job.company}`,
      `Title:   ${job.jobTitle}`,
      job.description ? `Description:\n${job.description.slice(0, 2000)}` : '',
      job.requirements ? `Requirements:\n${job.requirements.slice(0, 1000)}` : '',
      '',
      `Candidate background:`,
      `Name:   ${profile.name}`,
      `Title:  ${profile.title || ''}`,
      `Summary: ${profile.summary || ''}`,
      '',
      `Experience:`,
      expBlock,
      '',
      `Skills: ${skillsBlock}`,
      '',
      `Return only the email body text. No subject line, no headers, no signature.`,
    ].filter(l => l !== null).join('\n'),
  };
}

// ---------- email application ------------------------------------------------

async function applyByEmail({ npcBrains, gmailClient, broadcast }, job, opts = {}) {
  const profile = loadProfile();
  if (!profile) return { ok: false, error: 'user-profile.json not found — fill it in at denizen/data/user-profile.json' };
  if (!job.applyEmail) return { ok: false, error: 'applyEmail required for email application' };

  const _broadcast = (type, data) => {
    if (!broadcast) return;
    try { broadcast({ type, ...data }); } catch (_) {}
  };

  // Return immediately — do the work async so the HTTP response isn't held
  _appendLog({ kind: 'email-started', method: 'email', company: job.company, jobTitle: job.jobTitle, to: job.applyEmail });
  const mode = opts.fullAI ? 'full AI draft' : 'fast template';
  _broadcast('job_apply_status', { status: 'starting', method: 'email', message: `Lucy is writing your cover letter for ${job.jobTitle} at ${job.company} (${mode})...` });

  // Fire and forget
  (async () => {
    let coverLetter;
    try {
      if (opts.fullAI) {
        // Slow but fully AI-written path (opt-in)
        const { systemHint, userPrompt } = buildCoverLetterPrompt(profile, job);
        coverLetter = await npcBrains.getResponse('Lucy', 'CEO', userPrompt, {
          kind: 'job-application',
          systemOverride: systemHint,
        });
      } else {
        // Fast path: template + single AI opener (~3-8 seconds)
        coverLetter = await buildFastCoverLetter(npcBrains, profile, job);
      }
    } catch (err) {
      _broadcast('job_apply_status', { status: 'error', method: 'email', message: 'Cover letter failed: ' + (err?.message || err) });
      _appendLog({ kind: 'email-failed', method: 'email', company: job.company, jobTitle: job.jobTitle, error: err?.message });
      return;
    }

    _broadcast('job_apply_status', { status: 'drafting', method: 'email', message: 'Cover letter written — creating Gmail draft...' });

    const resumeBlock = [
      `\n\n--- Resume Summary ---`,
      `${profile.name} | ${profile.title || ''}`,
      profile.linkedin ? `LinkedIn: ${profile.linkedin}` : '',
      profile.github   ? `GitHub:   ${profile.github}`   : '',
      profile.portfolio ? `Portfolio: ${profile.portfolio}` : '',
      '',
      profile.summary || '',
      '',
      `Skills: ${(profile.skills || []).join(', ')}`,
      '',
      ...(profile.experience || []).map(e =>
        `${e.title} — ${e.company} (${e.start}–${e.end})\n` +
        (e.bullets || []).map(b => `  • ${b}`).join('\n')
      ),
      `\n--- End Resume ---`,
    ].filter(Boolean).join('\n');

    const fullBody = `${coverLetter.trim()}\n${resumeBlock}\n\n--\n${profile.name}`;
    const subject  = `Application: ${job.jobTitle} — ${profile.name}`;

    let drafted;
    try {
      drafted = await gmailClient.createDraft({ to: job.applyEmail, subject, body: fullBody, by: 'Lucy' });
    } catch (err) {
      _broadcast('job_apply_status', { status: 'error', method: 'email', message: 'Gmail draft failed: ' + (err?.message || err) });
      _appendLog({ kind: 'email-failed', method: 'email', company: job.company, jobTitle: job.jobTitle, error: err?.message });
      return;
    }

    let sent = false;
    const autoSendEnv = String(process.env.EMAIL_AUTOSEND || '').toLowerCase() === 'true';
    if (autoSendEnv) {
      try {
        const sendResult = await gmailClient.sendDraft({ id: drafted.id, autoSendAllowed: true });
        sent = sendResult.status === 'sent';
      } catch (err) {
        console.warn('[job-application] auto-send failed:', err?.message || err);
      }
    }

    _appendLog({ kind: sent ? 'sent' : 'drafted', method: 'email', company: job.company, jobTitle: job.jobTitle, to: job.applyEmail, draftId: drafted.id, sent });
    _broadcast('job_apply_status', {
      status: sent ? 'sent' : 'drafted',
      method: 'email',
      message: sent
        ? `Lucy sent your application to ${job.applyEmail}`
        : `Draft ready in Gmail — check your drafts folder.`,
      draftId: drafted.id,
    });
  })().catch(err => console.error('[job-application] email async error:', err?.message));

  return { ok: true, method: 'email', async: true, note: `Lucy is writing your cover letter for ${job.jobTitle}. Watch for a WS event when the draft is ready.` };
}

// ---------- web form application (via built-in computer-use agent) ----------

async function applyByWebForm(job, { broadcast, provider } = {}) {
  const profile = loadProfile();
  if (!profile) return { ok: false, error: 'user-profile.json not found' };
  if (!job.applyUrl) return { ok: false, error: 'applyUrl required for web form application' };

  const instruction = [
    `Fill out a job application on behalf of ${profile.name}.`,
    `Role: ${job.jobTitle} at ${job.company}.`,
    job.description ? `Job description summary: ${job.description.slice(0, 400)}` : '',
    '',
    `Do NOT click Submit or Apply — fill all visible fields then stop.`,
  ].filter(Boolean).join('\n');

  // Notify the game immediately so Lucy animates before the async task runs.
  if (broadcast) {
    try {
      broadcast({
        type: 'computer_use_status',
        status: 'starting',
        message: `Lucy is applying to ${job.jobTitle} at ${job.company}...`,
        meta: { company: job.company, jobTitle: job.jobTitle },
      });
    } catch (_) {}
  }

  _appendLog({
    kind: 'computer-use-started',
    method: 'webform',
    company: job.company,
    jobTitle: job.jobTitle,
    url: job.applyUrl,
  });

  // Run the computer-use agent asynchronously — the HTTP response returns
  // immediately so the caller isn't blocked for the 2–5 minutes it takes.
  // Progress is streamed back via broadcast (WS events to the game).
  computerUseAgent.runBrowserTask({
    instruction,
    url: job.applyUrl,
    profile,
    broadcast,
    provider: provider || job.provider || null,
  }).then(result => {
    _appendLog({
      kind: result.ok ? 'computer-use-done' : 'computer-use-failed',
      method: 'webform',
      company: job.company,
      jobTitle: job.jobTitle,
      url: job.applyUrl,
      steps: result.steps,
      error: result.error || null,
    });
    if (broadcast) {
      broadcast({
        type: 'computer_use_status',
        status: result.ok ? 'done' : 'error',
        message: result.ok
          ? `Lucy finished filling the ${job.jobTitle} application at ${job.company}.`
          : `Application attempt failed: ${result.error}`,
        meta: { company: job.company, jobTitle: job.jobTitle },
      });
    }
  }).catch(err => {
    console.error('[job-application] computer-use agent threw:', err?.message || err);
  });

  return {
    ok: true,
    method: 'webform',
    async: true,
    note: 'Lucy has opened a browser and is filling the form. Watch your screen — she will not submit without you.',
  };
}

// ---------- unified entry point ---------------------------------------------

async function applyToJob(deps, job, opts = {}) {
  if (!job.company || !job.jobTitle) {
    return { ok: false, error: 'company and jobTitle are required' };
  }

  // Prefer web form if URL is given; fall back to email
  if (job.applyUrl) {
    return applyByWebForm(job, { broadcast: deps.broadcast, provider: job.provider });
  }
  if (job.applyEmail) {
    return applyByEmail(deps, job, opts);
  }
  return { ok: false, error: 'provide either applyEmail or applyUrl' };
}

module.exports = { applyToJob, applyByEmail, applyByWebForm, loadProfile };
