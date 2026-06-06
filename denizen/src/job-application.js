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
const jobCrm = require('./job-crm');

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
  const model    = fastCfg?.model    || process.env.LM_STUDIO_FAST_MODEL || 'google/gemma-4-e2b';
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
    const crmStore = jobCrm.loadCrm();
    const crmId = `crm_${Date.now()}`;
    jobCrm.upsertApplication(crmStore, {
      id: crmId, company: job.company, role: job.jobTitle,
      status: sent ? 'watching' : 'awaiting_submit', applyEmail: job.applyEmail,
      letterType: opts.fullAI ? 'fullAI' : 'fast', appliedAt: new Date().toISOString(),
    });
    jobCrm.recordOutcome(crmId, 'applied', { letterType: opts.fullAI ? 'fullAI' : 'fast' });
    jobCrm.saveCrm(crmStore);
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
    browserMode: process.env.LUCY_BROWSER_MODE || 'auto',
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

// ---------- pipeline helpers ------------------------------------------------

const { exec } = require('node:child_process');
const crypto = require('node:crypto');

const jellyPaths = require('../jelly/paths');
const SCRAPER_SCRIPT  = jellyPaths.vendorScriptPath('job-scraper');
const APPLIER_SCRIPT  = jellyPaths.vendorScriptPath('job-applier');
const RESUME_SCRIPT   = jellyPaths.vendorScriptPath('resume-generator');

/** Run a node script and return its stdout as a string. Rejects on timeout. */
function _spawnSkill(scriptPath, args = [], timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Skill script not found: ${scriptPath}`));
    }
    const cmd = `node "${scriptPath}" ${args.map(a => `"${a}"`).join(' ')}`;
    exec(cmd, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').slice(0, 500)));
      resolve((stdout || '').trim());
    });
  });
}

/**
 * Filter scraped listings against the user profile's preferred roles,
 * optional salary floor, and remote preference.
 */
function _filterListings(listings, profile, { minSalary = 0, remoteOnly = false } = {}) {
  const targetRoles = (profile.targetRoles || [
    'senior ai engineer', 'product manager', 'full-stack engineer',
    'full stack engineer', 'backend developer', 'backend engineer',
    'software engineer', 'developer', 'full-stack developer',
  ]).map(r => r.toLowerCase());

  return listings.filter(job => {
    const title = (job.title || '').toLowerCase();
    const desc  = (job.description || job.snippet || '').toLowerCase();

    // Role match: at least one target keyword in the title
    const roleMatch = targetRoles.some(r => title.includes(r));
    if (!roleMatch) return false;

    // Salary floor
    if (minSalary && job.salary) {
      const salaryNum = Number(String(job.salary).replace(/[^0-9]/g, '')) || 0;
      if (salaryNum > 0 && salaryNum < minSalary) return false;
    }

    // Remote filter
    if (remoteOnly) {
      const remote = `${title} ${desc} ${(job.location || '').toLowerCase()}`;
      if (!remote.includes('remote')) return false;
    }

    return true;
  });
}

/**
 * Build a fast template cover letter, personalised per listing.
 * All letters in a pipeline run share the same opener template;
 * only company name and role are swapped out. Target: < 1s per letter.
 */
function _buildTemplateCoverLetter(profile, job, openerTemplate) {
  const opener = openerTemplate
    ? openerTemplate
        .replace(/\{company\}/g, job.company || '')
        .replace(/\{role\}/g, job.title || '')
    : (profile.summary || `I build production systems and ship working software.`);

  const topExp = (profile.experience || [])[0];
  const expLine = topExp
    ? `Most recently as ${topExp.title} at ${topExp.company}, ${(topExp.bullets || [])[0] || ''}`.slice(0, 200)
    : '';

  return [
    opener,
    '',
    expLine ? expLine + '.' : '',
    '',
    `The ${job.title || 'role'} at ${job.company || 'your company'} is a direct match for what I do. ` +
    `My skills include ${(profile.skills || []).slice(0, 5).join(', ')}.`,
    '',
    'Happy to discuss further.',
  ].filter(l => l !== null && l !== undefined).join('\n').trim();
}

// ---------- pipeline status tracker ----------------------------------------

let _pipelineStatus = { running: false, lastRun: null, lastSummary: '' };

function getPipelineStatus() {
  return { ..._pipelineStatus };
}

// ---------- application log helpers ----------------------------------------

function getApplicationLog({ limit = 50 } = {}) {
  const store = _readLog();
  return store.entries.slice(0, limit);
}

// ---------- main pipeline ---------------------------------------------------

/**
 * runJobPipeline — Lucy's full scrape→filter→resume→cover→apply pipeline.
 *
 * @param {object} opts
 * @param {string}  opts.query       — search query (default: 'software engineer')
 * @param {string}  opts.site        — job board: linkedin | indeed | glassdoor | ziprecruiter
 * @param {number}  opts.pages       — pages to scrape (default: 2)
 * @param {number}  opts.minSalary   — optional salary floor (0 = no filter)
 * @param {boolean} opts.remoteOnly  — only keep remote listings
 * @returns {Promise<string>}  — summary string Lucy can use as her message
 */
async function runJobPipeline(opts = {}, deps = {}) {
  if (_pipelineStatus.running) {
    return 'Job pipeline is already running — wait for it to finish before starting another.';
  }

  const query      = opts.query      || 'software engineer';
  const site       = opts.site       || 'linkedin';
  const pages      = Math.min(opts.pages || 2, 3);
  const minSalary  = Number(opts.minSalary)  || 0;
  const remoteOnly = Boolean(opts.remoteOnly);

  _pipelineStatus = { running: true, lastRun: new Date().toISOString(), lastSummary: '' };
  console.log(`[job-pipeline] Starting: query="${query}" site=${site} pages=${pages}`);

  const profile = loadProfile();
  if (!profile) {
    _pipelineStatus.running = false;
    return 'Cannot run job pipeline — user-profile.json is missing. Fill it in at denizen/data/user-profile.json.';
  }

  // ── Step 1: Scrape ───────────────────────────────────────────────────────
  let listings = [];
  try {
    const scraperArgs = [
      '--site', site,
      '--query', query,
      '--pages', String(pages),
      '--headless', 'true',
      '--save', 'false',
    ];
    if (remoteOnly) scraperArgs.push('--remote-only', 'true');

    const raw = await _spawnSkill(SCRAPER_SCRIPT, scraperArgs, 90000);
    // The scraper may print progress lines before the final JSON — grab
    // the last valid JSON array in the output.
    const jsonMatch = raw.match(/(\[[\s\S]*\])\s*$/);
    if (jsonMatch) {
      listings = JSON.parse(jsonMatch[1]);
    } else {
      // Try parsing the whole thing
      const parsed = JSON.parse(raw);
      listings = parsed.jobs || (Array.isArray(parsed) ? parsed : []);
    }
    console.log(`[job-pipeline] Scraped ${listings.length} listings from ${site}`);
  } catch (err) {
    console.warn('[job-pipeline] Scraper failed:', err.message);
    _appendLog({ kind: 'pipeline-scrape-failed', query, site, error: err.message, at: new Date().toISOString() });
    _pipelineStatus.running = false;
    return `Job scrape failed for "${query}" on ${site}: ${err.message}. Check if the skill script is installed.`;
  }

  if (!listings.length) {
    _pipelineStatus.running = false;
    return `No listings found for "${query}" on ${site}. Try a different query or site.`;
  }

  // ── Step 2: Filter ───────────────────────────────────────────────────────
  const qualified = _filterListings(listings, profile, { minSalary, remoteOnly });
  console.log(`[job-pipeline] ${qualified.length}/${listings.length} listings passed filter`);

  if (!qualified.length) {
    _pipelineStatus.running = false;
    return `Found ${listings.length} listings on ${site} but none matched profile filters. Try a broader query.`;
  }

  // ── Step 2b: Score + rank (Bob-style company research on top N) ───────────
  const ranked = await jobCrm.scoreAndRankListings(profile, qualified, {
    researchTopN: jobCrm.RESEARCH_TOP_N,
  });
  console.log(`[job-pipeline] Scored ${ranked.length} listings — top: ${ranked[0]?.score || '?'} (${ranked[0]?.job?.company || '?'})`);

  const crmStore = jobCrm.loadCrm();
  const results = { applied: [], manualQueue: [], skipped: [], failed: [] };
  let bestMatch = null;
  let fullAiUsed = 0;
  let applyCount = 0;

  // Build one shared opener template for template cover letters
  const openerTemplate = `${profile.summary || 'I build production software and ship what I start.'}`;
  const npcBrains = deps.npcBrains || null;

  for (const entry of ranked) {
    const job = entry.job;
    const jobId = crypto.randomUUID();
    const company = job.company || 'Unknown Company';
    const role    = job.title   || 'Unknown Role';
    const score   = entry.score;
    const recommendation = entry.recommendation;

    if (recommendation === 'skip') {
      results.skipped.push({ company, role, score });
      jobCrm.upsertApplication(crmStore, {
        id: jobId, company, role, site, status: 'skipped', score,
        scoreReasons: entry.reasons, url: job.url || null,
        description: (job.description || job.snippet || '').slice(0, 500),
      });
      continue;
    }

    if (recommendation === 'review') {
      results.manualQueue.push({ company, role, score });
      jobCrm.upsertApplication(crmStore, {
        id: jobId, company, role, site, status: 'queued', score,
        scoreReasons: entry.reasons, url: job.url || null,
        description: (job.description || job.snippet || '').slice(0, 500),
        researchSummary: (entry.research?.results || []).slice(0, 2).map(r => r.title).join('; ') || null,
      });
      continue;
    }

    if (applyCount >= jobCrm.MAX_AUTO_APPLY_PER_RUN) {
      results.manualQueue.push({ company, role, score });
      jobCrm.upsertApplication(crmStore, {
        id: jobId, company, role, site, status: 'queued', score,
        scoreReasons: entry.reasons, url: job.url || null,
        notes: 'Daily apply cap reached — queued for next run',
      });
      continue;
    }

    // Step 3 — Generate tailored resume
    let resumePath = null;
    try {
      const profileTmpPath = path.join(require('os').tmpdir(), `lucy-profile-${jobId}.json`);
      const jobTmpPath     = path.join(require('os').tmpdir(), `lucy-job-${jobId}.json`);
      fs.writeFileSync(profileTmpPath, JSON.stringify(profile), 'utf8');
      fs.writeFileSync(jobTmpPath, JSON.stringify({
        title: role, company, description: job.description || job.snippet || '',
      }), 'utf8');

      const resumeOut = path.join(require('os').tmpdir(), `lucy-resume-${jobId}.html`);
      const resumeArgs = [
        '--profile', profileTmpPath,
        '--job',     jobTmpPath,
        '--template', 'modern',
        '--output',  resumeOut,
      ];
      await _spawnSkill(RESUME_SCRIPT, resumeArgs, 30000);
      resumePath = fs.existsSync(resumeOut) ? resumeOut : null;

      // Clean up tmp files
      try { fs.unlinkSync(profileTmpPath); } catch (_) {}
      try { fs.unlinkSync(jobTmpPath); } catch (_) {}
    } catch (err) {
      console.warn(`[job-pipeline] Resume gen failed for ${role} at ${company}:`, err.message);
      // Continue without a tailored resume — not fatal
    }

    // Step 4 — Cover letter: full AI for top-scored roles, template otherwise
    let coverLetter;
    let letterType = 'template';
    const useFullAi = score >= jobCrm.FULL_AI_SCORE_THRESHOLD
      && fullAiUsed < jobCrm.FULL_AI_MAX_COUNT
      && npcBrains;
    if (useFullAi) {
      try {
        const { systemHint, userPrompt } = buildCoverLetterPrompt(profile, {
          jobTitle: role, company, description: job.description || job.snippet || '',
        });
        coverLetter = await npcBrains.getResponse('Lucy', 'CEO', userPrompt, {
          kind: 'job-application',
          systemOverride: systemHint,
        });
        letterType = 'fullAI';
        fullAiUsed++;
      } catch (err) {
        console.warn(`[job-pipeline] fullAI cover letter failed for ${company}:`, err.message);
        coverLetter = _buildTemplateCoverLetter(profile, { title: role, company }, openerTemplate);
      }
    } else {
      coverLetter = npcBrains
        ? await buildFastCoverLetter(npcBrains, profile, { jobTitle: role, company, description: job.description || job.snippet || '' })
        : _buildTemplateCoverLetter(profile, { title: role, company }, openerTemplate);
    }

    // Step 5 — Apply or queue
    let status = 'needs_manual_apply';
    let applierError = null;

    if (job.url && fs.existsSync(APPLIER_SCRIPT)) {
      try {
        const applierArgs = [
          '--url',          job.url,
          '--dry-run',      'true', // always dry-run from pipeline — safety first
          '--headless',     'false', // visible + stealth; CF sites need real browser
          '--browser-mode', process.env.LUCY_BROWSER_MODE || 'auto',
        ];
        if (resumePath) applierArgs.push('--resume-pdf', resumePath);
        if (coverLetter) applierArgs.push('--cover-letter', coverLetter.slice(0, 800));

        await _spawnSkill(APPLIER_SCRIPT, applierArgs, 180000);
        status = 'applied';
        if (!bestMatch) bestMatch = { company, role };
      } catch (err) {
        applierError = err.message;
        status = 'needs_manual_apply';
        console.warn(`[job-pipeline] Applier failed for ${role} at ${company}:`, err.message);
      }
    } else {
      if (!job.url) console.log(`[job-pipeline] No URL for ${role} at ${company} — queuing for manual review`);
      if (!fs.existsSync(APPLIER_SCRIPT)) console.warn('[job-pipeline] job-applier.mjs not found — skipping auto-apply');
    }

    const crmStatus = status === 'applied' ? 'applied' : 'awaiting_submit';
    const appliedAt = new Date().toISOString();

    // Step 6 — Log entry (legacy log + CRM)
    const logEntry = {
      id: jobId, ts: appliedAt, npc: 'Lucy', company, role, site, status,
      score, letterType,
      resumePath: resumePath || null,
      notes: applierError ? `Applier error: ${applierError}` : (status === 'needs_manual_apply' ? 'No URL or applier unavailable' : 'Dry-run via job-applier'),
    };
    _appendLog(logEntry);

    jobCrm.upsertApplication(crmStore, {
      id: jobId, company, role, site, url: job.url || null,
      status: crmStatus, score, scoreReasons: entry.reasons,
      letterType, resumePath: resumePath || null,
      description: (job.description || job.snippet || '').slice(0, 500),
      researchSummary: (entry.research?.results || []).slice(0, 2).map(r => r.title).join('; ') || null,
      appliedAt,
      companyDomain: (job.url || '').match(/https?:\/\/([^/]+)/)?.[1]?.replace(/^www\./, '') || null,
    });
    jobCrm.recordOutcome(jobId, 'applied', {
      site, scoreBand: score >= 8 ? '8-10' : score >= 6 ? '6-7' : '1-5', letterType,
    });

    if (status === 'applied') {
      results.applied.push({ company, role, score });
      applyCount++;
      if (!bestMatch || score > (bestMatch.score || 0)) bestMatch = { company, role, score };
    } else {
      results.manualQueue.push({ company, role, score });
    }
  }

  jobCrm.saveCrm(crmStore);

  // ── Step 7: Summary ──────────────────────────────────────────────────────
  const appliedCount = results.applied.length;
  const manualCount  = results.manualQueue.length;
  const skippedCount = results.skipped.length;
  const bestStr = bestMatch
    ? ` Best match: ${bestMatch.role} at ${bestMatch.company} (score ${bestMatch.score}).`
    : '';
  const summary = [
    `Scored ${ranked.length} listings.`,
    appliedCount ? `Applied to ${appliedCount} role${appliedCount === 1 ? '' : 's'} (score ≥ ${jobCrm.MIN_SCORE_TO_APPLY}).` : '',
    manualCount  ? `${manualCount} queued for your review.` : '',
    skippedCount ? `${skippedCount} low-fit roles skipped.` : '',
    fullAiUsed ? `${fullAiUsed} got tailored full-AI cover letters.` : '',
    bestStr,
  ].filter(Boolean).join(' ').trim() || `Processed ${qualified.length} listings from ${site} — all queued for manual review.`;

  _pipelineStatus = { running: false, lastRun: _pipelineStatus.lastRun, lastSummary: summary };
  console.log('[job-pipeline] Done:', summary);
  return summary;
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

module.exports = {
  applyToJob,
  applyByEmail,
  applyByWebForm,
  loadProfile,
  runJobPipeline,
  getApplicationLog,
  getPipelineStatus,
  buildCoverLetterPrompt,
  buildFastCoverLetter,
};
