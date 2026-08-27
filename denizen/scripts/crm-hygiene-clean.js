'use strict';

/**
 * Zion CRM hygiene: audit + safe cleanup.
 * Run inside denizen-server: node /tmp/crm-hygiene-clean.js [--apply]
 *
 * Safe by default (audit only). --apply:
 *  - backup workspace JSON to /app/data/crm-hygiene/
 *  - close overdue open tasks older than 14d OR instruction/bogus titles
 *  - detach instruction notes
 *  - merge email-duplicate contacts (keep oldest id)
 *  - tag probe/test contacts as archived (does not delete)
 */

const fs = require('fs');
const path = require('path');

const ORG = process.env.DENIZEN_CRM_ORG_ID || 'be6080e8-638a-495a-b05d-2d90cd1b838f';
const APPLY = process.argv.includes('--apply');
const OUT = process.env.CRM_HYGIENE_OUT || '/app/data/crm-hygiene';

function isProbeName(name) {
  const n = String(name || '').trim().toLowerCase();
  return /^(test\s*user|testuser|probe|health\s*check|healthcheck|e2e|cypress|playwright|demo\s*user|sample)(\b|[_\-\d]|$)/i.test(n);
}

function looksInstruction(text) {
  const t = String(text || '').toLowerCase();
  return [
    'execute crm corrections',
    'not just a summary',
    'create or update',
    'correct the canonical',
    'verified deadline',
    'return a detailed',
    'fix all crm',
    'detach instruction',
    'edit the crm',
    'do not invent',
  ].some((k) => t.includes(k));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const crmStore = require('/app/src/denizen-crm-store.js');
  const loaded = await crmStore.getWorkspace(ORG);
  if (!loaded?.state || typeof loaded.state !== 'object') {
    throw new Error('CRM workspace not found for org ' + ORG);
  }
  const state = loaded.state;
  const ifUpdatedAt = loaded.updated_at || null;

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT, `backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(state));

  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const deals = Array.isArray(state.deals) ? [...state.deals] : [];
  const tasks = Array.isArray(state.tasks) ? [...state.tasks] : [];
  const notes = Array.isArray(state.notes) ? [...state.notes] : [];
  const submissions = Array.isArray(state.submissions) ? state.submissions : [];
  const companies = Array.isArray(state.companies) ? state.companies : [];

  const openTasks = tasks.filter((t) => !t.done && !['done', 'closed', 'completed'].includes(String(t.status || '').toLowerCase()));
  const overdue = [];
  for (const t of openTasks) {
    const due = String(t.due || '').slice(0, 10);
    if (due && due < today()) {
      overdue.push({ id: t.id, title: t.title, due, contact: t.contact, priority: t.priority });
    }
  }

  const instrNotes = notes.filter((n) => looksInstruction(n.text)).map((n) => ({
    id: n.id, dealId: n.dealId, preview: String(n.text || '').slice(0, 100),
  }));

  const bogusTasks = openTasks.filter((t) => {
    const title = String(t.title || '');
    const low = title.toLowerCase();
    return looksInstruction(title)
      || (low.includes('teaming agreement') && low.includes('omes'))
      || (low.includes('follow up') && low.includes('omes') && (low.includes('execute') || low.includes('correct')));
  }).map((t) => ({ id: t.id, title: t.title }));

  const byEmail = new Map();
  const dupes = [];
  for (const c of contacts) {
    const email = String(c.email || '').trim().toLowerCase();
    if (!email) continue;
    if (byEmail.has(email)) dupes.push({ email, keepId: byEmail.get(email).id, keep: byEmail.get(email).name, dropId: c.id, drop: c.name });
    else byEmail.set(email, c);
  }

  const probes = contacts.filter((c) => isProbeName(c.name)).map((c) => ({ id: c.id, name: c.name, email: c.email, status: c.status }));
  const noEmail = contacts.filter((c) => !String(c.email || '').trim()).map((c) => ({ id: c.id, name: c.name, status: c.status }));
  const cnames = new Set(contacts.map((c) => c.name));
  const orphanDeals = deals.filter((d) => d.contact && !cnames.has(d.contact)).map((d) => ({
    id: d.id, title: d.title, contact: d.contact, stage: d.stage,
  }));
  const cutoff = daysAgo(60);
  const stale = contacts.filter((c) => {
    const status = String(c.status || '').toLowerCase();
    if (['customer', 'active client', 'partner'].includes(status)) return false;
    const lc = String(c.lastContact || c.updatedAt || c.createdAt || '').slice(0, 10);
    return lc && lc < cutoff;
  }).map((c) => ({ id: c.id, name: c.name, status: c.status, lastContact: c.lastContact || c.updatedAt || c.createdAt }));

  const newIntake = submissions.filter((s) => String(s.status || '').toLowerCase() === 'new').length;
  const atRisk = deals.filter((d) => {
    const h = String(d.health || '').toLowerCase();
    return ['at-risk', 'atrisk', 'critical', 'cold'].includes(h) || /nexus/i.test(String(d.title || ''));
  }).map((d) => ({ id: d.id, title: d.title, stage: d.stage, health: d.health, value: d.value }));

  const report = {
    generated_at: new Date().toISOString(),
    org_id: ORG,
    apply: APPLY,
    backup: backupPath,
    counts: {
      contacts: contacts.length,
      deals: deals.length,
      tasks_open: openTasks.length,
      tasks_total: tasks.length,
      notes: notes.length,
      companies: companies.length,
      submissions: submissions.length,
    },
    overdue_tasks: overdue,
    instruction_notes: instrNotes,
    bogus_tasks: bogusTasks,
    email_dupes: dupes,
    probe_contacts: probes,
    missing_email_count: noEmail.length,
    missing_email_sample: noEmail.slice(0, 30),
    orphan_deals: orphanDeals,
    stale_contacts_60d_count: stale.length,
    stale_contacts_sample: stale.slice(0, 30),
    new_intake: newIntake,
    at_risk_or_nexus_deals: atRisk,
    actions: { tasks_closed: [], notes_detached: [], contacts_merged: 0, probes_archived: 0, orphan_deals_cleared: [], orphan_contacts_cleared: 0 },
  };

  if (APPLY) {
    const closeIds = new Set([
      ...bogusTasks.map((t) => t.id),
      ...overdue.filter((t) => t.due < daysAgo(14)).map((t) => t.id),
    ]);
    const nowIso = new Date().toISOString();
    for (const t of tasks) {
      if (closeIds.has(t.id) && !t.done) {
        t.done = true;
        t.status = 'done';
        t.closedAt = nowIso;
        t.closedReason = 'crm-hygiene-clean';
        report.actions.tasks_closed.push({ id: t.id, title: t.title });
      }
    }
    state.tasks = tasks;

    const detachIds = new Set(instrNotes.map((n) => n.id));
    state.notes = notes.filter((n) => {
      if (detachIds.has(n.id)) {
        report.actions.notes_detached.push({ id: n.id, preview: String(n.text || '').slice(0, 80) });
        return false;
      }
      return true;
    });

    if (dupes.length) {
      const dropIds = new Set(dupes.map((d) => d.dropId));
      state.contacts = contacts.filter((c) => !dropIds.has(c.id)).map((c) => {
        const hits = dupes.filter((d) => d.keepId === c.id);
        if (!hits.length) return c;
        const tags = new Set([...(c.tags || []), 'merged', 'crm-hygiene']);
        for (const h of hits) {
          const drop = contacts.find((x) => x.id === h.dropId);
          for (const tag of (drop?.tags || [])) tags.add(tag);
        }
        return { ...c, tags: [...tags] };
      });
      report.actions.contacts_merged = dupes.length;
    }

    // archive probe contacts (keep for audit, hide from active lists via status)
    let archived = 0;
    state.contacts = (state.contacts || contacts).map((c) => {
      if (!isProbeName(c.name)) return c;
      if (String(c.status || '').toLowerCase() === 'archived') return c;
      archived += 1;
      return {
        ...c,
        status: 'Archived',
        tags: [...new Set([...(c.tags || []), 'probe', 'crm-hygiene'])],
        notes: [c.notes, 'Archived by crm-hygiene-clean (probe/test name).'].filter(Boolean).join('\n'),
      };
    });
    report.actions.probes_archived = archived;

    // Clear dangling deal.contact names that do not match any contact
    const nameSet = new Set((state.contacts || []).map((c) => c.name).filter(Boolean));
    let cleared = 0;
    state.deals = (state.deals || []).map((d) => {
      if (d.contact && !nameSet.has(d.contact)) {
        cleared += 1;
        report.actions.orphan_deals_cleared = report.actions.orphan_deals_cleared || [];
        report.actions.orphan_deals_cleared.push({ id: d.id, title: d.title, was: d.contact });
        return { ...d, contact: '', contactUnlinkedAt: nowIso, contactUnlinkedReason: 'crm-hygiene-orphan' };
      }
      return d;
    });
    report.actions.orphan_contacts_cleared = cleared;

    const auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
    auditLog.unshift({
      id: `hygiene-${Date.now()}`,
      at: nowIso,
      actor: 'crm-hygiene-clean',
      action: 'workspace_cleanup',
      detail: report.actions,
    });
    state.auditLog = auditLog.slice(0, 500);

    const saved = await crmStore.upsertWorkspace(ORG, state, null, {
      ifUpdatedAt,
      actor: { user: 'crm-hygiene-clean', identityId: null },
      skipAutomations: true,
    });
    if (saved?.conflict) {
      throw new Error('CRM workspace changed during cleanup — re-run --apply');
    }
  }

  const reportPath = path.join(OUT, APPLY ? `apply-${stamp}.json` : `audit-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'LATEST.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'DONE.txt'), `${APPLY ? 'apply' : 'audit'} ok ${stamp}\n`);
  console.log(JSON.stringify({
    ok: true,
    apply: APPLY,
    backup: backupPath,
    report: reportPath,
    counts: report.counts,
    overdue: overdue.length,
    dupes: dupes.length,
    probes: probes.length,
    instrNotes: instrNotes.length,
    bogusTasks: bogusTasks.length,
    actions: report.actions,
  }));
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(1);
});
