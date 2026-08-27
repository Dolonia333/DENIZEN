'use strict';

/**
 * Dump zion CRM board summary to /app/data/crm-hygiene/BOARD_AFTER_KILL.json
 * node /tmp/crm-board-dump.js
 */

const fs = require('fs');
const path = require('path');

const ORG = 'be6080e8-638a-495a-b05d-2d90cd1b838f';
const OUT = '/app/data/crm-hygiene';

(async () => {
  const store = require('/app/src/denizen-crm-store.js');
  const row = await store.getWorkspace(ORG);
  const s = row.state || {};
  const deals = s.deals || [];
  const contacts = s.contacts || [];
  const tasks = (s.tasks || []).filter((t) => !t.done && !['done', 'closed', 'completed'].includes(String(t.status || '').toLowerCase()));
  const companies = s.companies || [];
  const quotes = s.quotes || [];
  const openish = deals.filter((d) => {
    const st = String(d.status || '').toLowerCase();
    return !['lost', 'disqualified', 'won', 'closed'].includes(st);
  });
  const pipeline = openish.filter((d) => {
    const st = String(d.status || '').toLowerCase();
    const stage = String(d.stage || '').toLowerCase();
    if (st === 'watchlist' || st === 'expired') return false;
    if (stage.includes('watch') || stage.includes('expired') || stage.includes('lost')) return false;
    if ((d.tags || []).includes('watchlist') || (d.tags || []).includes('not-pipeline')) return false;
    return true;
  });
  const board = {
    updated_at: row.updated_at,
    counts: {
      contacts: contacts.length,
      deals_total: deals.length,
      open_pipeline: pipeline.length,
      open_pipeline_value: pipeline.reduce((a, d) => a + Number(d.value || 0), 0),
      watchlist_or_openish: openish.length,
      open_tasks: tasks.length,
      companies: companies.length,
      quotes: quotes.length,
    },
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, company: c.company, status: c.status, tags: c.tags })),
    open_pipeline: pipeline.map((d) => ({
      id: d.id, title: d.title, stage: d.stage, status: d.status, value: d.value, contact: d.contact, company: d.company,
    })),
    leftover_nonclosed: openish.map((d) => ({
      id: d.id, title: d.title, stage: d.stage, status: d.status, value: d.value, contact: d.contact, company: d.company, tags: d.tags,
    })),
    open_tasks: tasks.map((t) => ({ id: t.id, title: t.title, due: t.due, contact: t.contact, dealId: t.dealId })),
    companies: companies.map((c) => ({ id: c.id, name: c.name, status: c.status, tags: c.tags })),
    quotes: quotes.map((q) => ({ id: q.id, company: q.company, status: q.status, total: q.total })),
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'BOARD_AFTER_KILL.json'), JSON.stringify(board, null, 2));
  fs.writeFileSync(path.join(OUT, 'BOARD_DONE.txt'), 'ok\n');
  console.log(JSON.stringify(board.counts, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
