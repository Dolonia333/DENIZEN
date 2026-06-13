'use strict';

const crypto = require('node:crypto');
const denizenDb = require('./denizen-db');

function crmStableUuid(orgId, kind, id) {
  const hex = crypto.createHash('sha256').update(`${orgId}:${kind}:${id}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isCustomerStatus(status) {
  return /customer|client|active/i.test(String(status || ''));
}

function contactMarker(contact) {
  return `crm:contact:${contact.id}`;
}

function dealMarker(deal) {
  return `crm:deal:${deal.id}`;
}

async function findByEmail(table, orgId, email) {
  const rows = await denizenDb._get(
    `${table}?select=id&org_id=eq.${encodeURIComponent(orgId)}&email=eq.${encodeURIComponent(email)}&limit=1`,
  );
  return rows?.[0]?.id || null;
}

async function upsertRegistry(orgId, entityType, entityId, externalKey, title, status, summary) {
  if (!orgId || !entityId) return;
  await denizenDb._post(
    'denizen_entity_registry?on_conflict=org_id,entity_type,entity_id',
    {
      org_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      external_key: externalKey,
      title: String(title || '').slice(0, 200) || null,
      status: status || null,
      summary: summary || {},
      last_seen_at: new Date().toISOString(),
    },
    { prefer: 'resolution=merge-duplicates,return=minimal' },
  ).catch((err) => {
    console.warn('[CrmSpine] registry upsert failed:', err?.message || err);
  });
}

async function syncContact(orgId, contact) {
  const email = String(contact?.email || '').trim().toLowerCase();
  const customer = isCustomerStatus(contact.status);
  const table = customer ? 'clients' : 'leads';
  const marker = contactMarker(contact);

  if (!email) {
    const entityId = crmStableUuid(orgId, 'crm_contact', contact.id);
    await upsertRegistry(
      orgId,
      'crm_contact',
      entityId,
      marker,
      contact.name || `Contact #${contact.id}`,
      contact.status || null,
      {
        company: contact.company,
        score: contact.score,
        tags: contact.tags,
        source: 'denizen_crm',
        no_email: true,
      },
    );
    return;
  }

  const row = {
    org_id: orgId,
    name: contact.name || email,
    company: contact.company || null,
    email,
    phone: contact.phone || null,
    status: contact.status || (customer ? 'active' : 'new'),
    ...(customer
      ? { notes: marker }
      : { message: marker, source: contact.leadSource || 'crm' }),
  };

  let entityId = await findByEmail(table, orgId, email);
  if (entityId) {
    await denizenDb._patch(
      `${table}?id=eq.${encodeURIComponent(entityId)}`,
      row,
      { prefer: 'return=minimal' },
    );
  } else {
    const inserted = await denizenDb._post(table, row, { prefer: 'return=representation' });
    entityId = inserted?.[0]?.id || null;
  }

  if (entityId) {
    await upsertRegistry(
      orgId,
      customer ? 'client' : 'lead',
      entityId,
      marker,
      contact.name || email,
      contact.status || null,
      {
        company: contact.company,
        score: contact.score,
        tags: contact.tags,
        source: 'denizen_crm',
      },
    );
  }
}

async function syncDeal(orgId, deal) {
  if (!deal?.id) return;
  const entityId = crmStableUuid(orgId, 'crm_deal', deal.id);
  await upsertRegistry(
    orgId,
    'crm_deal',
    entityId,
    dealMarker(deal),
    deal.title || `Deal #${deal.id}`,
    deal.stage || null,
    {
      contact: deal.contact,
      value: deal.value,
      probability: deal.probability,
      close_date: deal.closeDate,
      health: deal.health,
      source: 'denizen_crm',
    },
  );
}

function collectActiveMarkers(state) {
  const markers = new Set();
  for (const contact of state.contacts || []) {
    if (contact?.id != null) markers.add(contactMarker(contact));
  }
  for (const deal of state.deals || []) {
    if (deal?.id != null) markers.add(dealMarker(deal));
  }
  return markers;
}

async function pruneOrphans(orgId, activeMarkers) {
  const rows = await denizenDb._get(
    `denizen_entity_registry?select=entity_type,entity_id,external_key&org_id=eq.${encodeURIComponent(orgId)}&external_key=like.crm:%&limit=500`,
  ).catch(() => []);
  for (const row of rows || []) {
    const key = row.external_key;
    if (!key || activeMarkers.has(key)) continue;
    await denizenDb._delete(
      `denizen_entity_registry?org_id=eq.${encodeURIComponent(orgId)}&entity_type=eq.${encodeURIComponent(row.entity_type)}&entity_id=eq.${encodeURIComponent(row.entity_id)}`,
    ).catch(() => {});
  }
}

function spineRowToContact(row, isClient) {
  const email = String(row.email || '').trim().toLowerCase();
  return {
    id: Date.now() + Math.floor(Math.random() * 100000),
    name: row.name || email || 'Unknown',
    company: row.company || '',
    email: email || '',
    phone: row.phone || '',
    status: isClient ? 'Customer' : (row.status || 'Lead'),
    tags: ['spine-import'],
    score: 50,
    lastContact: new Date().toISOString().slice(0, 10),
    interactions: 0,
    leadSource: 'spine',
  };
}

/**
 * Pull platform leads/clients into workspace when missing by email.
 */
async function enrichWorkspaceFromSpine(orgId, state) {
  if (!orgId || !denizenDb.enabled) return state;
  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const emails = new Set(
    contacts.map((c) => String(c?.email || '').trim().toLowerCase()).filter(Boolean),
  );

  const [leads, clients] = await Promise.all([
    denizenDb._get(
      `leads?select=id,name,company,email,phone,status,message&org_id=eq.${encodeURIComponent(orgId)}&order=created_at.desc&limit=100`,
    ).catch(() => []),
    denizenDb._get(
      `clients?select=id,name,company,email,phone,status,notes&org_id=eq.${encodeURIComponent(orgId)}&order=created_at.desc&limit=100`,
    ).catch(() => []),
  ]);

  let added = 0;
  for (const lead of leads || []) {
    const email = String(lead.email || '').trim().toLowerCase();
    if (!email || emails.has(email)) continue;
    const msg = String(lead.message || '');
    if (msg.includes('crm:contact:')) continue;
    contacts.push(spineRowToContact(lead, false));
    emails.add(email);
    added += 1;
  }
  for (const client of clients || []) {
    const email = String(client.email || '').trim().toLowerCase();
    if (!email || emails.has(email)) continue;
    const notes = String(client.notes || '');
    if (notes.includes('crm:contact:')) continue;
    contacts.push(spineRowToContact(client, true));
    emails.add(email);
    added += 1;
  }

  if (!added) return state;
  return { ...state, contacts };
}

/**
 * Mirror CRM workspace into platform leads/clients + entity registry (fire-and-forget).
 */
function syncSpine(orgId, state) {
  if (!orgId || !denizenDb.enabled || !state) return;
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const activeMarkers = collectActiveMarkers(state);
  denizenDb.enqueue(async () => {
    for (const contact of contacts.slice(0, 500)) {
      await syncContact(orgId, contact).catch((err) => {
        console.warn('[CrmSpine] contact sync:', err?.message || err);
      });
    }
    for (const deal of deals.slice(0, 500)) {
      await syncDeal(orgId, deal).catch((err) => {
        console.warn('[CrmSpine] deal sync:', err?.message || err);
      });
    }
    await pruneOrphans(orgId, activeMarkers).catch((err) => {
      console.warn('[CrmSpine] prune:', err?.message || err);
    });
  });
}

module.exports = {
  syncSpine,
  enrichWorkspaceFromSpine,
  crmStableUuid,
  isCustomerStatus,
  contactMarker,
  dealMarker,
};
