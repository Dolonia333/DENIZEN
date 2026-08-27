'use strict';

/**
 * Zion CRM pipeline wipe — kill seed + park RFPs; optional keeper normalize.
 *
 * Phases:
 *   --phase=kill       (default) seed kill, RFP park, quote void, Angela tag.
 *                      Does NOT rewrite RM Cyber / Brittany / Amazon keepers
 *                      and does NOT add next-action tasks.
 *   --phase=normalize  keeper stage/contact fixes + 3 real next tasks
 *   --phase=all        kill then normalize
 *
 * Run inside denizen-server:
 *   node /tmp/crm-pipeline-wipe.js [--apply] [--phase=kill|normalize|all]
 */

const fs = require('fs');
const path = require('path');

const ORG = 'be6080e8-638a-495a-b05d-2d90cd1b838f';
const APPLY = process.argv.includes('--apply');
const phaseArg = (process.argv.find((a) => a.startsWith('--phase=')) || '--phase=kill').split('=')[1];
const PHASE = ['kill', 'normalize', 'all'].includes(phaseArg) ? phaseArg : 'kill';
const DO_KILL = PHASE === 'kill' || PHASE === 'all';
const DO_NORM = PHASE === 'normalize' || PHASE === 'all';
const OUT = '/app/data/crm-hygiene';
const NOW = new Date().toISOString();

const KILL_CONTACT_EMAILS = new Set([
  'raj@cloudforge.io',
  'elena@oktechpartners.gov',
  'alex@okstateit.com',
  'alex@okstateit.gov',
  'sarah@okstate.gov',
  'procurement@ok.gov',
  'ops@rmcyber.com',
  'leads@ok.gov',
  'leads@okmod.gov',
].map((e) => e.toLowerCase()));

const KILL_CONTACT_NAMES = new Set([
  'raj patel',
  'elena vargas',
  'alex rivera',
  'sarah chen',
  'oklahoma it modernization team',
  'rm cyber ops lead',
  'oklahoma it prospects',
  'govcon lead',
]);

const KILL_DEAL_IDS = new Set([8, 11, 12, 13, 14, 15, 16, 18, 19]); // seed / invented $
const KEEP_DEAL_IDS = new Set([7, 17, 23, 24]); // OMES expired, RM Cyber partnership, Brittany, Amazon Hub

function isRfpDeal(d) {
  const stage = String(d.stage || '').toLowerCase();
  const id = Number(d.id);
  if (KEEP_DEAL_IDS.has(id) || KILL_DEAL_IDS.has(id)) return false;
  if ((d.tags || []).includes('watchlist') || (d.tags || []).includes('not-pipeline')) return false;
  return stage.includes('rfp')
    || stage.includes('watch')
    || (!d.contact && Number(d.value || 0) === 0 && id >= 20);
}

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function daysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function openPipelineFilter(d) {
  const st = norm(d.status);
  const stage = norm(d.stage);
  if (['lost', 'disqualified', 'expired', 'won', 'closed', 'watchlist'].includes(st)) return false;
  if (stage.includes('watch') || stage.includes('expired') || stage.includes('lost') || stage.includes('disqual')) return false;
  if ((d.tags || []).includes('watchlist') || (d.tags || []).includes('not-pipeline')) return false;
  return true;
}

async function main() {
  const store = require('/app/src/denizen-crm-store.js');
  const row = await store.getWorkspace(ORG);
  if (!row?.state) throw new Error('no workspace');
  const state = row.state;
  const ifUpdatedAt = row.updated_at;
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = NOW.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(OUT, `backup-before-wipe-${stamp}.json`), JSON.stringify(state));

  const report = {
    generated_at: NOW,
    apply: APPLY,
    phase: PHASE,
    killed_contacts: [],
    killed_deals: [],
    parked_rfps: [],
    rfp_dupes_removed: [],
    quotes_voided: [],
    companies_tagged: [],
    contacts_fixed: [],
    deals_fixed: [],
    tasks_added: [],
    keepers: {},
  };

  let contacts = [...(state.contacts || [])];
  let deals = [...(state.deals || [])];
  let quotes = [...(state.quotes || [])];
  let companies = [...(state.companies || [])];
  let tasks = [...(state.tasks || [])];

  if (DO_KILL) {
    // --- Contacts: drop NPC seed; tag Angela capture-team; merge email dupes ---
    const keptContacts = [];
    for (const c of contacts) {
      const email = norm(c.email);
      const name = norm(c.name);
      if (KILL_CONTACT_EMAILS.has(email) || KILL_CONTACT_NAMES.has(name)) {
        report.killed_contacts.push({ id: c.id, name: c.name, email: c.email, reason: 'seed-npc' });
        continue;
      }
      if (name.includes('angela') || email.includes('angela') || email === 'vzion253@gmail.com') {
        c.name = 'Angela Van Zandt';
        c.status = 'Capture Team';
        c.company = '1921 Holding Co., LLC';
        c.tags = [...new Set([...(c.tags || []), 'capture-team', 'internal', 'do-not-autolead'])];
        report.contacts_fixed.push({ id: c.id, name: c.name, email: c.email, status: c.status });
      }
      keptContacts.push(c);
    }
    const byEmail = new Map();
    const deduped = [];
    for (const c of keptContacts) {
      const email = norm(c.email);
      if (email && byEmail.has(email)) {
        report.killed_contacts.push({ id: c.id, name: c.name, email: c.email, reason: 'email-dupe' });
        continue;
      }
      if (email) byEmail.set(email, c);
      deduped.push(c);
    }
    // Merge duplicate Angela rows with different emails into one (keep lowest id)
    const angelas = deduped.filter((c) => norm(c.name).includes('angela') || norm(c.email).includes('angela') || norm(c.email) === 'vzion253@gmail.com');
    if (angelas.length > 1) {
      angelas.sort((a, b) => Number(a.id) - Number(b.id));
      const keep = angelas[0];
      const emails = [...new Set(angelas.map((a) => a.email).filter(Boolean))];
      keep.email = emails.includes('angelavanzandt1921@gmail.com') ? 'angelavanzandt1921@gmail.com' : keep.email;
      keep.altEmails = emails.filter((e) => e !== keep.email);
      keep.name = 'Angela Van Zandt';
      keep.status = 'Capture Team';
      keep.company = '1921 Holding Co., LLC';
      keep.tags = [...new Set([...(keep.tags || []), 'capture-team', 'internal', 'do-not-autolead', 'merged'])];
      const dropIds = new Set(angelas.slice(1).map((a) => a.id));
      for (const a of angelas.slice(1)) {
        report.killed_contacts.push({ id: a.id, name: a.name, email: a.email, reason: 'angela-merge', kept: keep.id });
      }
      contacts = deduped.filter((c) => !dropIds.has(c.id));
    } else {
      contacts = deduped;
    }

    // --- Deals: close seed; park RFPs (dedupe titles) ---
    const keptDeals = [];
    const rfpByTitle = new Map();
    for (const d of deals) {
      const id = Number(d.id);
      if (KILL_DEAL_IDS.has(id)) {
        const wasValue = d.value;
        d.stage = 'Lost / Disqualified';
        d.status = 'disqualified';
        d.outcome = 'lost';
        d.health = 'closed';
        d.value = 0;
        d.closedAt = NOW;
        d.closedReason = 'seed-data';
        d.notes = [d.notes, 'Closed by pipeline wipe: seed/demo/invented pipeline row.'].filter(Boolean).join('\n');
        report.killed_deals.push({ id, title: d.title, wasValue });
        keptDeals.push(d);
        continue;
      }
      if (isRfpDeal(d)) {
        const titleKey = norm(d.title);
        if (rfpByTitle.has(titleKey)) {
          report.rfp_dupes_removed.push({ id, title: d.title, keepId: rfpByTitle.get(titleKey) });
          continue;
        }
        d.stage = 'Watch / Research';
        d.status = 'watchlist';
        d.health = 'parked';
        d.value = 0;
        d.tags = [...new Set([...(d.tags || []), 'federal-rfp', 'watchlist', 'not-pipeline'])];
        d.notes = [d.notes, 'Parked from open pipeline — promote only after go/no-go.'].filter(Boolean).join('\n');
        rfpByTitle.set(titleKey, id);
        report.parked_rfps.push({ id, title: d.title });
        keptDeals.push(d);
        continue;
      }
      keptDeals.push(d);
    }
    deals = keptDeals;

    // --- Quotes ---
    for (const q of quotes) {
      const company = norm(q.company);
      if (company.includes('cloudforge') || Number(q.id) === 2) {
        q.status = 'void';
        q.outcome = 'disqualified';
        q.closedReason = 'seed-data';
        q.closedAt = NOW;
        report.quotes_voided.push({ id: q.id, company: q.company });
      }
    }

    // --- Companies ---
    for (const c of companies) {
      const name = norm(c.name);
      if (name === 'oklahoma tech partners') {
        c.status = 'archived';
        c.tags = [...new Set([...(c.tags || []), 'seed-data', 'archived'])];
        report.companies_tagged.push({ id: c.id, name: c.name, status: 'archived' });
      }
      if (name === '252') {
        c.status = 'archived';
        c.tags = [...new Set([...(c.tags || []), 'unknown', 'archived'])];
        report.companies_tagged.push({ id: c.id, name: c.name, status: 'archived' });
      }
      if (name === 'dolonia') {
        c.tags = [...new Set([...(c.tags || []), 'internal', 'dba', 'not-customer'])];
        report.companies_tagged.push({ id: c.id, name: c.name, role: 'dba' });
      }
    }

    // Close any remaining open hygiene/overdue chores (safety net)
    for (const t of tasks) {
      if (t.done || ['done', 'closed', 'completed'].includes(norm(t.status))) continue;
      const title = norm(t.title);
      const hygiene = [
        'follow up within 48 hours',
        'enrich all contacts',
        'update crm onboarding',
        'link all deals',
        'invite team members to crm',
        'enrich alex',
        'qualify raj',
        'enrich ',
      ].some((k) => title.includes(k));
      const due = String(t.due || '').slice(0, 10);
      const overdue = due && due < NOW.slice(0, 10);
      if (hygiene || overdue) {
        t.done = true;
        t.status = 'done';
        t.closedAt = NOW;
        t.closedReason = 'pipeline-wipe-hygiene';
      }
    }
  }

  if (DO_NORM) {
    for (const c of contacts) {
      const name = norm(c.name);
      if (name === 'benjamin ballard' || name === 'brent murray') {
        c.company = 'RM Cyber / Richey May';
        c.status = 'Partner';
        c.tags = [...new Set([...(c.tags || []), 'rm-cyber', 'partnership-development'])];
        report.contacts_fixed.push({ id: c.id, name: c.name, email: c.email });
      }
      if (name === 'brittany johnson') {
        c.status = 'Active Client';
        c.company = c.company || '1921 Holding Co., LLC';
        c.tags = [...new Set([...(c.tags || []), 'active-client', 'onboarding'])];
        report.contacts_fixed.push({ id: c.id, name: c.name, email: c.email });
      }
    }
    for (const d of deals) {
      const id = Number(d.id);
      if (id === 7) {
        d.contact = 'Benjamin Ballard';
        d.company = 'RM Cyber / Richey May';
        d.value = 0;
        d.status = 'expired';
        d.stage = 'Expired / Needs Correction';
        d.tags = [...new Set([...(d.tags || []), 'omes', 'teaming', 'historical'])];
        report.deals_fixed.push({ id, title: d.title, stage: d.stage });
      }
      if (id === 17) {
        d.title = 'OMES EV00000919 teaming (RM Cyber)';
        d.contact = 'Benjamin Ballard';
        d.company = 'RM Cyber / Richey May';
        d.stage = 'Partnership Development';
        d.status = 'open';
        d.health = 'warm';
        d.value = 0;
        d.tags = [...new Set([...(d.tags || []), 'omes', 'teaming', 'partnership-development'])];
        d.notes = [d.notes, 'Partnership-development only; no signed teaming; value $0 until vehicle is real.'].filter(Boolean).join('\n');
        report.deals_fixed.push({ id, title: d.title, contact: d.contact, value: 0 });
      }
      if (id === 23) {
        d.contact = 'Brittany Johnson';
        d.company = '1921 Holding Co., LLC';
        d.stage = 'Onboarding / Awaiting Payment';
        d.status = 'open';
        d.value = 0;
        d.tags = [...new Set([...(d.tags || []), 'active-client', 'onboarding'])];
        report.deals_fixed.push({ id, title: d.title, contact: d.contact });
      }
      if (id === 24) {
        d.company = '1921 Holding Co., LLC';
        d.stage = 'Application Ready';
        d.status = 'open';
        d.value = 0;
        d.contact = d.contact || '';
        d.tags = [...new Set([...(d.tags || []), 'amazon-hub', 'application'])];
        report.deals_fixed.push({ id, title: d.title, stage: d.stage });
      }
    }
    const need = [
      { title: 'Email Ballard teaming redlines for OMES vehicle', contact: 'Benjamin Ballard', dealId: 17, due: daysFromNow(3) },
      { title: 'Check Brittany onboarding / payment milestone', contact: 'Brittany Johnson', dealId: 23, due: daysFromNow(2) },
      { title: 'Decide: submit Amazon Hub Delivery or kill', contact: '', dealId: 24, due: daysFromNow(5) },
    ];
    let nextId = Math.max(0, ...tasks.map((t) => Number(t.id) || 0)) + 1;
    for (const n of need) {
      const exists = tasks.some((t) => !t.done && norm(t.title) === norm(n.title));
      if (exists) continue;
      const row = {
        id: nextId++,
        title: n.title,
        contact: n.contact,
        dealId: n.dealId,
        due: n.due,
        priority: 'High',
        status: 'open',
        done: false,
        createdAt: NOW,
        source: 'pipeline-wipe',
      };
      tasks.push(row);
      report.tasks_added.push({ id: row.id, title: row.title, due: row.due });
    }
  }

  const openPipeline = deals.filter(openPipelineFilter);
  const openTasks = tasks.filter((t) => !t.done && !['done', 'closed', 'completed'].includes(norm(t.status)));
  report.keepers = {
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, status: c.status, company: c.company })),
    open_pipeline_deals: openPipeline.map((d) => ({
      id: d.id, title: d.title, stage: d.stage, value: d.value, contact: d.contact, company: d.company, status: d.status,
    })),
    open_pipeline_value: openPipeline.reduce((s, d) => s + Number(d.value || 0), 0),
    open_tasks: openTasks.map((t) => ({ id: t.id, title: t.title, due: t.due, contact: t.contact, dealId: t.dealId })),
    watchlist_rfps: report.parked_rfps.length || deals.filter((d) => (d.tags || []).includes('watchlist')).length,
    closed_seed_deals: report.killed_deals.length,
    leftover_deals_all_openish: deals.filter((d) => !['lost', 'disqualified', 'won', 'closed'].includes(norm(d.status))).map((d) => ({
      id: d.id, title: d.title, stage: d.stage, status: d.status, value: d.value, contact: d.contact,
    })),
  };

  if (APPLY) {
    state.contacts = contacts;
    state.deals = deals;
    state.quotes = quotes;
    state.companies = companies;
    state.tasks = tasks;
    const auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
    auditLog.unshift({
      id: `wipe-${Date.now()}`,
      at: NOW,
      actor: 'crm-pipeline-wipe',
      action: `phase_${PHASE}`,
      detail: report.keepers,
    });
    state.auditLog = auditLog.slice(0, 500);

    const saved = await store.upsertWorkspace(ORG, state, null, {
      ifUpdatedAt,
      skipAutomations: true,
      actor: { user: 'crm-pipeline-wipe' },
    });
    if (saved?.conflict) throw new Error('conflict — re-run');
  }

  fs.writeFileSync(path.join(OUT, `wipe-${APPLY ? 'apply' : 'dry'}-${PHASE}-${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'WIPE_LATEST.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'WIPE_DONE.txt'), `${APPLY ? 'apply' : 'dry'} phase=${PHASE} ok\n`);
  console.log(JSON.stringify({
    ok: true,
    apply: APPLY,
    phase: PHASE,
    killed_contacts: report.killed_contacts.length,
    killed_deals: report.killed_deals.length,
    parked_rfps: report.parked_rfps.length,
    rfp_dupes_removed: report.rfp_dupes_removed.length,
    quotes_voided: report.quotes_voided.length,
    keepers: report.keepers,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
