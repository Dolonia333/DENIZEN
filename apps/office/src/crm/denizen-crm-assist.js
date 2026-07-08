'use strict';

const { buildAssistPersonaBlock, resolvePersona } = require('./denizen-crm-npc-personas');

function summarizeWorkspace(state = {}) {
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const notes = Array.isArray(state.notes) ? state.notes : [];
  const companies = Array.isArray(state.companies) ? state.companies : [];
  const submissions = Array.isArray(state.submissions) ? state.submissions : [];
  const quotes = Array.isArray(state.quotes) ? state.quotes : [];
  const today = new Date().toISOString().slice(0, 10);

  const openDeals = deals.filter((d) => d && !/closed won|closed lost/i.test(String(d.stage || '')));
  const atRisk = openDeals.filter((d) => d.health === 'at-risk');
  const pendingTasks = tasks.filter((t) => t && !t.done);
  const overdueTasks = pendingTasks.filter((t) => t.due && String(t.due) < today);
  const pipelineValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const weighted = openDeals.reduce((s, d) => s + (Number(d.value) || 0) * ((Number(d.probability) || 0) / 100), 0);
  const newSubmissions = submissions.filter((s) => /new|review/i.test(String(s?.status || '')));
  const tickets = Array.isArray(state.supportTickets) ? state.supportTickets : [];
  const openTickets = tickets.filter((t) => t && (t.status === 'open' || t.status === 'pending'));
  const overdueTickets = openTickets.filter((t) => t.slaDue && String(t.slaDue) < today);
  const campaigns = Array.isArray(state.marketingCampaigns) ? state.marketingCampaigns : [];
  const activeCampaigns = campaigns.filter((c) => c && c.status === 'active');

  return {
    contactCount: contacts.length,
    companyCount: companies.length,
    dealCount: deals.length,
    openDealCount: openDeals.length,
    atRiskCount: atRisk.length,
    pendingTaskCount: pendingTasks.length,
    overdueTaskCount: overdueTasks.length,
    newSubmissionCount: newSubmissions.length,
    openTicketCount: openTickets.length,
    overdueTicketCount: overdueTickets.length,
    activeCampaignCount: activeCampaigns.length,
    openQuoteCount: quotes.filter((q) => !/signed|paid|lost/i.test(String(q?.status || ''))).length,
    pipelineValue,
    weightedPipeline: weighted,
    topDeals: openDeals
      .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
      .slice(0, 12)
      .map((d) => ({
        title: d.title,
        contact: d.contact,
        stage: d.stage,
        value: d.value,
        probability: d.probability,
        health: d.health,
        daysInStage: d.daysInStage,
      })),
    topTasks: pendingTasks
      .sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))
      .slice(0, 10)
      .map((t) => ({
        title: t.title,
        due: t.due,
        priority: t.priority,
        contact: t.contact,
        overdue: !!(t.due && String(t.due) < today),
      })),
    recentNotes: notes.slice(-8).map((n) => ({
      contact: n.contact,
      type: n.type,
      text: String(n.text || '').slice(0, 120),
      date: n.date,
    })),
    atRiskDeals: atRisk.slice(0, 6).map((d) => ({ title: d.title, contact: d.contact, value: d.value, stage: d.stage })),
    openTickets: openTickets.slice(0, 8).map((t) => ({
      subject: t.subject,
      contact: t.contact,
      status: t.status,
      priority: t.priority,
      assignee: t.assignee,
      overdue: !!(t.slaDue && String(t.slaDue) < today),
    })),
    activeCampaigns: activeCampaigns.slice(0, 5).map((c) => ({ name: c.name, enrolledCount: c.enrolledCount, sentCount: c.sentCount })),
    companiesAtRisk: companies.filter((c) => c.health === 'at-risk').slice(0, 5).map((c) => ({ name: c.name, arr: c.arr, health: c.health })),
    setup: (() => {
      try {
        const crmSetup = require('./denizen-crm-setup');
        return crmSetup.computeOnboardingProgress(state);
      } catch (_) {
        return null;
      }
    })(),
    industry: state.industryConfig?.id
      ? { id: state.industryConfig.id, name: state.industryConfig.name, icon: state.industryConfig.icon }
      : null,
  };
}

function proposeActions(message, summary) {
  const lq = String(message || '').toLowerCase();
  const actions = [];

  if (summary.overdueTaskCount > 0 && (lq.includes('focus') || lq.includes('today') || lq.includes('priority'))) {
    const t = summary.topTasks.find((x) => x.overdue) || summary.topTasks[0];
    if (t) actions.push({ type: 'open_tab', tab: 'schedule', label: `View task: ${t.title}` });
  }

  if (summary.atRiskCount > 0 && (lq.includes('risk') || lq.includes('pipeline') || lq.includes('focus'))) {
    const d = summary.atRiskDeals[0];
    if (d) actions.push({ type: 'open_tab', tab: 'sales', label: `Review at-risk: ${d.title}` });
  }

  if (lq.includes('follow') || lq.includes('email') || lq.includes('draft')) {
    const d = summary.topDeals[0];
    if (d) {
      actions.push({
        type: 'create_task',
        label: `Follow up: ${d.contact}`,
        payload: {
          title: `Follow up with ${d.contact} on ${d.title}`,
          contact: d.contact,
          priority: 'High',
        },
      });
    }
  }

  if (summary.newSubmissionCount > 0 && lq.includes('intake')) {
    actions.push({ type: 'open_tab', tab: 'intake', label: `Review ${summary.newSubmissionCount} intake submission(s)` });
  }

  if (summary.openTicketCount > 0 && (lq.includes('ticket') || lq.includes('support'))) {
    actions.push({ type: 'open_tab', tab: 'support', label: `View ${summary.openTicketCount} open ticket(s)` });
  }

  if (summary.activeCampaignCount > 0 && (lq.includes('campaign') || lq.includes('marketing'))) {
    actions.push({ type: 'open_tab', tab: 'marketing', label: `Review ${summary.activeCampaignCount} active campaign(s)` });
  }

  if (summary.setup && summary.setup.next && (lq.includes('setup') || lq.includes('onboarding') || lq.includes('getting started'))) {
    actions.push({
      type: 'open_tab',
      tab: summary.setup.next.tab,
      label: `Next setup: ${summary.setup.next.label}`,
    });
  }

  if (lq.includes('industry') || lq.includes('vertical')) {
    actions.push({ type: 'open_tab', tab: 'settings', label: 'Pick industry template' });
  }

  return actions.slice(0, 4);
}

function pickProvider(npcBrains) {
  if (!npcBrains?.providers) return null;
  const order = ['lmstudio', 'claude', 'grok', 'gemini', 'kimi', 'moonshot'];
  for (const key of order) {
    const cfg = npcBrains.providers[key];
    if (cfg && cfg.type !== 'demo' && (cfg.apiKey || cfg.baseUrl || cfg.type === 'lmstudio')) {
      return { key, cfg };
    }
  }
  return null;
}

function fallbackReply(message, summary) {
  const lq = String(message || '').toLowerCase();
  if (lq.includes('pipeline') || lq.includes('summary')) {
    return `Pipeline: ${summary.openDealCount} open deals (${summary.pipelineValue.toLocaleString()} total), weighted ${Math.round(summary.weightedPipeline).toLocaleString()}. ${summary.atRiskCount} at-risk, ${summary.overdueTaskCount} overdue tasks, ${summary.newSubmissionCount} new intakes.`;
  }
  if (lq.includes('focus') || lq.includes('today') || lq.includes('priority')) {
    const parts = [];
    if (summary.overdueTaskCount) parts.push(`${summary.overdueTaskCount} overdue task(s) need attention.`);
    if (summary.atRiskDeals[0]) parts.push(`At-risk: ${summary.atRiskDeals[0].title} (${summary.atRiskDeals[0].contact}).`);
    if (summary.topDeals[0]) parts.push(`Top deal: ${summary.topDeals[0].title} at ${summary.topDeals[0].stage}.`);
    if (summary.setup?.next) parts.push(`CRM setup next: ${summary.setup.next.label} (${summary.setup.next.owner}).`);
    return parts.length ? parts.join(' ') : 'No urgent items — good time to prospect or review intake.';
  }
  if (lq.includes('setup') || lq.includes('onboarding')) {
    if (summary.setup?.next) {
      return `CRM setup ${summary.setup.completed}/${summary.setup.total} complete. Next: ${summary.setup.next.label} — ask ${summary.setup.next.owner} or open /crm/ → ${summary.setup.next.tab}.`;
    }
    return 'CRM setup looks complete. Ask about pipeline, tasks, or industry template tweaks.';
  }
  return `You have ${summary.openDealCount} open deals, ${summary.pendingTaskCount} open tasks (${summary.overdueTaskCount} overdue), and ${summary.companyCount} companies. Setup ${summary.setup?.completed || 0}/${summary.setup?.total || 7}. Ask about pipeline, priorities, intake, industry, or follow-ups.`;
}

async function crmAssist(npcBrains, message, state, opts = {}) {
  const text = String(message || '').trim().slice(0, 2000);
  if (!text) throw new Error('message required');
  const summary = summarizeWorkspace(state);
  const actions = proposeActions(text, summary);
  const persona = resolvePersona(opts.npcKey || opts.npcName);
  const picked = pickProvider(npcBrains);
  if (!picked?.cfg || typeof npcBrains._callProvider !== 'function') {
    const prefix = persona ? `${persona.name} (${persona.title}): ` : '';
    return { reply: prefix + fallbackReply(text, summary), source: 'rules', summary, actions, persona: persona?.key || null };
  }

  const personaBlock = buildAssistPersonaBlock(opts.npcKey || opts.npcName);
  const system = [
    personaBlock || 'You are a concise CRM sales copilot for a Denizen team workspace.',
    'Answer using ONLY the workspace snapshot below. Be practical and brief (under 220 words).',
    'If setup is incomplete, name the next onboarding step and which teammate owns it.',
    'If data is missing, say what to add in the CRM at /crm/. Plain text; short bullets ok.',
    `Snapshot: ${JSON.stringify(summary)}`,
  ].join('\n');

  try {
    const raw = await npcBrains._callProvider(
      picked.cfg,
      system,
      [{ role: 'user', content: text }],
      { maxTokens: 500, sliceLen: 1600, temperature: 0.6 },
    );
    const reply = String(raw || '').trim() || fallbackReply(text, summary);
    return { reply, source: picked.key, summary, actions, persona: persona?.key || null };
  } catch (err) {
    const prefix = persona ? `${persona.name}: ` : '';
    return {
      reply: prefix + fallbackReply(text, summary),
      source: 'rules',
      error: err?.message || String(err),
      summary,
      actions,
      persona: persona?.key || null,
    };
  }
}

function mergeWorkspaceStates(serverState, clientState) {
  if (!clientState || typeof clientState !== 'object') return serverState || {};
  if (!serverState || typeof serverState !== 'object') return clientState;
  const out = { ...serverState };
  for (const key of Object.keys(clientState)) {
    const cv = clientState[key];
    const sv = serverState[key];
    if (Array.isArray(cv) && cv.length > 0 && (!Array.isArray(sv) || sv.length === 0)) {
      out[key] = cv;
    } else if (cv && typeof cv === 'object' && !Array.isArray(cv) && Object.keys(cv).length > 0) {
      if (!sv || typeof sv !== 'object' || Object.keys(sv).length === 0) out[key] = cv;
    }
  }
  return out;
}

module.exports = {
  crmAssist,
  summarizeWorkspace,
  proposeActions,
  mergeWorkspaceStates,
};
