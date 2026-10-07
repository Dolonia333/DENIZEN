'use strict';

/**
 * One CRM entry point for connectors that only refresh a short tool list.
 * Contact ids from list-records are the lookup key, including when email changes.
 */

const ACTIONS = Object.freeze([
  'list-records',
  'update-contact',
  'delete-contact',
  'update-deal',
  'delete-deal',
  'merge-contacts',
  'link-deal',
  'upsert-company',
  'link',
  'update-task',
  'close-task',
  'upsert-package',
  'sync-business-context',
]);

function normalizeAction(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

async function operateCrm(orgId, params = {}, identityId = null, actor = null) {
  const action = normalizeAction(params.action || params.op);
  if (!ACTIONS.includes(action)) {
    return {
      ok: false,
      error: `unknown action "${action || ''}"`,
      actions: ACTIONS,
    };
  }
  if (!orgId) return { ok: false, action, error: 'org_id unavailable' };

  const crmSkills = require('./denizen-crm-skills');
  const crmMutations = require('./denizen-crm-mutations');
  const agentRecords = require('./denizen-crm-agent-records');

  try {
    if (action === 'list-records') {
      const listed = await agentRecords.listRecords(orgId, params, actor);
      return { ok: true, action, ...listed };
    }
    if (action === 'update-contact') {
      const result = await crmSkills.updateContact(orgId, params, identityId);
      return { ok: true, action, contact_id: result.contact?.id, ...result };
    }
    if (action === 'delete-contact') {
      const result = await crmSkills.deleteContact(orgId, params, identityId);
      return { ok: true, action, ...result };
    }
    if (action === 'update-deal') {
      const result = await crmMutations.updateDeal(orgId, params, identityId);
      return { ok: true, action, ...result };
    }
    if (action === 'delete-deal') {
      const result = await crmMutations.deleteDeal(orgId, params, identityId);
      return { ok: true, action, ...result };
    }
    if (action === 'merge-contacts') {
      const result = await crmMutations.mergeContacts(orgId, params, identityId);
      return { ok: true, action, ...result };
    }
    if (action === 'link-deal') {
      const result = await crmMutations.linkDealContact(orgId, params, identityId);
      return { ok: true, action, ...result };
    }
    if (action === 'upsert-company') {
      const companyId = params.company_id ?? params.companyId;
      if (companyId != null && companyId !== '') {
        try {
          const updated = await crmMutations.updateCompany(orgId, { ...params, company_id: companyId }, identityId);
          return { ok: true, action, updated: true, company_id: updated.company?.id, ...updated };
        } catch (err) {
          if (!/company not found/i.test(err?.message || '') || !(params.name || params.company)) throw err;
        }
      }
      const created = await crmSkills.addCompany(orgId, params, identityId);
      return { ok: true, action, created: true, company_id: created.company?.id, ...created };
    }
    if (action === 'link') {
      const links = Array.isArray(params.links) && params.links.length ? params.links : [params];
      const result = await agentRecords.bulkLinkRecords(orgId, { links }, identityId);
      const failed = (result.results || []).filter((row) => !row.ok);
      return { ok: failed.length === 0, action, ...result };
    }
    if (action === 'update-task') {
      const result = await agentRecords.bulkUpdateTasks(orgId, {
        updates: [{ ...params, task_id: params.task_id ?? params.taskId ?? params.id }],
      }, identityId);
      return { ok: true, action, ...result };
    }
    if (action === 'close-task') {
      const result = await crmMutations.closeTask(orgId, params, identityId);
      return { ok: true, action, ...result };
    }
    if (action === 'upsert-package') {
      const result = await agentRecords.upsertPackage(orgId, params, identityId);
      return { ok: true, action, ...result };
    }
    const businessContext = require('./denizen-business-context');
    const saved = await businessContext.syncBusinessContext(orgId);
    const snapshot = await businessContext.buildSnapshot({ orgId });
    return {
      ok: true,
      action,
      saved: !!saved?.saved,
      focus: snapshot.current_focus,
      opportunities: snapshot.opportunities,
    };
  } catch (err) {
    return { ok: false, action, error: err?.message || String(err) };
  }
}

module.exports = {
  ACTIONS,
  normalizeAction,
  operateCrm,
};
