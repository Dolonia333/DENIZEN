'use strict';

const crmMutations = require('./denizen-crm-mutations');
const crmSetup = require('./denizen-crm-setup');
const chatActions = require('./denizen-crm-chat-actions');

const INTERACTIVE_ORDER = ['profile', 'packages', 'industry', 'contact', 'deal', 'invite', 'intake', 'ai'];
const _wizardSessions = new Map();
const WIZARD_TTL_MS = 2 * 60 * 60 * 1000;

const publicBaseUrl = chatActions.publicBaseUrl;
const buildCrmUrl = chatActions.buildCrmUrl;

function navAction(tab, label, extra = {}) {
  return chatActions.openTabAction(tab, label, extra);
}

function proposeSetupActions(setupSummary, message = '') {
  const msg = String(message || '').toLowerCase();
  const actions = [];
  const onboarding = setupSummary?.onboarding || setupSummary?.setup?.onboarding;

  if (onboarding?.next) {
    const n = onboarding.next;
    actions.push(navAction(n.tab, `Next: ${n.label}`, { subTab: n.subTab }));
    actions.push(chatActions.askNpcAction(n.owner, `Help me with CRM setup: ${n.label}`, `Ask ${n.owner}`));
  }

  if (msg.includes('intake') || onboarding?.next?.id === 'intake') {
    actions.push(navAction('intake', 'Open intake'));
  }
  if (msg.includes('package') || onboarding?.next?.id === 'packages') {
    actions.push(navAction('packages', 'Open packages'));
  }
  if (msg.includes('contact') || onboarding?.next?.id === 'contact') {
    actions.push(navAction('contacts', 'Add contacts'));
  }
  if (msg.includes('deal') || msg.includes('pipeline') || onboarding?.next?.id === 'deal') {
    actions.push(navAction('sales', 'Open pipeline', { subTab: 'pipeline' }));
  }
  if (msg.includes('industry') || onboarding?.next?.id === 'industry') {
    actions.push(navAction('settings', 'Pick industry'));
  }
  if (msg.includes('invite') || onboarding?.next?.id === 'invite') {
    actions.push(navAction('onboarding', 'Invite teammates'));
  }

  return actions.slice(0, 6);
}

function wizardSessionKey(sessionId, orgId) {
  return `${orgId || 'org'}:${sessionId || 'anon'}`;
}

function getWizardSession(key) {
  const row = _wizardSessions.get(key);
  if (!row) return null;
  if (Date.now() - row.updatedAt > WIZARD_TTL_MS) {
    _wizardSessions.delete(key);
    return null;
  }
  return row;
}

function saveWizardSession(key, data) {
  _wizardSessions.set(key, { ...data, updatedAt: Date.now() });
}

function enrichProfile(profile, params = {}) {
  const p = { ...(profile || {}) };
  if (!p.name && params.displayName) p.name = params.displayName;
  if (!p.title && params.workPosition?.title) p.title = params.workPosition.title;
  if (!p.name && params.profile?.name) p.name = params.profile.name;
  if (!p.title && params.profile?.title) p.title = params.profile.title;
  if (!p.email && params.profile?.email) p.email = params.profile.email;
  return p;
}

function inferIndustryId(params = {}) {
  if (params.industryId || params.templateId || params.industry) {
    return params.industryId || params.templateId || params.industry;
  }
  const industryBridge = require('./denizen-crm-industry-bridge');
  const fromTask = industryBridge.resolveIndustryId(params.task || '');
  if (fromTask) return fromTask;
  const title = String(params.workPosition?.title || params.profile?.title || '').toLowerCase();
  if (/saas|software|startup|product manager|pm\b/.test(title)) return industryBridge.resolveIndustryId('saas');
  if (/gov|contract|federal/.test(title)) return industryBridge.resolveIndustryId('govcon');
  if (/agency|marketing|creative/.test(title)) return industryBridge.resolveIndustryId('agency');
  return null;
}

function parseInviteFromParams(params = {}) {
  if (params.inviteEmail || params.invite?.email) {
    return {
      email: params.inviteEmail || params.invite.email,
      name: params.inviteName || params.invite?.name || '',
      platform: params.platform || params.invite?.platform || 'windows',
    };
  }
  const task = String(params.task || '');
  const emailM = task.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (!emailM) return null;
  let platform = 'windows';
  if (/\bmac|macos|apple\b/i.test(task)) platform = 'macos';
  if (/\blinux\b/i.test(task)) platform = 'linux';
  const nameM = task.match(/\b(?:invite|add)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  return { email: emailM[0], name: nameM?.[1] || '', platform };
}

function stepPrompt(stepId, onboarding) {
  const map = {
    profile: 'What name and job title should I put on your CRM profile?',
    packages: 'I can seed Starter / Pro / Enterprise packages — say "seed packages" or tap Open packages to customize.',
    industry: 'What industry fits your team? (SaaS, agency, govcon, legal, healthcare…)',
    contact: 'Who is your first contact? Give name + email (e.g. Jane Doe jane@acme.com at Acme).',
    deal: 'Want a first deal? Give a title, contact name, and optional value.',
    invite: 'Who should join the team? Give email + platform (Windows/Mac) — e.g. invite grandpa@email.com on Windows.',
    intake: 'Copy your public intake link below and share it with prospects.',
    ai: 'Last step: try the Meridian AI assistant in CRM.',
  };
  return map[stepId] || onboarding?.next?.label || 'Continue CRM setup';
}

function buildIntakeUrl(orgSlug) {
  return orgSlug
    ? `${publicBaseUrl()}/crm/intake.html?org=${encodeURIComponent(orgSlug)}`
    : `${publicBaseUrl()}/crm/intake.html`;
}

async function runInviteStep(orgId, orgSlug, invite, inviterName) {
  if (!invite?.email) return null;
  const { inviteTeamMember } = require('./denizen-crm-team-invite');
  const result = await inviteTeamMember(orgId, orgSlug, {
    email: invite.email,
    displayName: invite.name || undefined,
    platform: invite.platform || 'windows',
  }, inviterName || 'Your team');
  return result;
}

async function runSetupWizard(orgId, {
  mode = 'run_all',
  stepId = null,
  identityId = null,
  orgSlug = null,
  sessionId = null,
  profile = null,
  displayName = null,
  workPosition = null,
  industryId = null,
  contact = null,
  deal = null,
  seedPackages = true,
  task = '',
  teamCount = null,
  inviterName = null,
  inviteEmail = null,
  inviteName = null,
  platform = null,
} = {}) {
  const enrichedProfile = enrichProfile(profile, { displayName, workPosition, profile });
  const resolvedIndustry = industryId || inferIndustryId({ task, workPosition, profile: enrichedProfile });
  const invite = parseInviteFromParams({ task, inviteEmail, inviteName, platform });

  if (mode === 'interactive' || mode === 'continue') {
    return runInteractiveWizard(orgId, {
      sessionId,
      identityId,
      orgSlug,
      profile: enrichedProfile,
      industryId: resolvedIndustry,
      contact,
      deal,
      seedPackages,
      task,
      teamCount,
      inviterName,
      invite,
    });
  }

  const results = [];
  const crm_actions = [];
  const ctx = { profile: enrichedProfile, teamCount };

  async function refresh() {
    return crmMutations.getSetupStatus(orgId, ctx);
  }

  const runStep = async (id, fn) => {
    try {
      const out = await fn();
      results.push({ id, ok: true, summary: out?.summary || out?.message || 'done', detail: out });
      return out;
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err) });
      return null;
    }
  };

  const stepsToRun = mode === 'run_step' && stepId
    ? [stepId]
    : ['profile', 'industry', 'packages', 'contact', 'deal', 'ai'];

  for (const step of stepsToRun) {
    if (step === 'profile' && enrichedProfile?.name) {
      await runStep('profile', () => crmMutations.updateUserProfile(orgId, enrichedProfile, identityId));
    }
    if (step === 'industry' && resolvedIndustry) {
      await runStep('industry', () => crmMutations.applyIndustry(orgId, {
        templateId: resolvedIndustry,
        npcName: 'setup-wizard',
      }, identityId));
    }
    if (step === 'packages' && seedPackages) {
      await runStep('packages', () => crmMutations.seedStarterPackages(orgId, {}, identityId));
    }
    if (step === 'contact' && contact && (contact.name || contact.email)) {
      await runStep('contact', () => crmMutations.addContact(orgId, contact, identityId));
    }
    if (step === 'deal' && deal && deal.title) {
      await runStep('deal', () => crmMutations.addDeal(orgId, deal, identityId));
    }
    if (step === 'ai') {
      await runStep('ai', () => crmMutations.markOnboardingFlag(orgId, 'triedAi', identityId));
      crm_actions.push(navAction('ai', 'Open Meridian AI'));
    }
  }

  if (invite?.email) {
    const inv = await runInviteStep(orgId, orgSlug, invite, inviterName);
    if (inv?.ok) {
      results.push({ id: 'invite', ok: true, summary: inv.emailed ? `Invite emailed to ${invite.email}` : `Invite ready for ${invite.email}` });
      if (inv.joinUrl) crm_actions.push(chatActions.copyLinkAction(inv.joinUrl, 'Copy team join link'));
      if (inv.email_draft) crm_actions.push(chatActions.copyTextAction(inv.email_draft, 'Copy invite email'));
    } else if (inv) {
      results.push({ id: 'invite', ok: false, error: inv.error || 'invite failed' });
    }
  }

  const status = await refresh();
  const onboarding = status.setup?.onboarding;
  const intakeUrl = buildIntakeUrl(orgSlug);

  if (onboarding?.next) {
    crm_actions.unshift(navAction(onboarding.next.tab, `Next: ${onboarding.next.label}`));
    crm_actions.push(chatActions.askNpcAction(onboarding.next.owner, `Help me with: ${onboarding.next.label}`, `Ask ${onboarding.next.owner}`));
  }

  const lines = [
    `CRM setup — ${onboarding?.completed || 0}/${onboarding?.total || 8} complete (${onboarding?.percent || 0}%).`,
  ];
  for (const r of results) {
    lines.push(r.ok ? `✓ ${r.id}: ${r.summary}` : `✗ ${r.id}: ${r.error}`);
  }
  if (onboarding?.next) {
    lines.push(`${onboarding.next.owner}: ${stepPrompt(onboarding.next.id, onboarding)}`);
  }
  if (!onboarding?.done?.intake) {
    lines.push(`Intake link: ${intakeUrl}`);
    crm_actions.push(chatActions.copyLinkAction(intakeUrl, 'Copy intake link'));
  }

  return {
    summary: lines.join('\n'),
    setup: status.setup,
    steps: results,
    crm_actions: chatActions.normalizeCrmActions(
      proposeSetupActions(status.setup, task).concat(crm_actions),
    ),
    intake_url: intakeUrl,
    wizard_mode: mode,
  };
}

async function runInteractiveWizard(orgId, params) {
  const key = wizardSessionKey(params.sessionId, orgId);
  const session = getWizardSession(key) || { cursor: 0, ran: new Set() };
  const ctx = { profile: params.profile, teamCount: params.teamCount };
  const results = [];
  const crm_actions = [];
  const intakeUrl = buildIntakeUrl(params.orgSlug);

  let status = await crmMutations.getSetupStatus(orgId, ctx);
  let done = status.setup?.onboarding?.done || {};

  async function tryAuto(id, fn, guard = true) {
    if (guard && done[id]) return true;
    if (session.ran.has(id)) return done[id];
    try {
      const out = await fn();
      session.ran.add(id);
      results.push({ id, ok: true, summary: out?.summary || 'done' });
      status = await crmMutations.getSetupStatus(orgId, ctx);
      done = status.setup?.onboarding?.done || {};
      return true;
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err) });
      return false;
    }
  }

  if (!done.profile && params.profile?.name) {
    await tryAuto('profile', () => crmMutations.updateUserProfile(orgId, params.profile, params.identityId));
  }
  if (!done.packages && params.seedPackages !== false) {
    await tryAuto('packages', () => crmMutations.seedStarterPackages(orgId, {}, params.identityId));
  }
  if (!done.industry && params.industryId) {
    await tryAuto('industry', () => crmMutations.applyIndustry(orgId, {
      templateId: params.industryId,
      npcName: 'setup-wizard',
    }, params.identityId));
  }
  if (!done.contact && params.contact && (params.contact.name || params.contact.email)) {
    await tryAuto('contact', () => crmMutations.addContact(orgId, params.contact, params.identityId));
  }
  if (!done.deal && params.deal?.title) {
    await tryAuto('deal', () => crmMutations.addDeal(orgId, params.deal, params.identityId));
  }
  if (params.invite?.email && !done.invite) {
    const inv = await runInviteStep(orgId, params.orgSlug, params.invite, params.inviterName);
    if (inv?.ok) {
      session.ran.add('invite');
      results.push({ id: 'invite', ok: true, summary: inv.emailed ? `Invite sent to ${params.invite.email}` : `Invite draft ready for ${params.invite.email}` });
      if (inv.joinUrl) crm_actions.push(chatActions.copyLinkAction(inv.joinUrl, 'Copy join link'));
      if (inv.email_draft) crm_actions.push(chatActions.copyTextAction(inv.email_draft, 'Copy invite email'));
      status = await crmMutations.getSetupStatus(orgId, { ...ctx, teamCount: (params.teamCount || 0) + 1 });
      done = status.setup?.onboarding?.done || {};
    }
  }

  const onboarding = status.setup?.onboarding;
  const next = onboarding?.steps?.find((s) => !s.done) || onboarding?.next;
  saveWizardSession(key, session);

  const lines = [
    `CRM setup — ${onboarding?.completed || 0}/${onboarding?.total || 8} (${onboarding?.percent || 0}%).`,
  ];
  for (const r of results) {
    lines.push(r.ok ? `✓ ${r.summary}` : `✗ ${r.id}: ${r.error}`);
  }

  let wizard_prompt = null;
  if (next && !onboarding?.steps?.every((s) => s.done)) {
    wizard_prompt = stepPrompt(next.id, onboarding);
    lines.push(`\n${next.owner}: ${wizard_prompt}`);
    crm_actions.push(navAction(next.tab, `Open ${next.label}`, { subTab: next.subTab }));
    crm_actions.push(chatActions.askNpcAction(next.owner, `Help me with CRM: ${next.label}`, `Ask ${next.owner}`));
  } else {
    lines.push('\nSetup complete — your CRM workspace is ready.');
    crm_actions.push(navAction('dashboard', 'Open CRM dashboard'));
    _wizardSessions.delete(key);
  }

  if (!done.intake) {
    lines.push(`Intake: ${intakeUrl}`);
    crm_actions.push(chatActions.copyLinkAction(intakeUrl, 'Copy intake link'));
  }

  return {
    summary: lines.join('\n'),
    setup: status.setup,
    steps: results,
    wizard_prompt,
    wizard_next: next?.id || null,
    wizard_complete: !next,
    crm_actions: chatActions.normalizeCrmActions(crm_actions),
    intake_url: intakeUrl,
    wizard_mode: 'interactive',
  };
}

function buildSetupNudge(state, ctx = {}) {
  const setup = crmSetup.buildSetupSummary(state, ctx);
  const next = setup.onboarding?.next;
  if (!next || setup.onboarding.completed >= setup.onboarding.total) return null;
  const intakeUrl = buildIntakeUrl(ctx.orgSlug);
  const actions = [
    navAction(next.tab, `Open ${next.label}`),
    chatActions.askNpcAction(next.owner, `Help me finish CRM setup: ${next.label}`, `Ask ${next.owner}`),
  ];
  if (next.id === 'intake') actions.push(chatActions.copyLinkAction(intakeUrl, 'Copy intake link'));
  if (next.id === 'invite') actions.push(navAction('onboarding', 'Invite teammates'));
  return {
    npcName: next.owner,
    text: `CRM setup ${setup.onboarding.completed}/${setup.onboarding.total} — next: ${next.label}. Say "continue CRM setup" or tap a button below.`,
    crm_actions: chatActions.normalizeCrmActions(actions),
  };
}

module.exports = {
  publicBaseUrl,
  buildCrmUrl,
  buildIntakeUrl,
  navAction,
  proposeSetupActions,
  runSetupWizard,
  runInteractiveWizard,
  buildSetupNudge,
  enrichProfile,
  inferIndustryId,
  INTERACTIVE_ORDER,
};
