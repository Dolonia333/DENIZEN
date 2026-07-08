'use strict';
/**
 * Job CRM — full job-search lifecycle beyond "fill a form".
 *
 * Discover → score → research → tailor → apply → watch inbox → follow up →
 * interview prep → outcome learning → weekly standup.
 */

const fs = require('node:fs');
const path = require('node:path');
const webResearch = require('./web-research');

let _denizenDb = null;
function _db() {
  if (!_denizenDb) {
    try { _denizenDb = require('./denizen-db'); } catch (_) {}
  }
  return _denizenDb;
}

const ROOT = path.resolve(__dirname, '..');
const CRM_FILE = path.join(ROOT, 'data', 'job-crm.json');
const OUTCOMES_FILE = path.join(ROOT, 'data', 'job-outcomes.json');
const PREP_DIR = path.join(ROOT, 'reports', 'interview-prep');

const MAX_AUTO_APPLY_PER_RUN = 5;
const MIN_SCORE_TO_APPLY = 7;
const MIN_SCORE_TO_QUEUE = 5;
const FULL_AI_SCORE_THRESHOLD = 8;
const FULL_AI_MAX_COUNT = 3;
const STALE_DAYS = 10;
const RESEARCH_TOP_N = 5;

const RECRUITER_KEYWORDS = /\b(recruiter|talent|hiring|careers|hr@|jobs@|recruiting|staffing|headhunter)\b/i;
const INTERVIEW_KEYWORDS = /\b(interview|phone screen|video call|calendar invite|schedule a (call|chat)|speak with you|meet (with )?you)\b/i;
const REJECTION_KEYWORDS = /\b(not moving forward|unfortunately|other candidates|position has been filled|decided to proceed|not selected|regret to inform)\b/i;
const OFFER_KEYWORDS = /\b(offer letter|compensation package|we'd like to offer|pleased to offer|salary of|equity grant|start date)\b/i;
const OUTREACH_KEYWORDS = /\b(reaching out|great fit|open role|hiring for|opportunity at|your background|passive candidate)\b/i;

function _readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function _writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function loadCrm() {
  const store = _readJson(CRM_FILE, { applications: [], referrals: [], lastStandupAt: null });
  if (!Array.isArray(store.applications)) store.applications = [];
  if (!Array.isArray(store.referrals)) store.referrals = [];
  return store;
}

function _syncAppToDb(app) {
  try {
    require('./denizen-db').syncJobApplication(app);
  } catch (_) {}
}

function saveCrm(store) {
  _writeJson(CRM_FILE, store);
}

function syncAllApplicationsToDb() {
  const store = loadCrm();
  try {
    require('./denizen-db').syncAllJobApplications(store.applications);
  } catch (_) {}
  return store.applications.length;
}

function loadOutcomes() {
  const store = _readJson(OUTCOMES_FILE, { stats: {}, events: [] });
  if (!store.stats || typeof store.stats !== 'object') store.stats = {};
  if (!Array.isArray(store.events)) store.events = [];
  return store;
}

function saveOutcomes(store) {
  _writeJson(OUTCOMES_FILE, store);
}

function _norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function _wordOverlap(a, b) {
  const wa = new Set(_norm(a).split(/\s+/).filter(w => w.length > 2));
  const wb = new Set(_norm(b).split(/\s+/).filter(w => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let hit = 0;
  wa.forEach(w => { if (wb.has(w)) hit++; });
  return hit / Math.max(wa.size, wb.size);
}

/**
 * Score a listing 1–10 against the user profile.
 * @param {object} profile — user-profile.json
 * @param {object} job — { title, company, description?, snippet?, location?, salary?, url? }
 * @param {object} [research] — optional webResearch result
 */
function scoreListing(profile, job, research = null) {
  let score = 5;
  const reasons = [];
  const title = (job.title || '').toLowerCase();
  const desc = `${job.description || job.snippet || ''}`.toLowerCase();
  const company = job.company || 'Unknown';

  const targetRoles = (profile.targetRoles || [
    'senior ai engineer', 'product manager', 'full-stack engineer',
    'backend developer', 'software engineer', 'developer',
  ]).map(r => r.toLowerCase());

  const roleHits = targetRoles.filter(r => title.includes(r) || desc.includes(r));
  if (roleHits.length) {
    score += Math.min(2, roleHits.length);
    reasons.push(`role match: ${roleHits[0]}`);
  } else {
    score -= 2;
    reasons.push('weak role match');
  }

  const skills = (profile.skills || []).map(s => s.toLowerCase());
  const skillHits = skills.filter(s => desc.includes(s) || title.includes(s));
  if (skillHits.length >= 4) { score += 2; reasons.push(`${skillHits.length} skills match`); }
  else if (skillHits.length >= 2) { score += 1; reasons.push(`${skillHits.length} skills match`); }
  else if (!skillHits.length) { score -= 1; reasons.push('few skill overlaps'); }

  const remotePref = profile.autofillDefaults?.remotePreference === 'remote';
  const remoteText = `${title} ${desc} ${(job.location || '').toLowerCase()}`;
  if (remotePref) {
    if (remoteText.includes('remote')) { score += 1; reasons.push('remote OK'); }
    else if (remoteText.includes('on-site') || remoteText.includes('onsite')) {
      score -= 1; reasons.push('on-site only');
    }
  }

  if (job.salary) {
    const num = Number(String(job.salary).replace(/[^0-9]/g, '')) || 0;
    const floor = Number(profile.minSalary || 0);
    if (num > 0 && floor > 0) {
      if (num >= floor) { score += 1; reasons.push('meets salary floor'); }
      else { score -= 2; reasons.push('below salary floor'); }
    }
  }

  if (research?.results?.length) {
    const snips = research.results.map(r => `${r.title} ${r.snippet}`).join(' ').toLowerCase();
    if (/\b(ai|ml|startup|series [abc]|well[- ]funded|remote[- ]first)\b/.test(snips)) {
      score += 1;
      reasons.push('company research positive signals');
    }
    if (/\b(layoff|bankrupt|shutdown|scam)\b/.test(snips)) {
      score -= 2;
      reasons.push('company research red flags');
    }
  }

  const projects = (profile.projects || []).map(p => (p.name || '').toLowerCase());
  if (projects.some(p => p && (desc.includes(p.split(' ')[0]) || title.includes('ai')))) {
    score += 0.5;
    reasons.push('project alignment');
  }

  score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));
  return {
    score,
    reasons: reasons.slice(0, 4),
    recommendation: score >= MIN_SCORE_TO_APPLY ? 'apply'
      : score >= MIN_SCORE_TO_QUEUE ? 'review' : 'skip',
  };
}

function upsertApplication(store, entry) {
  const apps = store.applications;
  const idx = entry.id ? apps.findIndex(a => a.id === entry.id) : -1;
  const now = new Date().toISOString();
  const merged = {
    ...(idx >= 0 ? apps[idx] : {}),
    ...entry,
    updatedAt: now,
    createdAt: (idx >= 0 ? apps[idx].createdAt : null) || entry.createdAt || now,
  };
  if (idx >= 0) apps[idx] = merged;
  else apps.unshift(merged);
  if (apps.length > 300) apps.length = 300;
  _syncAppToDb(merged);
  return merged;
}

function findMatchingApplication(store, emailPayload) {
  const hay = `${emailPayload.subject || ''} ${emailPayload.body || ''} ${emailPayload.from || ''}`;
  const fromDomain = String(emailPayload.from || '').split('@')[1]?.toLowerCase() || '';
  let best = null;
  let bestScore = 0;

  for (const app of store.applications) {
    if (['rejected', 'closed'].includes(app.status)) continue;
    let match = 0;
    const company = _norm(app.company);
    if (company && _norm(hay).includes(company)) match += 0.5;
    if (app.role && _wordOverlap(app.role, hay) > 0.3) match += 0.3;
    if (app.applyEmail && emailPayload.from?.toLowerCase().includes(app.applyEmail.toLowerCase())) match += 0.4;
    if (app.companyDomain && fromDomain.includes(app.companyDomain.toLowerCase())) match += 0.35;
    if (match > bestScore) { bestScore = match; best = app; }
  }
  return bestScore >= 0.35 ? { app: best, confidence: bestScore } : null;
}

function classifyJobEmail(emailPayload) {
  const hay = `${emailPayload.subject || ''}\n${emailPayload.body || ''}`.toLowerCase();
  if (OFFER_KEYWORDS.test(hay)) return 'offer';
  if (INTERVIEW_KEYWORDS.test(hay)) return 'interview_request';
  if (REJECTION_KEYWORDS.test(hay)) return 'rejection';
  if (OUTREACH_KEYWORDS.test(hay) && RECRUITER_KEYWORDS.test(hay)) return 'recruiter_outreach';
  if (RECRUITER_KEYWORDS.test(hay)) return 'recruiter_reply';
  return null;
}

function recordOutcome(appId, outcome, meta = {}) {
  const outcomes = loadOutcomes();
  const event = { appId, outcome, at: new Date().toISOString(), ...meta };
  outcomes.events.unshift(event);
  if (outcomes.events.length > 500) outcomes.events.length = 500;

  const bump = (key, field) => {
    if (!outcomes.stats[key]) outcomes.stats[key] = {};
    if (!outcomes.stats[key][field]) outcomes.stats[key][field] = 0;
    outcomes.stats[key][field]++;
  };

  if (meta.site) bump('bySite', meta.site);
  if (meta.scoreBand) bump('byScoreBand', meta.scoreBand);
  if (meta.letterType) bump('byLetterType', meta.letterType);
  if (outcome === 'replied' || outcome === 'interview' || outcome === 'offer') {
    bump('totals', 'positive');
  } else if (outcome === 'rejected') {
    bump('totals', 'rejected');
  } else if (outcome === 'applied') {
    bump('totals', 'applied');
  }

  saveOutcomes(outcomes);
  try { _db()?.recordJobOutcome?.(appId, outcome, meta); } catch (_) {}
  return event;
}

function getOutcomeStats() {
  const outcomes = loadOutcomes();
  const crm = loadCrm();
  const apps = crm.applications;
  const applied = apps.filter(a => ['applied', 'watching', 'recruiter_replied', 'interview_scheduled', 'offer', 'follow_up_sent'].includes(a.status)).length;
  const replied = apps.filter(a => ['recruiter_replied', 'interview_scheduled', 'offer'].includes(a.status)).length;
  const interviews = apps.filter(a => a.status === 'interview_scheduled').length;
  const offers = apps.filter(a => a.status === 'offer').length;
  const replyRate = applied ? Math.round((replied / applied) * 100) : 0;

  return {
    applied,
    replied,
    interviews,
    offers,
    replyRate,
    stored: outcomes.stats,
    insights: _buildInsights(outcomes.stats, apps),
  };
}

function _buildInsights(stats, apps) {
  const insights = [];
  const bySite = stats.bySite || {};
  const sites = Object.entries(bySite).sort((a, b) => (b[1].positive || 0) - (a[1].positive || 0));
  if (sites.length) insights.push(`Best reply source so far: ${sites[0][0]}`);

  const byLetter = stats.byLetterType || {};
  const fullAi = byLetter.fullAI?.positive || 0;
  const tmpl = byLetter.template?.positive || 0;
  if (fullAi + tmpl > 0) {
    insights.push(fullAi >= tmpl
      ? 'Full-AI cover letters are outperforming templates — keep using them for top picks.'
      : 'Template letters are holding up — reserve full-AI for 8+ scored roles only.');
  }

  const highScore = apps.filter(a => (a.score || 0) >= 8 && a.status === 'recruiter_replied').length;
  const lowScore = apps.filter(a => (a.score || 0) < 7 && a.status === 'recruiter_replied').length;
  if (highScore > lowScore) insights.push('High-scored applications (8+) are getting more replies — scoring is working.');

  return insights.slice(0, 4);
}

function detectStaleApplications(days = STALE_DAYS) {
  const crm = loadCrm();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return crm.applications.filter(a => {
    if (!['applied', 'watching', 'awaiting_submit'].includes(a.status)) return false;
    const t = new Date(a.appliedAt || a.createdAt || 0).getTime();
    return t > 0 && t < cutoff && !a.followUpDraftedAt;
  });
}

async function researchCompany(company) {
  if (!company || company === 'Unknown Company') return null;
  try {
    return await webResearch.research(`${company} company careers funding remote`, { count: 3, read: 0 });
  } catch (_) {
    return null;
  }
}

async function scoreAndRankListings(profile, listings, { researchTopN = RESEARCH_TOP_N } = {}) {
  const sorted = [...listings];
  // Quick pre-score for research prioritization
  const preScored = sorted.map(job => ({ job, pre: scoreListing(profile, job) }));
  preScored.sort((a, b) => b.pre.score - a.pre.score);

  const researchMap = new Map();
  const topForResearch = preScored.slice(0, researchTopN);
  await Promise.all(topForResearch.map(async ({ job }) => {
    const r = await researchCompany(job.company);
    if (r) researchMap.set(job.url || `${job.company}:${job.title}`, r);
  }));

  return preScored.map(({ job, pre }) => {
    const key = job.url || `${job.company}:${job.title}`;
    const research = researchMap.get(key) || null;
    const scored = scoreListing(profile, job, research);
    return { job, ...scored, research };
  }).sort((a, b) => b.score - a.score);
}

function buildWeeklyStandup() {
  const crm = loadCrm();
  const stats = getOutcomeStats();
  const stale = detectStaleApplications();
  const awaiting = crm.applications.filter(a => a.status === 'awaiting_submit');
  const watching = crm.applications.filter(a => a.status === 'watching');
  const replies = crm.applications.filter(a => ['recruiter_replied', 'interview_scheduled'].includes(a.status));
  const offers = crm.applications.filter(a => a.status === 'offer');
  const queue = crm.applications.filter(a => a.status === 'queued');

  const best = [...crm.applications]
    .filter(a => a.score >= 8)
    .sort((a, b) => b.score - a.score)[0];

  const lines = [
    `📋 Job search standup — ${new Date().toLocaleDateString()}`,
    stats.applied ? `Applied/watching: ${stats.applied} · Replies: ${stats.replied} (${stats.replyRate}% reply rate)` : 'No applications logged yet.',
    awaiting.length ? `${awaiting.length} waiting for your Submit click.` : '',
    watching.length ? `${watching.length} in inbox watch.` : '',
    replies.length ? `${replies.length} recruiter/interview threads active.` : '',
    offers.length ? `🎉 ${offers.length} offer(s) need your review!` : '',
    queue.length ? `${queue.length} scored roles queued for your review.` : '',
    stale.length ? `${stale.length} applications stale (>${STALE_DAYS}d) — follow up?` : '',
    best ? `Best match in pipeline: ${best.role} at ${best.company} (score ${best.score}).` : '',
    stats.insights.length ? `Insight: ${stats.insights[0]}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

async function generateFollowUpDraft(npcBrains, app) {
  const prompt = [
    `Draft a brief, professional follow-up email for a job application.`,
    `Role: ${app.role} at ${app.company}`,
    `Applied on: ${(app.appliedAt || app.createdAt || '').slice(0, 10)}`,
    `Tone: warm, confident, under 120 words. No filler openers.`,
    `Mention you're still interested and open to a conversation.`,
    `Return ONLY the email body.`,
  ].join('\n');
  const text = await npcBrains.getResponse('Lucy', 'CEO', prompt, { kind: 'job-follow-up' });
  return String(text || '').trim();
}

async function generateInterviewPrep(npcBrains, app, profile) {
  const prompt = [
    `Create interview prep notes for the CEO.`,
    `Role: ${app.role} at ${app.company}`,
    app.description ? `Job description:\n${app.description.slice(0, 1500)}` : '',
    `Candidate background: ${profile.summary || ''}`,
    `Top experience: ${(profile.experience || []).slice(0, 2).map(e => `${e.title} at ${e.company}`).join('; ')}`,
    `Key projects: ${(profile.projects || []).slice(0, 3).map(p => p.name).join(', ')}`,
    `Include: 5 likely questions, 3 talking points from their real projects, 2 questions to ask the interviewer, 1 red flag to probe.`,
    `Format as markdown.`,
  ].filter(Boolean).join('\n\n');

  const text = await npcBrains.getResponse('Lucy', 'CEO', prompt, { kind: 'interview-prep' });
  const body = String(text || '').trim();
  fs.mkdirSync(PREP_DIR, { recursive: true });
  const slug = `${_norm(app.company).replace(/\s+/g, '-')}-${_norm(app.role).replace(/\s+/g, '-')}`.slice(0, 80);
  const filePath = path.join(PREP_DIR, `${slug}-${Date.now()}.md`);
  const header = `# Interview prep: ${app.role} at ${app.company}\n\nGenerated: ${new Date().toISOString()}\n\n`;
  fs.writeFileSync(filePath, header + body, 'utf8');
  return { text: body, filePath };
}

async function generateSalaryBrief(npcBrains, app, emailPayload) {
  const compResearch = await webResearch.research(
    `${app.role} salary ${app.company} remote 2025`,
    { count: 3, read: 0 },
  );
  const compSnip = (compResearch.results || []).map(r => `- ${r.title}: ${r.snippet}`).join('\n').slice(0, 800);

  const prompt = [
    `The CEO received a job offer email. Help them negotiate intelligently.`,
    `Role: ${app.role} at ${app.company}`,
    `Offer email excerpt:\n${(emailPayload.body || '').slice(0, 1200)}`,
    compSnip ? `Market comp research:\n${compSnip}` : '',
    `Provide: (1) summary of what was offered, (2) 3 negotiation levers, (3) suggested counter range if data supports it, (4) what NOT to accept without CEO review.`,
    `Keep it under 250 words.`,
  ].filter(Boolean).join('\n\n');

  const text = await npcBrains.getResponse('Lucy', 'CEO', prompt, { kind: 'salary-negotiation' });
  return { brief: String(text || '').trim(), compResearch };
}

/**
 * Process an inbound email for job-search lifecycle actions.
 * Returns { handled, action?, app?, draft?, prep?, brief?, escalated? }
 */
async function processInboundJobEmail(deps, emailPayload) {
  const { npcBrains, gmailClient } = deps || {};
  const kind = classifyJobEmail(emailPayload);
  if (!kind) return { handled: false };

  const store = loadCrm();
  const match = findMatchingApplication(store, emailPayload);
  const now = new Date().toISOString();
  let app = match?.app || null;

  // New recruiter outreach — no existing app
  if (kind === 'recruiter_outreach' && !app) {
    const subject = emailPayload.subject || '';
    const roleGuess = subject.replace(/re:|fw:/gi, '').trim().slice(0, 120);
    app = upsertApplication(store, {
      id: `crm_${Date.now()}`,
      company: _extractCompanyFromEmail(emailPayload) || 'Unknown',
      role: roleGuess || 'Inbound opportunity',
      status: 'discovered',
      source: 'inbound_email',
      inboundFrom: emailPayload.from,
      notes: 'Recruiter outreach — linked from inbox',
    });
    saveCrm(store);
  }

  if (!app) return { handled: false, kind, reason: 'no matching application' };

  const updates = { lastEmailAt: now, lastEmailKind: kind };
  const result = { handled: true, kind, app, action: kind };

  if (kind === 'interview_request') {
    updates.status = 'interview_scheduled';
    recordOutcome(app.id, 'interview', { site: app.site, scoreBand: _scoreBand(app.score), letterType: app.letterType });
    if (npcBrains) {
      try {
        const profile = _loadProfile();
        const prep = await generateInterviewPrep(npcBrains, { ...app, ...updates }, profile);
        result.prep = prep;
        updates.prepPath = prep.filePath;
        result.action = 'interview_prep';
      } catch (err) {
        result.prepError = err.message;
      }
    }
  } else if (kind === 'rejection') {
    updates.status = 'rejected';
    recordOutcome(app.id, 'rejected', { site: app.site, scoreBand: _scoreBand(app.score), letterType: app.letterType });
    result.action = 'rejection_logged';
  } else if (kind === 'offer') {
    updates.status = 'offer';
    recordOutcome(app.id, 'offer', { site: app.site, scoreBand: _scoreBand(app.score), letterType: app.letterType });
    result.escalated = true;
    if (npcBrains) {
      try {
        const brief = await generateSalaryBrief(npcBrains, { ...app, ...updates }, emailPayload);
        result.brief = brief;
        result.action = 'offer_negotiation';
      } catch (err) {
        result.briefError = err.message;
      }
    }
  } else if (kind === 'recruiter_reply' || kind === 'recruiter_outreach') {
    updates.status = 'recruiter_replied';
    recordOutcome(app.id, 'replied', { site: app.site, scoreBand: _scoreBand(app.score), letterType: app.letterType });
    if (npcBrains && gmailClient) {
      try {
        const { assembleFinalBody, parseEmailStyle } = require('./email-handler');
        const brain = npcBrains.brains?.Lucy;
        const style = brain?.personality ? parseEmailStyle(brain.personality) : null;
        const replyPrompt = [
          `Recruiter emailed about ${app.role} at ${app.company}.`,
          `From: ${emailPayload.from}`,
          `Subject: ${emailPayload.subject}`,
          `Body:\n${(emailPayload.body || '').slice(0, 2000)}`,
          `Draft a warm, brief reply. If they're asking to schedule, suggest flexibility.`,
          `Return ONLY the email body.`,
        ].join('\n\n');
        const replyText = await npcBrains.getResponse('Lucy', 'CEO', replyPrompt, { kind: 'recruiter-reply' });
        const finalBody = style ? assembleFinalBody(replyText, style) : String(replyText || '').trim();
        const subjectReply = /^re:/i.test(emailPayload.subject || '') ? emailPayload.subject : `Re: ${emailPayload.subject || app.role}`;
        const drafted = await gmailClient.createDraft({
          to: emailPayload.from,
          subject: subjectReply,
          body: finalBody,
          threadId: emailPayload.threadId || null,
          by: 'Lucy',
        });
        result.draft = drafted;
        updates.draftId = drafted.id;
        result.action = 'recruiter_reply_drafted';
      } catch (err) {
        result.draftError = err.message;
      }
    }
  }

  upsertApplication(store, { ...app, ...updates });
  saveCrm(store);
  return result;
}

function _extractCompanyFromEmail(emailPayload) {
  const from = String(emailPayload.from || '');
  const domain = from.split('@')[1]?.split('>')[0]?.trim() || '';
  if (!domain) return null;
  const base = domain.split('.')[0];
  if (['gmail', 'yahoo', 'outlook', 'icloud', 'proton'].includes(base)) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function _scoreBand(score) {
  const s = Number(score) || 0;
  if (s >= 8) return '8-10';
  if (s >= 6) return '6-7';
  return '1-5';
}

function _loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'user-profile.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

async function runMaintenance(deps = {}) {
  const { npcBrains, broadcast } = deps;
  const store = loadCrm();
  const stale = detectStaleApplications();
  const events = [];

  for (const app of stale.slice(0, 3)) {
    if (!npcBrains) break;
    try {
      const draft = await generateFollowUpDraft(npcBrains, app);
      upsertApplication(store, {
        ...app,
        followUpDraft: draft,
        followUpDraftedAt: new Date().toISOString(),
        status: app.status === 'applied' ? 'watching' : app.status,
      });
      events.push({ type: 'follow_up_drafted', appId: app.id, company: app.company });
    } catch (err) {
      events.push({ type: 'follow_up_failed', appId: app.id, error: err.message });
    }
  }
  saveCrm(store);
  const synced = syncAllApplicationsToDb();

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const last = store.lastStandupAt ? new Date(store.lastStandupAt).getTime() : 0;
  if (Date.now() - last >= weekMs) {
    const report = buildWeeklyStandup();
    store.lastStandupAt = new Date().toISOString();
    saveCrm(store);
    if (broadcast) {
      broadcast({ type: 'npc_report_to_ceo', npcName: 'Lucy', text: report, ts: Date.now() });
      broadcast({ type: 'job_standup', report, ts: Date.now() });
    }
    events.push({ type: 'weekly_standup', report });
  }

  return { stale: stale.length, synced, events };
}

function listApplications({ status, limit = 50 } = {}) {
  const crm = loadCrm();
  let apps = crm.applications;
  if (status) apps = apps.filter(a => a.status === status);
  return apps.slice(0, limit);
}

function addReferral({ company, contact, relationship, notes }) {
  const store = loadCrm();
  store.referrals.unshift({
    company, contact, relationship: relationship || 'linkedin',
    notes: notes || '', addedAt: new Date().toISOString(),
  });
  if (store.referrals.length > 100) store.referrals.length = 100;
  saveCrm(store);
  return store.referrals[0];
}

module.exports = {
  CRM_FILE,
  MAX_AUTO_APPLY_PER_RUN,
  MIN_SCORE_TO_APPLY,
  MIN_SCORE_TO_QUEUE,
  FULL_AI_SCORE_THRESHOLD,
  FULL_AI_MAX_COUNT,
  STALE_DAYS,
  loadCrm,
  saveCrm,
  syncAllApplicationsToDb,
  scoreListing,
  scoreAndRankListings,
  researchCompany,
  upsertApplication,
  classifyJobEmail,
  findMatchingApplication,
  processInboundJobEmail,
  generateFollowUpDraft,
  generateInterviewPrep,
  generateSalaryBrief,
  detectStaleApplications,
  recordOutcome,
  getOutcomeStats,
  buildWeeklyStandup,
  runMaintenance,
  listApplications,
  addReferral,
};
