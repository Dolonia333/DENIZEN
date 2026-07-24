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

function hasDueLanguage(text) {
  return /\b(due|follow[- ]?up|remind|callback|call back|check[- ]?in|schedule|by\s+(?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|today))\b/i
    .test(String(text || ''));
}

function parseRelativeDue(text) {
  const msg = String(text || '').toLowerCase();
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  if (/\btoday\b/.test(msg) && hasDueLanguage(msg)) return today.toISOString().slice(0, 10);
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

  // Only treat ISO dates as due dates when due/follow-up language is present.
  // Correction text often cites historical deadlines (e.g. 2026-06-11) — those
  // must NOT spawn overdue follow-up tasks.
  const iso = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && hasDueLanguage(msg)) return iso[1];

  const weekday = msg.match(/\b(?:on\s+)?(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (weekday && hasDueLanguage(msg)) {
    const target = WEEKDAYS[weekday[2]];
    const d = new Date(today);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0 || weekday[1]) delta = delta === 0 ? 7 : delta;
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * True when the message is a correction/edit directive — must mutate records,
 * never become a CRM note or follow-up task.
 */
function isEditCorrectionIntent(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/^\s*EDIT\b/i.test(text)) return true;
  if (/\bEXECUTE CRM CORRECTIONS\b/i.test(text)) return true;
  if (/\bFIX ALL CRM\b/i.test(text)) return true;
  return /\b(correction|correct this|correct the|fix the note|undo|detach|remove note|wrong note|delete note|close task|remove task|update the (deal|company|contact|note|task|record)|not just a summary|do not (log|capture|create) (a )?note)\b/i
    .test(text);
}

function looksLikeInstructionNote(text) {
  const body = String(text || '');
  if (body.length < 80) return false;
  return isEditCorrectionIntent(body)
    || /\b(create or update|correct the canonical|execute crm|return a detailed|verified deadline|detach|read-after-write)\b/i.test(body);
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
 * Correction path: update/detach/close — never create notes or follow-up tasks.
 */
async function runCaptureEdit(opts = {}) {
  const {
    orgSlug,
    orgId,
    npcName = 'Lucy',
    message,
    identityId = null,
  } = opts;
  const text = String(message || '').trim();
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const dealHint = extractDealHint(text) || opts.deal || opts.title || null;
  const who = extractWho(text) || opts.name || opts.contact || null;
  const mutated = [];
  const summaries = [];

  let deal = dealHint
    ? crmSkills.findDeal(state, { title: dealHint, deal: dealHint, contact: who })
    : null;
  if (!deal && /omes|ev00000919/i.test(text)) {
    deal = crmSkills.findDeal(state, { title: 'OMES EV00000919', deal: 'OMES' });
  }

  // Detach instruction-dump notes on the target deal (or any matching instruction notes).
  const notes = Array.isArray(state.notes) ? state.notes : [];
  const instructionNotes = notes.filter((n) => {
    if (!looksLikeInstructionNote(n?.text)) return false;
    if (deal?.id != null && n.dealId != null) return String(n.dealId) === String(deal.id);
    if (deal?.title && n.contact) {
      return String(n.contact).toLowerCase().includes(String(deal.title).slice(0, 24).toLowerCase());
    }
    return !!deal;
  });
  for (const note of instructionNotes) {
    const detached = await agentWrites.detachNote({
      orgSlug,
      npcName,
      noteId: note.id,
      identityId,
    });
    if (detached.ok) {
      mutated.push({ type: 'note_detached', id: note.id });
      summaries.push(`Detached note #${note.id}`);
    }
  }

  // Close false follow-up / teaming tasks tied to this correction.
  const taskMatchers = [];
  if (dealHint) taskMatchers.push(String(dealHint).slice(0, 40).toLowerCase());
  if (/omes|ev00000919/i.test(text)) {
    taskMatchers.push('omes');
    taskMatchers.push('ev00000919');
  }
  if (/teaming/i.test(text)) taskMatchers.push('teaming');
  taskMatchers.push('follow up');
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const closedIds = new Set();
  for (const task of tasks) {
    if (!task || task.done) continue;
    const title = String(task.title || '').toLowerCase();
    const hit = taskMatchers.some((m) => m && title.includes(m))
      && (/follow\s*up|teaming|execute rm cyber/i.test(title) || /omes|ev00000919/i.test(title));
    if (!hit) continue;
    const closed = await agentWrites.closeTask({
      orgSlug,
      npcName,
      taskId: task.id,
      identityId,
    });
    if (closed.ok && !closedIds.has(task.id)) {
      closedIds.add(task.id);
      mutated.push({ type: 'task_closed', id: task.id, title: task.title });
      summaries.push(`Closed task #${task.id}`);
    }
  }

  if (deal) {
    const patch = {};
    if (/\bexpired\b|\bneeds correction\b/i.test(text)) {
      patch.stage = 'Expired / Needs Correction';
      patch.status = 'expired';
      patch.health = 'critical';
    } else if (/\bonboarding\b|\bawaiting payment\b/i.test(text)) {
      patch.stage = 'Onboarding / Awaiting Payment';
    } else if (/\bpartnership[- ]?development\b/i.test(text)) {
      patch.stage = 'Partnership Development';
    } else if (/\bapplication[- ]?ready\b/i.test(text)) {
      patch.stage = 'Application Ready';
    }
    const deadline = text.match(/\bdeadline(?:\s+was|\s+of|:)?\s*(\d{4}-\d{2}-\d{2})\b/i)
      || text.match(/\bverified deadline\s+(\d{4}-\d{2}-\d{2})\b/i);
    if (deadline) patch.deadline = deadline[1];
    if (/\bno invented\b|\bclear(?:ed)? (?:the )?value\b|\bremove .*\$|\bwithout .*value\b|\bno .*monetary value\b/i.test(text)) {
      patch.clearValue = true;
    }
    if (Object.keys(patch).length) {
      const updated = await agentWrites.updateDealFields({
        orgSlug,
        npcName,
        dealId: deal.id,
        identityId,
        ...patch,
      });
      if (updated.ok) {
        mutated.push({ type: 'deal_updated', id: deal.id, patch });
        summaries.push(updated.summary || `Updated deal #${deal.id}`);
      } else {
        summaries.push(`Deal update skipped: ${updated.error}`);
      }
    }
  }

  if (!summaries.length) {
    summaries.push(
      'Edit mode: no note/task created. Provide a deal name and concrete field changes '
      + '(stage/deadline/detach/close) to mutate records.',
    );
  }

  return {
    ok: true,
    mode: 'edit',
    summary: summaries.join(' '),
    mutated,
    created: [],
    contact: who ? { name: who } : null,
    deal: deal ? { id: deal.id, title: deal.title, stage: deal.stage } : null,
    due: null,
  };
}

/**
 * Run capture: match/create contact → note → optional task → optional deal stage touch.
 * EDIT/correction messages take the mutation path and never create notes/tasks.
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

  if (isEditCorrectionIntent(text)) {
    return runCaptureEdit(opts);
  }

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
  if (isEditCorrectionIntent(text)) return [];
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
  const suggestedTasks = Array.isArray(state.suggestedTasks) ? state.suggestedTasks : [];
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

  const pendingSuggested = suggestedTasks
    .filter((t) => t && !t.done && t.suggested !== false)
    .slice(0, 20)
    .map((t) => ({
      kind: 'suggested_task',
      id: t.id,
      title: t.title,
      due: t.due || null,
      overdue: !!(t.due && String(t.due) < today),
      contact: t.contact || null,
      priority: t.priority || null,
      source: t.source || 'gmail_inbound',
      gmailId: t.gmailId || null,
      suggested: true,
    }));

  const dueTasks = [
    ...pendingSuggested,
    ...tasks
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
      })),
  ].slice(0, 24);

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
    suggestedTasks: pendingSuggested,
    counts: {
      notes: recentNotes.length,
      dueTasks: dueTasks.length,
      suggested: pendingSuggested.length,
      overdue: dueTasks.filter((t) => t.overdue).length,
      audit: recentAudit.length,
      email: recentEmail.length,
    },
  };
}

/**
 * Accept a suggested task into the real tasks list.
 */
async function acceptSuggestedTask(orgId, suggestedId, identityId = null) {
  const crmStore = require('./denizen-crm-store');
  const row = await crmStore.getWorkspace(orgId);
  if (!row?.state) return { ok: false, error: 'workspace unavailable' };
  const state = { ...row.state };
  const suggested = Array.isArray(state.suggestedTasks) ? [...state.suggestedTasks] : [];
  const idx = suggested.findIndex((t) => String(t?.id) === String(suggestedId));
  if (idx < 0) return { ok: false, error: 'suggested task not found' };
  const [task] = suggested.splice(idx, 1);
  const accepted = {
    ...task,
    suggested: false,
    status: 'todo',
    done: false,
    acceptedAt: new Date().toISOString(),
  };
  const tasks = Array.isArray(state.tasks) ? [...state.tasks] : [];
  tasks.unshift(accepted);
  state.suggestedTasks = suggested;
  state.tasks = tasks;
  const saved = await crmStore.upsertWorkspace(orgId, state, identityId);
  if (!saved) return { ok: false, error: 'save failed' };
  return {
    ok: true,
    summary: `Accepted task: ${accepted.title}${accepted.due ? ` (due ${accepted.due})` : ''}`,
    task: accepted,
  };
}

/**
 * Dismiss a suggested task without adding it.
 */
async function dismissSuggestedTask(orgId, suggestedId, identityId = null) {
  const crmStore = require('./denizen-crm-store');
  const row = await crmStore.getWorkspace(orgId);
  if (!row?.state) return { ok: false, error: 'workspace unavailable' };
  const state = { ...row.state };
  const suggested = Array.isArray(state.suggestedTasks) ? state.suggestedTasks : [];
  const next = suggested.filter((t) => String(t?.id) !== String(suggestedId));
  if (next.length === suggested.length) return { ok: false, error: 'suggested task not found' };
  state.suggestedTasks = next;
  const saved = await crmStore.upsertWorkspace(orgId, state, identityId);
  if (!saved) return { ok: false, error: 'save failed' };
  return { ok: true, summary: 'Dismissed suggested follow-up.' };
}

module.exports = {
  parseRelativeDue,
  hasDueLanguage,
  isEditCorrectionIntent,
  looksLikeInstructionNote,
  extractWho,
  extractDealHint,
  wantsFollowUp,
  wantsDealTouch,
  runCapture,
  runCaptureEdit,
  proposeCaptureActions,
  buildMyDay,
  acceptSuggestedTask,
  dismissSuggestedTask,
};
