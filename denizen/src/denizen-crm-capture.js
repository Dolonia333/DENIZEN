'use strict';

/**
 * Angela-style CRM capture: one natural-language phrase → note + optional task + optional deal touch.
 * All writes go through denizen-crm-agent-writes (org policy fail-closed).
 */

const agentWrites = require('./denizen-crm-agent-writes');
const crmMutations = require('./denizen-crm-mutations');
const crmSkills = require('./denizen-crm-skills');

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function parseRelativeDue(text) {
  const msg = String(text || '').toLowerCase();
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  if (/\btoday\b/.test(msg)) return today.toISOString().slice(0, 10);
  if (/\btomorrow\b/.test(msg)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/\bnext week\b/.test(msg)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }

  const iso = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const weekday = msg.match(/\b(?:on\s+)?(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (weekday) {
    const target = WEEKDAYS[weekday[2]];
    const d = new Date(today);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0 || weekday[1]) delta = delta === 0 ? 7 : delta;
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

function extractWho(message) {
  const msg = String(message || '');
  const patterns = [
    // Non-greedy capture; stop before about/re/follow-up (dots in OK.gov are fine)
    /\b(?:talked|spoke|met|call(?:ed)?|emailed|email|meeting)\s+(?:with|to)\s+(.+?)(?:\s+about|\s+re:|\s+regarding|\s+follow|,|$)/i,
    /\b(?:with|for)\s+([A-Z][A-Za-z0-9&. -]{1,50}?)(?:\s+about|\s+on|\s+follow|,|$)/i,
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m) {
      const who = m[1].trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
      if (who && !/^(the|a|an|my|our|this|that)$/i.test(who) && who.length <= 60) return who;
    }
  }
  return null;
}

function extractDealHint(message) {
  const msg = String(message || '');
  const bid = msg.match(/\b(OMES\s*\w*|EV\d+|RFP\s*[\w-]+|I\.?W\.?I\.?N\.?|RM\s*Cyber|CloudForge|1921)[^\s,]*/i);
  if (bid) return bid[1].trim();
  const about = msg.match(/\babout\s+(?:the\s+)?([A-Za-z0-9][\w\s.-]{2,40}?)(?:\s+bid|\s+deal|\s+proposal|,|\.|$)/i);
  if (about) return about[1].trim();
  return null;
}

function wantsFollowUp(message) {
  return /\b(follow[- ]?up|remind|callback|call back|check[- ]?in|due)\b/i.test(String(message || ''));
}

function wantsDealTouch(message) {
  return /\b(deal|pipeline|stage|bid|proposal|move|qualify|won|lost)\b/i.test(String(message || ''));
}

/**
 * Run capture: match/create contact → note → optional task → optional deal stage touch.
 */
async function runCapture(opts = {}) {
  const {
    orgSlug,
    orgId,
    npcName = 'Lucy',
    message,
    identityId = null,
    createContactIfMissing = true,
  } = opts;

  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'message required', summary: 'Nothing to capture.' };
  if (!orgSlug) return { ok: false, error: 'org_slug required', summary: 'Organization required.' };
  if (!orgId) return { ok: false, error: 'org_id required', summary: 'CRM workspace unavailable.' };

  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const who = extractWho(text) || opts.name || opts.contact || null;
  const dealHint = extractDealHint(text) || opts.deal || opts.title || null;
  const due = parseRelativeDue(text) || opts.due || null;

  let contact = who
    ? crmSkills.findContact(state, { name: who, contact: who, email: opts.email })
    : null;

  const created = [];
  const summaries = [];

  if (!contact && who && createContactIfMissing) {
    try {
      const added = await crmMutations.addContact(orgId, {
        name: who,
        company: who,
        status: 'Lead',
        notes: `Captured from chat by ${npcName}`,
        tags: ['ai-capture'],
      }, identityId);
      contact = added?.contact || crmSkills.findContact(
        (await crmMutations.loadOrgWorkspace(orgId)).state,
        { name: who },
      );
      if (contact) {
        created.push({ type: 'contact', id: contact.id, name: contact.name });
        summaries.push(`Added contact ${contact.name}`);
      }
    } catch (err) {
      summaries.push(`Contact create skipped: ${err.message}`);
    }
  }

  let deal = dealHint
    ? crmSkills.findDeal(state, { title: dealHint, deal: dealHint, contact: who || contact?.name })
    : (who ? crmSkills.findDeal(state, { contact: who }) : null);

  if (!deal && dealHint) {
    const fresh = await crmMutations.loadOrgWorkspace(orgId);
    deal = crmSkills.findDeal(fresh.state, { title: dealHint, deal: dealHint });
  }

  const noteBody = text.slice(0, 2000);
  const noteResult = await agentWrites.createNote({
    orgSlug,
    npcName,
    contactId: contact?.id,
    dealId: deal?.id,
    body: noteBody,
    identityId,
  });
  if (!noteResult.ok) {
    return {
      ok: false,
      error: noteResult.error,
      code: noteResult.code,
      summary: noteResult.summary || noteResult.error || 'Could not log note.',
      created,
    };
  }
  created.push({ type: 'note', id: noteResult.id });
  summaries.push(noteResult.summary);

  if (wantsFollowUp(text) || due) {
    const taskTitle = who
      ? `Follow up with ${who}${dealHint ? ` — ${dealHint}` : ''}`
      : (dealHint ? `Follow up — ${dealHint}` : `Follow up: ${text.slice(0, 60)}`);
    const taskResult = await agentWrites.logTask({
      orgSlug,
      npcName,
      title: taskTitle.slice(0, 200),
      dueAt: due || undefined,
      identityId,
    });
    if (taskResult.ok) {
      created.push({ type: 'task', id: taskResult.id, due: due || null });
      summaries.push(taskResult.summary + (due ? ` (due ${due})` : ''));
    } else {
      summaries.push(`Task skipped: ${taskResult.error}`);
    }
  }

  if (deal && wantsDealTouch(text) && opts.stage) {
    const stageResult = await agentWrites.updateDealStage({
      orgSlug,
      dealId: deal.id,
      stage: opts.stage,
      npcName,
      identityId,
    });
    if (stageResult.ok) {
      created.push({ type: 'deal', id: deal.id, stage: opts.stage });
      summaries.push(stageResult.summary);
    }
  } else if (deal && wantsDealTouch(text)) {
    summaries.push(`Linked to deal "${deal.title}" (stage unchanged).`);
  }

  return {
    ok: true,
    summary: summaries.join(' '),
    created,
    contact: contact ? { id: contact.id, name: contact.name } : null,
    deal: deal ? { id: deal.id, title: deal.title, stage: deal.stage } : null,
    due,
  };
}

/**
 * Build confirmable assist actions from a user message (propose, don't write yet).
 */
function proposeCaptureActions(message, summary = {}) {
  const text = String(message || '').trim();
  if (!text) return [];
  const who = extractWho(text);
  const dealHint = extractDealHint(text);
  const due = parseRelativeDue(text);
  const captureLike = /\b(talked|spoke|met|call|email|follow|log|note|remind|capture|update crm|add to crm)\b/i.test(text)
    || !!who
    || wantsFollowUp(text);

  if (!captureLike) return [];

  const actions = [];
  actions.push({
    type: 'confirm_capture',
    label: who ? `Log update about ${who}` : 'Log this to CRM',
    payload: {
      message: text,
      name: who || undefined,
      deal: dealHint || undefined,
      due: due || undefined,
    },
  });

  if (wantsFollowUp(text) || due) {
    actions.push({
      type: 'confirm_task',
      label: due ? `Add follow-up (due ${due})` : 'Add follow-up task',
      payload: {
        title: who ? `Follow up with ${who}` : `Follow up: ${text.slice(0, 60)}`,
        due: due || undefined,
        contact: who || undefined,
      },
    });
  }

  if (summary.openDealCount > 0 && dealHint) {
    actions.push({
      type: 'open_tab',
      tab: 'sales',
      label: `Open pipeline (look for ${dealHint})`,
    });
  }

  return actions.slice(0, 4);
}

/**
 * Build My Day feed from workspace state for a given user (email/name).
 */
function buildMyDay(state = {}, opts = {}) {
  const email = String(opts.email || '').trim().toLowerCase();
  const user = String(opts.user || opts.displayName || '').trim().toLowerCase();
  const hours = Math.min(168, Math.max(1, Number(opts.hours) || 168));
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);

  const notes = Array.isArray(state.notes) ? state.notes : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const audit = Array.isArray(state.auditLog) ? state.auditLog : [];
  const emailLog = Array.isArray(state.emailLog) ? state.emailLog : [];

  const mineAudit = (e) => {
    const blob = `${e.user || ''} ${e.email || ''} ${e.source || ''}`.toLowerCase();
    if (email && blob.includes(email)) return true;
    if (user && blob.includes(user)) return true;
    if (/agent-note|agent-task|ai-capture|gmail_inbound|crm-capture/i.test(blob + (e.action || '') + (e.source || ''))) {
      // include agent writes when filtering loosely for team admin views
      return !email && !user;
    }
    return false;
  };

  const recentNotes = notes
    .filter((n) => {
      const d = n.date || n.createdAt || n.at;
      const ts = d ? new Date(d).getTime() : Date.now();
      if (Number.isNaN(ts) || ts < cutoff) return false;
      if (/agent-note|gmail|ai-capture/i.test(String(n.type || ''))) return true;
      if (user && String(n.author || '').toLowerCase().includes(user)) return true;
      return !email && !user;
    })
    .slice(0, 40)
    .map((n) => ({
      kind: 'note',
      id: n.id,
      title: n.contact || 'Note',
      text: String(n.text || '').slice(0, 200),
      at: n.date || n.createdAt,
      type: n.type,
      author: n.author || null,
    }));

  const dueTasks = tasks
    .filter((t) => t && !t.done)
    .filter((t) => {
      if (!t.due) return true;
      return String(t.due) <= today || String(t.due) <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    })
    .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))
    .slice(0, 20)
    .map((t) => ({
      kind: 'task',
      id: t.id,
      title: t.title,
      due: t.due || null,
      overdue: !!(t.due && String(t.due) < today),
      contact: t.contact || null,
      priority: t.priority || null,
    }));

  const recentAudit = audit
    .filter((e) => {
      const ts = e.at ? new Date(e.at).getTime() : 0;
      if (!ts || ts < cutoff) return false;
      return mineAudit(e);
    })
    .slice(0, 40)
    .map((e) => ({
      kind: 'audit',
      id: e.id,
      title: `${e.user || 'Someone'} ${e.action || 'updated'} ${e.entityName || e.entity || ''}`.trim(),
      at: e.at,
      entity: e.entity,
      action: e.action,
    }));

  const recentEmail = emailLog
    .filter((e) => {
      const ts = e.at || e.date ? new Date(e.at || e.date).getTime() : 0;
      if (ts && ts < cutoff) return false;
      if (email && String(e.from || e.to || '').toLowerCase().includes(email)) return true;
      if (/gmail|inbound/i.test(String(e.source || e.type || ''))) return true;
      return !email;
    })
    .slice(0, 20)
    .map((e) => ({
      kind: 'email',
      id: e.id,
      title: e.subject || 'Email',
      text: String(e.snippet || e.body || '').slice(0, 160),
      at: e.at || e.date,
      from: e.from || null,
    }));

  const items = [...recentNotes, ...recentAudit, ...recentEmail]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 50);

  return {
    generatedAt: new Date().toISOString(),
    hours,
    dueTasks,
    items,
    counts: {
      notes: recentNotes.length,
      dueTasks: dueTasks.length,
      overdue: dueTasks.filter((t) => t.overdue).length,
      audit: recentAudit.length,
      email: recentEmail.length,
    },
  };
}

module.exports = {
  parseRelativeDue,
  extractWho,
  extractDealHint,
  wantsFollowUp,
  wantsDealTouch,
  runCapture,
  proposeCaptureActions,
  buildMyDay,
};
