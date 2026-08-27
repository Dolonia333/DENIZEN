'use strict';

/**
 * Full CRM workspace reset for zion — backup then empty all records.
 * node /tmp/crm-full-reset.js [--apply]
 *
 * Keeps nothing in pipeline/contacts/tasks/etc. Fresh start.
 */

const fs = require('fs');
const path = require('path');

const ORG = process.env.DENIZEN_CRM_ORG_ID || 'be6080e8-638a-495a-b05d-2d90cd1b838f';
const APPLY = process.argv.includes('--apply');
const OUT = '/app/data/crm-hygiene';
const NOW = new Date().toISOString();

const ARRAY_KEYS = [
  'contacts', 'deals', 'notes', 'tasks', 'companies', 'goals', 'sequences',
  'sequenceEnrollments', 'submissions', 'quotes', 'packages', 'meetings',
  'automations', 'emailTemplates', 'emailLog', 'auditLog', 'noteBoards',
  'contactGroups', 'crmQuotas', 'metricSnapshots', 'automationRuns',
  'dealComments', 'aiThreads', 'supportTickets', 'marketingCampaigns', 'usageLog',
];

const OBJECT_KEYS = [
  'contactGroupMap', 'userPrefs', 'calendarConnections', 'integrations',
  'onboarding', 'availability', 'industryConfig', 'teamPolicy',
];

async function main() {
  const store = require('/app/src/denizen-crm-store.js');
  const row = await store.getWorkspace(ORG);
  if (!row?.state) throw new Error('no workspace');
  const prev = row.state;
  const ifUpdatedAt = row.updated_at;

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = NOW.replace(/[:.]/g, '-');
  const backupPath = path.join(OUT, `backup-before-full-reset-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(prev));

  const beforeCounts = {};
  for (const k of ARRAY_KEYS) {
    beforeCounts[k] = Array.isArray(prev[k]) ? prev[k].length : 0;
  }

  const empty = {};
  for (const k of ARRAY_KEYS) empty[k] = [];
  for (const k of OBJECT_KEYS) empty[k] = {};
  empty.auditLog = [{
    id: `full-reset-${Date.now()}`,
    at: NOW,
    actor: 'crm-full-reset',
    action: 'workspace_cleared',
    detail: { beforeCounts, backup: backupPath },
  }];

  const report = {
    generated_at: NOW,
    apply: APPLY,
    org_id: ORG,
    backup: backupPath,
    beforeCounts,
    afterEmpty: true,
  };

  if (APPLY) {
    const saved = await store.upsertWorkspace(ORG, empty, null, {
      ifUpdatedAt,
      skipAutomations: true,
      skipAudit: true,
      actor: { user: 'crm-full-reset' },
    });
    if (saved?.conflict) throw new Error('conflict — re-run');
    report.updated_at = saved.updated_at || null;
  }

  fs.writeFileSync(path.join(OUT, `full-reset-${APPLY ? 'apply' : 'dry'}-${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'FULL_RESET_LATEST.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'FULL_RESET_DONE.txt'), `${APPLY ? 'apply' : 'dry'} ok\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
