'use strict';

const crmMutations = require('./denizen-crm-mutations');
const { intakeQualifiedHandoff } = require('./denizen-crm-handoffs');
const { enrollContact } = require('./denizen-crm-sequences');
const crmEmail = require('./denizen-crm-email');
const chatActions = require('./denizen-crm-chat-actions');

function nextId(list) {
  const ids = (list || []).map((r) => Number(r?.id) || 0);
  return ids.length ? Math.max(...ids) + 1 : Date.now();
}

function findContact(state, params = {}) {
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  if (params.contactId != null) {
    return contacts.find((c) => String(c?.id) === String(params.contactId)) || null;
  }
  const email = String(params.email || '').trim().toLowerCase();
  if (email) {
    return contacts.find((c) => String(c?.email || '').toLowerCase() === email) || null;
  }
  const name = String(params.name || params.contact || '').trim().toLowerCase();
  if (name) {
    return contacts.find((c) => {
      const cn = String(c?.name || '').toLowerCase();
      return cn === name || cn.includes(name);
    }) || null;
  }
  return null;
}

function findDeal(state, params = {}) {
  const deals = Array.isArray(state.deals) ? state.deals : [];
  if (params.dealId != null) {
    return deals.find((d) => String(d?.id) === String(params.dealId)) || null;
  }
  const title = String(params.title || params.deal || '').trim().toLowerCase();
  if (title) {
    return deals.find((d) => String(d?.title || '').toLowerCase().includes(title)) || null;
  }
  if (params.contact || params.name) {
    const who = String(params.contact || params.name).toLowerCase();
    return deals.find((d) => String(d?.contact || '').toLowerCase().includes(who)) || null;
  }
  return null;
}

function findSubmission(state, params = {}) {
  const subs = Array.isArray(state.submissions) ? state.submissions : [];
  if (params.submissionId != null) {
    return subs.find((s) => String(s?.id) === String(params.submissionId)) || null;
  }
  const company = String(params.company || '').trim().toLowerCase();
  if (company) {
    return subs.find((s) => String(s?.company || '').toLowerCase().includes(company)) || null;
  }
  const email = String(params.email || '').trim().toLowerCase();
  if (email) {
    return subs.find((s) => String(s?.clientEmail || '').toLowerCase() === email) || null;
  }
  const name = String(params.clientName || params.name || '').trim().toLowerCase();
  if (name) {
    return subs.find((s) => String(s?.clientName || '').toLowerCase().includes(name)) || null;
  }
  if (/\bnew(est)?\b/i.test(String(params.task || ''))) {
    return subs.slice().sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))[0] || null;
  }
  return subs.find((s) => s.status === 'new') || subs[0] || null;
}

function parseBudgetTier(answers = {}, budgetText = '') {
  const raw = budgetText
    || answers["What's your expected monthly budget?"]
    || answers['What\'s your expected monthly budget?']
    || '';
  const s = String(raw).toLowerCase();
  if (/2500|2,500\+|\$2,500\+/.test(s)) return 'enterprise';
  if (/800|2,500|800–2,500/.test(s)) return 'pro';
  if (/300|800|under \$300/.test(s)) return 'starter';
  return 'pro';
}

function pickPackage(state, tier) {
  const packages = Array.isArray(state.packages) ? state.packages : crmMutations.STARTER_PACKAGES;
  return packages.find((p) => p.tier === tier) || packages.find((p) => /pro/i.test(p.name)) || packages[0] || null;
}

function withCrmActions(result, actions = []) {
  const merged = chatActions.normalizeCrmActions([
    ...(result.crm_actions || []),
    ...actions,
  ]);
  return { ...result, crm_actions: merged };
}

async function updateContact(orgId, params = {}, identityId = null) {
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const idx = contacts.findIndex((c) => {
    if (params.contactId != null) return String(c?.id) === String(params.contactId);
    const email = String(params.email || '').toLowerCase();
    if (email && String(c?.email || '').toLowerCase() === email) return true;
    const name = String(params.name || params.contact || '').toLowerCase();
    return name && String(c?.name || '').toLowerCase().includes(name);
  });
  if (idx < 0) throw new Error('contact not found');
  const prev = contacts[idx];
  const updated = {
    ...prev,
    ...(params.name != null ? { name: String(params.name) } : {}),
    ...(params.email != null ? { email: String(params.email) } : {}),
    ...(params.company != null ? { company: String(params.company) } : {}),
    ...(params.phone != null ? { phone: String(params.phone) } : {}),
    ...(params.status != null ? { status: String(params.status) } : {}),
    ...(params.score != null ? { score: Number(params.score) || prev.score } : {}),
    ...(params.tags ? { tags: Array.isArray(params.tags) ? params.tags : [...(prev.tags || []), params.tags] } : {}),
  };
  contacts[idx] = updated;
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, contacts }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Updated contact ${updated.name}${updated.email ? ` (${updated.email})` : ''}.`,
    contact: updated,
  }, [chatActions.openTabAction('contacts', 'Open contacts')]);
}

async function qualifySubmission(orgId, params = {}, identityId = null) {
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const submission = findSubmission(state, params);
  if (!submission) throw new Error('intake submission not found');
  const submissions = (state.submissions || []).map((s) => (
    s.id === submission.id ? { ...s, status: 'qualified' } : s
  ));
  let nextState = { ...state, submissions };
  const handoff = intakeQualifiedHandoff(nextState, { ...submission, status: 'qualified' });
  if (handoff.changed) nextState = handoff.state;
  const tier = parseBudgetTier(submission.answers || {}, params.budget);
  const pkg = pickPackage(nextState, tier);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, nextState, identityId, { ifUpdatedAt });
  const contact = findContact(nextState, { email: submission.clientEmail, name: submission.clientName });
  const deal = findDeal(nextState, { company: submission.company, contact: submission.clientName });
  return withCrmActions({
    summary: [
      `Qualified intake: ${submission.clientName || submission.company}.`,
      contact ? `Contact: ${contact.name}.` : '',
      deal ? `Deal: ${deal.title} (${deal.stage}).` : '',
      pkg ? `Recommended package: ${pkg.icon || ''} ${pkg.name} (${pkg.tier}).` : '',
    ].filter(Boolean).join(' '),
    submission: { ...submission, status: 'qualified' },
    contact,
    deal,
    recommendedPackage: pkg,
  }, [
    chatActions.openTabAction('sales', 'Open pipeline', { subTab: 'pipeline' }),
    chatActions.openTabAction('intake', 'Open intake'),
  ]);
}

async function recommendPackage(orgId, params = {}) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const submission = params.submissionId || params.company
    ? findSubmission(state, params)
    : null;
  const tier = parseBudgetTier(submission?.answers || {}, params.budget || params.task);
  const pkg = pickPackage(state, tier);
  if (!pkg) return { summary: 'No packages configured — ask Sarah to seed packages.' };
  return {
    summary: `For budget tier "${tier}", recommend ${pkg.icon || ''} ${pkg.name} — ${pkg.tagline}. ${(pkg.features || []).slice(0, 3).join(', ')}.`,
    package: pkg,
    tier,
    crm_actions: chatActions.normalizeCrmActions([
      chatActions.openTabAction('packages', 'Open packages'),
    ]),
  };
}

async function generateQuote(orgId, params = {}, identityId = null) {
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const submission = findSubmission(state, params);
  if (!submission) throw new Error('submission not found for quote');
  const tier = parseBudgetTier(submission.answers || {}, params.budget);
  const pkg = pickPackage(state, tier);
  if (!pkg) throw new Error('no packages available');
  const quotes = Array.isArray(state.quotes) ? [...state.quotes] : [];
  const monthly = (pkg.lineItems || []).reduce((s, li) => s + (Number(li.price) || 0), 0);
  const quote = {
    id: nextId(quotes),
    submissionId: submission.id,
    clientName: submission.clientName,
    company: submission.company,
    createdAt: new Date().toISOString().slice(0, 10),
    status: 'draft',
    recommendedPackage: pkg.name,
    aiReasoning: `Matched ${pkg.name} from intake budget tier (${tier}).`,
    lineItems: (pkg.lineItems || []).map((li, i) => ({
      id: i + 1,
      name: li.name,
      price: li.price,
      unit: li.unit,
    })),
    monthlyTotal: monthly,
    onetimeTotal: 0,
    notes: String(params.notes || '').slice(0, 500),
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  };
  quotes.unshift(quote);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, quotes }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Draft quote #${quote.id} for ${quote.company || quote.clientName} — ${pkg.name}, ~$${monthly}/mo.`,
    quote,
  }, [chatActions.openTabAction('portal', 'Open quotes')]);
}

async function moveDeal(orgId, params = {}, identityId = null) {
  const stage = String(params.stage || '').trim();
  if (!stage) throw new Error('stage required');
  return crmMutations.updateDeal(orgId, { ...params, stage }, identityId);
}

async function markDealOutcome(orgId, params = {}, identityId = null) {
  const task = String(params.task || '').toLowerCase();
  let stage = params.stage;
  if (!stage) {
    if (/\bwon\b/i.test(task)) stage = 'Closed Won';
    else if (/\blost\b/i.test(task)) stage = 'Closed Lost';
  }
  if (!stage) throw new Error('won or lost required');
  const result = await crmMutations.updateDeal(orgId, { ...params, stage }, identityId);
  return withCrmActions(result, [chatActions.openTabAction('sales', 'Open pipeline', { subTab: 'pipeline' })]);
}

async function pipelineBrief(orgId, params = {}) {
  const [pipeline, atRisk, tasks, status] = await Promise.all([
    crmMutations.listPipeline(orgId, { limit: 8 }),
    crmMutations.listAtRisk(orgId, {}),
    crmMutations.listTasks(orgId, { overdue: true }),
    crmMutations.getSetupStatus(orgId, params),
  ]);
  const lines = [
    pipeline.summary,
    atRisk.count ? `At-risk: ${atRisk.deals.map((d) => d.title).slice(0, 3).join(', ')}.` : '',
    tasks.overdueCount ? `Overdue tasks: ${tasks.tasks.map((t) => t.title).slice(0, 3).join(', ')}.` : '',
    status.setup?.onboarding?.next
      ? `Setup ${status.setup.onboarding.completed}/${status.setup.onboarding.total} — next: ${status.setup.onboarding.next.label}.`
      : '',
  ].filter(Boolean);
  return {
    summary: lines.join('\n'),
    pipeline,
    atRisk,
    tasks,
    setup: status.setup,
    crm_actions: chatActions.normalizeCrmActions([
      chatActions.openTabAction('dashboard', 'Open CRM dashboard'),
      chatActions.openTabAction('sales', 'Open pipeline', { subTab: 'pipeline' }),
    ]),
  };
}

async function dedupeContacts(orgId, params = {}, identityId = null) {
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const byEmail = new Map();
  const dupes = [];
  for (const c of contacts) {
    const email = String(c?.email || '').trim().toLowerCase();
    if (!email) continue;
    if (byEmail.has(email)) dupes.push({ keep: byEmail.get(email), drop: c });
    else byEmail.set(email, c);
  }
  if (!dupes.length) {
    return { summary: 'No duplicate contacts by email found.', duplicates: [] };
  }
  if (params.merge) {
    const dropIds = new Set(dupes.map((d) => d.drop.id));
    const merged = contacts.filter((c) => !dropIds.has(c.id)).map((c) => {
      const dupe = dupes.find((d) => d.keep.id === c.id);
      if (!dupe) return c;
      return {
        ...c,
        tags: [...new Set([...(c.tags || []), ...(dupe.drop.tags || []), 'merged'])],
      };
    });
    const crmStore = require('./denizen-crm-store');
    await crmStore.upsertWorkspace(orgId, { ...state, contacts: merged }, identityId, { ifUpdatedAt });
    return withCrmActions({
      summary: `Merged ${dupes.length} duplicate contact(s) by email.`,
      merged: dupes.length,
    }, [chatActions.openTabAction('contacts', 'Review contacts')]);
  }
  return {
    summary: `Found ${dupes.length} duplicate email(s): ${dupes.slice(0, 4).map((d) => d.drop.name).join(', ')}. Say "merge duplicate contacts" to clean up.`,
    duplicates: dupes.map((d) => ({ email: d.drop.email, names: [d.keep.name, d.drop.name] })),
    crm_actions: chatActions.normalizeCrmActions([
      chatActions.askNpcAction('Pier', 'Merge duplicate contacts in CRM', 'Ask Pier to merge'),
    ]),
  };
}

async function auditWorkspace(orgId) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const contacts = state.contacts || [];
  const deals = state.deals || [];
  const issues = [];
  const noEmail = contacts.filter((c) => !c.email).length;
  if (noEmail) issues.push(`${noEmail} contact(s) missing email`);
  const orphanDeals = deals.filter((d) => d.contact && !contacts.some((c) => c.name === d.contact)).length;
  if (orphanDeals) issues.push(`${orphanDeals} deal(s) without matching contact`);
  const emptyPackages = !(state.packages || []).length;
  if (emptyPackages) issues.push('No packages configured');
  const newIntake = (state.submissions || []).filter((s) => s.status === 'new').length;
  if (newIntake) issues.push(`${newIntake} unqualified intake submission(s)`);
  return {
    summary: issues.length
      ? `CRM audit: ${issues.join('; ')}.`
      : 'CRM audit: workspace looks healthy.',
    issues,
    counts: {
      contacts: contacts.length,
      deals: deals.length,
      packages: (state.packages || []).length,
      submissions: (state.submissions || []).length,
    },
    crm_actions: chatActions.normalizeCrmActions([
      chatActions.openTabAction('data-tools', 'Open data tools'),
    ]),
  };
}

async function exportSnapshot(orgId) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const contacts = (state.contacts || []).slice(0, 20);
  const deals = (state.deals || []).slice(0, 20);
  const lines = [
    `Contacts (${contacts.length} shown):`,
    ...contacts.map((c) => `- ${c.name} | ${c.email || 'no email'} | ${c.status || ''}`),
    `Deals (${deals.length} shown):`,
    ...deals.map((d) => `- ${d.title} | ${d.stage} | $${d.value || 0}`),
  ];
  const text = lines.join('\n');
  return {
    summary: `Exported snapshot — ${contacts.length} contacts, ${deals.length} deals (preview in response).`,
    snapshot: text,
    crm_actions: chatActions.normalizeCrmActions([
      chatActions.copyTextAction(text, 'Copy CRM snapshot'),
    ]),
  };
}

async function scheduleFollowup(orgId, params = {}, identityId = null) {
  const title = String(params.title || params.task || `Follow up with ${params.contact || params.name || 'contact'}`).trim();
  const due = params.due || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return crmMutations.addTask(orgId, {
    title: title.slice(0, 120),
    contact: params.contact || params.name || '',
    due,
    priority: params.priority || 'Medium',
    notes: params.notes || params.task,
  }, identityId);
}

async function draftEmail(orgId, params = {}, identityId = null) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const contact = findContact(state, params);
  if (!contact) throw new Error('contact not found for email draft');
  const result = await crmEmail.sendCrmEmail(state, {
    contactId: contact.id,
    dealId: params.dealId,
    templateName: params.templateName || params.template || (/welcome/i.test(params.task || '') ? 'Welcome Email' : 'Follow-Up'),
    subject: params.subject,
    body: params.body,
    senderName: params.senderName || params.npcName || 'Team',
    forceMailto: true,
  });
  if (!result.ok) throw new Error(result.error || 'draft failed');
  const body = result.body || result.logEntry?.body || '';
  const subject = result.subject || result.logEntry?.subject || '';
  return withCrmActions({
    summary: `Email draft for ${contact.name}:\nSubject: ${subject}\n\n${body.slice(0, 800)}`,
    subject,
    body,
    mailto: result.mailto,
  }, [
    chatActions.copyTextAction(`${subject}\n\n${body}`, 'Copy email draft'),
    ...(result.mailto ? [chatActions.mailtoAction({
      to: contact.email,
      subject,
      body,
      label: 'Open in mail app',
    })] : []),
  ]);
}

async function enrollSequenceSkill(orgId, params = {}, identityId = null) {
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const contact = findContact(state, params);
  if (!contact) throw new Error('contact not found');
  const sequences = Array.isArray(state.sequences) ? state.sequences : [];
  let seq = sequences.find((s) => String(s.id) === String(params.sequenceId));
  if (!seq && params.sequenceName) {
    const q = String(params.sequenceName).toLowerCase();
    seq = sequences.find((s) => String(s.name || '').toLowerCase().includes(q));
  }
  if (!seq) seq = sequences.find((s) => s.active) || sequences[0];
  if (!seq) throw new Error('no email sequence configured');
  const out = enrollContact(state, seq.id, contact.id);
  if (!out.ok) throw new Error(out.error || 'enroll failed');
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, out.state, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Enrolled ${contact.name} in sequence "${seq.name}".`,
    sequence: seq.name,
    contact: contact.name,
  }, [chatActions.openTabAction('contacts', 'Open contacts')]);
}

async function inviteTeammateSkill(orgId, params = {}, identityId = null) {
  const { inviteTeamMember } = require('./denizen-crm-team-invite');
  const email = String(params.inviteEmail || params.email || '').trim();
  if (!email) throw new Error('invite email required');
  const result = await inviteTeamMember(orgId, params.orgSlug, {
    email,
    displayName: params.inviteName || params.name,
    platform: params.platform || 'windows',
  }, params.inviterName || 'Team');
  if (!result.ok) throw new Error(result.error || 'invite failed');
  const actions = [];
  if (result.joinUrl) actions.push(chatActions.copyLinkAction(result.joinUrl, 'Copy join link'));
  if (result.email_draft) actions.push(chatActions.copyTextAction(result.email_draft, 'Copy invite email'));
  return withCrmActions({
    summary: result.emailed
      ? `Invitation emailed to ${email}.`
      : `Invite ready for ${email} — copy the join link or email draft below.`,
    invite: result,
  }, actions);
}

async function intakeToPipeline(orgId, params = {}, identityId = null) {
  return qualifySubmission(orgId, { ...params, merge: true }, identityId);
}

async function qualifyDeal(orgId, params = {}) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const deal = findDeal(state, params);
  if (!deal) throw new Error('deal not found');
  const contact = findContact(state, { name: deal.contact });
  const tier = contact?.score >= 70 ? 'pro' : 'starter';
  const pkg = pickPackage(state, tier);
  const lines = [
    `Deal "${deal.title}" — stage ${deal.stage}, $${deal.value || 0}, health ${deal.health || 'good'}.`,
    contact ? `Contact ${contact.name} (${contact.status}, score ${contact.score || '—'}).` : '',
    pkg ? `Sarah recommends ${pkg.name} if budget fits ${tier} tier.` : '',
    Number(deal.probability) < 40 ? 'Consider a follow-up task or moving stage after discovery.' : 'On track — keep momentum.',
  ].filter(Boolean);
  return withCrmActions({
    summary: lines.join(' '),
    deal,
    contact,
    recommendedPackage: pkg,
  }, [
    chatActions.openTabAction('sales', 'Open pipeline', { subTab: 'pipeline' }),
    chatActions.askNpcAction('Marcus', `Add follow-up task for deal ${deal.title}`, 'Schedule follow-up'),
  ]);
}

async function saveAtRiskDeal(orgId, params = {}, identityId = null) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const deal = findDeal(state, params);
  if (!deal) throw new Error('deal not found');
  await crmMutations.updateDeal(orgId, {
    dealId: deal.id,
    health: 'at-risk',
    stage: params.stage || deal.stage,
  }, identityId);
  const task = await crmMutations.addTask(orgId, {
    title: `Save at-risk deal: ${deal.title}`,
    contact: deal.contact,
    due: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    priority: 'High',
    notes: params.notes || params.task || 'Follow up to prevent stall',
  }, identityId);
  return withCrmActions({
    summary: `Marked "${deal.title}" at-risk and added task "${task.task.title}".`,
    deal,
    task: task.task,
  }, [chatActions.openTabAction('sales', 'Open pipeline', { subTab: 'pipeline' })]);
}

async function draftFollowup(orgId, params = {}) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const contact = findContact(state, params);
  const deal = findDeal(state, params);
  const name = contact?.name || params.name || 'there';
  const dealLine = deal ? ` re: ${deal.title}` : '';
  const body = `Hi ${name},\n\nQuick follow-up${dealLine} — wanted to check in and see if you had any questions.\n\nBest,\nTeam`;
  return {
    summary: `Draft follow-up for ${name}:\n\n${body}`,
    body,
    crm_actions: chatActions.normalizeCrmActions([
      chatActions.copyTextAction(body, 'Copy follow-up draft'),
    ]),
  };
}

async function enrichContact(orgId, params = {}, npcName = null) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  let contact = findContact(state, params);
  if (!contact) {
    // Smart add if not found: create minimal contact from params for lead gen
    const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
    contact = {
      id: nextId(contacts),
      name: params.name || 'Unknown',
      email: params.email || null,
      company: params.company || null,
      title: params.title || null,
      status: params.status || 'Lead',
      leadSource: params.source || params.leadSource || 'grok-research',
      notes: params.notes || params.why || 'Auto-enriched from lead gen / research',
      score: params.score || (params.researchMatch ? 65 : 50),
      createdAt: new Date().toISOString(),
      tags: params.researchMatch || /OMES|RM Cyber|GovCon|1921|federal/i.test((params.notes||'')+(params.company||'')) ? ['research-lead', '1921-fit'] : [],
    };
    contacts.push(contact);
    await crmMutations.upsertWorkspace(orgId, { ...state, contacts }, null, {});
  }
  const deals = (state.deals || []).filter((d) => d.contact === contact.name);
  const notes = (state.notes || []).filter((n) => n.contact === contact.name).slice(0, 3);
  const fitHint = /OMES|RM|Cyber|GovCon|federal|Oklahoma|1921/i.test(`${contact.company} ${contact.notes} ${params.why || ''}`) ? ' Strong 1921/OMES fit — consider crm-add-deal.' : '';
  const lines = [
    `Prospect brief: ${contact.name}${contact.company ? ` @ ${contact.company}` : ''}.`,
    `Status ${contact.status}, score ${contact.score || '—'}, source ${contact.leadSource || 'unknown'}.`,
    deals.length ? `Open deals: ${deals.map((d) => `${d.title} (${d.stage}, $${d.value || 0})`).join('; ')}.` : 'No deals linked yet.',
    notes.length ? `Notes: ${notes.map((n) => n.text || n.title || n.content).slice(0, 2).join('; ')}.` : '',
    'Ask Grok to run more research or update the deal further.' + fitHint,
  ].filter(Boolean);
  return withCrmActions({
    summary: lines.join('\n'),
    contact,
    deals,
    suggestedNext: deals.length ? 'move-deal or add-task' : 'crm-add-deal with value fit',
  }, [
    chatActions.askNpcAction('Grok', `Further research and CRM update for ${contact.name}`, 'Ask Grok to update CRM'),
    chatActions.askNpcAction('Sarah', `crm-add-deal for ${contact.name} at ${contact.company || 'prospect'}`, 'Add deal from research'),
    chatActions.openTabAction('contacts', 'Open contact'),
    ...(contact.email ? [{
      type: 'open_tab',
      tab: 'contacts',
      prefill: { name: contact.name, email: contact.email, company: contact.company || '' },
      label: 'Add note in CRM',
    }] : []),
  ]);
}

function findCompany(state, params = {}) {
  const companies = Array.isArray(state.companies) ? state.companies : [];
  if (params.companyId != null) {
    return companies.find((c) => String(c?.id) === String(params.companyId)) || null;
  }
  const name = String(params.company || params.name || '').trim().toLowerCase();
  if (!name) return null;
  return companies.find((c) => String(c?.name || '').toLowerCase().includes(name)) || null;
}

function findQuote(state, params = {}) {
  const quotes = Array.isArray(state.quotes) ? state.quotes : [];
  if (params.quoteId != null) {
    return quotes.find((q) => String(q?.id) === String(params.quoteId)) || null;
  }
  const company = String(params.company || '').trim().toLowerCase();
  if (company) {
    return quotes.find((q) => String(q?.company || '').toLowerCase().includes(company)) || null;
  }
  return quotes[0] || null;
}

function parseContactImportRows(params = {}) {
  if (Array.isArray(params.rows)) return params.rows;
  const csv = String(params.csv || params.text || '').trim();
  if (!csv) return [];
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });
    return {
      name: row.name || row['full name'] || row.contact || '',
      email: row.email || '',
      company: row.company || '',
      phone: row.phone || '',
      status: row.status || 'Lead',
    };
  }).filter((r) => r.name || r.email);
}

async function listCompanies(orgId, params = {}) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const companies = Array.isArray(state.companies) ? state.companies : [];
  const limit = Math.min(30, Math.max(1, Number(params.limit) || 15));
  const rows = companies.slice(0, limit).map((c) => ({
    id: c.id,
    name: c.name,
    industry: c.industry,
    arr: c.arr,
    health: c.health,
    linkedContacts: (c.linkedContacts || []).length,
  }));
  return {
    summary: `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}. ${rows.slice(0, 4).map((c) => c.name).join('; ') || 'None yet.'}`,
    companies: rows,
    count: companies.length,
    crm_actions: chatActions.normalizeCrmActions([chatActions.openTabAction('companies', 'Open companies')]),
  };
}

async function addCompany(orgId, params = {}, identityId = null) {
  const name = String(params.name || params.company || '').trim();
  if (!name) throw new Error('company name required');
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const companies = Array.isArray(state.companies) ? [...state.companies] : [];
  if (companies.some((c) => String(c?.name || '').toLowerCase() === name.toLowerCase())) {
    const existing = companies.find((c) => String(c?.name || '').toLowerCase() === name.toLowerCase());
    return { summary: `Company already exists: ${existing.name}`, company: existing };
  }
  const company = {
    id: nextId(companies),
    name,
    domain: String(params.domain || '').trim(),
    industry: String(params.industry || '').trim(),
    size: String(params.size || '').trim(),
    mrr: Number(params.mrr) || 0,
    arr: Number(params.arr) || 0,
    health: String(params.health || 'good'),
    tags: Array.isArray(params.tags) ? params.tags : [],
    website: String(params.website || '').trim(),
    notes: String(params.notes || '').slice(0, 500),
    linkedContacts: [],
    linkedDeals: [],
  };
  companies.push(company);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, companies }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Added company ${company.name}.`,
    company,
  }, [chatActions.openTabAction('companies', 'Open companies', { prefill: { name: company.name } })]);
}

async function linkContactCompany(orgId, params = {}, identityId = null) {
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const contact = findContact(state, params);
  const company = findCompany(state, params);
  if (!contact) throw new Error('contact not found');
  if (!company) throw new Error('company not found');

  const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
  const cIdx = contacts.findIndex((c) => String(c?.id) === String(contact.id));
  if (cIdx >= 0) {
    contacts[cIdx] = { ...contacts[cIdx], company: company.name };
  }
  const companies = Array.isArray(state.companies) ? [...state.companies] : [];
  const coIdx = companies.findIndex((c) => String(c?.id) === String(company.id));
  if (coIdx >= 0) {
    const linked = new Set(companies[coIdx].linkedContacts || []);
    linked.add(contact.id);
    companies[coIdx] = { ...companies[coIdx], linkedContacts: [...linked] };
  }
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, contacts, companies }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Linked ${contact.name} → ${company.name}.`,
    contact: contacts[cIdx],
    company: companies[coIdx],
  }, [chatActions.openTabAction('companies', 'Open company')]);
}

async function listQuotes(orgId, params = {}) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const quotes = Array.isArray(state.quotes) ? state.quotes : [];
  const limit = Math.min(20, Math.max(1, Number(params.limit) || 10));
  const rows = quotes.slice(0, limit).map((q) => ({
    id: q.id,
    company: q.company,
    clientName: q.clientName,
    status: q.status,
    package: q.recommendedPackage,
    monthlyTotal: q.monthlyTotal,
    hasPortal: !!q.portalToken,
  }));
  return withCrmActions({
    summary: `${quotes.length} quote(s). ${rows.slice(0, 3).map((q) => `#${q.id} ${q.company || q.clientName} (${q.status})`).join('; ') || 'None yet.'}`,
    quotes: rows,
  }, [chatActions.openTabAction('intake', 'Open quotes')]);
}

async function portalLink(orgId, params = {}, identityId = null) {
  const crypto = require('node:crypto');
  const portal = require('./denizen-crm-portal');
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const quotes = Array.isArray(state.quotes) ? [...state.quotes] : [];
  let quote = findQuote(state, params);
  if (!quote && quotes.length) quote = quotes[0];
  if (!quote) throw new Error('no quote found — generate a quote first');

  const idx = quotes.findIndex((q) => String(q?.id) === String(quote.id));
  if (idx < 0) throw new Error('quote not found');

  let token = String(quotes[idx].portalToken || '').trim();
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    quotes[idx] = { ...quotes[idx], portalToken: token, portalActivity: quotes[idx].portalActivity || [] };
  }
  const nextState = { ...state, quotes };
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, nextState, identityId, { ifUpdatedAt });
  await portal.syncPortalTokenIndex(orgId, nextState).catch(() => {});

  const url = `${chatActions.publicBaseUrl()}/crm/#/portal/${token}`;
  return withCrmActions({
    summary: `Portal link for quote #${quotes[idx].id} (${quotes[idx].company || quotes[idx].clientName}): ${url}`,
    quote: quotes[idx],
    portalUrl: url,
    portalToken: token,
  }, [
    chatActions.copyLinkAction(url, 'Copy portal link'),
    chatActions.openTabAction('portal', 'Open portal preview'),
  ]);
}

async function listAutomations(orgId) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const automations = Array.isArray(state.automations) ? state.automations : [];
  const rows = automations.slice(0, 15).map((a) => ({
    id: a.id,
    name: a.name,
    active: a.active,
    trigger: a.triggerLabel || a.trigger,
    action: a.actionLabel || a.action,
    runCount: a.runCount || 0,
  }));
  return withCrmActions({
    summary: `${automations.length} automation rule(s). ${rows.filter((a) => a.active).length} active.`,
    automations: rows,
  }, [chatActions.openTabAction('automations', 'Open automations')]);
}

async function addAutomation(orgId, params = {}, identityId = null) {
  const name = String(params.name || '').trim() || 'NPC automation';
  const trigger = String(params.trigger || 'deal_stale').trim();
  const action = String(params.action || 'create_task').trim();
  const triggerLabels = {
    deal_created: 'Deal created',
    deal_won: 'Deal won',
    deal_lost: 'Deal lost',
    deal_moved: 'Deal moved',
    deal_stale: 'Deal stale (7+ days)',
    task_overdue: 'Task overdue',
    contact_added: 'Contact added',
    form_submitted: 'Intake submitted',
  };
  const actionLabels = {
    create_task: 'Create task',
    notify: 'Notify team',
    update_field: 'Update field',
    draft_email: 'Draft email',
    webhook: 'Call webhook',
  };
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const automations = Array.isArray(state.automations) ? [...state.automations] : [];
  const auto = {
    id: nextId(automations),
    name,
    active: params.active !== false,
    trigger,
    triggerLabel: triggerLabels[trigger] || trigger,
    conditions: String(params.conditions || '').trim(),
    action,
    actionLabel: actionLabels[action] || action,
    actionDetail: String(params.actionDetail || params.detail || 'Follow up from automation').slice(0, 500),
    runCount: 0,
    lastRun: null,
  };
  automations.push(auto);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, automations }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Created automation "${auto.name}" — when ${auto.triggerLabel}, then ${auto.actionLabel}.`,
    automation: auto,
  }, [chatActions.openTabAction('automations', 'Open automations')]);
}

async function analyticsSummary(orgId) {
  const crmMetrics = require('./denizen-crm-metrics');
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const ds = crmMetrics.summarizeDeals(state.deals);
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter((t) => !t.done && t.due && String(t.due) < today).length;
  const leads = contacts.filter((c) => /lead|prospect/i.test(String(c.status || ''))).length;
  const customers = contacts.filter((c) => /customer|client/i.test(String(c.status || ''))).length;
  const winRate = ds.wonCount + ds.lostCount > 0
    ? Math.round((ds.wonCount / (ds.wonCount + ds.lostCount)) * 100)
    : 0;
  const lines = [
    `Analytics: ${contacts.length} contacts (${leads} leads, ${customers} customers).`,
    `Pipeline: ${ds.openCount} open ($${ds.pipelineValue.toLocaleString()}), ${ds.wonCount} won ($${ds.wonValue.toLocaleString()}), win rate ${winRate}%.`,
    overdue ? `${overdue} overdue task(s).` : '',
  ].filter(Boolean);
  return withCrmActions({
    summary: lines.join('\n'),
    metrics: { ...ds, contacts: contacts.length, leads, customers, winRate, overdueTasks: overdue },
  }, [chatActions.openTabAction('analytics', 'Open analytics')]);
}

async function marketingFunnel(orgId) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const bySource = {};
  for (const c of contacts) {
    const src = String(c.leadSource || 'unknown').trim() || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;
  }
  const byStatus = {};
  for (const c of contacts) {
    const st = String(c.status || 'Lead').trim();
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  const sources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const statuses = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const campaigns = Array.isArray(state.marketingCampaigns) ? state.marketingCampaigns : [];
  const lines = [
    `Marketing funnel: ${contacts.length} contacts.`,
    sources.length ? `Top sources: ${sources.map(([s, n]) => `${s} (${n})`).join(', ')}.` : '',
    `By status: ${statuses.map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}.`,
    campaigns.length ? `${campaigns.length} campaign(s) in workspace.` : '',
  ].filter(Boolean);
  return withCrmActions({
    summary: lines.join('\n'),
    leadSources: sources,
    byStatus: statuses,
  }, [chatActions.openTabAction('marketing', 'Open marketing')]);
}

async function calendarStatusSkill(orgId, params = {}) {
  const crmCalendar = require('./denizen-crm-calendar');
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const identityId = params.identityId || params.userId || 'default';
  const status = crmCalendar.calendarStatus(state, identityId);
  const google = status.google.connected
    ? `Google connected (${status.google.email || 'account'})`
    : status.googleConfigured ? 'Google available — not connected' : 'Google OAuth not configured on server';
  const ms = status.microsoft.connected
    ? `Outlook connected (${status.microsoft.email || 'account'})`
    : status.microsoftConfigured ? 'Outlook available — not connected' : 'Microsoft OAuth not configured on server';
  const actions = [];
  if (!status.google.connected && status.googleConfigured) {
    const auth = crmCalendar.buildGoogleAuthUrl(orgId, identityId);
    if (auth.ok) actions.push(chatActions.openUrlAction(auth.url, 'Connect Google Calendar'));
  }
  if (!status.microsoft.connected && status.microsoftConfigured) {
    const auth = crmCalendar.buildMicrosoftAuthUrl(orgId, identityId);
    if (auth.ok) actions.push(chatActions.openUrlAction(auth.url, 'Connect Outlook'));
  }
  actions.push(chatActions.openTabAction('schedule', 'Open schedule', { subTab: 'calendar' }));
  return withCrmActions({
    summary: `Calendar: ${google}. ${ms}.`,
    calendar: status,
  }, actions);
}

async function syncCalendarSkill(orgId, params = {}, identityId = null) {
  const crmCalendar = require('./denizen-crm-calendar');
  const provider = /\bmicrosoft|outlook\b/i.test(String(params.task || params.provider || ''))
    ? 'microsoft'
    : 'google';
  const uid = identityId || params.identityId || params.userId || 'default';
  const result = await crmCalendar.syncCalendar(orgId, uid, provider);
  if (!result.ok) {
    return withCrmActions({
      summary: `Calendar sync failed (${provider}): ${result.error}. Connect calendar first — ask Dan.`,
    }, [
      chatActions.askNpcAction('Dan', 'Connect my CRM calendar', 'Ask Dan'),
      chatActions.openTabAction('schedule', 'Open calendar'),
    ]);
  }
  return withCrmActions({
    summary: `Synced ${provider} calendar — ${result.imported} new meeting(s) (${result.total} fetched).`,
    ...result,
  }, [chatActions.openTabAction('schedule', 'Open meetings', { subTab: 'calendar' })]);
}

async function listMeetings(orgId, params = {}) {
  const { state } = await crmMutations.loadOrgWorkspace(orgId);
  const meetings = Array.isArray(state.meetings) ? state.meetings : [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = meetings.filter((m) => !m.date || String(m.date) >= today);
  const limit = Math.min(20, Math.max(1, Number(params.limit) || 10));
  const rows = upcoming.slice(0, limit).map((m) => ({
    id: m.id,
    title: m.title,
    date: m.date,
    time: m.time,
    contact: m.contact,
    type: m.type,
  }));
  return withCrmActions({
    summary: `${upcoming.length} upcoming meeting(s). ${rows.slice(0, 3).map((m) => `${m.title} ${m.date || ''}`).join('; ') || 'None scheduled.'}`,
    meetings: rows,
  }, [chatActions.openTabAction('schedule', 'Open schedule', { subTab: 'calendar' })]);
}

async function scheduleMeeting(orgId, params = {}, identityId = null) {
  const title = String(params.title || params.meeting || 'Discovery call').trim();
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const contact = findContact(state, params);
  const contactName = contact?.name || String(params.contact || params.name || '').trim();
  const meetings = Array.isArray(state.meetings) ? [...state.meetings] : [];
  const due = String(params.date || params.due || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const meeting = {
    id: nextId(meetings),
    title,
    type: String(params.type || 'discovery'),
    date: due,
    time: String(params.time || '10:00'),
    duration: Number(params.duration) || 30,
    contact: contactName,
    attendees: contactName ? [contactName] : [],
    status: 'scheduled',
    notes: String(params.notes || '').slice(0, 500),
    meetingUrl: String(params.meetingUrl || '').trim(),
  };
  meetings.push(meeting);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, meetings }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Scheduled "${meeting.title}" with ${meeting.contact || 'team'} on ${meeting.date} at ${meeting.time}.`,
    meeting,
  }, [chatActions.openTabAction('schedule', 'Open schedule', { subTab: 'calendar' })]);
}

async function addSequence(orgId, params = {}, identityId = null) {
  const name = String(params.name || 'Welcome sequence').trim();
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const sequences = Array.isArray(state.sequences) ? [...state.sequences] : [];
  const seq = {
    id: nextId(sequences),
    name,
    active: params.active !== false,
    enrolledCount: 0,
    completedCount: 0,
    steps: Array.isArray(params.steps) && params.steps.length
      ? params.steps
      : [
        { id: 1, type: 'email', day: 0, subject: 'Welcome', body: 'Hi {{name}}, thanks for connecting.' },
        { id: 2, type: 'wait', day: 2 },
        { id: 3, type: 'task', day: 3, title: 'Follow up call' },
      ],
  };
  sequences.push(seq);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, sequences }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Created sequence "${seq.name}" with ${seq.steps.length} step(s).`,
    sequence: seq,
  }, [chatActions.openTabAction('sequences', 'Open sequences')]);
}

async function addEmailTemplate(orgId, params = {}, identityId = null) {
  const name = String(params.name || 'Follow-up template').trim();
  const subject = String(params.subject || 'Following up').trim();
  const body = String(params.body || params.text || 'Hi {{name}},\n\nJust checking in on {{deal.title}}.\n\nBest,').trim();
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const emailTemplates = Array.isArray(state.emailTemplates) ? [...state.emailTemplates] : [];
  const tpl = {
    id: nextId(emailTemplates),
    name,
    subject,
    body,
    category: String(params.category || 'general'),
    lastUsed: null,
  };
  emailTemplates.push(tpl);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, emailTemplates }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Added email template "${tpl.name}".`,
    template: tpl,
  }, [chatActions.openTabAction('email-templates', 'Open templates')]);
}

async function importContacts(orgId, params = {}, identityId = null) {
  const rows = parseContactImportRows(params);
  if (!rows.length && !params.name && !params.email) {
    throw new Error('provide csv text, rows array, or name/email');
  }
  const toImport = rows.length ? rows : [{
    name: params.name,
    email: params.email,
    company: params.company,
    phone: params.phone,
    status: params.status || 'Lead',
  }];
  let added = 0;
  let skipped = 0;
  for (const row of toImport) {
    try {
      const r = await crmMutations.addContact(orgId, row, identityId);
      if (/already exists/i.test(r.summary || '')) skipped += 1;
      else added += 1;
    } catch (_) {
      skipped += 1;
    }
  }
  return withCrmActions({
    summary: `Imported ${added} contact(s)${skipped ? `, skipped ${skipped}` : ''}.`,
    added,
    skipped,
  }, [chatActions.openTabAction('contacts', 'Open contacts'), chatActions.openTabAction('data-tools', 'Open data tools')]);
}

async function addNote(orgId, params = {}, identityId = null) {
  const text = String(params.text || params.note || params.task || '').trim();
  if (!text) throw new Error('note text required');
  const { state, updated_at: ifUpdatedAt } = await crmMutations.loadOrgWorkspace(orgId);
  const contact = findContact(state, params);
  const contactName = contact?.name || String(params.contact || params.name || 'General').trim();
  const notes = Array.isArray(state.notes) ? [...state.notes] : [];
  const note = {
    id: nextId(notes),
    contact: contactName,
    text: text.slice(0, 2000),
    date: new Date().toISOString().slice(0, 10),
    type: String(params.type || 'note'),
  };
  notes.unshift(note);
  const crmStore = require('./denizen-crm-store');
  await crmStore.upsertWorkspace(orgId, { ...state, notes }, identityId, { ifUpdatedAt });
  return withCrmActions({
    summary: `Logged note for ${contactName}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
    note,
  }, [chatActions.openTabAction('notes', 'Open notes')]);
}

module.exports = {
  findContact,
  findDeal,
  findSubmission,
  updateContact,
  qualifySubmission,
  recommendPackage,
  generateQuote,
  moveDeal,
  markDealOutcome,
  pipelineBrief,
  dedupeContacts,
  auditWorkspace,
  exportSnapshot,
  scheduleFollowup,
  draftEmail,
  enrollSequenceSkill,
  inviteTeammateSkill,
  intakeToPipeline,
  qualifyDeal,
  saveAtRiskDeal,
  draftFollowup,
  enrichContact,
  findCompany,
  findQuote,
  listCompanies,
  addCompany,
  linkContactCompany,
  listQuotes,
  portalLink,
  listAutomations,
  addAutomation,
  analyticsSummary,
  marketingFunnel,
  calendarStatusSkill,
  syncCalendarSkill,
  listMeetings,
  scheduleMeeting,
  addSequence,
  addEmailTemplate,
  importContacts,
  addNote,
  parseContactImportRows,
};
