'use strict';

/** Repair empty industryConfig {} that blanks Meridian CRM UI after full reset. */
const ORG = 'be6080e8-638a-495a-b05d-2d90cd1b838f';
const fs = require('fs');

const MINIMAL_SALES = {
  id: 'sales',
  name: 'Sales / SaaS',
  icon: '💼',
  terminology: {
    contact: 'Contact', contacts: 'Contacts', deal: 'Deal', deals: 'Deals',
    pipeline: 'Pipeline', company: 'Company', account: 'Account', accounts: 'Accounts',
    customers: 'Customers', salesHub: 'Sales Hub', pipelineValue: 'Pipeline Value',
    note: 'Note', notes: 'Notes', task: 'Task', tasks: 'Tasks', value: 'Value',
    closeDate: 'Close Date', stage: 'Stage',
  },
  pipelineStages: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'],
  contactStatuses: ['Lead', 'Prospect', 'Customer', 'Churned'],
  noteTypes: ['Call', 'Email', 'Meeting', 'Note'],
  customFields: [],
  leadSources: ['Organic Search', 'Paid Ads', 'Referral', 'Cold Outreach', 'Event', 'Partner', 'Social Media', 'Other'],
};

(async () => {
  const store = require('/app/src/denizen-crm-store.js');
  const row = await store.getWorkspace(ORG);
  if (!row?.state) throw new Error('no workspace');
  const state = { ...row.state };
  const ic = state.industryConfig;
  const broken = !ic || typeof ic !== 'object' || !ic.id || !ic.terminology || !Array.isArray(ic.pipelineStages) || !Array.isArray(ic.contactStatuses);
  const report = { broken, beforeKeys: ic && typeof ic === 'object' ? Object.keys(ic) : null };
  if (broken) {
    state.industryConfig = MINIMAL_SALES;
    const saved = await store.upsertWorkspace(ORG, state, null, {
      ifUpdatedAt: row.updated_at,
      skipAutomations: true,
      skipAudit: true,
      actor: { user: 'crm-repair-industry' },
    });
    if (saved?.conflict) throw new Error('conflict');
    report.repaired = true;
    report.updated_at = saved.updated_at;
  } else {
    report.repaired = false;
  }
  fs.mkdirSync('/app/data/crm-hygiene', { recursive: true });
  fs.writeFileSync('/app/data/crm-hygiene/INDUSTRY_REPAIR.json', JSON.stringify(report, null, 2));
  fs.writeFileSync('/app/data/crm-hygiene/INDUSTRY_REPAIR_DONE.txt', 'ok\n');
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
